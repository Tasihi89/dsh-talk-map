/**
 * Canvas data store: the client-side working copy of the talk-map domain.
 * Reads land here from GET /talk-map/state plus the SSE change feed; writes
 * are optimistic (local first) with debounced persistence. Card positions
 * are sacred user data — nothing here ever moves a card except an explicit
 * user drag or the one-time auto-placement of a session that has no card yet.
 */
import { talkMapApi } from './api.ts'
import type { Card, Digest, FrameGeometry, MapEdgeData, MapGlobal, Camera } from '../shared/model.ts'
import { INBOX_BOARD_ID } from '../shared/model.ts'

export interface CanvasState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'error'
  readonly error?: string
  readonly cards: Readonly<Record<string, Card>>
  readonly edges: Readonly<Record<string, MapEdgeData>>
  readonly digests: Readonly<Record<string, Digest>>
  readonly global: MapGlobal | null
}

type Listener = () => void

const FLUSH_DELAY_MS = 500
const CAMERA_DELAY_MS = 800

let state: CanvasState = { phase: 'idle', cards: {}, edges: {}, digests: {}, global: null }
const listeners = new Set<Listener>()

function setState(next: Partial<CanvasState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

const dirtyCards = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | undefined
let cameraTimer: ReturnType<typeof setTimeout> | undefined
let frameTimer: ReturnType<typeof setTimeout> | undefined

/** Undo/redo: whole-board snapshots (camera excluded on restore). Rapid
 * operation streams (a drag emits dozens of moves) collapse into one entry. */
interface BoardSnapshot {
  cards: Readonly<Record<string, Card>>
  edges: Readonly<Record<string, MapEdgeData>>
  global: MapGlobal | null
}
const undoStack: BoardSnapshot[] = []
const redoStack: BoardSnapshot[] = []
let lastUndoPush = 0

function takeSnapshot(): BoardSnapshot {
  return { cards: state.cards, edges: state.edges, global: state.global }
}

function pushUndo(): void {
  const now = Date.now()
  if (now - lastUndoPush < 400 && undoStack.length > 0) return
  lastUndoPush = now
  undoStack.push(takeSnapshot())
  if (undoStack.length > 50) undoStack.shift()
  redoStack.length = 0
}

function restoreSnapshot(snapshot: BoardSnapshot): void {
  const previousCards = state.cards
  const previousEdges = state.edges
  const currentCamera = state.global?.cameraByBoard
  const global = snapshot.global === null
    ? state.global
    : { ...snapshot.global, cameraByBoard: currentCamera ?? snapshot.global.cameraByBoard }
  setState({ cards: snapshot.cards, edges: snapshot.edges, ...(global !== null ? { global } : {}) })
  // Server sync, fire-and-forget: full upserts + deletions of the leftovers.
  const goneCards = Object.keys(previousCards).filter(id => snapshot.cards[id] === undefined)
  const goneEdges = Object.keys(previousEdges).filter(id => snapshot.edges[id] === undefined)
  void (async () => {
    if (Object.keys(snapshot.cards).length > 0) await talkMapApi.upsertCards({ ...snapshot.cards })
    if (goneCards.length > 0) await talkMapApi.deleteCards(goneCards)
    if (Object.keys(snapshot.edges).length > 0) await talkMapApi.upsertEdges({ ...snapshot.edges })
    if (goneEdges.length > 0) await talkMapApi.deleteEdges(goneEdges)
    if (global !== null) await talkMapApi.setGlobal(global)
  })().catch((error) => {
    console.error('[dsh-talk-map] undo sync failed:', error)
  })
}

let globalPersistTimer: ReturnType<typeof setTimeout> | undefined

/** Debounced full-global persist (layout-memory writes batch under deletes). */
function scheduleGlobalPersist(): void {
  if (globalPersistTimer !== undefined) clearTimeout(globalPersistTimer)
  globalPersistTimer = setTimeout(() => {
    globalPersistTimer = undefined
    const current = state.global
    if (current === null) return
    void talkMapApi.setGlobal(current).catch((error) => {
      console.error('[dsh-talk-map] layout-memory save failed:', error)
    })
  }, 600)
}

function scheduleCardFlush(): void {
  if (flushTimer !== undefined) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    void flushCards()
  }, FLUSH_DELAY_MS)
}

async function flushCards(): Promise<void> {
  if (dirtyCards.size === 0) return
  const payload: Record<string, Card> = {}
  for (const id of dirtyCards) {
    const card = state.cards[id]
    if (card !== undefined) payload[id] = card
  }
  dirtyCards.clear()
  if (Object.keys(payload).length === 0) return
  try {
    await talkMapApi.upsertCards(payload)
  } catch (error) {
    console.error('[dsh-talk-map] card flush failed:', error)
    for (const id of Object.keys(payload)) dirtyCards.add(id)
  }
}

export const canvas = {
  get(): CanvasState {
    return state
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },

  ensureLoaded(): void {
    if (state.phase === 'loading' || state.phase === 'ready') return
    setState({ phase: 'loading', error: undefined })
    talkMapApi.getState().then((payload) => {
      setState({
        phase: 'ready',
        cards: payload.cards,
        edges: payload.edges,
        digests: payload.digests,
        global: payload.global,
      })
    }).catch((error) => {
      setState({ phase: 'error', error: String(error) })
    })
  },

  /** SSE mirror: applies host-confirmed changes (idempotent over our own writes). */
  connect(): () => void {
    return talkMapApi.subscribeChanges((change) => {
      if (change.table === 'cards') {
        // Never clobber a position the user is actively dragging.
        if (dirtyCards.has(change.key)) return
        const cards = { ...state.cards }
        if (change.operation === 'deleted') delete cards[change.key]
        else cards[change.key] = change.value as Card
        setState({ cards })
        return
      }
      if (change.table === 'edges') {
        const edges = { ...state.edges }
        if (change.operation === 'deleted') delete edges[change.key]
        else edges[change.key] = change.value as MapEdgeData
        setState({ edges })
        return
      }
      if (change.table === 'digests') {
        const digests = { ...state.digests }
        if (change.operation === 'deleted') delete digests[change.key]
        else digests[change.key] = change.value as Digest
        setState({ digests })
      }
    })
  },

  moveCard(id: string, x: number, y: number): void {
    // Existence FIRST, undo frame after — a no-op must not push an
    // identical snapshot (pushUndo clears the redo stack). Same order in
    // every mutator below.
    const card = state.cards[id]
    if (card === undefined) return
    pushUndo()
    setState({ cards: { ...state.cards, [id]: { ...card, x, y } } })
    dirtyCards.add(id)
    scheduleCardFlush()
  },

  /** Immediate-persist upsert (new cards from double-click / auto-placement). */
  addCards(entries: Record<string, Card>): void {
    pushUndo()
    setState({ cards: { ...state.cards, ...entries } })
    void talkMapApi.upsertCards(entries).catch((error) => {
      console.error('[dsh-talk-map] card upsert failed:', error)
    })
  },

  /** Add edges: local state first, then persisted (no SSE round-trip needed). */
  addEdges(entries: Record<string, MapEdgeData>): void {
    pushUndo()
    setState({ edges: { ...state.edges, ...entries } })
    void talkMapApi.upsertEdges(entries).catch((error) => {
      console.error('[dsh-talk-map] edge upsert failed:', error)
    })
  },

  removeEdges(ids: readonly string[]): void {
    const present = ids.filter(id => state.edges[id] !== undefined)
    // No-op deletes (already gone via SSE, double Backspace) must not
    // push an identical undo frame — pushUndo clears the redo stack.
    if (present.length === 0) return
    pushUndo()
    const edges = { ...state.edges }
    for (const id of present) delete edges[id]
    setState({ edges })
    void talkMapApi.deleteEdges(present).catch((error) => {
      console.error('[dsh-talk-map] edge delete failed:', error)
    })
  },

  /** Background re-sync with the server (missed SSE while the map was
   * closed or the server restarted). Skipped while local writes are
   * still in flight. */
  refresh(): void {
    if (state.phase !== 'ready' || dirtyCards.size > 0) return
    talkMapApi.getState().then((payload) => {
      if (state.phase !== 'ready' || dirtyCards.size > 0) return
      setState({
        cards: payload.cards,
        edges: payload.edges,
        digests: payload.digests,
        global: payload.global,
      })
    }).catch(() => undefined)
  },

  /** Local mirror of a host-side spawn result (host already persisted it). */
  applySpawn(result: { cardId: string; card: Card; edges: Record<string, MapEdgeData> }): void {
    pushUndo()
    setState({
      cards: { ...state.cards, [result.cardId]: result.card },
      edges: { ...state.edges, ...result.edges },
    })
  },

  removeCard(id: string): void {
    const card = state.cards[id]
    if (card === undefined) return
    pushUndo()
    const cards = { ...state.cards }
    delete cards[id]
    // Remember the placement so a re-import restores the arrangement.
    if (state.global !== null) {
      const layoutMemory = {
        ...state.global.layoutMemory,
        [card.sessionId]: {
          x: card.x,
          y: card.y,
          ...(card.colorTag !== undefined ? { colorTag: card.colorTag } : {}),
        },
      }
      const global: MapGlobal = { ...state.global, layoutMemory }
      setState({ cards, global })
      scheduleGlobalPersist()
    } else {
      setState({ cards })
    }
    void talkMapApi.deleteCards([id]).catch((error) => {
      console.error('[dsh-talk-map] card delete failed:', error)
    })
  },

  /** Recolor cards (undefined clears); persists immediately. */
  setCardsColor(ids: readonly string[], colorTag: string | undefined): void {
    const payload: Record<string, Card> = {}
    const cards = { ...state.cards }
    for (const id of ids) {
      const card = cards[id]
      if (card === undefined) continue
      const next = { ...card }
      if (colorTag === undefined) delete next.colorTag
      else next.colorTag = colorTag
      cards[id] = next
      payload[id] = next
    }
    if (Object.keys(payload).length === 0) return
    pushUndo()
    setState({ cards })
    void talkMapApi.upsertCards(payload).catch((error) => {
      console.error('[dsh-talk-map] card color save failed:', error)
    })
  },

  /** Adopt a card into another workspace's frame (map-level membership). */
  setCardWorkspaceOverride(id: string, wsOverride: string | undefined): void {
    const card = state.cards[id]
    if (card === undefined) return
    pushUndo()
    const next = { ...card }
    if (wsOverride === undefined) delete next.wsOverride
    else next.wsOverride = wsOverride
    setState({ cards: { ...state.cards, [id]: next } })
    void talkMapApi.upsertCards({ [id]: next }).catch((error) => {
      console.error('[dsh-talk-map] card override save failed:', error)
    })
  },

  /** Manual frame geometry (drag/resize); local now, persisted debounced. */
  setWsFrameRect(workspaceId: string, rect: FrameGeometry): void {
    if (state.global === null) return
    pushUndo()
    const global: MapGlobal = {
      ...state.global,
      wsFrames: { ...state.global.wsFrames, [workspaceId]: rect },
    }
    setState({ global })
    if (frameTimer !== undefined) clearTimeout(frameTimer)
    frameTimer = setTimeout(() => {
      frameTimer = undefined
      const current = state.global
      if (current === null) return
      void talkMapApi.setGlobal(current).catch((error) => {
        console.error('[dsh-talk-map] frame save failed:', error)
      })
    }, 600)
  },

  /** Recolor a workspace frame (undefined clears); persists immediately. */
  setWorkspaceColor(workspaceId: string, colorTag: string | undefined): void {
    if (state.global === null) return
    pushUndo()
    const wsColors = { ...state.global.wsColors }
    if (colorTag === undefined) delete wsColors[workspaceId]
    else wsColors[workspaceId] = colorTag
    canvas.patchGlobalNow({ wsColors })
  },

  /** Immediate global patch (layout-version stamp etc.) — no debounce. */
  patchGlobalNow(patch: Partial<MapGlobal>): void {
    if (state.global === null) return
    const global: MapGlobal = { ...state.global, ...patch }
    setState({ global })
    void talkMapApi.setGlobal(global).catch((error) => {
      console.error('[dsh-talk-map] global save failed:', error)
    })
  },

  setCamera(boardId: string, camera: Camera): void {
    if (state.global === null) return
    const global: MapGlobal = {
      ...state.global,
      cameraByBoard: { ...state.global.cameraByBoard, [boardId]: camera },
    }
    setState({ global })
    if (cameraTimer !== undefined) clearTimeout(cameraTimer)
    cameraTimer = setTimeout(() => {
      cameraTimer = undefined
      const current = state.global
      if (current === null) return
      void talkMapApi.setGlobal(current).catch((error) => {
        console.error('[dsh-talk-map] camera save failed:', error)
      })
    }, CAMERA_DELAY_MS)
  },

  /** Cmd/Ctrl+Z — board operations only (conversations are not undoable). */
  undo(): void {
    const snapshot = undoStack.pop()
    if (snapshot === undefined) return
    redoStack.push(takeSnapshot())
    restoreSnapshot(snapshot)
  },

  redo(): void {
    const snapshot = redoStack.pop()
    if (snapshot === undefined) return
    undoStack.push(takeSnapshot())
    restoreSnapshot(snapshot)
  },

  savedCamera(boardId: string): Camera | undefined {
    return state.global?.cameraByBoard[boardId]
  },

  /** First card found for a session (M1: one board, at most one card each). */
  cardIdForSession(sessionId: string): string | undefined {
    for (const [id, card] of Object.entries(state.cards)) {
      if (card.sessionId === sessionId) return id
    }
    return undefined
  },
}

export function newCardId(): string {
  return `card-${crypto.randomUUID()}`
}

export { INBOX_BOARD_ID }
