# dsh-talk-map · Talk Map

English | [中文](README.zh.md)

A visual conversation map plugin for DeepSeek Harness (dsh): every session becomes a card on an infinite whiteboard.

- **Spatial memory instead of working memory**: free placement + grid snapping, and nothing ever rearranges your cards — if you remember "that conversation was bottom-left", it stays bottom-left. Designed for ADHD users, useful for everyone.
- **Double-click to chat**: double-click empty canvas to start a new session; the card is born exactly where you clicked.
- **Draw an edge to fork**: drag a line from a card onto empty space, preview (and edit) the context digest to inject, confirm — a new session starts *knowing* the old conversation.
- **Card front = resume surface**: title, the digest's "next step", relative time, running state. One glance tells you what to do next.
- **Automatic digests**: after a session goes idle, a three-field digest (summary / key findings / next step) is generated with your deployment's default model; hit ⟳ on a card to regenerate manually.
- **Provenance visible**: dsh's native fork/subagent lineage renders as dashed edges; your injection edges are solid.

## Install

```sh
# npm (recommended)
dsh plugin --profile web add dsh-talk-map

# or GitHub (built artifacts are committed — works without allowBuilds)
dsh plugin --profile web add github:Tasihi89/dsh-talk-map
```

Restart `dsh web`; a map button appears at the sidebar foot.

## Usage

| Action | Effect |
|---|---|
| Sidebar map button / Esc | toggle the map |
| Drag a card | place it (16px grid snap, persisted) |
| Double-click empty space | create a session there and enter it |
| Double-click a card | open that session |
| Drag from a card's right handle to empty space | preview injection → fork a new session |
| ⟳ on a card | regenerate the digest |

## Where data lives

- Canvas data (positions, edges, digests): `$DSH_HOME/storages/talk_map.json` via dsh's official storage-domain, atomically persisted.
- Sessions themselves stay fully owned by dsh — this plugin reads them, and creates new ones only through official APIs when forking.
- Digests use your configured default model through dsh's local LLM channel; there are no other external requests.

## Compatibility

Built against deepseek-harness `0.1.0-rc.6` (rc-stage APIs may drift). The structural contracts live in `src/client/dsh.ts` and `src/host/dsh-host.ts` — start there when upgrading.

## Roadmap

Multi-board shelf (project = board, WIP limit) · whole-board archive/shelve · timeline view (camera fly-back) · alias cards · multi-parent merge UI · selection-level injection · quick-ask on card · two-week fade.

## Development

```sh
pnpm install
pnpm run build        # host → lib/, client → client/client.js
dsh plugin --profile dev add /abs/path/dsh-talk-map
dsh --profile dev     # add a profile patch to change the port and coexist with your main instance
```

MIT License.
