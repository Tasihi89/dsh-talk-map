/**
 * The card node: one session on the board. Front face is the ADHD resume
 * surface — title, the digest's "next step" once M2 fills it, relative time,
 * running state. A card whose session no longer exists renders as a ghost
 * (grey, removable) — the host never auto-deletes placements.
 */
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { canvas } from './canvas-store.ts'
import { t } from './i18n.ts'
import styles from './talk-map.module.css'

export interface SessionCardData extends Record<string, unknown> {
  cardId: string
  sessionId: string
  title: string
  running: boolean
  isCurrent: boolean
  ghost: boolean
  updatedAt?: number
  nextStep?: string
  stale?: boolean
}

export type SessionCardNodeType = Node<SessionCardData, 'sessionCard'>

function relativeTime(timestamp: number | undefined): string {
  if (timestamp === undefined) return ''
  const delta = Date.now() - timestamp
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return t('time.now')
  if (minutes < 60) return `${minutes}${t('time.m')}`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}${t('time.h')}`
  const days = Math.round(hours / 24)
  return `${days}${t('time.d')}`
}

export function SessionCardNode(props: NodeProps<SessionCardNodeType>): React.JSX.Element {
  const { data, selected } = props
  const classNames = [styles['card']]
  if (data.ghost) classNames.push(styles['cardGhost'])
  if (selected === true) classNames.push(styles['cardSelected'])
  if (data.isCurrent) classNames.push(styles['cardCurrent'])

  return (
    <div className={classNames.filter(Boolean).join(' ')}>
      <Handle type="target" position={Position.Left} className={styles['cardHandle'] ?? ''} />
      <div className={styles['cardTop']}>
        {data.running ? <span className={styles['runningDot']} title={t('card.running')} /> : null}
        <span className={styles['cardTitle']}>{data.ghost ? t('card.ghostTitle') : data.title}</span>
      </div>
      {data.ghost
        ? (
            <button
              type="button"
              className={`${styles['cardRemove']} nodrag`}
              onClick={() => { canvas.removeCard(data.cardId) }}
            >
              {t('card.remove')}
            </button>
          )
        : data.nextStep !== undefined && data.nextStep !== ''
          ? (
              <div className={styles['cardNext']}>
                <span className={styles['cardNextLabel']}>{t('card.next')}</span>
                <span className={styles['cardNextText']}>{data.nextStep}</span>
                {data.stale === true ? <span className={styles['cardStale']} title={t('card.stale')}>⟳</span> : null}
              </div>
            )
          : null}
      <div className={styles['cardMeta']}>{relativeTime(data.updatedAt)}</div>
      <Handle type="source" position={Position.Right} className={styles['cardHandle'] ?? ''} />
    </div>
  )
}
