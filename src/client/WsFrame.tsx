/**
 * Workspace frame: a derived, purely visual region drawn behind the cards of
 * one workspace. It is computed from member-card bounding boxes every render
 * — never stored, never draggable, and pointer-transparent (the node's style
 * carries pointer-events:none), so panning and double-click work through it.
 */
import type { NodeProps, Node } from '@xyflow/react'
import styles from './talk-map.module.css'

export interface WsFrameData extends Record<string, unknown> {
  title: string
  count: number
  width: number
  height: number
}

export type WsFrameNodeType = Node<WsFrameData, 'wsFrame'>

export function WsFrameNode(props: NodeProps<WsFrameNodeType>): React.JSX.Element {
  const { data } = props
  return (
    <div
      className={styles['wsFrame']}
      style={{ width: data.width, height: data.height }}
      data-talkmap-frame=""
    >
      <div className={styles['wsFrameLabel']}>
        {data.title}
        <span className={styles['wsFrameCount']}>{data.count}</span>
      </div>
    </div>
  )
}
