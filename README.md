# Codex ↔ Muse bridge

Let Codex talk to Muse in your existing browser session: find a conversation, send a message, and read the reply. The conversation stays visible in Muse.

This is a small extraction of a working browser workflow. It has no Nook dependency, shopping rules, model router, server, API key, or subscription of its own. Muse login stays in the browser. It uses the chat UI; it is not an official Muse API.

## Use with Codex

You need a signed-in Muse account and Codex browser tools that expose the documented browser/tab interface (the implementation was checked with Codex's in-app browser). This plugin supplies the workflow and helper, not the browser tooling.

For a first local use, tell Codex:

> Read `skills/muse-bridge/SKILL.md` in this repository, then use Muse to help with [my task]. Use [my conversation URL].

The repository also contains a `.codex-plugin/plugin.json` manifest for packaging as a Codex plugin. Extraction does not install it globally or change existing agents. It has not been published to a marketplace.

## Small backend

`scripts/muse-bridge.cjs` is dependency-free JavaScript. It accepts an existing browser tab; it does not start, stop, or reconfigure any browser. The skill explains how to use it in the host's browser REPL. A compatible JavaScript host can also load it directly:

```js
const { createMuseBridge, findMuseChats } = require('./scripts/muse-bridge.cjs');
const chats = await findMuseChats(browser, 'Project');
const tab = await browser.tabs.get(chats[0].id);
const bridge = createMuseBridge(tab);
await bridge.read();
const delivery = await bridge.send('Please review the approach we discussed.');
if (delivery.status === 'sent') {
  const response = await bridge.wait({ timeoutMs: 20000 });
  // Inspect response.status and its actual messages before taking another action.
}
```

`browser` above is supplied by the host, not Node or this package. Running Node alone does not connect to Muse. The helpers return message IDs, roles, text, links, and generation status. Read returns changes after the initial loaded window; wait returns a visible reply or a bounded waiting/status result.

Optional checkpoints remember the conversation and observed message fingerprints between sessions. `scripts/checkpoint.mjs save|load ALIAS` stores them outside the repository, under `~/.local/state/codex-muse-bridge/` by default. Set `MUSE_BRIDGE_STATE_DIR` for a different private location. Save accepts checkpoint JSON on stdin; use one writer per alias. No message bodies or browser credentials are produced by `bridge.checkpoint()`.

## Verification and limits

Run `npm test` (Node 20+, no install step). Tests exercise actual helper behavior with an in-memory browser adapter: streaming, immediate replies, lost send acknowledgements, thread changes, cursor restoration, and private checkpoint files. This adapter is a test fixture, not Muse.

Read-only live verification and its exact limits are recorded in [VERIFICATION.md](VERIFICATION.md). Existing Codex/Muse exchanges motivated the extraction; they do not establish a fresh end-to-end send test of this package.

The main limits are the host browser tool, Muse UI changes, and session availability. Only loaded conversation messages are visible. A stopped text stream is not proof that an asynchronous Muse task finished. There is no background daemon, inbound callback, automatic retry of uncertain sends, cross-agent write lock, or guaranteed delivery across host restarts. Coordinate through a dedicated conversation when multiple agents are working.

Source is local and unpublished. No private account data, chat transcripts, cookies, or Nook credentials belong in this repository. Select a license before public release.
