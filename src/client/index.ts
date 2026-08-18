/**
 * dsh-talk-map, browser half: one sidebar footer action (toggle) plus one
 * shell.overlay entry (the map itself). Both ride ctx.slots.inject, so the
 * registrations wait for their slots to exist and unwind on plugin unload.
 *
 * Failure policy: apply() must never throw — the web shell fails the whole
 * boot when a plugin apply throws, and an external plugin must not take the
 * GUI down (policy proven by dsh-plugin-market).
 */
import type { TalkMapClientContext } from './dsh.ts'
import { canvas } from './canvas-store.ts'
import { DEFAULT_HOTKEY, hotkeyMatches } from './hotkey.ts'
import { attachServices, mapUi } from './map-state.ts'
import { MapOverlay } from './MapOverlay.tsx'
import { MapToggleButton } from './MapToggleButton.tsx'
import { t } from './i18n.ts'

export const name = 'dsh-talk-map'
export const inject = ['slots', 'sessions', 'workspaces', 'connection']

let applied = false

export function apply(ctx: TalkMapClientContext): void {
  // A duplicated client injection (module factory executed twice in one page
  // lifetime) would otherwise register a second button and overlay.
  if (applied) return
  applied = true
  ctx.effect(() => () => { applied = false }, 'dsh-talk-map: apply claim')

  try {
    attachServices({ sessions: ctx.sessions, workspaces: ctx.workspaces, connection: ctx.connection })
    ctx.effect(() => () => { attachServices(undefined) }, 'dsh-talk-map: services')

    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'talk-map',
      order: 10,
      label: () => t('map.toggle'),
    }, MapToggleButton))

    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'talk-map',
      order: 100,
      label: () => t('map.title'),
    }, MapOverlay))

    // Toggle hotkey (default ⌥F, user-configurable in the map header).
    // preventDefault stops macOS from typing the dead character (ƒ etc.)
    // into a focused composer. State loads early so the custom binding is
    // live before the map is first opened.
    canvas.ensureLoaded()
    ctx.effect(() => {
      const onKeyDown = (event: KeyboardEvent): void => {
        const hotkey = canvas.get().global?.hotkey ?? DEFAULT_HOTKEY
        if (hotkeyMatches(event, hotkey)) {
          event.preventDefault()
          event.stopPropagation()
          mapUi.toggle()
        }
      }
      window.addEventListener('keydown', onKeyDown, { capture: true })
      return () => { window.removeEventListener('keydown', onKeyDown, { capture: true }) }
    }, 'dsh-talk-map: toggle hotkey')
  } catch (error) {
    console.error('[dsh-talk-map] client apply failed:', error)
  }
}
