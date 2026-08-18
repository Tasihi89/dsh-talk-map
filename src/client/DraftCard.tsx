/**
 * The draft card: double-clicking empty canvas opens this in-place composer
 * node instead of jumping into the conversation UI. Nothing exists until 发送
 * — then (optionally) a workspace is created, a session is created in it,
 * the optional model selection is applied, the first prompt is queued, and
 * the draft turns into a normal card at the same spot. The user stays on the
 * map; the running dot shows progress.
 *
 * Defaults are shown as real values (via /talk-map/defaults): the default
 * model route and the deployment's default agent preset. Double-clicking
 * inside a workspace frame preselects that workspace; anywhere else the
 * selector defaults to creating a new workspace.
 */
import { useEffect, useRef, useState } from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import type { AgentPresetEntry, ModelProviderGroup } from './dsh.ts'
import { talkMapApi } from './api.ts'
import { canvas, INBOX_BOARD_ID, newCardId } from './canvas-store.ts'
import { getServices, mapUi } from './map-state.ts'
import { t } from './i18n.ts'
import styles from './talk-map.module.css'

export interface DraftCardData extends Record<string, unknown> {
  /** Workspaces to choose from (id + display title + path), map-order. */
  workspaceOptions: { id: string; title: string; path: string }[]
  /** Preselected workspace (set when the double-click landed inside a frame). */
  defaultWorkspaceId?: string
  /** Map group the draft was opened in — the new card's frame membership. */
  groupId?: string
  onClose: () => void
}

export type DraftCardNodeType = Node<DraftCardData, 'draftCard'>

const NEW_WORKSPACE = '__new__'
const GRID = 16
const snap = (value: number): number => Math.round(value / GRID) * GRID

function unwrap<T>(response: { result: { ok: true; value: T } | { ok: false; error: { code?: string; message?: string } } }, what: string): T {
  const { result } = response
  if (result.ok) return result.value
  throw new Error(`${what}: ${result.error.code ?? ''} ${result.error.message ?? ''}`.trim())
}

/** Parent directory new workspaces land in: alongside the existing ones. */
function newWorkspaceParent(options: { path: string }[]): string {
  const sample = options[0]?.path
  if (sample === undefined) return '~'
  const cut = sample.lastIndexOf('/')
  return cut > 0 ? sample.slice(0, cut) : sample
}

export function DraftCardNode(props: NodeProps<DraftCardNodeType>): React.JSX.Element {
  const { data } = props
  const [workspaceId, setWorkspaceId] = useState(data.defaultWorkspaceId ?? NEW_WORKSPACE)
  const [newWsName, setNewWsName] = useState('')
  const [modelKey, setModelKey] = useState('')
  const [presetId, setPresetId] = useState('')
  const [text, setText] = useState('')
  const [groups, setGroups] = useState<ModelProviderGroup[]>([])
  const [presets, setPresets] = useState<readonly AgentPresetEntry[]>([])
  const [defaultModelLabel, setDefaultModelLabel] = useState('')
  const [defaultPresetLabel, setDefaultPresetLabel] = useState('')
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
      if (response.result.ok) {
        const list = response.result.value.presets
        setPresets(list)
        // Prefer the plain "standard" preset for map-born conversations —
        // the deployment default may be a specialized mode (e.g. cordis).
        if (list.some(preset => preset.id === 'standard')) {
          setPresetId(previous => (previous === '' ? 'standard' : previous))
        }
      }
    }).catch(() => undefined)
    talkMapApi.getDefaults().then((defaults) => {
      if (defaults.model !== null) setDefaultModelLabel(defaults.model.model)
      if (defaults.preset !== null) setDefaultPresetLabel(defaults.preset)
    }).catch(() => undefined)
  }, [])

  const creatingWorkspace = workspaceId === NEW_WORKSPACE
  const wsParent = newWorkspaceParent(data.workspaceOptions)
  const newWsPath = `${wsParent}/${newWsName.trim()}`
  const sendDisabled = busy || text.trim() === '' || (creatingWorkspace && newWsName.trim() === '')

  const send = async (): Promise<void> => {
    const services = getServices()
    if (services === undefined || sendDisabled) return
    setBusy(true)
    setError(undefined)
    try {
      let targetWorkspaceId = workspaceId
      if (creatingWorkspace) {
        // dsh only registers existing directories — create the folder first.
        await talkMapApi.ensureDir(newWsPath)
        const created = unwrap(
          await services.connection.api.workspace.create({ path: newWsPath }),
          'workspace.create',
        )
        targetWorkspaceId = created.workspace.workspaceId
      }
      const created = unwrap(await services.connection.api.sessions.create({
        workspaceId: targetWorkspaceId,
        ...(presetId !== '' ? { agentPreset: presetId } : {}),
      }), 'session.create')
      const sessionId = created.sessionId
      const cardX = snap(props.positionAbsoluteX)
      const cardY = snap(props.positionAbsoluteY)
      // The card's map group follows the chosen workspace (not merely the
      // frame the draft was opened in) — and a workspace with no frame on
      // the board gets one built around the newborn card.
      canvas.addCards({
        [newCardId()]: {
          boardId: INBOX_BOARD_ID,
          sessionId,
          x: cardX,
          y: cardY,
          wsOverride: targetWorkspaceId,
          createdAt: Date.now(),
        },
      })
      if (canvas.get().global?.wsFrames?.[targetWorkspaceId] === undefined) {
        const CARD_W = 224
        const CARD_H = 120
        const PAD = 32
        const LABEL = 30
        canvas.setWsFrameRect(targetWorkspaceId, {
          x: cardX - PAD,
          y: cardY - PAD - LABEL,
          width: CARD_W + PAD * 2,
          height: CARD_H + PAD * 2 + LABEL,
        })
      }
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
      // Jump straight into the running conversation.
      mapUi.setOpen(false)
      services.sessions.open(sessionId)
    } catch (sendError) {
      setError(String(sendError))
      setBusy(false)
    }
  }

  return (
    <div
      className={styles['draftCard']}
      role="dialog"
      aria-label={t('draft.heading')}
      // Form controls own their pointer events entirely: React Flow's node
      // machinery must never see them, or the native <select> dropdown opens
      // and instantly closes (the flash-close bug).
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('select, textarea, input, button') !== null) event.stopPropagation()
      }}
      onMouseDownCapture={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('select, textarea, input, button') !== null) event.stopPropagation()
      }}
    >
      <div className={styles['draftHeading']}>{t('draft.heading')}</div>
      <div className={styles['draftRow']}>
        <label className={styles['draftLabel']}>{t('draft.workspace')}</label>
        <select
          className={`${styles['draftSelect']} nodrag`}
          value={workspaceId}
          onChange={(event) => { setWorkspaceId(event.target.value) }}
        >
          <option value={NEW_WORKSPACE}>{t('draft.newWorkspace')}</option>
          {data.workspaceOptions.map(option => (
            <option key={option.id} value={option.id}>{option.title}</option>
          ))}
        </select>
      </div>
      {creatingWorkspace
        ? (
            <div className={styles['draftRow']}>
              <label className={styles['draftLabel']}>{t('draft.wsName')}</label>
              <div className={styles['draftGrow']}>
                <input
                  className={`${styles['draftInput']} nodrag`}
                  value={newWsName}
                  placeholder={t('draft.wsNamePlaceholder')}
                  onChange={(event) => { setNewWsName(event.target.value) }}
                />
                {newWsName.trim() !== ''
                  ? <div className={styles['draftPathPreview']}>{newWsPath}</div>
                  : null}
              </div>
            </div>
          )
        : null}
      <div className={styles['draftRow']}>
        <label className={styles['draftLabel']}>{t('draft.model')}</label>
        <select
          className={`${styles['draftSelect']} nodrag`}
          value={modelKey}
          onChange={(event) => { setModelKey(event.target.value) }}
        >
          <option value="">
            {defaultModelLabel !== '' ? `${defaultModelLabel}${t('draft.defaultSuffix')}` : t('draft.default')}
          </option>
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
                <option value="">
                  {defaultPresetLabel !== '' ? `${defaultPresetLabel}${t('draft.defaultSuffix')}` : t('draft.default')}
                </option>
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
          // Enter sends (Shift+Enter = newline); an IME confirmation Enter
          // (Chinese candidate pick) must never send.
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
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
          disabled={sendDisabled}
        >
          {busy ? t('draft.sending') : t('draft.send')}
        </button>
      </div>
    </div>
  )
}
