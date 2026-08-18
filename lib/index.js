import { z } from "zod";
//#region src/host/store.ts
/**
* The talk-map storage domain: canvas-private data only. Session content,
* titles, and lineage stay with dsh's own services — this domain stores what
* the map adds on top (positions, user-drawn injection edges, digests, and
* per-board camera). Persisted by the profile's storage-json backend under
* $DSH_HOME/storages/.
*
* CardId ≠ SessionId on purpose: a later "alias card" feature (the same
* session appearing on several boards) then needs no migration.
*/
/** Storage unit names must match /^[a-z][a-z0-9_]*$/ — no hyphens. */
const DOMAIN_NAME = "talk_map";
/** The bootstrap board every unfiled card lands on. */
const INBOX_BOARD_ID = "inbox";
const boardSchema = z.object({
	name: z.string(),
	color: z.string(),
	order: z.number(),
	createdAt: z.number(),
	archivedAt: z.number().optional(),
	shelvedAt: z.number().optional()
});
const cardSchema = z.object({
	boardId: z.string(),
	sessionId: z.string(),
	x: z.number(),
	y: z.number(),
	colorTag: z.string().optional(),
	createdAt: z.number()
});
const edgeInjectionSchema = z.object({
	kind: z.enum([
		"digest",
		"full",
		"selection"
	]),
	/** What was actually injected (post-edit), kept for provenance display. */
	injectedText: z.string().optional()
});
const edgeSchema = z.object({
	boardId: z.string(),
	fromCardId: z.string(),
	toCardId: z.string(),
	injection: edgeInjectionSchema,
	createdAt: z.number()
});
const digestSchema = z.object({
	/** Last session event seq folded into this digest (staleness anchor). */
	atSeq: z.number(),
	summary: z.string(),
	keyFindings: z.array(z.string()),
	/** The ADHD field: one imperative sentence — the next concrete action. */
	nextStep: z.string(),
	/** Zero-cost fallback lifted from the session's todo/write events. */
	todoNext: z.string().optional(),
	generatedAt: z.number(),
	model: z.string().optional(),
	error: z.string().optional()
});
const cameraSchema = z.object({
	x: z.number(),
	y: z.number(),
	zoom: z.number()
});
const globalSchema = z.object({
	version: z.number(),
	activeBoard: z.string(),
	cameraByBoard: z.record(z.string(), cameraSchema)
});
const TALK_MAP_SPEC = {
	name: DOMAIN_NAME,
	version: 1,
	global: {
		schema: globalSchema,
		initial: {
			version: 1,
			activeBoard: INBOX_BOARD_ID,
			cameraByBoard: {}
		}
	},
	tables: {
		boards: { valueSchema: boardSchema },
		cards: { valueSchema: cardSchema },
		edges: { valueSchema: edgeSchema },
		digests: { valueSchema: digestSchema }
	}
};
async function openTalkMapStore(storageDomain) {
	const domain = await storageDomain.open(TALK_MAP_SPEC);
	const store = {
		domain,
		boards: domain.table("boards"),
		cards: domain.table("cards"),
		edges: domain.table("edges"),
		digests: domain.table("digests"),
		global: () => domain.global.get(),
		setGlobal: (value) => domain.global.set(value)
	};
	if (store.boards.get("inbox") === void 0) await store.boards.put(INBOX_BOARD_ID, {
		name: "Inbox",
		color: "gray",
		order: 0,
		createdAt: Date.now()
	});
	return store;
}
//#endregion
//#region src/host/routes.ts
const MAX_BODY_BYTES = 1048576;
function sendJson(response, status, body) {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	response.end(payload);
}
function sameOrigin(request) {
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	const host = request.headers.host;
	if (host === void 0) return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}
async function readJsonBody(request) {
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = chunk;
		size += buffer.length;
		if (size > MAX_BODY_BYTES) throw new Error("body too large");
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	return text === "" ? void 0 : JSON.parse(text);
}
function tableToRecord(table) {
	const out = {};
	for (const [key, value] of table.entries()) out[key] = value;
	return out;
}
const upsertCardsBody = z.object({ cards: z.record(z.string(), cardSchema) });
const deleteCardsBody = z.object({ ids: z.array(z.string()) });
const setGlobalBody = z.object({ global: globalSchema });
/**
* Register the /talk-map/ routes.
* @param services - host services (webServer + event bus).
* @param storeReady - resolves when the storage domain is open; handlers await it.
* @returns disposer removing the route registration and closing SSE clients.
*/
function mountTalkMapRoutes(services, storeReady) {
	const sseClients = /* @__PURE__ */ new Set();
	const offChanged = services.on("domain/changed", (...args) => {
		const change = args[0];
		if (change.domain !== "talk_map") return;
		const frame = `event: change\ndata: ${JSON.stringify(change)}\n\n`;
		for (const client of sseClients) client.write(frame);
	});
	const ping = setInterval(() => {
		for (const client of sseClients) client.write(": ping\n\n");
	}, 25e3);
	ping.unref?.();
	const unregister = services.webServer.register({
		kind: "prefix",
		path: "/talk-map",
		handler: async (request, response) => {
			const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
			const route = `${request.method ?? "GET"} ${url.pathname}`;
			try {
				if (route === "GET /talk-map/state") {
					const store = await storeReady;
					sendJson(response, 200, {
						boards: tableToRecord(store.boards),
						cards: tableToRecord(store.cards),
						edges: tableToRecord(store.edges),
						digests: tableToRecord(store.digests),
						global: store.global()
					});
					return;
				}
				if (route === "GET /talk-map/events") {
					response.writeHead(200, {
						"content-type": "text/event-stream",
						"cache-control": "no-store",
						"connection": "keep-alive"
					});
					response.write(": connected\n\n");
					sseClients.add(response);
					request.on("close", () => {
						sseClients.delete(response);
					});
					return;
				}
				if (request.method === "POST" && !sameOrigin(request)) {
					sendJson(response, 403, { error: "cross-origin request refused" });
					return;
				}
				if (route === "POST /talk-map/cards/upsert") {
					const store = await storeReady;
					const body = upsertCardsBody.parse(await readJsonBody(request));
					for (const [id, card] of Object.entries(body.cards)) await store.cards.put(id, card);
					sendJson(response, 200, {
						ok: true,
						count: Object.keys(body.cards).length
					});
					return;
				}
				if (route === "POST /talk-map/cards/delete") {
					const store = await storeReady;
					const body = deleteCardsBody.parse(await readJsonBody(request));
					let removed = 0;
					for (const id of body.ids) if (await store.cards.delete(id)) removed += 1;
					sendJson(response, 200, {
						ok: true,
						removed
					});
					return;
				}
				if (route === "POST /talk-map/global") {
					const store = await storeReady;
					const body = setGlobalBody.parse(await readJsonBody(request));
					await store.setGlobal(body.global);
					sendJson(response, 200, { ok: true });
					return;
				}
				sendJson(response, 404, { error: `no such route: ${route}` });
			} catch (error) {
				services.logger?.warn(`[dsh-talk-map] ${route} failed: ${String(error)}`);
				if (!response.headersSent) sendJson(response, 400, { error: String(error) });
				else response.end();
			}
		}
	});
	return () => {
		clearInterval(ping);
		offChanged();
		for (const client of sseClients) client.end();
		sseClients.clear();
		unregister();
	};
}
//#endregion
//#region src/index.ts
const name = "dsh-talk-map";
function apply(ctx) {
	ctx.inject(["storageDomain", "webServer"], (injected) => {
		const services = injected;
		services.effect(() => {
			let disposed = false;
			let store;
			const storeReady = openTalkMapStore(services.storageDomain).then((opened) => {
				if (disposed) {
					opened.domain.close();
					throw new Error("dsh-talk-map: disposed during open");
				}
				store = opened;
				services.logger?.info?.("[dsh-talk-map] storage domain open, routes live at /talk-map/");
				return opened;
			});
			storeReady.catch((error) => {
				services.logger?.warn(`[dsh-talk-map] storage domain failed to open: ${String(error)}`);
			});
			const unmountRoutes = mountTalkMapRoutes(services, storeReady);
			return () => {
				disposed = true;
				unmountRoutes();
				store?.domain.close();
			};
		}, "dsh-talk-map: domain + routes");
	});
}
//#endregion
export { apply, name };
