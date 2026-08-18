/**
 * The card node: one session on the board. Front face is the ADHD resume
 * surface — title, the digest's "next step" once M2 fills it, relative time,
 * running state. A card whose session no longer exists renders as a ghost
 * (grey, removable) — the host never auto-deletes placements.
 */
import { useState } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { talkMapApi } from './api.ts'
import { canvas } from './canvas-store.ts'
import { colorOf } from './colors.ts'
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
  colorTag?: string
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
  const [refreshing, setRefreshing] = useState(false)
  const classNames = [styles['card']]
  if (data.ghost) classNames.push(styles['cardGhost'])
  if (selected === true) classNames.push(styles['cardSelected'])
  if (data.isCurrent) classNames.push(styles['cardCurrent'])

  const refreshDigest = async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await talkMapApi.refreshDigest(data.sessionId)
    } catch (error) {
      console.error('[dsh-talk-map] digest refresh failed:', error)
    } finally {
      setRefreshing(false)
    }
  }

  const color = colorOf(data.colorTag)

  return (
    <div
      className={classNames.filter(Boolean).join(' ')}
      style={color !== undefined
        ? { borderColor: color.border, backgroundImage: `linear-gradient(${color.fill}, ${color.fill})` }
        : {}}
    >
      <Handle type="target" position={Position.Left} className={styles['cardHandle'] ?? ''} />
      <div className={styles['cardTop']}>
        {data.running ? <span className={styles['runningDot']} title={t('card.running')} /> : null}
        <span className={styles['cardTitle']}>{data.ghost ? t('card.ghostTitle') : data.title}</span>
        {data.ghost
          ? null
          : (
              <button
                type="button"
                className={`${styles['cardRefresh']} nodrag${refreshing ? ` ${styles['cardRefreshBusy']}` : ''}`}
                title={t('card.refresh')}
                aria-label={t('card.refresh')}
                onClick={(event) => {
                  event.stopPropagation()
                  void refreshDigest()
                }}
              >
                ⟳
              </button>
            )}
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
