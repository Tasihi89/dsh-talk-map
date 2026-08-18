/**
 * Right-click menu for the board. One flat panel; entries that need a second
 * step (import workspace, move to group, import session) swap the panel body
 * for a searchable pick list. Right-DRAG still pans — React Flow only raises
 * the contextmenu callbacks on a plain right click.
 */
import { useEffect, useRef, useState } from 'react'
import { mapUi } from './map-state.ts'
import { t } from './i18n.ts'
import styles from './talk-map.module.css'

export interface MenuItem {
  key: string
  label: string
  /** Dimmed suffix rendered after the label (e.g. 已在地图). */
  hint?: string
  disabled?: boolean
  onPick: () => void
}

export interface MenuState {
  /** Position inside the canvas wrapper (px). */
  left: number
  top: number
  title?: string
  /** Pick-list views get a filter input. */
  searchable?: boolean
  /** Prompt views ask for one line of text instead of picking from a list. */
  prompt?: {
    placeholder: string
    submitLabel: string
    /** Live preview under the input (e.g. the resulting folder path). */
    preview?: (value: string) => string
    onSubmit: (value: string) => Promise<void>
  }
  items: MenuItem[]
}

export function ContextMenu(props: { menu: MenuState; onClose: () => void }): React.JSX.Element {
  const { menu } = props
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const submitPrompt = async (): Promise<void> => {
    const prompt = menu.prompt
    if (prompt === undefined || busy || query.trim() === '') return
    setBusy(true)
    setError(undefined)
    try {
      await prompt.onSubmit(query.trim())
    } catch (submitError) {
      setError(String(submitError))
      setBusy(false)
    }
  }

  useEffect(() => {
    const release = mapUi.claimEscape('context-menu')
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        props.onClose()
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
    if (menu.searchable === true || menu.prompt !== undefined) inputRef.current?.focus()
  }, [menu.searchable, menu.prompt])

  const normalized = query.trim().toLowerCase()
  const visible = normalized === ''
    ? menu.items
    : menu.items.filter(item => item.label.toLowerCase().includes(normalized))

  return (
    <div
      className={styles['menu']}
      style={{ left: menu.left, top: menu.top }}
      role="menu"
      // The canvas wrapper closes the menu on any click that reaches it —
      // clicks INSIDE the menu (view switches, the search input) must not.
      onClick={(event) => { event.stopPropagation() }}
      onPointerDown={(event) => { event.stopPropagation() }}
      onContextMenu={(event) => { event.preventDefault() }}
    >
      {menu.title !== undefined ? <div className={styles['menuTitle']}>{menu.title}</div> : null}
      {menu.prompt !== undefined
        ? (
            <>
              <input
                ref={inputRef}
                className={styles['menuSearch']}
                placeholder={menu.prompt.placeholder}
                value={query}
                onChange={(event) => { setQuery(event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void submitPrompt()
                  }
                }}
              />
              {menu.prompt.preview !== undefined && query.trim() !== ''
                ? <div className={styles['menuPreview']}>{menu.prompt.preview(query.trim())}</div>
                : null}
              {error !== undefined ? <div className={styles['menuError']}>{error}</div> : null}
              <button
                type="button"
                className={styles['menuItem']}
                disabled={busy || query.trim() === ''}
                onClick={() => { void submitPrompt() }}
              >
                {busy ? t('menu.working') : menu.prompt.submitLabel}
              </button>
            </>
          )
        : null}
      {menu.searchable === true
        ? (
            <input
              ref={inputRef}
              className={styles['menuSearch']}
              placeholder={t('menu.search')}
              value={query}
              onChange={(event) => { setQuery(event.target.value) }}
            />
          )
        : null}
      {menu.prompt !== undefined
        ? null
        : visible.length === 0
        ? <div className={styles['menuEmpty']}>{t('menu.empty')}</div>
        : visible.map(item => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={styles['menuItem']}
            disabled={item.disabled === true}
            onClick={() => { item.onPick() }}
          >
            {item.label}
            {item.hint !== undefined ? <span className={styles['menuHint']}> {item.hint}</span> : null}
          </button>
        ))}
    </div>
  )
}
