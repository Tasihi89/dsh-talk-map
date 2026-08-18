/**
 * The full-screen map surface, registered into 'shell.overlay' (root-scope
 * list slot: the layer is click-through, this entry opts back into pointer
 * events only while open). Closed state renders null so the app underneath
 * stays fully interactive.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { RootSlotStandardProps } from './dsh.ts'
import { t } from './i18n.ts'
import { mapUi } from './map-state.ts'
import { MapCanvas } from './MapCanvas.tsx'
import styles from './talk-map.module.css'

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
        event.stopPropagation()
        mapUi.setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => { window.removeEventListener('keydown', onKeyDown, { capture: true }) }
  }, [])

  return (
    <div className={styles['overlay']} role="dialog" aria-label={t('map.title')}>
      <div className={styles['header']}>
        <span className={styles['headerTitle']}>{t('map.title')}</span>
        <span className={styles['headerBadge']}>{sessionCount} {t('map.sessions')}</span>
        <span className={styles['headerSpace']} />
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
  if (!open) return null
  return <OpenMapOverlay {...props} />
}
