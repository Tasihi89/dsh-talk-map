/**
 * dsh-talk-map host entry. Three independently-injected layers over one
 * shared store promise, so a composition missing llm or agents still serves
 * the board (spawn/digest routes answer 503 instead):
 *
 *   1. storageDomain + webServer  → talk_map domain + /talk-map/* routes
 *   2. sessionQuery + llm + agentDefaultModel + sessions → digest pipeline
 *   3. agents + sessionQuery      → injection-spawn
 *
 * Failure policy: a broken external plugin must not take the host down —
 * open/mount failures are logged and the affected layer stays inert.
 */
import type { DigestHostServices, SpawnHostServices, TalkMapHostServices } from './host/dsh-host.ts'
import { DigestPipeline } from './host/digest/pipeline.ts'
import { mountTalkMapRoutes, type TalkMapRuntime } from './host/routes.ts'
import { Spawner } from './host/spawn.ts'
import { openTalkMapStore, type TalkMapStore } from './host/store.ts'

export const name = 'dsh-talk-map'

/** Structural cordis surface at the outer (uninjected) layer. */
interface OuterContext {
  logger?: { info?(message: string): void; warn(message: string): void }
  inject(deps: readonly string[], callback: (ctx: unknown) => void): void
}

export function apply(ctx: OuterContext): void {
  const runtime: TalkMapRuntime = {}
  let resolveStore: (store: TalkMapStore) => void
  let rejectStore: (error: unknown) => void
  const storeReady = new Promise<TalkMapStore>((resolve, reject) => {
    resolveStore = resolve
    rejectStore = reject
  })
  storeReady.catch(() => { /* observed per-consumer; avoid unhandled rejection */ })

  // Layer 1: storage domain + HTTP routes.
  ctx.inject(['storageDomain', 'webServer'], (injected: unknown) => {
    const services = injected as TalkMapHostServices
    services.effect(() => {
      let disposed = false
      let store: TalkMapStore | undefined
      openTalkMapStore(services.storageDomain).then((opened) => {
        if (disposed) {
          void opened.domain.close()
          return
        }
        store = opened
        resolveStore(opened)
        services.logger?.info?.('[dsh-talk-map] storage domain open, routes live at /talk-map/')
      }).catch((error) => {
        services.logger?.warn(`[dsh-talk-map] storage domain failed to open: ${String(error)}`)
        rejectStore(error)
      })
      const unmountRoutes = mountTalkMapRoutes(services, storeReady, runtime)
      return () => {
        disposed = true
        unmountRoutes()
        void store?.domain.close()
      }
    }, 'dsh-talk-map: domain + routes')
  })

  // Layer 2: digest pipeline (needs the llm route and session surfaces).
  ctx.inject(['sessions', 'sessionQuery', 'llm', 'agentDefaultModel'], (injected: unknown) => {
    const services = injected as DigestHostServices
    services.effect(() => {
      const pipeline = new DigestPipeline(services, storeReady)
      const stop = pipeline.start()
      runtime.digest = pipeline
      return () => {
        stop()
        if (runtime.digest === pipeline) delete runtime.digest
      }
    }, 'dsh-talk-map: digest pipeline')
  })

  // Defaults for the draft composer (each optional — missing service just
  // leaves the corresponding default unlabeled).
  ctx.inject(['agentDefaultModel'], (injected: unknown) => {
    const services = injected as { agentDefaultModel: { currentSelection(): { provider: string; model: string; reasoningEffort?: string } }; effect(cb: () => () => void, label?: string): void }
    services.effect(() => {
      runtime.modelDefault = () => services.agentDefaultModel.currentSelection()
      return () => { delete runtime.modelDefault }
    }, 'dsh-talk-map: model default')
  })
  ctx.inject(['agentPresets'], (injected: unknown) => {
    const services = injected as { agentPresets: { defaultId: string }; effect(cb: () => () => void, label?: string): void }
    services.effect(() => {
      runtime.presetDefault = () => services.agentPresets.defaultId
      return () => { delete runtime.presetDefault }
    }, 'dsh-talk-map: preset default')
  })

  // Layer 3: injection-spawn (needs the agent registry).
  ctx.inject(['agents', 'sessionQuery'], (injected: unknown) => {
    const services = injected as SpawnHostServices
    services.effect(() => {
      const spawner = new Spawner(services, storeReady)
      runtime.spawner = spawner
      return () => {
        if (runtime.spawner === spawner) delete runtime.spawner
      }
    }, 'dsh-talk-map: spawner')
  })
}
