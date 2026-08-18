/**
 * Sidebar footer action: toggles the map overlay. Receives the sidebar's
 * column state as owner props ({ wide }) — rendering stays icon-sized either
 * way, matching the Settings row's footprint.
 */
import { useSyncExternalStore } from 'react'
import type { SidebarFooterActionOwnerProps } from './dsh.ts'
import { t } from './i18n.ts'
import { mapUi } from './map-state.ts'
import styles from './talk-map.module.css'

function MapIcon(): React.JSX.Element {
  return (
    <svg className={styles['toggleIcon']} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </svg>
  )
}

export function MapToggleButton(_props: SidebarFooterActionOwnerProps): React.JSX.Element {
  const open = useSyncExternalStore(mapUi.subscribe, () => mapUi.get().open)
  return (
    <button
      type="button"
      className={`${styles['toggleButton']}${open ? ` ${styles['toggleButtonActive']}` : ''}`}
      title={t('map.toggle')}
      aria-label={t('map.toggle')}
      aria-pressed={open}
      onClick={() => { mapUi.toggle() }}
    >
      <MapIcon />
    </button>
  )
}
