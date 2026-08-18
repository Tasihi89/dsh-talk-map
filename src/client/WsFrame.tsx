/**
 * Workspace frame: a derived region drawn behind the cards of one map group.
 * The body is pointer-transparent (pan/double-click pass through); the label
 * chip is the frame's physical handle — grab it to drag the whole group
 * (the canvas moves every member card by the same delta), click it to
 * select the frame for coloring.
 */
import type { NodeProps, Node } from '@xyflow/react'
import { colorOf } from './colors.ts'
import styles from './talk-map.module.css'

export interface WsFrameData extends Record<string, unknown> {
  title: string
  count: number
  width: number
  height: number
  colorTag?: string
}

export type WsFrameNodeType = Node<WsFrameData, 'wsFrame'>

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
    </div>
  )
}
