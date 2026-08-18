/**
 * The board: cards ⨝ sessions rendered through React Flow.
 *
 * Position law: manual placement is sacred. The only writes to card
 * positions are (1) the user's own drag, (2) the one-time grid placement of
 * a session that has no card yet, (3) an explicit double-click create at the
 * click point. Nothing ever re-arranges existing cards.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider,
  useReactFlow, type Edge, type NodeChange, type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { RootSlotStandardProps, SessionListState } from './dsh.ts'
import type { Card } from '../shared/model.ts'
import { canvas, INBOX_BOARD_ID, newCardId, type CanvasState } from './canvas-store.ts'
import { getServices } from './map-state.ts'
import { mapUi } from './map-state.ts'
import { SessionCardNode, type SessionCardData, type SessionCardNodeType } from './SessionCard.tsx'
import { t } from './i18n.ts'
import { useDsDarkTheme } from './use-dark.ts'
import styles from './talk-map.module.css'

const nodeTypes = { sessionCard: SessionCardNode }

const GRID = 16
const CARD_W = 224
const CARD_H = 104
const GAP_X = 48
const GAP_Y = 48
const PLACE_COLUMNS = 4

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

/** One-time grid placement below the existing content for card-less sessions. */
function planPlacement(missing: string[], sessions: SessionListState, cards: Readonly<Record<string, Card>>): Record<string, Card> {
  const existing = Object.values(cards)
  const startY = existing.length > 0
    ? snap(Math.max(...existing.map(card => card.y)) + CARD_H + GAP_Y)
    : 0
  const sorted = [...missing].sort((a, b) =>
    (sessions.byId[b]?.updatedAt ?? 0) - (sessions.byId[a]?.updatedAt ?? 0))
  const planned: Record<string, Card> = {}
  sorted.forEach((sessionId, index) => {
    const column = index % PLACE_COLUMNS
    const row = Math.floor(index / PLACE_COLUMNS)
    planned[newCardId()] = {
      boardId: INBOX_BOARD_ID,
      sessionId,
      x: snap(column * (CARD_W + GAP_X)),
      y: snap(startY + row * (CARD_H + GAP_Y)),
      createdAt: Date.now(),
    }
  })
  return planned
}

function CanvasInner(props: RootSlotStandardProps): React.JSX.Element {
  const dark = useDsDarkTheme()
  const canvasState = useSyncExternalStore(canvas.subscribe, canvas.get)
  const sessions = props.useSessions(state => state)
  const workspaces = props.useWorkspaces(state => state)
  const { screenToFlowPosition } = useReactFlow()
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const creatingRef = useRef(false)

  // One-time placement of card-less sessions (idempotent: planned cards land
  // in the store synchronously, so the next run finds nothing missing).
  useEffect(() => {
    if (canvasState.phase !== 'ready') return
    const placed = new Set(Object.values(canvasState.cards).map(card => card.sessionId))
    const missing = placeableSessionIds(sessions).filter(id => !placed.has(id))
    if (missing.length === 0) return
    canvas.addCards(planPlacement(missing, sessions, canvasState.cards))
  }, [canvasState.phase, canvasState.cards, sessions])

  const sessionIdToCardId = useMemo(() => {
    const index = new Map<string, string>()
    for (const [cardId, card] of Object.entries(canvasState.cards)) {
      if (!index.has(card.sessionId)) index.set(card.sessionId, cardId)
    }
    return index
  }, [canvasState.cards])

  const nodes = useMemo<SessionCardNodeType[]>(() => {
    return Object.entries(canvasState.cards)
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
  }, [canvasState.cards, canvasState.digests, sessions, selectedIds])

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = []
    // Provenance (fork/subagent lineage) — derived, read-only, dashed.
    for (const [cardId, card] of Object.entries(canvasState.cards)) {
      const parentSessionId = sessions.byId[card.sessionId]?.parentId
      if (parentSessionId === undefined) continue
      const parentCardId = sessionIdToCardId.get(parentSessionId)
      if (parentCardId === undefined) continue
      out.push({
        id: `lineage-${parentCardId}-${cardId}`,
        source: parentCardId,
        target: cardId,
        type: 'smoothstep',
        selectable: false,
        style: { strokeDasharray: '6 4', opacity: 0.5 },
      })
    }
    // User-drawn injection edges (persisted).
    for (const [edgeId, edge] of Object.entries(canvasState.edges)) {
      out.push({
        id: edgeId,
        source: edge.fromCardId,
        target: edge.toCardId,
        type: 'smoothstep',
        label: edge.injection.kind,
      })
    }
    return out
  }, [canvasState.cards, canvasState.edges, sessions, sessionIdToCardId])

  const onNodesChange = (changes: NodeChange<SessionCardNodeType>[]): void => {
    for (const change of changes) {
      if (change.type === 'position' && change.position !== undefined) {
        canvas.moveCard(change.id, change.position.x, change.position.y)
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

  const openSession = (sessionId: string): void => {
    const services = getServices()
    if (services === undefined) return
    mapUi.setOpen(false)
    services.sessions.open(sessionId)
  }

  const createSessionAt = async (clientX: number, clientY: number): Promise<void> => {
    const services = getServices()
    if (services === undefined || creatingRef.current) return
    const workspaceId = workspaces.recentWorkspaceId ?? workspaces.items[0]?.workspaceId
    if (workspaceId === undefined) {
      // No workspace yet: fall back to the shell's own New Session flow.
      services.workspaces.startSession()
      mapUi.setOpen(false)
      return
    }
    creatingRef.current = true
    try {
      const position = screenToFlowPosition({ x: clientX, y: clientY })
      const sessionId = await services.workspaces.connectWorkspace(workspaceId)
      const x = snap(position.x - CARD_W / 2)
      const y = snap(position.y - CARD_H / 2)
      const existingCard = canvas.cardIdForSession(sessionId)
      if (existingCard !== undefined) {
        // connectWorkspace reuses the workspace's blank session — the card
        // (if the blank one already got a card) just moves to the click point.
        canvas.moveCard(existingCard, x, y)
      } else {
        canvas.addCards({
          [newCardId()]: { boardId: INBOX_BOARD_ID, sessionId, x, y, createdAt: Date.now() },
        })
      }
      mapUi.setOpen(false)
      services.sessions.open(sessionId)
    } catch (error) {
      console.error('[dsh-talk-map] create-at failed:', error)
    } finally {
      creatingRef.current = false
    }
  }

  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID)
  const hasCards = nodes.length > 0

  return (
    <div
      className={styles['canvas']}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('.react-flow__pane') === null) return
        void createSessionAt(event.clientX, event.clientY)
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDoubleClick={(_event, node) => {
          if (!node.data.ghost) openSession(node.data.sessionId)
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
      {hasCards ? null : <div className={styles['emptyHint']}>{t('map.empty')}</div>}
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
