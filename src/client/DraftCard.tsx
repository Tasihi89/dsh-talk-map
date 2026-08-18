/**
 * The draft card: double-clicking empty canvas opens this in-place composer
 * node instead of jumping into the conversation UI. Nothing exists until 发送
 * — then a session is created in the chosen workspace, the optional model
 * selection is applied, the first prompt is queued, and the draft turns into
 * a normal card at the same spot. The user stays on the map; the running dot
 * shows progress and double-clicking the card opens the conversation.
 */
import { useEffect, useRef, useState } from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import type { AgentPresetEntry, ModelProviderGroup } from './dsh.ts'
import { canvas, INBOX_BOARD_ID, newCardId } from './canvas-store.ts'
import { getServices, mapUi } from './map-state.ts'
import { t } from './i18n.ts'
import styles from './talk-map.module.css'

export interface DraftCardData extends Record<string, unknown> {
  /** Workspaces to choose from (id + display title), map-order. */
  workspaceOptions: { id: string; title: string }[]
  defaultWorkspaceId?: string
  onClose: () => void
}

export type DraftCardNodeType = Node<DraftCardData, 'draftCard'>

const GRID = 16
const snap = (value: number): number => Math.round(value / GRID) * GRID

function unwrap<T>(response: { result: { ok: true; value: T } | { ok: false; error: { code?: string; message?: string } } }, what: string): T {
  const { result } = response
  if (result.ok) return result.value
  throw new Error(`${what}: ${result.error.code ?? ''} ${result.error.message ?? ''}`.trim())
}

export function DraftCardNode(props: NodeProps<DraftCardNodeType>): React.JSX.Element {
  const { data } = props
  const [workspaceId, setWorkspaceId] = useState(data.defaultWorkspaceId ?? data.workspaceOptions[0]?.id ?? '')
  const [modelKey, setModelKey] = useState('')
  const [presetId, setPresetId] = useState('')
  const [text, setText] = useState('')
  const [groups, setGroups] = useState<ModelProviderGroup[]>([])
  const [presets, setPresets] = useState<readonly AgentPresetEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    textareaRef.current?.focus()
    const release = mapUi.claimEscape('draft-card')
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        data.onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const services = getServices()
    if (services === undefined) return
    services.connection.api.llm.models({}).then((response) => {
      if (response.result.ok) setGroups(response.result.value.groups ?? [])
    }).catch(() => undefined)
    services.connection.api.agentPresets.list({}).then((response) => {
      if (response.result.ok) setPresets(response.result.value.presets)
    }).catch(() => undefined)
  }, [])

  const send = async (): Promise<void> => {
    const services = getServices()
    if (services === undefined || busy || text.trim() === '' || workspaceId === '') return
    setBusy(true)
    setError(undefined)
    try {
      const created = unwrap(await services.connection.api.sessions.create({
        workspaceId,
        ...(presetId !== '' ? { agentPreset: presetId } : {}),
      }), 'session.create')
      const sessionId = created.sessionId
      // Card FIRST: the session hits the list feed the moment it exists, and
      // the auto-placement effect must find a card already standing or it
      // places a duplicate in the workspace region.
      canvas.addCards({
        [newCardId()]: {
          boardId: INBOX_BOARD_ID,
          sessionId,
          x: snap(props.positionAbsoluteX),
          y: snap(props.positionAbsoluteY),
          createdAt: Date.now(),
        },
      })
      if (modelKey !== '') {
        const [provider, model] = modelKey.split('::') as [string, string]
        unwrap(await services.connection.api.sessions.selectModel({ sessionId, provider, model }), 'session.selectModel')
      }
      unwrap(await services.connection.api.sessions.prompt({
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }), 'session.prompt')
      data.onClose()
    } catch (sendError) {
      setError(String(sendError))
      setBusy(false)
    }
  }

  return (
    <div className={styles['draftCard']} role="dialog" aria-label={t('draft.heading')}>
      <div className={styles['draftHeading']}>{t('draft.heading')}</div>
      <div className={styles['draftRow']}>
        <label className={styles['draftLabel']}>{t('draft.workspace')}</label>
        <select
          className={`${styles['draftSelect']} nodrag`}
          value={workspaceId}
          onChange={(event) => { setWorkspaceId(event.target.value) }}
        >
          {data.workspaceOptions.map(option => (
            <option key={option.id} value={option.id}>{option.title}</option>
          ))}
        </select>
      </div>
      <div className={styles['draftRow']}>
        <label className={styles['draftLabel']}>{t('draft.model')}</label>
        <select
          className={`${styles['draftSelect']} nodrag`}
          value={modelKey}
          onChange={(event) => { setModelKey(event.target.value) }}
        >
          <option value="">{t('draft.default')}</option>
          {groups.map(group => group.models.map(model => (
            <option key={`${group.id}::${model.id}`} value={`${group.id}::${model.id}`}>
              {group.name} · {model.name}
            </option>
          )))}
        </select>
      </div>
      {presets.length > 0
        ? (
            <div className={styles['draftRow']}>
              <label className={styles['draftLabel']}>{t('draft.preset')}</label>
              <select
                className={`${styles['draftSelect']} nodrag`}
                value={presetId}
                onChange={(event) => { setPresetId(event.target.value) }}
              >
                <option value="">{t('draft.default')}</option>
                {presets.map(preset => (
                  <option key={preset.id} value={preset.id}>{preset.name ?? preset.id}</option>
                ))}
              </select>
            </div>
          )
        : null}
      <textarea
        ref={textareaRef}
        className={`${styles['draftTextarea']} nodrag nowheel`}
        placeholder={t('draft.placeholder')}
        value={text}
        rows={4}
        onChange={(event) => { setText(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void send()
          }
        }}
      />
      {error !== undefined ? <div className={styles['spawnError']}>{error}</div> : null}
      <div className={styles['spawnActions']}>
        <button type="button" className={`${styles['spawnBtnGhost']} nodrag`} onClick={data.onClose} disabled={busy}>
          {t('spawn.cancel')}
        </button>
        <button
          type="button"
          className={`${styles['spawnBtnPrimary']} nodrag`}
          onClick={() => { void send() }}
          disabled={busy || text.trim() === '' || workspaceId === ''}
        >
          {busy ? t('draft.sending') : t('draft.send')}
        </button>
      </div>
    </div>
  )
}
