/**
 * Structural contracts for the DSH client-runtime surfaces this plugin
 * touches. Deliberately NOT imported from @deepseek-ai packages: this plugin
 * builds out-of-tree against rc-stage APIs, and a structural subset keeps the
 * compile surface pinned to exactly what we call (the pattern proven by
 * dsh-plugin-market). Source of truth — verify on dsh upgrades:
 *   packages/client/runtime/src/client/contract/sessions.ts
 *   packages/client/runtime/src/client/sessions/service.ts   (SessionSummary)
 *   packages/client/runtime/src/client/workspaces/service.ts
 *   packages/client/ui-slots/src/store.ts                    (SnapshotSelectorHook)
 *   packages/client/ui-layout/src/client/index.ts            ('shell.overlay')
 *   packages/client/ui-sidebar/src/client/contract/slots.ts  ('sidebar.footer.action')
 * all @ deepseek-harness 0.1.0-rc.6.
 */

/** Selector hook a slot's standard props deliver (subscribes the component). */
export type SnapshotSelectorHook<T> = <S>(sel: (state: T) => S, eq?: (a: S, b: S) => boolean) => S

/** One row of the sessions list feed (subset of SessionSummary we render). */
export interface SessionSummary {
  readonly id: string
  readonly title?: string
  readonly displayTitle: string
  readonly cwd?: string
  readonly agentPreset?: string
  /** Fork/subagent lineage — the free provenance edge on the map. */
  readonly parentId?: string
  readonly origin?: 'subagent'
  readonly running: boolean
  readonly completed?: boolean
  readonly blank: boolean
  readonly updatedAt: number
}

/** The useSessions standard feed (subset). */
export interface SessionListState {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionSummary>>
  readonly current?: string
}

/** The useWorkspaces standard feed (subset of WorkspaceListState/WorkspaceView). */
export interface WorkspaceView {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
}
export interface WorkspaceListState {
  readonly items: readonly WorkspaceView[]
  readonly recentWorkspaceId: string | undefined
  readonly baselinesReady?: boolean
}

/** Standard props every root-scope slot component receives. */
export interface RootSlotStandardProps {
  useSessions: SnapshotSelectorHook<SessionListState>
  useWorkspaces: SnapshotSelectorHook<WorkspaceListState>
}

/** Owner share of a 'sidebar.footer.action' entry. */
export interface SidebarFooterActionOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/** Slot registration options (subset of the register() surface we use). */
export interface SlotEntryOptions {
  name: string
  id?: string
  order?: number
  label?: string | (() => string)
  inject?: (...args: unknown[]) => unknown
}

/** ctx.slots — inject defers until the slot is declared; register returns a disposer. */
export interface SlotsService {
  inject(name: string, factory: () => (() => void) | Iterable<() => void>): void
  register(entry: SlotEntryOptions, component: unknown): () => void
}

/** ctx.sessions (ISessions subset). */
export interface SessionsService {
  readonly list: {
    getSnapshot(): SessionListState
    subscribe(listener: () => void): () => void
  }
  open(id: string): void
  clear(): void
  fork(opts: { sessionId: string; atSeq?: number; increaseTitle?: boolean }): Promise<string>
}

/** ctx.workspaces (subset): connectWorkspace reuses-or-creates the blank session. */
export interface WorkspacesService {
  connectWorkspace(workspaceId: string): Promise<string>
  startSession(workspaceId?: string): void
}

/** The client cordis context surface this plugin relies on (structural). */
export interface TalkMapClientContext {
  slots: SlotsService
  sessions: SessionsService
  workspaces: WorkspacesService
  effect(callback: () => unknown, label?: string): void
}
