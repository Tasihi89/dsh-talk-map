/**
 * dsh-talk-map host entry. M0: log-only mount confirming the layer loads;
 * M1 adds the storage domain (boards/cards/edges) and the /talk-map/* HTTP
 * routes, M2 the digest pipeline and the spawn endpoint.
 */

export const name = 'dsh-talk-map'

/** Structural cordis surface (host). */
interface TalkMapHostContext {
  logger?: { info?(message: string): void; warn(message: string): void }
  inject(deps: readonly string[], callback: (ctx: unknown) => void): void
}

export function apply(ctx: TalkMapHostContext): void {
  ctx.logger?.info?.('[dsh-talk-map] host half mounted')
}
