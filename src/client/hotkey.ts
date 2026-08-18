/**
 * Map-toggle hotkey: stored as "modifier+…+code" (KeyboardEvent.code), e.g.
 * "alt+KeyF" or "meta+shift+KeyM". Default ⌥F.
 */
export const DEFAULT_HOTKEY = 'alt+KeyF'

export interface ParsedHotkey {
  alt: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
  code: string
}

export function parseHotkey(value: string): ParsedHotkey {
  const parts = value.split('+')
  const code = parts[parts.length - 1] ?? ''
  return {
    alt: parts.includes('alt'),
    ctrl: parts.includes('ctrl'),
    meta: parts.includes('meta'),
    shift: parts.includes('shift'),
    code,
  }
}

export function hotkeyMatches(event: KeyboardEvent, value: string): boolean {
  const hotkey = parseHotkey(value)
  return event.altKey === hotkey.alt
    && event.ctrlKey === hotkey.ctrl
    && event.metaKey === hotkey.meta
    && event.shiftKey === hotkey.shift
    && event.code === hotkey.code
}

/** Encode a captured keydown; null when it's modifier-only or unmodified. */
export function hotkeyFromEvent(event: KeyboardEvent): string | null {
  if (/^(Alt|Control|Meta|Shift)/.test(event.code) || event.code === '') return null
  if (!event.altKey && !event.ctrlKey && !event.metaKey) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  if (event.metaKey) parts.push('meta')
  parts.push(event.code)
  return parts.join('+')
}

/** Human-readable form: ⌃⌥⇧⌘ + key label. */
export function hotkeyLabel(value: string): string {
  const hotkey = parseHotkey(value)
  const key = hotkey.code.startsWith('Key')
    ? hotkey.code.slice(3)
    : hotkey.code.startsWith('Digit')
      ? hotkey.code.slice(5)
      : hotkey.code
  return `${hotkey.ctrl ? '⌃' : ''}${hotkey.alt ? '⌥' : ''}${hotkey.shift ? '⇧' : ''}${hotkey.meta ? '⌘' : ''}${key}`
}
