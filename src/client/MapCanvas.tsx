/**
 * The board: cards ⨝ sessions rendered through React Flow, grouped visually
 * by workspace (derived frames), with an in-place draft composer.
 *
 * Position law: manual placement is sacred. The writes to card positions are
 * (1) the user's own drag, (2) grid placement of a session that has no card
 * yet, (3) the one-time layout-v2 migration into workspace groups, (4) a
 * draft card sent at its own spot. Nothing else rearranges existing cards.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider,
  useReactFlow, type Edge, type FinalConnectionState, type NodeChange, type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { RootSlotStandardProps, SessionListState, WorkspaceListState } from './dsh.ts'
import type { Card } from '../shared/model.ts'
import { canvas, INBOX_BOARD_ID, newCardId, type CanvasState } from './canvas-store.ts'
import { getServices, mapUi } from './map-state.ts'
import { DraftCardNode, type DraftCardNodeType } from './DraftCard.tsx'
import { SessionCardNode, type SessionCardData, type SessionCardNodeType } from './SessionCard.tsx'
import { SpawnPreview, type PendingSpawn } from './SpawnPreview.tsx'
import { WsFrameNode, type WsFrameNodeType } from './WsFrame.tsx'
import { t } from './i18n.ts'
import { useDsDarkTheme } from './use-dark.ts'
import styles from './talk-map.module.css'

const nodeTypes = { sessionCard: SessionCardNode, wsFrame: WsFrameNode, draftCard: DraftCardNode }

const GRID = 16
const CARD_W = 224
const CARD_H = 120
const GAP_X = 48
const GAP_Y = 56
const COLS = 3
const REGION_GAP = 200
const FRAME_PAD = 32
const FRAME_LABEL_H = 30
const UNGROUPED = '__ungrouped__'
const LAYOUT_VERSION = 2

type TalkMapNode = SessionCardNodeType | WsFrameNodeType | DraftCardNodeType

function snap(value: number): number {
  return Math.round(value / GRID) * GRID
}

/** Sessions eligible for a card: top-level, non-empty logs. */
function placeableSessionIds(sessions: SessionListState): string[] {
  return sessions.ids.filter((id) => {
    const summary = sessions.byId[id]
    return summary !== undefined && !summary.blank && summary.origin !== 'subagent'
  })
}

interface WsEntry {
  id: string
  title: string
}

/** sessionId → workspaceId, from the workspace registry's own accounting. */
function sessionWorkspaceIndex(workspaces: WorkspaceListState): Map<string, string> {
  const index = new Map<string, string>()
  for (const workspace of workspaces.items) {
    for (const sessionId of workspace.sessionIds) index.set(sessionId, workspace.workspaceId)
  }
  return index
}

function workspaceEntries(workspaces: WorkspaceListState): WsEntry[] {
  return [
    ...workspaces.items.map(item => ({ id: item.workspaceId, title: item.title })),
    { id: UNGROUPED, title: t('frame.ungrouped') },
  ]
}

function gridPosition(origin: { x: number; y: number }, index: number): { x: number; y: number } {
  const column = index % COLS
  const row = Math.floor(index / COLS)
  return {
    x: snap(origin.x + column * (CARD_W + GAP_X)),
    y: snap(origin.y + row * (CARD_H + GAP_Y)),
  }
}

/**
 * Layout-v2 migration: place EVERY known session into its workspace region.
 * Cards whose session no longer exists keep their spot (ghosts stay put).
 */
function planGroupedFull(
  sessions: SessionListState,
  sessionWs: Map<string, string>,
  wsList: WsEntry[],
  existingCards: Readonly<Record<string, Card>>,
): Record<string, Card> {
  const placeable = placeableSessionIds(sessions)
  const bySession = new Map<string, string>()
  for (const [cardId, card] of Object.entries(existingCards)) {
    if (!bySession.has(card.sessionId)) bySession.set(card.sessionId, cardId)
  }
  const plan: Record<string, Card> = {}
  let cursorX = 0
  for (const workspace of wsList) {
    const members = placeable
      .filter(id => (sessionWs.get(id) ?? UNGROUPED) === workspace.id)
      .sort((a, b) => (sessions.byId[b]?.updatedAt ?? 0) - (sessions.byId[a]?.updatedAt ?? 0))
    if (members.length === 0) continue
    members.forEach((sessionId, index) => {
      const position = gridPosition({ x: cursorX, y: 0 }, index)
      const cardId = bySession.get(sessionId) ?? newCardId()
      const previous = existingCards[cardId]
      plan[cardId] = {
        boardId: INBOX_BOARD_ID,
        sessionId,
        x: position.x,
        y: position.y,
        createdAt: previous?.createdAt ?? Date.now(),
        ...(previous?.colorTag !== undefined ? { colorTag: previous.colorTag } : {}),
      }
    })
    cursorX += COLS * (CARD_W + GAP_X) - GAP_X + REGION_GAP
  }
  return plan
}

/** Incremental placement for sessions that appeared after the migration. */
function planGroupedIncremental(
  missing: string[],
  sessions: SessionListState,
  sessionWs: Map<string, string>,
  existingCards: Readonly<Record<string, Card>>,
): Record<string, Card> {
  interface Box { minX: number; minY: number; maxX: number; maxY: number }
  const boxes = new Map<string, Box>()
  let globalMaxX = 0
  for (const card of Object.values(existingCards)) {
    const workspaceId = sessionWs.get(card.sessionId) ?? UNGROUPED
    const box = boxes.get(workspaceId) ?? { minX: card.x, minY: card.y, maxX: card.x, maxY: card.y }
    box.minX = Math.min(box.minX, card.x)
    box.minY = Math.min(box.minY, card.y)
    box.maxX = Math.max(box.maxX, card.x)
    box.maxY = Math.max(box.maxY, card.y)
    boxes.set(workspaceId, box)
    globalMaxX = Math.max(globalMaxX, card.x + CARD_W)
  }
  const plan: Record<string, Card> = {}
  const grouped = new Map<string, string[]>()
  for (const sessionId of missing) {
    const workspaceId = sessionWs.get(sessionId) ?? UNGROUPED
    grouped.set(workspaceId, [...grouped.get(workspaceId) ?? [], sessionId])
  }
  let newRegionX = globalMaxX + REGION_GAP
  for (const [workspaceId, members] of grouped) {
    const sorted = members.sort((a, b) => (sessions.byId[b]?.updatedAt ?? 0) - (sessions.byId[a]?.updatedAt ?? 0))
    const box = boxes.get(workspaceId)
    const origin = box !== undefined
      ? { x: box.minX, y: box.maxY + CARD_H + GAP_Y }
      : { x: newRegionX, y: 0 }
    if (box === undefined) newRegionX += COLS * (CARD_W + GAP_X) - GAP_X + REGION_GAP
    sorted.forEach((sessionId, index) => {
      const position = gridPosition(origin, index)
      plan[newCardId()] = {
        boardId: INBOX_BOARD_ID,
        sessionId,
        x: position.x,
        y: position.y,
        createdAt: Date.now(),
      }
    })
  }
  return plan
}

interface FrameRect {
  workspaceId: string
  title: string
  count: number
  x: number
  y: number
  width: number
  height: number
}

function frameRects(
  cards: Readonly<Record<string, Card>>,
  sessionWs: Map<string, string>,
  wsList: WsEntry[],
): FrameRect[] {
  const byWs = new Map<string, Card[]>()
  for (const card of Object.values(cards)) {
    if (card.boardId !== INBOX_BOARD_ID) continue
    const workspaceId = sessionWs.get(card.sessionId) ?? UNGROUPED
    byWs.set(workspaceId, [...byWs.get(workspaceId) ?? [], card])
  }
  const titles = new Map(wsList.map(entry => [entry.id, entry.title]))
  const rects: FrameRect[] = []
  for (const [workspaceId, members] of byWs) {
    if (members.length === 0) continue
    const minX = Math.min(...members.map(card => card.x))
    const minY = Math.min(...members.map(card => card.y))
    const maxX = Math.max(...members.map(card => card.x + CARD_W))
    const maxY = Math.max(...members.map(card => card.y + CARD_H))
    rects.push({
      workspaceId,
      title: titles.get(workspaceId) ?? workspaceId,
      count: members.length,
      x: minX - FRAME_PAD,
      y: minY - FRAME_PAD - FRAME_LABEL_H,
      width: maxX - minX + FRAME_PAD * 2,
      height: maxY - minY + FRAME_PAD * 2 + FRAME_LABEL_H,
    })
  }
  return rects
}

interface DraftState {
  x: number
  y: number
  workspaceId?: string
}

function CanvasInner(props: RootSlotStandardProps): React.JSX.Element {
  const dark = useDsDarkTheme()
  const canvasState = useSyncExternalStore(canvas.subscribe, canvas.get)
  const sessions = props.useSessions(state => state)
  const workspaces = props.useWorkspaces(state => state)
  const { screenToFlowPosition } = useReactFlow()
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [pendingSpawn, setPendingSpawn] = useState<PendingSpawn | null>(null)
  const [draft, setDraft] = useState<DraftState | null>(null)

  const sessionWs = useMemo(() => sessionWorkspaceIndex(workspaces), [workspaces])
  const wsList = useMemo(() => workspaceEntries(workspaces), [workspaces])
  const workspacesReady = workspaces.baselinesReady !== false && workspaces.items.length >= 0

  const layoutVersion = canvasState.global?.layoutVersion ?? 1
  const migrationPending = canvasState.phase === 'ready' && layoutVersion < LAYOUT_VERSION

  // One-time layout-v2 migration: regroup everything by workspace. Runs once
  // (guarded by the persisted layoutVersion stamp), then never touches
  // positions again.
  useEffect(() => {
    if (!migrationPending || !workspacesReady) return
    if (workspaces.items.length === 0 && sessions.ids.length === 0) return
    // Sweep cards left behind for blank (empty-log) sessions by the old
    // double-click flow — nothing to resume behind them.
    for (const [cardId, card] of Object.entries(canvasState.cards)) {
      if (sessions.byId[card.sessionId]?.blank === true) canvas.removeCard(cardId)
    }
    const plan = planGroupedFull(sessions, sessionWs, wsList, canvasState.cards)
    if (Object.keys(plan).length > 0) canvas.addCards(plan)
    canvas.patchGlobalNow({ layoutVersion: LAYOUT_VERSION })
  }, [migrationPending, workspacesReady, sessions, sessionWs, wsList, canvasState.cards])

  // Incremental placement of card-less sessions (post-migration only).
  useEffect(() => {
    if (canvasState.phase !== 'ready' || migrationPending || !workspacesReady) return
    const placed = new Set(Object.values(canvasState.cards).map(card => card.sessionId))
    const missing = placeableSessionIds(sessions).filter(id => !placed.has(id))
    if (missing.length === 0) return
    canvas.addCards(planGroupedIncremental(missing, sessions, sessionWs, canvasState.cards))
  }, [canvasState.phase, migrationPending, workspacesReady, canvasState.cards, sessions, sessionWs])

  // Cards pointing at blank (empty-log) sessions are noise — hidden from the
  // board and from frame bounding boxes.
  const visibleCards = useMemo(() => {
    const out: Record<string, Card> = {}
    for (const [cardId, card] of Object.entries(canvasState.cards)) {
      if (sessions.byId[card.sessionId]?.blank === true) continue
      out[cardId] = card
    }
    return out
  }, [canvasState.cards, sessions])

  const sessionIdToCardId = useMemo(() => {
    const index = new Map<string, string>()
    for (const [cardId, card] of Object.entries(visibleCards)) {
      if (!index.has(card.sessionId)) index.set(card.sessionId, cardId)
    }
    return index
  }, [visibleCards])

  const frames = useMemo(
    () => frameRects(visibleCards, sessionWs, wsList),
    [visibleCards, sessionWs, wsList],
  )

  const nodes = useMemo<TalkMapNode[]>(() => {
    const frameNodes: TalkMapNode[] = frames.map(frame => ({
      id: `frame-${frame.workspaceId}`,
      type: 'wsFrame' as const,
      position: { x: frame.x, y: frame.y },
      data: { title: frame.title, count: frame.count, width: frame.width, height: frame.height },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
      style: { pointerEvents: 'none' as const },
    }))
    const cardNodes: TalkMapNode[] = Object.entries(visibleCards)
      .filter(([, card]) => card.boardId === INBOX_BOARD_ID)
      .map(([cardId, card]) => {
        const summary = sessions.byId[card.sessionId]
        const digest = canvasState.digests[card.sessionId]
        const data: SessionCardData = {
          cardId,
          sessionId: card.sessionId,
          title: summary?.displayTitle ?? card.sessionId,
          running: summary?.running ?? false,
          isCurrent: sessions.current === card.sessionId,
          ghost: summary === undefined,
          updatedAt: summary?.updatedAt,
          nextStep: digest?.nextStep ?? digest?.todoNext,
        }
        return {
          id: cardId,
          type: 'sessionCard' as const,
          position: { x: card.x, y: card.y },
          selected: selectedIds.has(cardId),
          data,
        }
      })
    const draftNodes: TalkMapNode[] = draft === null
      ? []
      : [{
          id: 'draft',
          type: 'draftCard' as const,
          position: { x: draft.x, y: draft.y },
          zIndex: 10,
          data: {
            workspaceOptions: workspaces.items.map(item => ({ id: item.workspaceId, title: item.title })),
            ...(draft.workspaceId !== undefined ? { defaultWorkspaceId: draft.workspaceId } : {}),
            onClose: () => { setDraft(null) },
          },
        }]
    return [...frameNodes, ...cardNodes, ...draftNodes]
  }, [frames, visibleCards, canvasState.digests, sessions, selectedIds, draft, workspaces.items])

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = []
    const injectionPairs = new Set<string>()
    for (const [edgeId, edge] of Object.entries(canvasState.edges)) {
      injectionPairs.add(`${edge.fromCardId}->${edge.toCardId}`)
      out.push({
        id: edgeId,
        source: edge.fromCardId,
        target: edge.toCardId,
        type: 'smoothstep',
        label: t('edge.injected'),
      })
    }
    for (const [cardId, card] of Object.entries(visibleCards)) {
      const parentSessionId = sessions.byId[card.sessionId]?.parentId
      if (parentSessionId === undefined) continue
      const parentCardId = sessionIdToCardId.get(parentSessionId)
      if (parentCardId === undefined) continue
      if (injectionPairs.has(`${parentCardId}->${cardId}`)) continue
      out.push({
        id: `lineage-${parentCardId}-${cardId}`,
        source: parentCardId,
        target: cardId,
        type: 'smoothstep',
        selectable: false,
        style: { strokeDasharray: '6 4', opacity: 0.5 },
      })
    }
    return out
  }, [visibleCards, canvasState.edges, sessions, sessionIdToCardId])

  const onNodesChange = (changes: NodeChange<TalkMapNode>[]): void => {
    for (const change of changes) {
      if (change.type === 'position' && change.position !== undefined) {
        if (change.id === 'draft') {
          setDraft(previous => previous === null
            ? previous
            : { ...previous, x: change.position?.x ?? previous.x, y: change.position?.y ?? previous.y })
        } else {
          canvas.moveCard(change.id, change.position.x, change.position.y)
        }
      } else if (change.type === 'select') {
        setSelectedIds((previous) => {
          const next = new Set(previous)
          if (change.selected) next.add(change.id)
          else next.delete(change.id)
          return next
        })
      }
    }
  }

  const onConnectEnd = (
    event: MouseEvent | TouchEvent,
    connectionState: FinalConnectionState,
  ): void => {
    if (connectionState.isValid === true) return
    const fromNodeId = connectionState.fromNode?.id
    if (fromNodeId === undefined) return
    const card = canvasState.cards[fromNodeId]
    if (card === undefined) return
    const summary = sessions.byId[card.sessionId]
    if (summary === undefined) return
    const client = 'clientX' in event
      ? { x: event.clientX, y: event.clientY }
      : event.changedTouches[0] !== undefined
        ? { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY }
        : undefined
    if (client === undefined) return
    const position = screenToFlowPosition(client)
    setPendingSpawn({
      parent: { cardId: fromNodeId, sessionId: card.sessionId, title: summary.displayTitle },
      x: snap(position.x - CARD_W / 2),
      y: snap(position.y - CARD_H / 2),
    })
  }

  const openSession = (sessionId: string): void => {
    const services = getServices()
    if (services === undefined) return
    mapUi.setOpen(false)
    services.sessions.open(sessionId)
  }

  const openDraftAt = (clientX: number, clientY: number): void => {
    const position = screenToFlowPosition({ x: clientX, y: clientY })
    const x = snap(position.x - CARD_W / 2)
    const y = snap(position.y - 40)
    const frame = frames.find(rect =>
      position.x >= rect.x && position.x <= rect.x + rect.width
      && position.y >= rect.y && position.y <= rect.y + rect.height)
    const workspaceId = frame !== undefined && frame.workspaceId !== UNGROUPED
      ? frame.workspaceId
      : workspaces.recentWorkspaceId ?? workspaces.items[0]?.workspaceId
    setDraft({ x, y, ...(workspaceId !== undefined ? { workspaceId } : {}) })
  }

  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID)
  const hasCards = Object.keys(canvasState.cards).length > 0

  return (
    <div
      className={styles['canvas']}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('.react-flow__pane') === null) return
        openDraftAt(event.clientX, event.clientY)
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnectEnd={onConnectEnd}
        onNodeDoubleClick={(_event, node) => {
          if (node.type === 'sessionCard' && !(node as SessionCardNodeType).data.ghost) {
            openSession((node as SessionCardNodeType).data.sessionId)
          }
        }}
        onMoveEnd={(_event, viewport: Viewport) => {
          canvas.setCamera(INBOX_BOARD_ID, viewport)
        }}
        colorMode={dark ? 'dark' : 'light'}
        snapToGrid
        snapGrid={[GRID, GRID]}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
        {...(savedCamera !== undefined ? { defaultViewport: savedCamera } : { fitView: hasCards })}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {hasCards || draft !== null ? null : <div className={styles['emptyHint']}>{t('map.empty')}</div>}
      {pendingSpawn !== null
        ? <SpawnPreview pending={pendingSpawn} onClose={() => { setPendingSpawn(null) }} />
        : null}
    </div>
  )
}

export function MapCanvas(props: RootSlotStandardProps): React.JSX.Element {
  const canvasState = useSyncExternalStore(canvas.subscribe, canvas.get)

  useEffect(() => {
    canvas.ensureLoaded()
    return canvas.connect()
  }, [])

  if (canvasState.phase === 'error') {
    return (
      <div className={styles['canvas']}>
        <div className={styles['emptyHint']}>
          {t('map.loadError')} {canvasState.error}
        </div>
      </div>
    )
  }
  if (canvasState.phase !== 'ready') {
    return (
      <div className={styles['canvas']}>
        <div className={styles['emptyHint']}>{t('map.loading')}</div>
      </div>
    )
  }
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}

export type { CanvasState }
