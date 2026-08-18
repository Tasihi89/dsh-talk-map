/**
 * The talk-map storage domain: canvas-private data only. Session content,
 * titles, and lineage stay with dsh's own services — this domain stores what
 * the map adds on top (positions, user-drawn injection edges, digests, and
 * per-board camera). Persisted by the profile's storage-json backend under
 * $DSH_HOME/storages/.
 *
 * CardId ≠ SessionId on purpose: a later "alias card" feature (the same
 * session appearing on several boards) then needs no migration.
 */
import { z } from 'zod'
import type { Domain, DomainSpec, KvTable } from './dsh-host.ts'

/** Storage unit names must match /^[a-z][a-z0-9_]*$/ — no hyphens. */
export const DOMAIN_NAME = 'talk_map'
/** The bootstrap board every unfiled card lands on. */
export const INBOX_BOARD_ID = 'inbox'

export const boardSchema = z.object({
  name: z.string(),
  color: z.string(),
  order: z.number(),
  createdAt: z.number(),
  archivedAt: z.number().optional(),
  shelvedAt: z.number().optional(),
})
export type Board = z.infer<typeof boardSchema>

export const cardSchema = z.object({
  boardId: z.string(),
  sessionId: z.string(),
  x: z.number(),
  y: z.number(),
  colorTag: z.string().optional(),
  createdAt: z.number(),
})
export type Card = z.infer<typeof cardSchema>

export const edgeInjectionSchema = z.object({
  kind: z.enum(['digest', 'full', 'selection']),
  /** What was actually injected (post-edit), kept for provenance display. */
  injectedText: z.string().optional(),
})
export const edgeSchema = z.object({
  boardId: z.string(),
  fromCardId: z.string(),
  toCardId: z.string(),
  injection: edgeInjectionSchema,
  createdAt: z.number(),
})
export type MapEdge = z.infer<typeof edgeSchema>

export const digestSchema = z.object({
  /** Last session event seq folded into this digest (staleness anchor). */
  atSeq: z.number(),
  summary: z.string(),
  keyFindings: z.array(z.string()),
  /** The ADHD field: one imperative sentence — the next concrete action. */
  nextStep: z.string(),
  /** Zero-cost fallback lifted from the session's todo/write events. */
  todoNext: z.string().optional(),
  generatedAt: z.number(),
  model: z.string().optional(),
  error: z.string().optional(),
})
export type Digest = z.infer<typeof digestSchema>

export const cameraSchema = z.object({ x: z.number(), y: z.number(), zoom: z.number() })
export const globalSchema = z.object({
  version: z.number(),
  activeBoard: z.string(),
  cameraByBoard: z.record(z.string(), cameraSchema),
})
export type MapGlobal = z.infer<typeof globalSchema>

export const TALK_MAP_SPEC: DomainSpec = {
  name: DOMAIN_NAME,
  version: 1,
  global: {
    schema: globalSchema,
    initial: { version: 1, activeBoard: INBOX_BOARD_ID, cameraByBoard: {} },
  },
  tables: {
    boards: { valueSchema: boardSchema },
    cards: { valueSchema: cardSchema },
    edges: { valueSchema: edgeSchema },
    digests: { valueSchema: digestSchema },
  },
}

/** Typed table handles over the untyped structural Domain. */
export interface TalkMapStore {
  domain: Domain
  boards: KvTable<Board>
  cards: KvTable<Card>
  edges: KvTable<MapEdge>
  digests: KvTable<Digest>
  global(): MapGlobal
  setGlobal(value: MapGlobal): Promise<void>
}

export async function openTalkMapStore(
  storageDomain: { open(spec: DomainSpec): Promise<Domain> },
): Promise<TalkMapStore> {
  const domain = await storageDomain.open(TALK_MAP_SPEC)
  const store: TalkMapStore = {
    domain,
    boards: domain.table('boards') as KvTable<Board>,
    cards: domain.table('cards') as KvTable<Card>,
    edges: domain.table('edges') as KvTable<MapEdge>,
    digests: domain.table('digests') as KvTable<Digest>,
    global: () => domain.global.get() as MapGlobal,
    setGlobal: value => domain.global.set(value),
  }
  if (store.boards.get(INBOX_BOARD_ID) === undefined) {
    await store.boards.put(INBOX_BOARD_ID, {
      name: 'Inbox',
      color: 'gray',
      order: 0,
      createdAt: Date.now(),
    })
  }
  return store
}
