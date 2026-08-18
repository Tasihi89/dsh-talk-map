/**
 * Dark-mode signal, read the way the shell itself publishes it: ui-layout's
 * ThemePresenter sets `body[data-ds-dark-theme]` when the resolved scheme is
 * dark and removes it when light (theme-presenter.ts, DARK_ATTRIBUTE). A
 * MutationObserver keeps the hook live across theme switches.
 */
import { useSyncExternalStore } from 'react'

const DARK_ATTRIBUTE = 'data-ds-dark-theme'

function subscribe(listener: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  const observer = new MutationObserver(listener)
  observer.observe(document.body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] })
  return () => { observer.disconnect() }
}

function getSnapshot(): boolean {
  if (typeof document === 'undefined') return false
  return document.body.hasAttribute(DARK_ATTRIBUTE)
}

export function useDsDarkTheme(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot)
}
