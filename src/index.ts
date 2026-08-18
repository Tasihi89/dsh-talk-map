/**
 * dsh-talk-map host entry: opens the talk-map storage domain and mounts the
 * /talk-map/* HTTP routes once the profile composes storageDomain and
 * webServer. M2 adds the digest pipeline and the spawn endpoint on top.
 *
 * Failure policy: a broken external plugin must not take the host down —
 * open/mount failures are logged, the plugin stays inert.
 */
import type { TalkMapHostServices } from './host/dsh-host.ts'
import { mountTalkMapRoutes } from './host/routes.ts'
import { openTalkMapStore, type TalkMapStore } from './host/store.ts'

export const name = 'dsh-talk-map'

/** Structural cordis surface at the outer (uninjected) layer. */
interface OuterContext {
  logger?: { info?(message: string): void; warn(message: string): void }
  inject(deps: readonly string[], callback: (ctx: unknown) => void): void
}

export function apply(ctx: OuterContext): void {
  ctx.inject(['storageDomain', 'webServer'], (injected: unknown) => {
    const services = injected as TalkMapHostServices
    services.effect(() => {
      let disposed = false
      let store: TalkMapStore | undefined
      const storeReady = openTalkMapStore(services.storageDomain).then((opened) => {
        if (disposed) {
          void opened.domain.close()
          throw new Error('dsh-talk-map: disposed during open')
        }
        store = opened
        services.logger?.info?.('[dsh-talk-map] storage domain open, routes live at /talk-map/')
        return opened
      })
      storeReady.catch((error) => {
        services.logger?.warn(`[dsh-talk-map] storage domain failed to open: ${String(error)}`)
      })
      const unmountRoutes = mountTalkMapRoutes(services, storeReady)
      return () => {
        disposed = true
        unmountRoutes()
        void store?.domain.close()
      }
    }, 'dsh-talk-map: domain + routes')
  })
}
