/**
 * Injection-spawn: create a fresh session whose first model-visible context
 * is one digest message per parent, then persist the card and injection
 * edges in the same operation.
 *
 * Follows apiproxy's fork handler (api-proxy.ts:2363-2459) minus the seed:
 * no history slice means no dangling tool calls, so the deployment-default
 * agent composition is always safe and no preset re-composition is needed.
 * The injected messages ride agent.inject() — durable agent/inbox/spliced
 * events claimed at the next step, surviving restarts unread.
 */
import type { SpawnHostServices, UserMessageLite, AgentHandleLite } from './dsh-host.ts'
import type { TalkMapStore, Card, MapEdge } from './store.ts'

export interface SpawnParent {
  cardId: string
  sessionId: string
  /** The (possibly user-edited) context text to inject. */
  text: string
}

export interface SpawnRequest {
  parents: SpawnParent[]
  boardId: string
  x: number
  y: number
  /** Map group the new card lands in (frame membership). */
  wsOverride?: string
}

export interface SpawnResult {
  sessionId: string
  cardId: string
  card: Card
  edges: Record<string, MapEdge>
}

export class Spawner {
  /** Live handles: dropping one disposes the agent AND removes its session from the live store — keep them. */
  private readonly handles = new Map<string, AgentHandleLite>()

  constructor(
    private readonly services: SpawnHostServices,
    private readonly storeReady: Promise<TalkMapStore>,
  ) {}

  async spawn(request: SpawnRequest): Promise<SpawnResult> {
    if (request.parents.length === 0) throw new Error('spawn needs at least one parent')
    const store = await this.storeReady
    const first = request.parents[0]
    if (first === undefined) throw new Error('spawn needs at least one parent')

    const records = await this.services.sessionQuery.listSessions()
    const parentRecord = records.find(record => record.header.id === first.sessionId)

    const sessionId = `session-${crypto.randomUUID()}`
    const handle = await this.services.agents.create({
      sessionId,
      meta: {
        ...(parentRecord?.header.cwd !== undefined ? { cwd: parentRecord.header.cwd } : {}),
        parentSession: first.sessionId,
      },
    })
    this.handles.set(sessionId, handle)

    // Attach to the parent's workspace so the shell binds the new session
    // immediately (same cwd → the registry's validation passes); without
    // this the composer greys out asking to pick a workspace.
    if (parentRecord?.header.cwd !== undefined) {
      try {
        const workspace = await this.services.workspaceRegistry.resolveByPath(parentRecord.header.cwd)
        await workspace?.attachSession(sessionId)
      } catch (error) {
        this.services.logger?.warn(`[dsh-talk-map] workspace attach failed: ${String(error)}`)
      }
    }

    for (const parent of request.parents) {
      const message: UserMessageLite = {
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: parent.text }],
        source: {
          kind: 'plugin',
          plugin: 'dsh-talk-map',
          form: 'notice',
          summary: `Context injected from session ${parent.sessionId}`,
        },
      }
      handle.agent.inject(message)
    }

    const cardId = `card-${crypto.randomUUID()}`
    const card: Card = {
      boardId: request.boardId,
      sessionId,
      x: request.x,
      y: request.y,
      ...(request.wsOverride !== undefined ? { wsOverride: request.wsOverride } : {}),
      createdAt: Date.now(),
    }
    await store.cards.put(cardId, card)

    const edges: Record<string, MapEdge> = {}
    for (const parent of request.parents) {
      const edgeId = `edge-${crypto.randomUUID()}`
      const edge: MapEdge = {
        boardId: request.boardId,
        fromCardId: parent.cardId,
        toCardId: cardId,
        injection: { kind: 'digest', injectedText: parent.text },
        createdAt: Date.now(),
      }
      await store.edges.put(edgeId, edge)
      edges[edgeId] = edge
    }

    this.services.logger?.info?.(`[dsh-talk-map] spawned ${sessionId} from ${request.parents.length} parent(s)`)
    return { sessionId, cardId, card, edges }
  }
}
