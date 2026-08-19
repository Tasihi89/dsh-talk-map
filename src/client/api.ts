/**
 * Thin fetch/EventSource layer over the host half's /talk-map/* routes.
 * Same-origin by construction (relative URLs against the serving shell).
 */
import type { Card, Digest, MapEdgeData, MapGlobal, MapStatePayload } from '../shared/model.ts'

/** Error shape thrown on non-2xx: `code` carries the host's structured
 * error code (e.g. 'session-not-live') when the body provides one. */
export interface ApiError extends Error {
  code?: string
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    let detail = ''
    let code: string | undefined
    try {
      // Stringify before reading .code: a legal JSON body of `null` must
      // still land in the error message.
      const body = await response.json() as unknown
      detail = JSON.stringify(body)
      if (typeof body === 'object' && body !== null) {
        const bodyCode = (body as { code?: unknown }).code
        if (typeof bodyCode === 'string') code = bodyCode
      }
    } catch { /* body not json */ }
    const error: ApiError = new Error(`${path} → ${response.status} ${detail}`)
    if (code !== undefined) error.code = code
    throw error
  }
  return await response.json() as T
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const talkMapApi = {
  getState(): Promise<MapStatePayload> {
    return requestJson<MapStatePayload>('/talk-map/state')
  },
  upsertCards(cards: Record<string, Card>): Promise<void> {
    return postJson('/talk-map/cards/upsert', { cards })
  },
  deleteCards(ids: readonly string[]): Promise<void> {
    return postJson('/talk-map/cards/delete', { ids })
  },
  upsertEdges(edges: Record<string, MapEdgeData>): Promise<void> {
    return postJson('/talk-map/edges/upsert', { edges })
  },
  deleteEdges(ids: readonly string[]): Promise<void> {
    return postJson('/talk-map/edges/delete', { ids })
  },
  setGlobal(global: MapGlobal): Promise<void> {
    return postJson('/talk-map/global', { global })
  },
  spawn(request: {
    parents: { cardId: string; sessionId: string; text: string }[]
    boardId: string
    x: number
    y: number
    wsOverride?: string
  }): Promise<{ sessionId: string; cardId: string; card: Card; edges: Record<string, MapEdgeData> }> {
    return postJson('/talk-map/spawn', request)
  },
  injectContext(sessionId: string, parents: { sessionId: string; text: string }[]): Promise<{ ok: true }> {
    return postJson('/talk-map/inject', { sessionId, parents })
  },
  refreshDigest(sessionId: string): Promise<{ sessionId: string; digest: Digest }> {
    return postJson('/talk-map/digest/refresh', { sessionId })
  },
  ensureDir(path: string): Promise<{ ok: true; path: string }> {
    return postJson('/talk-map/fs/ensure-dir', { path })
  },
  getDefaults(): Promise<{
    model: { provider: string; model: string; reasoningEffort?: string } | null
    preset: string | null
  }> {
    return requestJson('/talk-map/defaults')
  },
  /**
   * Subscribe to host-side domain changes (multi-tab sync, digest arrivals).
   * @returns disposer closing the EventSource.
   */
  subscribeChanges(onChange: (change: {
    table: string
    key: string
    operation: 'put' | 'deleted'
    value?: unknown
  }) => void): () => void {
    const source = new EventSource('/talk-map/events')
    source.addEventListener('change', (event) => {
      try {
        onChange(JSON.parse((event as MessageEvent).data as string))
      } catch { /* malformed frame — skip */ }
    })
    return () => { source.close() }
  },
}
