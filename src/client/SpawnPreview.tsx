/**
 * The injection preview: shown when a connection is dropped on empty canvas.
 * The user sees — and can edit — exactly what will be injected into the new
 * session before anything happens. Confirm spawns via the host route, then
 * jumps into the new conversation.
 */
import { useState } from 'react'
import { talkMapApi } from './api.ts'
import { canvas, INBOX_BOARD_ID } from './canvas-store.ts'
import { getServices, mapUi } from './map-state.ts'
import { t } from './i18n.ts'
import type { Digest } from '../shared/model.ts'
import styles from './talk-map.module.css'

export interface PendingSpawn {
  parent: { cardId: string; sessionId: string; title: string }
  /** Flow position where the connection was dropped (card lands here). */
  x: number
  y: number
}

export function buildInjectionText(title: string, digest: Digest | undefined): string {
  const header = `${t('inject.header')}「${title}」`
  if (digest === undefined || (digest.summary === '' && digest.nextStep === '' && (digest.todoNext ?? '') === '')) {
    return `${header}\n${t('spawn.noDigest')}`
  }
  const parts = [header]
  if (digest.summary !== '') parts.push(`${t('inject.summary')}${digest.summary}`)
  if (digest.keyFindings.length > 0) {
    parts.push(t('inject.findings'))
    for (const finding of digest.keyFindings) parts.push(`- ${finding}`)
  }
  const next = digest.nextStep !== '' ? digest.nextStep : digest.todoNext ?? ''
  if (next !== '') parts.push(`${t('inject.next')}${next}`)
  return parts.join('\n')
}

export function SpawnPreview(props: {
  pending: PendingSpawn
  onClose: () => void
}): React.JSX.Element {
  const { pending } = props
  const digest = canvas.get().digests[pending.parent.sessionId]
  const [text, setText] = useState(() => buildInjectionText(pending.parent.title, digest))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const confirm = async (): Promise<void> => {
    if (busy || text.trim() === '') return
    setBusy(true)
    setError(undefined)
    try {
      const result = await talkMapApi.spawn({
        parents: [{ cardId: pending.parent.cardId, sessionId: pending.parent.sessionId, text }],
        boardId: INBOX_BOARD_ID,
        x: pending.x,
        y: pending.y,
      })
      canvas.applySpawn(result)
      props.onClose()
      const services = getServices()
      if (services !== undefined) {
        mapUi.setOpen(false)
        services.sessions.open(result.sessionId)
      }
    } catch (spawnError) {
      setError(String(spawnError))
      setBusy(false)
    }
  }

  return (
    <div className={styles['spawnPanel']} role="dialog" aria-label={t('spawn.heading')}>
      <div className={styles['spawnHeading']}>{t('spawn.heading')}</div>
      <div className={styles['spawnFrom']}>{t('spawn.from')}「{pending.parent.title}」</div>
      <div className={styles['spawnHint']}>{t('spawn.hint')}</div>
      <textarea
        className={`${styles['spawnTextarea']} nodrag nowheel`}
        value={text}
        rows={10}
        onChange={(event) => { setText(event.target.value) }}
      />
      {error !== undefined ? <div className={styles['spawnError']}>{error}</div> : null}
      <div className={styles['spawnActions']}>
        <button
          type="button"
          className={styles['spawnBtnGhost']}
          onClick={props.onClose}
          disabled={busy}
        >
          {t('spawn.cancel')}
        </button>
        <button
          type="button"
          className={styles['spawnBtnPrimary']}
          onClick={() => { void confirm() }}
          disabled={busy || text.trim() === ''}
        >
          {busy ? t('spawn.busy') : t('spawn.confirm')}
        </button>
      </div>
    </div>
  )
}
