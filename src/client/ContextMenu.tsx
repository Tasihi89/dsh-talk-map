/**
 * Right-click menu for the board. One flat panel; entries that need a second
 * step (import workspace, move to group, import session) swap the panel body
 * for a pick list with a back row. Right-DRAG still pans — React Flow only
 * raises the contextmenu callbacks on a plain right click.
 */
import { useEffect } from 'react'
import { mapUi } from './map-state.ts'
import { t } from './i18n.ts'
import styles from './talk-map.module.css'

export interface MenuItem {
  key: string
  label: string
  disabled?: boolean
  onPick: () => void
}

export interface MenuState {
  /** Position inside the canvas wrapper (px). */
  left: number
  top: number
  title?: string
  items: MenuItem[]
}

export function ContextMenu(props: { menu: MenuState; onClose: () => void }): React.JSX.Element {
  const { menu } = props

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

  return (
    <div
      className={styles['menu']}
      style={{ left: menu.left, top: menu.top }}
      role="menu"
      onContextMenu={(event) => { event.preventDefault() }}
    >
      {menu.title !== undefined ? <div className={styles['menuTitle']}>{menu.title}</div> : null}
      {menu.items.length === 0
        ? <div className={styles['menuEmpty']}>{t('menu.empty')}</div>
        : menu.items.map(item => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={styles['menuItem']}
            disabled={item.disabled === true}
            onClick={() => { item.onPick() }}
          >
            {item.label}
          </button>
        ))}
    </div>
  )
}
