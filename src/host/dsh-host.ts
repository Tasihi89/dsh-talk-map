/**
 * Structural contracts for the DSH host services this plugin touches.
 * Source of truth — verify on dsh upgrades:
 *   packages/storage/storage-domain/src/{spec,domain,index}.ts  (ctx.storageDomain)
 *   docs/subsystems/web-server.md                               (ctx.webServer)
 *   packages/core/session/src/index.ts                          (session events)
 * all @ deepseek-harness 0.1.0-rc.6.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ZodType } from 'zod'

/** storage-domain: spec is plain data — zod schemas plus names. */
export interface DomainGlobalSpec<G> {
  readonly schema: ZodType<G>
  readonly initial: G
}
export interface DomainTableSpec<V> {
  readonly valueSchema: ZodType<V>
}
export interface DomainSpec {
  readonly name: string
  readonly version: number
  readonly global?: DomainGlobalSpec<unknown>
  readonly tables: Record<string, DomainTableSpec<unknown>>
}

export interface DomainGlobal<G> {
  get(): G
  set(value: G): Promise<void>
}
export interface KvTable<V> {
  get(key: string): V | undefined
  entries(): IterableIterator<[string, V]>
  keys(): IterableIterator<string>
  readonly size: number
  put(key: string, value: V): Promise<void>
  delete(key: string): Promise<boolean>
  update(key: string, fn: (current: V) => V): Promise<V>
}
export interface Domain {
  readonly name: string
  readonly global: DomainGlobal<unknown>
  table(name: string): KvTable<unknown>
  close(): Promise<void>
}
export interface StorageDomainService {
  open(spec: DomainSpec): Promise<Domain>
}

/** ctx.webServer — register returns a disposer; duplicate (kind,path) throws. */
export interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
}
export interface WebServerService {
  register(route: WebServerRoute): () => void
  readonly port?: number
  readonly host?: string
}

/** domain/changed event payload (storage-domain/src/events.ts). */
export interface DomainChanged {
  domain: string
  table: string
  key: string
  operation: 'put' | 'deleted'
  value?: unknown
}

/** The host cordis context surface this plugin relies on (structural). */
export interface TalkMapHostServices {
  storageDomain: StorageDomainService
  webServer: WebServerService
  logger?: { info?(message: string): void; warn(message: string): void }
  effect(callback: () => (() => void | Promise<void>), label?: string): void
  on(event: string, listener: (...args: unknown[]) => void): () => void
}
