//#region src/index.ts
/**
* dsh-talk-map host entry. M0: log-only mount confirming the layer loads;
* M1 adds the storage domain (boards/cards/edges) and the /talk-map/* HTTP
* routes, M2 the digest pipeline and the spawn endpoint.
*/
const name = "dsh-talk-map";
function apply(ctx) {
	ctx.logger?.info?.("[dsh-talk-map] host half mounted");
}
//#endregion
export { apply, name };
