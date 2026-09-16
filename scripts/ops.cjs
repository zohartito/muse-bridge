'use strict';
/* High-level Muse operations shared by the CLI and the MCP server.
 * Every function takes an open host (scripts/host-playwright.cjs) so the MCP
 * server can keep one browser alive while the CLI opens and closes per call.
 */
const { createMuseBridge, museThreadURL, readMuseDOM } = require('./muse-bridge.cjs');
const { loadCheckpoint, saveCheckpoint, clearCheckpoint, NEW_THREAD_URL } = require('./host-playwright.cjs');

const MAX_SINGLE_WAIT_MS = 30000; // helper's own cap per wait() call

function attach(host, tab, url, { reset = false } = {}) {
  const checkpoint = reset ? null : loadCheckpoint(url);
  if (reset) clearCheckpoint(url);
  return createMuseBridge(tab, checkpoint ? { checkpoint } : {});
}

function publicMessages(messages = []) {
  return messages.map(({ id, role, text, links, change }) => ({ id, role, text, links, change }));
}

function finish(result) {
  saveCheckpoint(result.checkpoint);
  const { checkpoint, ...rest } = result;
  return { ...rest, thread: checkpoint.url, messages: publicMessages(rest.messages) };
}

/* Muse re-identifies a user message once the server accepts it (optimistic id →
 * server id), which the helper reports as history_gap. With one writer per
 * conversation the newest user message is ours, so re-anchor on it once. */
async function reanchor(tab, bridge) {
  const state = await tab.playwright.evaluate(readMuseDOM);
  const lastUser = [...(state.messages || [])].reverse().find(m => m.role === 'user');
  const checkpoint = bridge.checkpoint();
  checkpoint.afterUserId = lastUser ? lastUser.id : null;
  checkpoint.pending = null;
  return createMuseBridge(tab, { checkpoint });
}

/* Poll the helper's bounded wait() until Muse finishes a reply or the overall
 * deadline passes. Returns the helper's final status plus any partial text. */
async function waitLoop(bridge, { timeoutMs = 600000, intervalMs = 1000, tab = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let reanchored = false;
  do {
    const slice = Math.max(0, Math.min(MAX_SINGLE_WAIT_MS, deadline - Date.now()));
    last = await bridge.wait({ timeoutMs: slice, intervalMs });
    if (last.status === 'history_gap' && tab && !reanchored) {
      reanchored = true;
      bridge = await reanchor(tab, bridge);
      continue;
    }
    if (last.status !== 'waiting') break;
  } while (Date.now() < deadline);
  return last;
}

async function status(host) { return host.status(); }

async function read(host, url, { reset = false } = {}) {
  const thread = museThreadURL(url);
  const tab = await host.openThread(thread);
  const bridge = attach(host, tab, thread, { reset });
  const result = await bridge.read();
  return finish({ status: 'read', ...result });
}

async function send(host, url, text) {
  const thread = museThreadURL(url);
  const tab = await host.openThread(thread);
  const bridge = attach(host, tab, thread);
  const delivery = await bridge.send(text);
  return finish({ ...delivery, messages: [] });
}

async function wait(host, url, options = {}) {
  const thread = museThreadURL(url);
  const tab = await host.openThread(thread);
  const bridge = attach(host, tab, thread);
  if (!loadCheckpoint(thread)) await bridge.read(); // establish a baseline
  const result = await waitLoop(bridge, { ...options, tab });
  return finish({ messages: [], ...result });
}

async function ask(host, url, text, options = {}) {
  const thread = museThreadURL(url);
  const tab = await host.openThread(thread);
  const bridge = attach(host, tab, thread);
  const delivery = await bridge.send(text);
  if (delivery.status !== 'sent') return finish({ ...delivery, messages: [] });
  const result = await waitLoop(bridge, { ...options, tab });
  return finish({ messages: [], ...result, delivery: delivery.status });
}

async function newChat(host, text, options = {}) {
  const tab = await host.openNewThread();
  const bridge = createMuseBridge(tab);
  const delivery = await bridge.send(text);
  if (delivery.status !== 'sent') return finish({ ...delivery, messages: [] });
  const result = await waitLoop(bridge, { ...options, tab });
  const out = finish({ messages: [], ...result, delivery: delivery.status });
  if (out.thread === NEW_THREAD_URL) out.note = 'Muse has not assigned a permanent URL yet; read again before sending.';
  return out;
}

module.exports = { status, read, send, wait, ask, newChat, waitLoop };
