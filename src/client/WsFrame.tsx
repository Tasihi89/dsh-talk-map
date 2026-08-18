/**
 * Workspace frame: a region drawn behind the cards of one map group. The
 * body center is pointer-transparent (pan/double-click pass through); the
 * dashed BORDER and the label chip are the frame's physical surfaces —
 * click either to select, drag either to move the whole group (the canvas
 * translates every member card), and pull the bottom-right handle to give
 * the frame a manual size (persisted; auto-fit stops for that frame).
 */
import { useEffect, useRef, useState } from 'react'
import { useReactFlow, type NodeProps, type Node } from '@xyflow/react'
import { colorOf } from './colors.ts'
import { t } from './i18n.ts'
import styles from './talk-map.module.css'

export interface WsFrameData extends Record<string, unknown> {
  workspaceId: string
  title: string
  count: number
  /** Member cards that no longer fit the frame (hidden, not gone). */
  hiddenCount: number
  width: number
  height: number
  colorTag?: string
  /** Commit a manual resize (width/height in flow units). */
  onResizeEnd: (size: { width: number; height: number }) => void
}

export type WsFrameNodeType = Node<WsFrameData, 'wsFrame'>

const MIN_W = 240
const MIN_H = 160
const EDGE = 10

export function WsFrameNode(props: NodeProps<WsFrameNodeType>): React.JSX.Element {
  const { data, selected } = props
  const color = colorOf(data.colorTag)
  const { getZoom } = useReactFlow()
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null)

  // A store-confirmed size supersedes the live preview.
  useEffect(() => { setLiveSize(null) }, [data.width, data.height])

  const width = liveSize?.width ?? data.width
  const height = liveSize?.height ?? data.height

  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.stopPropagation()
    event.preventDefault()
    resizeRef.current = { startX: event.clientX, startY: event.clientY, width, height }
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
  }
  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = resizeRef.current
    if (start === null) return
    const zoom = getZoom()
    setLiveSize({
      width: Math.max(MIN_W, start.width + (event.clientX - start.startX) / zoom),
      height: Math.max(MIN_H, start.height + (event.clientY - start.startY) / zoom),
    })
  }
  const onHandlePointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = resizeRef.current
    if (start === null) return
    resizeRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    const zoom = getZoom()
    data.onResizeEnd({
      width: Math.max(MIN_W, start.width + (event.clientX - start.startX) / zoom),
      height: Math.max(MIN_H, start.height + (event.clientY - start.startY) / zoom),
    })
  }

  return (
    <div
      className={`${styles['wsFrame']}${selected === true ? ` ${styles['wsFrameSelected']}` : ''}`}
      style={{
        width,
        height,
        ...(color !== undefined ? { borderColor: color.border, background: color.faint } : {}),
      }}
      data-talkmap-frame=""
    >
      <div
        className={styles['wsFrameLabel']}
        style={color !== undefined
          ? { borderColor: color.border, backgroundImage: `linear-gradient(${color.fill}, ${color.fill})` }
          : {}}
      >
        {data.title}
        <span className={styles['wsFrameCount']}>{data.count}</span>
        {data.hiddenCount > 0
          ? <span className={styles['wsFrameHidden']} title={t('frame.hiddenTitle')}>…+{data.hiddenCount}</span>
          : null}
      </div>
      {/* border strips: clickable/draggable surfaces along the dashed edge */}
      <div className={styles['wsFrameEdge']} style={{ top: 0, left: 0, right: 0, height: EDGE }} />
      <div className={styles['wsFrameEdge']} style={{ bottom: 0, left: 0, right: 0, height: EDGE }} />
      <div className={styles['wsFrameEdge']} style={{ top: 0, bottom: 0, left: 0, width: EDGE }} />
      <div className={styles['wsFrameEdge']} style={{ top: 0, bottom: 0, right: 0, width: EDGE }} />
      <div
        className={`${styles['wsFrameResize']} nodrag`}
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
      />
    </div>
  )
}
