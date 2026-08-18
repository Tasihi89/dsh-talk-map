/**
 * The board. Import-based: nothing lands here automatically — the user
 * imports a workspace (frame + its sessions as cards), imports single
 * conversations, or creates new ones on the canvas (draft card / fork edge).
 *
 * Cards drag freely; a group's frame is derived from its members and
 * stretches after them. Dragging the frame (label chip or border) carries
 * every member. Membership changes go through the right-click menu.
 *
 * Interaction: right/middle-drag pans, plain right-click opens the context
 * menu, left-drag box-selects on the pane and drags nodes.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider,
  useReactFlow, type Edge, type FinalConnectionState, type NodeChange, type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { RootSlotStandardProps, SessionListState, WorkspaceListState } from './dsh.ts'
import type { Card, FrameGeometry } from '../shared/model.ts'
import { canvas, INBOX_BOARD_ID, newCardId, type CanvasState } from './canvas-store.ts'
import { COLOR_TAGS } from './colors.ts'
import { getServices, mapUi } from './map-state.ts'
import { ContextMenu, type MenuItem, type MenuState } from './ContextMenu.tsx'
import { DraftCardNode, type DraftCardNodeType } from './DraftCard.tsx'
import { SessionCardNode, type SessionCardData, type SessionCardNodeType } from './SessionCard.tsx'
import { SpawnPreview, type PendingSpawn } from './SpawnPreview.tsx'
import { WsFrameNode, type WsFrameNodeType } from './WsFrame.tsx'
import { t } from './i18n.ts'
import { talkMapApi } from './api.ts'
import { useDsDarkTheme } from './use-dark.ts'
import styles from './talk-map.module.css'

const nodeTypes = { sessionCard: SessionCardNode, wsFrame: WsFrameNode, draftCard: DraftCardNode }

const GRID = 16
const CARD_W = 224
const CARD_H = 120
const GAP_X = 48
const GAP_Y = 56
const COLS = 3
const FRAME_PAD = 32
const FRAME_LABEL_H = 30
const LAYOUT_VERSION = 3

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

function sessionWorkspaceIndex(workspaces: WorkspaceListState): Map<string, string> {
  const index = new Map<string, string>()
  for (const workspace of workspaces.items) {
    for (const sessionId of workspace.sessionIds) index.set(sessionId, workspace.workspaceId)
  }
  return index
}

function gridPosition(origin: { x: number; y: number }, index: number): { x: number; y: number } {
  const column = index % COLS
  const row = Math.floor(index / COLS)
  return {
    x: snap(origin.x + column * (CARD_W + GAP_X)),
    y: snap(origin.y + row * (CARD_H + GAP_Y)),
  }
}

/** Frame rect that fits a set of member cards. */
function fitRect(members: Card[]): FrameGeometry {
  const minX = Math.min(...members.map(card => card.x))
  const minY = Math.min(...members.map(card => card.y))
  const maxX = Math.max(...members.map(card => card.x + CARD_W))
  const maxY = Math.max(...members.map(card => card.y + CARD_H))
  return {
    x: minX - FRAME_PAD,
    y: minY - FRAME_PAD - FRAME_LABEL_H,
    width: maxX - minX + FRAME_PAD * 2,
    height: maxY - minY + FRAME_PAD * 2 + FRAME_LABEL_H,
  }
}


interface DraftState {
  x: number
  y: number
  workspaceId?: string
  groupId?: string
}

interface MenuContext {
  left: number
  top: number
  flowX: number
  flowY: number
  kind: 'pane' | 'card' | 'frame'
  targetId?: string
  view: 'root' | 'import-ws' | 'import-session' | 'move-group'
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
  const [menu, setMenu] = useState<MenuContext | null>(null)
  const framePosRef = useRef<Record<string, { x: number; y: number }>>({})
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const sessionWs = useMemo(() => sessionWorkspaceIndex(workspaces), [workspaces])
  const wsTitles = useMemo(
    () => new Map(workspaces.items.map(item => [item.workspaceId, item.title])),
    [workspaces],
  )
  const workspacesReady = workspaces.baselinesReady !== false

  const wsFrames = canvasState.global?.wsFrames ?? {}
  const layoutVersion = canvasState.global?.layoutVersion ?? 1

  // Migration v3 → the import-based world: existing cards keep their spots,
  // get explicit group membership stamped from the sidebar accounting, and
  // every populated group gets a stored frame. Runs once.
  useEffect(() => {
    if (canvasState.phase !== 'ready' || layoutVersion >= LAYOUT_VERSION || !workspacesReady) return
    const patches: Record<string, Card> = {}
    const effective: Record<string, Card> = {}
    for (const [cardId, card] of Object.entries(canvasState.cards)) {
      let next = card
      if (card.wsOverride === undefined) {
        const home = sessionWs.get(card.sessionId)
        if (home !== undefined) {
          next = { ...card, wsOverride: home }
          patches[cardId] = next
        }
      }
      effective[cardId] = next
    }
    const byGroup = new Map<string, Card[]>()
    for (const card of Object.values(effective)) {
      if (card.wsOverride === undefined) continue
      byGroup.set(card.wsOverride, [...byGroup.get(card.wsOverride) ?? [], card])
    }
    const framesNext = { ...canvasState.global?.wsFrames }
    for (const [groupId, members] of byGroup) {
      if (framesNext[groupId] === undefined && members.length > 0) {
        framesNext[groupId] = fitRect(members)
      }
    }
    if (Object.keys(patches).length > 0) canvas.addCards(patches)
    canvas.patchGlobalNow({ layoutVersion: LAYOUT_VERSION, wsFrames: framesNext })
  }, [canvasState.phase, layoutVersion, workspacesReady, canvasState.cards, canvasState.global, sessionWs])

  // Cards pointing at blank (empty-log) sessions are noise.
  const visibleCards = useMemo(() => {
    const out: Record<string, Card> = {}
    for (const [cardId, card] of Object.entries(canvasState.cards)) {
      if (sessions.byId[card.sessionId]?.blank === true) continue
      out[cardId] = card
    }
    return out
  }, [canvasState.cards, sessions])

  const membersByGroup = useMemo(() => {
    const index = new Map<string, string[]>()
    for (const [cardId, card] of Object.entries(visibleCards)) {
      if (card.wsOverride === undefined) continue
      index.set(card.wsOverride, [...index.get(card.wsOverride) ?? [], cardId])
    }
    return index
  }, [visibleCards])

  // Frame geometry FOLLOWS its members (free dragging stretches the frame);
  // the stored rect only positions a group that currently has no cards.
  const frameGeometry = useMemo(() => {
    const out: Record<string, FrameGeometry> = {}
    for (const [groupId, stored] of Object.entries(wsFrames)) {
      const members = (membersByGroup.get(groupId) ?? [])
        .map(id => visibleCards[id])
        .filter((card): card is Card => card !== undefined)
      out[groupId] = members.length > 0 ? fitRect(members) : stored
    }
    return out
  }, [wsFrames, membersByGroup, visibleCards])

  useEffect(() => {
    framePosRef.current = Object.fromEntries(
      Object.entries(frameGeometry).map(([groupId, rect]) => [`frame-${groupId}`, { x: rect.x, y: rect.y }]),
    )
  }, [frameGeometry])

  // With a selection active, Esc clears it instead of closing the map.
  const hasSelection = selectedIds.size > 0
  useEffect(() => {
    if (!hasSelection) return
    const release = mapUi.claimEscape('selection')
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setSelectedIds(new Set())
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      release()
    }
  }, [hasSelection])

  const nodes = useMemo<TalkMapNode[]>(() => {
    const wsColors = canvasState.global?.wsColors ?? {}
    const frameNodes: TalkMapNode[] = Object.entries(frameGeometry).map(([groupId, rect]) => {
      const members = membersByGroup.get(groupId) ?? []
      return {
        id: `frame-${groupId}`,
        type: 'wsFrame' as const,
        position: { x: rect.x, y: rect.y },
        data: {
          workspaceId: groupId,
          title: wsTitles.get(groupId) ?? t('frame.unknown'),
          count: members.length,
          width: rect.width,
          height: rect.height,
          ...(wsColors[groupId] !== undefined ? { colorTag: wsColors[groupId] } : {}),
        },
        draggable: true,
        selectable: true,
        focusable: false,
        selected: selectedIds.has(`frame-${groupId}`),
        zIndex: -1,
        style: { pointerEvents: 'none' as const },
      }
    })
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
          summary: digest?.summary,
          waiting: summary?.pendingInteraction !== undefined,
          done: summary?.completed === true,
          ...(card.colorTag !== undefined ? { colorTag: card.colorTag } : {}),
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
          selectable: false,
          zIndex: 10,
          data: {
            workspaceOptions: workspaces.items.map(item => ({
              id: item.workspaceId,
              title: item.title,
              path: item.path,
            })),
            ...(draft.workspaceId !== undefined ? { defaultWorkspaceId: draft.workspaceId } : {}),
            ...(draft.groupId !== undefined ? { groupId: draft.groupId } : {}),
            onClose: () => { setDraft(null) },
          },
        }]
    return [...frameNodes, ...cardNodes, ...draftNodes]
  }, [frameGeometry, membersByGroup, wsTitles, visibleCards, canvasState.digests, canvasState.global, sessions, selectedIds, draft, workspaces.items])

  const sessionIdToCardId = useMemo(() => {
    const index = new Map<string, string>()
    for (const [cardId, card] of Object.entries(visibleCards)) {
      if (!index.has(card.sessionId)) index.set(card.sessionId, cardId)
    }
    return index
  }, [visibleCards])

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = []
    const present = new Set(Object.keys(visibleCards))
    const injectionPairs = new Set<string>()
    for (const [edgeId, edge] of Object.entries(canvasState.edges)) {
      injectionPairs.add(`${edge.fromCardId}->${edge.toCardId}`)
      if (!present.has(edge.fromCardId) || !present.has(edge.toCardId)) continue
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
        } else if (change.id.startsWith('frame-')) {
          const previous = framePosRef.current[change.id]
          const groupId = change.id.slice('frame-'.length)
          if (previous !== undefined) {
            const dx = change.position.x - previous.x
            const dy = change.position.y - previous.y
            if (dx !== 0 || dy !== 0) {
              for (const cardId of membersByGroup.get(groupId) ?? []) {
                const card = canvasState.cards[cardId]
                if (card !== undefined) canvas.moveCard(cardId, card.x + dx, card.y + dy)
              }
            }
          }
          framePosRef.current[change.id] = { x: change.position.x, y: change.position.y }
          const rect = wsFrames[groupId]
          if (rect !== undefined) {
            canvas.setWsFrameRect(groupId, {
              x: change.position.x,
              y: change.position.y,
              width: rect.width,
              height: rect.height,
            })
          }
        } else {
          // Free dragging — the frame stretches after its members.
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
    const group = groupAtPoint(position.x, position.y)
    setPendingSpawn({
      parent: { cardId: fromNodeId, sessionId: card.sessionId, title: summary.displayTitle },
      x: snap(position.x - CARD_W / 2),
      y: snap(position.y - CARD_H / 2),
      ...(group !== undefined ? { wsOverride: group } : {}),
    })
  }

  const openSession = (sessionId: string): void => {
    const services = getServices()
    if (services === undefined) return
    mapUi.setOpen(false)
    services.sessions.open(sessionId)
  }

  const groupAtPoint = (x: number, y: number): string | undefined => {
    for (const [groupId, rect] of Object.entries(wsFrames)) {
      if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) return groupId
    }
    return undefined
  }

  const openDraftAt = (flowX: number, flowY: number): void => {
    const x = snap(flowX - CARD_W / 2)
    const y = snap(flowY - 40)
    const groupId = groupAtPoint(flowX, flowY)
    const isWorkspace = groupId !== undefined && wsTitles.has(groupId)
    setDraft({
      x,
      y,
      ...(isWorkspace ? { workspaceId: groupId } : {}),
      ...(groupId !== undefined ? { groupId } : {}),
    })
  }

  // ---- import actions -------------------------------------------------

  const boardSessionIds = useMemo(
    () => new Set(Object.values(canvasState.cards).map(card => card.sessionId)),
    [canvasState.cards],
  )

  const importWorkspace = (workspaceId: string, atX: number, atY: number): void => {
    const memberSessions = placeableSessionIds(sessions)
      .filter(id => sessionWs.get(id) === workspaceId && !boardSessionIds.has(id))
      .sort((a, b) => (sessions.byId[b]?.updatedAt ?? 0) - (sessions.byId[a]?.updatedAt ?? 0))
    const origin = { x: snap(atX), y: snap(atY) }
    const added: Record<string, Card> = {}
    const placed: Card[] = []
    memberSessions.forEach((sessionId, index) => {
      const position = gridPosition(origin, index)
      const card: Card = {
        boardId: INBOX_BOARD_ID,
        sessionId,
        x: position.x,
        y: position.y,
        wsOverride: workspaceId,
        createdAt: Date.now(),
      }
      added[newCardId()] = card
      placed.push(card)
    })
    if (placed.length > 0) canvas.addCards(added)
    const rect = placed.length > 0
      ? fitRect(placed)
      : { x: origin.x - FRAME_PAD, y: origin.y - FRAME_PAD - FRAME_LABEL_H, width: 400, height: 260 }
    canvas.setWsFrameRect(workspaceId, rect)
  }

  const importSession = (sessionId: string, atX: number, atY: number): void => {
    const groupId = groupAtPoint(atX, atY)
    const card: Card = {
      boardId: INBOX_BOARD_ID,
      sessionId,
      x: snap(atX),
      y: snap(atY),
      ...(groupId !== undefined ? { wsOverride: groupId } : {}),
      createdAt: Date.now(),
    }
    canvas.addCards({ [newCardId()]: card })
  }

  const syncGroup = (groupId: string): void => {
    const rect = frameGeometry[groupId]
    if (rect === undefined) return
    const fresh = placeableSessionIds(sessions)
      .filter(id => sessionWs.get(id) === groupId && !boardSessionIds.has(id))
    if (fresh.length === 0) return
    const members = (membersByGroup.get(groupId) ?? [])
      .map(id => canvasState.cards[id])
      .filter((card): card is Card => card !== undefined)
    const origin = members.length > 0
      ? { x: Math.min(...members.map(card => card.x)), y: Math.max(...members.map(card => card.y)) + CARD_H + GAP_Y }
      : { x: rect.x + FRAME_PAD, y: rect.y + FRAME_LABEL_H + FRAME_PAD }
    const added: Record<string, Card> = {}
    fresh.forEach((sessionId, index) => {
      const position = gridPosition(origin, index)
      added[newCardId()] = {
        boardId: INBOX_BOARD_ID,
        sessionId,
        x: position.x,
        y: position.y,
        wsOverride: groupId,
        createdAt: Date.now(),
      }
    })
    canvas.addCards(added)
  }

  const moveCardToGroup = (cardId: string, groupId: string | undefined): void => {
    // Frames follow their members, so membership alone is enough — the
    // target frame stretches to wherever the card already sits.
    canvas.setCardWorkspaceOverride(cardId, groupId)
  }

  const removeGroup = (groupId: string): void => {
    for (const cardId of membersByGroup.get(groupId) ?? []) canvas.removeCard(cardId)
    const framesNext = { ...wsFrames }
    delete framesNext[groupId]
    const colorsNext = { ...canvasState.global?.wsColors }
    delete colorsNext[groupId]
    canvas.patchGlobalNow({ wsFrames: framesNext, wsColors: colorsNext })
  }

  // ---- context menu ----------------------------------------------------

  const openMenu = (event: React.MouseEvent | MouseEvent, kind: MenuContext['kind'], targetId?: string): void => {
    event.preventDefault()
    const wrapper = wrapperRef.current
    if (wrapper === null) return
    const bounds = wrapper.getBoundingClientRect()
    const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    setMenu({
      left: event.clientX - bounds.left,
      top: event.clientY - bounds.top,
      flowX: flow.x,
      flowY: flow.y,
      kind,
      ...(targetId !== undefined ? { targetId } : {}),
      view: 'root',
    })
  }

  const menuState: MenuState | null = useMemo(() => {
    if (menu === null) return null
    const close = (): void => { setMenu(null) }
    const items: MenuItem[] = []
    let title: string | undefined

    if (menu.view === 'import-ws') {
      title = t('menu.importWs')
      for (const item of workspaces.items) {
        const imported = wsFrames[item.workspaceId] !== undefined
        items.push({
          key: item.workspaceId,
          label: item.title,
          ...(imported ? { hint: t('menu.alreadyImported') } : {}),
          onPick: () => {
            if (imported) syncGroup(item.workspaceId)
            else importWorkspace(item.workspaceId, menu.flowX, menu.flowY)
            close()
          },
        })
      }
    } else if (menu.view === 'import-session') {
      title = t('menu.importSession')
      const candidates = placeableSessionIds(sessions)
        .filter(id => !boardSessionIds.has(id))
        .slice(0, 200)
      for (const sessionId of candidates) {
        items.push({
          key: sessionId,
          label: sessions.byId[sessionId]?.displayTitle ?? sessionId,
          onPick: () => {
            importSession(sessionId, menu.flowX, menu.flowY)
            close()
          },
        })
      }
    } else if (menu.view === 'move-group') {
      title = t('menu.moveGroup')
      const cardId = menu.targetId
      if (cardId !== undefined) {
        for (const groupId of Object.keys(wsFrames)) {
          items.push({
            key: groupId,
            label: wsTitles.get(groupId) ?? t('frame.unknown'),
            onPick: () => {
              moveCardToGroup(cardId, groupId)
              close()
            },
          })
        }
        items.push({
          key: '__none__',
          label: t('menu.noGroup'),
          onPick: () => {
            moveCardToGroup(cardId, undefined)
            close()
          },
        })
      }
    } else if (menu.kind === 'pane') {
      items.push({
        key: 'draft',
        label: t('menu.newChat'),
        onPick: () => {
          openDraftAt(menu.flowX, menu.flowY)
          close()
        },
      })
      items.push({
        key: 'import-ws',
        label: `${t('menu.importWs')}…`,
        onPick: () => { setMenu({ ...menu, view: 'import-ws' }) },
      })
      items.push({
        key: 'import-session',
        label: `${t('menu.importSession')}…`,
        onPick: () => { setMenu({ ...menu, view: 'import-session' }) },
      })
    } else if (menu.kind === 'card' && menu.targetId !== undefined) {
      const cardId = menu.targetId
      const card = canvasState.cards[cardId]
      items.push({
        key: 'open',
        label: t('menu.open'),
        onPick: () => {
          close()
          if (card !== undefined) openSession(card.sessionId)
        },
      })
      items.push({
        key: 'digest',
        label: t('card.refresh'),
        onPick: () => {
          close()
          if (card !== undefined) void talkMapApi.refreshDigest(card.sessionId).catch(() => undefined)
        },
      })
      items.push({
        key: 'move',
        label: `${t('menu.moveGroup')}…`,
        onPick: () => { setMenu({ ...menu, view: 'move-group' }) },
      })
      items.push({
        key: 'remove',
        label: t('menu.removeCard'),
        onPick: () => {
          canvas.removeCard(cardId)
          close()
        },
      })
    } else if (menu.kind === 'frame' && menu.targetId !== undefined) {
      const groupId = menu.targetId
      items.push({
        key: 'sync',
        label: t('menu.syncGroup'),
        onPick: () => {
          syncGroup(groupId)
          close()
        },
      })
      items.push({
        key: 'remove-group',
        label: t('menu.removeGroup'),
        onPick: () => {
          removeGroup(groupId)
          close()
        },
      })
    }
    const searchable = menu.view === 'import-ws' || menu.view === 'import-session' || menu.view === 'move-group'
    return {
      left: menu.left,
      top: menu.top,
      ...(title !== undefined ? { title } : {}),
      ...(searchable ? { searchable } : {}),
      items,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, workspaces.items, sessions, boardSessionIds, wsFrames, wsTitles, canvasState.cards])

  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID)
  const hasContent = Object.keys(visibleCards).length > 0 || Object.keys(wsFrames).length > 0

  return (
    <div
      ref={wrapperRef}
      className={styles['canvas']}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('.react-flow__pane') === null) return
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        openDraftAt(position.x, position.y)
      }}
      onContextMenu={(event) => { event.preventDefault() }}
      onClick={() => { if (menu !== null) setMenu(null) }}
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
        onPaneContextMenu={(event) => { openMenu(event as MouseEvent, 'pane') }}
        onNodeContextMenu={(event, node) => {
          if (node.type === 'sessionCard') openMenu(event, 'card', node.id)
          else if (node.type === 'wsFrame') openMenu(event, 'frame', node.id.slice('frame-'.length))
          else event.preventDefault()
        }}
        onMoveEnd={(_event, viewport: Viewport) => {
          canvas.setCamera(INBOX_BOARD_ID, viewport)
        }}
        colorMode={dark ? 'dark' : 'light'}
        snapToGrid
        snapGrid={[GRID, GRID]}
        zoomOnDoubleClick={false}
        panOnDrag={[1, 2]}
        selectionOnDrag
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
        {...(savedCamera !== undefined ? { defaultViewport: savedCamera } : { fitView: hasContent })}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {selectedIds.size > 0
        ? (
            <ColorToolbar
              selectedIds={selectedIds}
              visibleCards={visibleCards}
            />
          )
        : null}
      {hasContent || draft !== null ? null : <div className={styles['emptyHint']}>{t('map.empty')}</div>}
      {menuState !== null
        ? <ContextMenu key={menu?.view ?? 'root'} menu={menuState} onClose={() => { setMenu(null) }} />
        : null}
      {pendingSpawn !== null
        ? <SpawnPreview pending={pendingSpawn} onClose={() => { setPendingSpawn(null) }} />
        : null}
    </div>
  )
}

function ColorToolbar(props: {
  selectedIds: ReadonlySet<string>
  visibleCards: Readonly<Record<string, Card>>
}): React.JSX.Element {
  const selectedCardIds = [...props.selectedIds].filter(id => props.visibleCards[id] !== undefined)
  const selectedFrameWs = [...props.selectedIds]
    .filter(id => id.startsWith('frame-'))
    .map(id => id.slice('frame-'.length))
  const applyColor = (colorTag: string | undefined): void => {
    if (selectedCardIds.length > 0) canvas.setCardsColor(selectedCardIds, colorTag)
    for (const workspaceId of selectedFrameWs) canvas.setWorkspaceColor(workspaceId, colorTag)
  }
  return (
    <div className={styles['colorToolbar']} role="toolbar" aria-label={t('color.toolbar')}>
      <span className={styles['colorToolbarLabel']}>{t('color.toolbar')}</span>
      {COLOR_TAGS.map(tag => (
        <button
          key={tag.id}
          type="button"
          className={styles['colorSwatch']}
          style={{ background: tag.swatch }}
          title={tag.id}
          aria-label={tag.id}
          onClick={() => { applyColor(tag.id) }}
        />
      ))}
      <button
        type="button"
        className={`${styles['colorSwatch']} ${styles['colorSwatchClear']}`}
        title={t('color.clear')}
        aria-label={t('color.clear')}
        onClick={() => { applyColor(undefined) }}
      >
        ×
      </button>
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
