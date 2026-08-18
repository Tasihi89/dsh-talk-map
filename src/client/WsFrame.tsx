/**
 * Workspace frame: a derived region drawn behind the cards of one map group.
 * Geometry follows its members — drag a card anywhere and the frame
 * stretches after it. The body center is pointer-transparent (pan and
 * double-click pass through); the dashed border strips and the label chip
 * are the frame's physical surfaces — click to select, drag to move the
 * whole group (the canvas translates every member card).
 */
import type { NodeProps, Node } from '@xyflow/react'
import { colorOf } from './colors.ts'
import styles from './talk-map.module.css'

export interface WsFrameData extends Record<string, unknown> {
  workspaceId: string
  title: string
  count: number
  width: number
  height: number
  colorTag?: string
}

export type WsFrameNodeType = Node<WsFrameData, 'wsFrame'>

const EDGE = 10

export function WsFrameNode(props: NodeProps<WsFrameNodeType>): React.JSX.Element {
  const { data, selected } = props
  const color = colorOf(data.colorTag)
  return (
    <div
      className={`${styles['wsFrame']}${selected === true ? ` ${styles['wsFrameSelected']}` : ''}`}
      style={{
        width: data.width,
        height: data.height,
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
      </div>
      {/* border strips: clickable/draggable surfaces along the dashed edge */}
      <div className={styles['wsFrameEdge']} style={{ top: 0, left: 0, right: 0, height: EDGE }} />
      <div className={styles['wsFrameEdge']} style={{ bottom: 0, left: 0, right: 0, height: EDGE }} />
      <div className={styles['wsFrameEdge']} style={{ top: 0, bottom: 0, left: 0, width: EDGE }} />
      <div className={styles['wsFrameEdge']} style={{ top: 0, bottom: 0, right: 0, width: EDGE }} />
    </div>
  )
}
