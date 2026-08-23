/**
 * The full-screen map surface, registered into 'shell.overlay' (root-scope
 * list slot: the layer is click-through, this entry opts back into pointer
 * events only while open). Closed state renders null so the app underneath
 * stays fully interactive.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { LocalePref } from '../shared/model.ts'
import type { RootSlotStandardProps } from './dsh.ts'
import { canvas } from './canvas-store.ts'
import { DEFAULT_HOTKEY, hotkeyFromEvent, hotkeyLabel } from './hotkey.ts'
import { activeLocale, LOCALE_CYCLE, subscribeLocale, t } from './i18n.ts'
import { mapUi } from './map-state.ts'
import { MapCanvas } from './MapCanvas.tsx'
import styles from './talk-map.module.css'

function HotkeyButton(): React.JSX.Element {
  const hotkey = useSyncExternalStore(canvas.subscribe, () => canvas.get().global?.hotkey ?? DEFAULT_HOTKEY)
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (!capturing) return
    const release = mapUi.claimEscape('hotkey-capture')
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setCapturing(false)
        return
      }
      const captured = hotkeyFromEvent(event)
      if (captured !== null) {
        canvas.patchGlobalNow({ hotkey: captured })
        setCapturing(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      release()
    }
  }, [capturing])

  return (
    <button
      type="button"
      className={styles['hotkeyButton']}
      title={t('hotkey.title')}
      onClick={() => { setCapturing(true) }}
    >
      {capturing ? t('hotkey.capturing') : hotkeyLabel(hotkey)}
    </button>
  )
}

/**
 * Interface language: cycles auto → 中文 → English. 'auto' follows dsh's
 * own <html lang>, which is what every install had before this setting.
 */
function LanguageButton(): React.JSX.Element {
  const pref = useSyncExternalStore(canvas.subscribe, () => canvas.get().global?.locale ?? 'auto')
  const index = LOCALE_CYCLE.indexOf(pref)
  const next: LocalePref = LOCALE_CYCLE[(index + 1) % LOCALE_CYCLE.length] ?? 'auto'
  return (
    <button
      type="button"
      className={styles['langButton']}
      title={t('lang.hint', { current: t(`lang.${pref}`), next: t(`lang.${next}`) })}
      onClick={() => { canvas.patchGlobalNow({ locale: next }) }}
    >
      {t(`lang.${pref}`)}
    </button>
  )
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function OpenMapOverlay(props: RootSlotStandardProps): React.JSX.Element {
  const sessionCount = props.useSessions(state => state.ids.length)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // An inner surface (draft card, spawn preview) claims Esc for itself.
        if (mapUi.escapeClaimed()) return
        event.stopPropagation()
        mapUi.setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => { window.removeEventListener('keydown', onKeyDown, { capture: true }) }
  }, [])

  return (
    <div className={styles['overlay']} lang={activeLocale()} role="dialog" aria-label={t('map.title')}>
      <div className={styles['header']}>
        <span className={styles['headerTitle']}>{t('map.title')}</span>
        <span className={styles['headerBadge']}>{sessionCount} {t('map.sessions')}</span>
        <span className={styles['headerSpace']} />
        <LanguageButton />
        <HotkeyButton />
        <button
          type="button"
          className={styles['closeButton']}
          title={t('map.close')}
          aria-label={t('map.close')}
          onClick={() => { mapUi.setOpen(false) }}
        >
          <CloseIcon />
        </button>
      </div>
      <MapCanvas {...props} />
    </div>
  )
}

export function MapOverlay(props: RootSlotStandardProps): React.JSX.Element | null {
  const open = useSyncExternalStore(mapUi.subscribe, () => mapUi.get().open)
  // Subscribing here re-renders the whole overlay on a language switch;
  // MapCanvas re-keys its own memos so the React-Flow nodes follow.
  useSyncExternalStore(subscribeLocale, activeLocale, activeLocale)
  if (!open) return null
  return <OpenMapOverlay {...props} />
}
