/**
 * Sidebar footer action: toggles the map overlay. Receives the sidebar's
 * column state as owner props ({ wide }) — rendering stays icon-sized either
 * way, matching the Settings row's footprint.
 */
import { useSyncExternalStore } from 'react'
import type { SidebarFooterActionOwnerProps } from './dsh.ts'
import { activeLocale, subscribeLocale, t } from './i18n.ts'
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

export function MapToggleButton(props: SidebarFooterActionOwnerProps): React.JSX.Element {
  const open = useSyncExternalStore(mapUi.subscribe, () => mapUi.get().open)
  // This button lives outside the overlay, so it needs its own subscription
  // to re-render when the language changes.
  const locale = useSyncExternalStore(subscribeLocale, activeLocale, activeLocale)
  const wide = props.wide
  const classNames = [wide ? styles['toggleRow'] : styles['toggleButton']]
  if (open) classNames.push(styles['toggleButtonActive'])
  return (
    <button
      type="button"
      className={classNames.filter(Boolean).join(' ')}
      lang={locale}
      title={t('map.toggle')}
      aria-label={t('map.toggle')}
      aria-pressed={open}
      onClick={() => { mapUi.toggle() }}
    >
      <MapIcon />
      {wide ? <span className={styles['toggleLabel']}>{t('map.toggle')}</span> : null}
    </button>
  )
}
