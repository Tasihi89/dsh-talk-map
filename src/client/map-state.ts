/**
 * Map UI state shared between the sidebar toggle button and the overlay —
 * two components registered into unrelated slots, so they meet through this
 * module-level external store (useSyncExternalStore on the React side).
 */
import type { SessionsService, WorkspacesService } from './dsh.ts'

export interface MapUiState {
  readonly open: boolean
}

type Listener = () => void

const listeners = new Set<Listener>()
let state: MapUiState = { open: false }

function emit(): void {
  for (const listener of listeners) listener()
}

export const mapUi = {
  get(): MapUiState {
    return state
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  setOpen(open: boolean): void {
    if (state.open === open) return
    state = { ...state, open }
    emit()
  },
  toggle(): void {
    mapUi.setOpen(!state.open)
  },
}

/**
 * Service handles captured at apply() time so components can navigate
 * (open/create sessions) without threading ctx through props.
 */
export interface MapServices {
  sessions: SessionsService
  workspaces: WorkspacesService
}

let services: MapServices | undefined

export function attachServices(next: MapServices | undefined): void {
  services = next
}

export function getServices(): MapServices | undefined {
  return services
}
