/**
 * HTTP surface bridging the browser map to the host. Everything lives under
 * the /talk-map/ prefix — deliberately NOT /api (that prefix carries dsh's
 * browser-trust fence). Mutations accept same-origin browser requests and
 * origin-less local tools (curl); a cross-origin browser POST is refused.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { DomainChanged, TalkMapHostServices } from './dsh-host.ts'
import type { DigestPipeline } from './digest/pipeline.ts'
import type { Spawner } from './spawn.ts'
import { cardSchema, globalSchema, DOMAIN_NAME, type TalkMapStore } from './store.ts'

/**
 * Capabilities filled in by independently-injected layers: the digest layer
 * needs llm + sessionQuery, the spawn layer needs agents. Either can be
 * missing in an unusual composition — routes answer 503 rather than the
 * whole plugin refusing to mount.
 */
export interface TalkMapRuntime {
  digest?: DigestPipeline
  spawner?: Spawner
  /** Deployment default model route (from ctx.agentDefaultModel). */
  modelDefault?: () => { provider: string; model: string; reasoningEffort?: string }
  /** Deployment default agent preset id (from ctx.agentPresets). */
  presetDefault?: () => string
}

const MAX_BODY_BYTES = 1024 * 1024

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(payload)
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (origin === undefined) return true // curl / same-machine tooling
  const host = request.headers.host
  if (host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? undefined : JSON.parse(text)
}

function tableToRecord<V>(table: { entries(): IterableIterator<[string, V]> }): Record<string, V> {
  const out: Record<string, V> = {}
  for (const [key, value] of table.entries()) out[key] = value
  return out
}

const upsertCardsBody = z.object({
  cards: z.record(z.string(), cardSchema),
})
const deleteCardsBody = z.object({
  ids: z.array(z.string()),
})
const setGlobalBody = z.object({
  global: globalSchema,
})
const spawnBody = z.object({
  parents: z.array(z.object({
    cardId: z.string(),
    sessionId: z.string(),
    text: z.string().min(1),
  })).min(1),
  boardId: z.string(),
  x: z.number(),
  y: z.number(),
  wsOverride: z.string().optional(),
})
const refreshDigestBody = z.object({
  sessionId: z.string(),
})

/**
 * Register the /talk-map/ routes.
 * @param services - host services (webServer + event bus).
 * @param storeReady - resolves when the storage domain is open; handlers await it.
 * @returns disposer removing the route registration and closing SSE clients.
 */
export function mountTalkMapRoutes(
  services: TalkMapHostServices,
  storeReady: Promise<TalkMapStore>,
  runtime: TalkMapRuntime,
): () => void {
  const sseClients = new Set<ServerResponse>()

  const offChanged = services.on('domain/changed', (...args: unknown[]) => {
    const change = args[0] as DomainChanged
    if (change.domain !== DOMAIN_NAME) return
    const frame = `event: change\ndata: ${JSON.stringify(change)}\n\n`
    for (const client of sseClients) client.write(frame)
  })

  const ping = setInterval(() => {
    for (const client of sseClients) client.write(': ping\n\n')
  }, 25_000)
  ping.unref?.()

  const unregister = services.webServer.register({
    kind: 'prefix',
    // NOTE: webserver prefix p matches `p` and `p/<anything>` — no trailing slash.
    path: '/talk-map',
    handler: async (request, response) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
      const route = `${request.method ?? 'GET'} ${url.pathname}`
      try {
        if (route === 'GET /talk-map/state') {
          const store = await storeReady
          sendJson(response, 200, {
            boards: tableToRecord(store.boards),
            cards: tableToRecord(store.cards),
            edges: tableToRecord(store.edges),
            digests: tableToRecord(store.digests),
            global: store.global(),
          })
          return
        }

        if (route === 'GET /talk-map/defaults') {
          let model: unknown = null
          let preset: unknown = null
          try {
            model = runtime.modelDefault?.() ?? null
          } catch { /* unresolved default model config */ }
          try {
            preset = runtime.presetDefault?.() ?? null
          } catch { /* no presets composed */ }
          sendJson(response, 200, { model, preset })
          return
        }

        if (route === 'GET /talk-map/events') {
          response.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            'connection': 'keep-alive',
          })
          response.write(': connected\n\n')
          sseClients.add(response)
          request.on('close', () => { sseClients.delete(response) })
          return
        }

        if (request.method === 'POST' && !sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin request refused' })
          return
        }

        if (route === 'POST /talk-map/cards/upsert') {
          const store = await storeReady
          const body = upsertCardsBody.parse(await readJsonBody(request))
          for (const [id, card] of Object.entries(body.cards)) {
            await store.cards.put(id, card)
          }
          sendJson(response, 200, { ok: true, count: Object.keys(body.cards).length })
          return
        }

        if (route === 'POST /talk-map/cards/delete') {
          const store = await storeReady
          const body = deleteCardsBody.parse(await readJsonBody(request))
          let removed = 0
          for (const id of body.ids) {
            if (await store.cards.delete(id)) removed += 1
          }
          // A card's edges die with it — a dangling edge renders nothing anyway.
          for (const [edgeId, edge] of [...store.edges.entries()]) {
            if (body.ids.includes(edge.fromCardId) || body.ids.includes(edge.toCardId)) {
              await store.edges.delete(edgeId)
            }
          }
          sendJson(response, 200, { ok: true, removed })
          return
        }

        if (route === 'POST /talk-map/edges/delete') {
          const store = await storeReady
          const body = deleteCardsBody.parse(await readJsonBody(request))
          let removed = 0
          for (const id of body.ids) {
            if (await store.edges.delete(id)) removed += 1
          }
          sendJson(response, 200, { ok: true, removed })
          return
        }

        if (route === 'POST /talk-map/global') {
          const store = await storeReady
          const body = setGlobalBody.parse(await readJsonBody(request))
          await store.setGlobal(body.global)
          sendJson(response, 200, { ok: true })
          return
        }

        if (route === 'POST /talk-map/spawn') {
          if (runtime.spawner === undefined) {
            sendJson(response, 503, { error: 'spawn layer unavailable (agents service missing)' })
            return
          }
          const body = spawnBody.parse(await readJsonBody(request))
          const result = await runtime.spawner.spawn(body)
          sendJson(response, 200, result)
          return
        }

        if (route === 'POST /talk-map/digest/refresh') {
          if (runtime.digest === undefined) {
            sendJson(response, 503, { error: 'digest layer unavailable (llm service missing)' })
            return
          }
          const body = refreshDigestBody.parse(await readJsonBody(request))
          const digest = await runtime.digest.refresh(body.sessionId)
          sendJson(response, 200, { sessionId: body.sessionId, digest })
          return
        }

        sendJson(response, 404, { error: `no such route: ${route}` })
      } catch (error) {
        services.logger?.warn(`[dsh-talk-map] ${route} failed: ${String(error)}`)
        if (!response.headersSent) {
          sendJson(response, 400, { error: String(error) })
        } else {
          response.end()
        }
      }
    },
  })

  return () => {
    clearInterval(ping)
    offChanged()
    for (const client of sseClients) client.end()
    sseClients.clear()
    unregister()
  }
}
