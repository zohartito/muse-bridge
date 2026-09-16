/* Dependency-free: require in Node, or paste into the host's browser REPL.
 * The browser/tab objects belong to the host; this never launches a browser.
 */
function museThreadURL(value) {
  const url = new URL(value);
  if (url.origin !== 'https://muse.ai' || !/^\/thread\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error('Use an observed https://muse.ai/thread/... conversation URL.');
  }
  return url.origin + url.pathname.replace(/\/$/, '');
}

async function findMuseChats(browser, query = '') {
  return (await browser.tabs.list()).filter(tab => {
    try { museThreadURL(tab.url); } catch { return false; }
    return `${tab.title || ''} ${tab.url}`.toLowerCase().includes(query.toLowerCase());
  });
}

// Only rendered conversation DOM, never application internals, cookies or API calls.
function readMuseDOM() {
  const log = document.querySelector('[role="log"][aria-label="Chat messages"]');
  const composer = document.querySelector('textarea[aria-label="Message"]');
  if (!log || !composer) return { ready: false };
  const messages = Array.from(log.querySelectorAll('[data-message-id]')).map(el => ({
    id: el.getAttribute('data-message-id'),
    role: el.getAttribute('data-message-role'),
    turnId: el.getAttribute('data-message-turn-id'),
    text: el.getAttribute('data-message-role') === 'user' ? el.innerText.replace(/^You:\s*/, '') : el.innerText,
    busy: !!el.querySelector('[aria-busy="true"]'),
    links: Array.from(el.querySelectorAll('a[href]')).map(a => ({ text: a.innerText, url: a.href }))
  }));
  const stop = Array.from(document.querySelectorAll('button')).some(button =>
    (button.getAttribute('aria-label') || button.innerText).trim() === 'Stop');
  return { ready: true, messages, generating: stop || messages.some(m => m.busy),
    hasDraft: composer.value.length > 0, composerEnabled: !composer.disabled };
}

// Change detector only, not a cryptographic or authentication primitive.
function museFingerprint(value) {
  let hash = 2166136261;
  for (const c of value) hash = Math.imul(hash ^ c.codePointAt(0), 16777619);
  return `${value.length}:${hash >>> 0}`;
}

function createMuseBridge(tab, options = {}) {
  const previous = options.checkpoint || {};
  let url = previous.url ? museThreadURL(previous.url) : null;
  const seen = new Map(previous.seen || []);
  let pending = previous.pending || null;
  let afterUserId = previous.afterUserId || null;
  let sending = false;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = options.now || Date.now;

  function checkpoint() {
    return { version: 1, url, seen: Array.from(seen), afterUserId, pending };
  }

  async function snapshot() {
    const current = museThreadURL(await tab.url());
    if (url && current !== url) throw new Error('Conversation changed; attach a new bridge for that thread.');
    url = current;
    const state = await tab.playwright.evaluate(readMuseDOM);
    if (!state.ready) throw new Error('Muse chat is not ready. Inspect the page for connection or sign-in.');
    if (state.messages.some(m => !m.id || !['user', 'assistant', 'system', 'tool'].includes(m.role))) {
      throw new Error('Muse message structure changed. Inspect the chat before continuing.');
    }
    return state;
  }

  function consume(state) {
    const changes = [];
    for (const message of state.messages) {
      const fingerprint = museFingerprint(JSON.stringify(message));
      if (seen.get(message.id) !== fingerprint) {
        changes.push({ ...message, change: seen.has(message.id) ? 'updated' : 'appeared' });
      }
      seen.set(message.id, fingerprint);
    }
    return { url, generating: state.generating, messages: changes, checkpoint: checkpoint() };
  }

  async function read() { return consume(await snapshot()); }

  function acknowledge(state) {
    if (!pending) return null;
    const baseline = pending.afterId ? state.messages.findIndex(m => m.id === pending.afterId) : -1;
    if (pending.afterId && baseline < 0) return null;
    const message = state.messages.slice(baseline + 1).find(m => m.role === 'user' &&
      museFingerprint(m.text.trim()) === pending.fingerprint);
    if (!message) return null;
    afterUserId = message.id;
    pending = null;
    return message.id;
  }

  async function checkDelivery() {
    const state = await snapshot();
    const id = acknowledge(state);
    // Do not consume assistant replies here: wait/read must still see them.
    return { status: id ? 'sent' : pending ? 'uncertain' : 'no_pending_send',
      messageId: id, checkpoint: checkpoint() };
  }

  async function send(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Message must contain text.');
    if (sending || pending) throw new Error('A send is pending. Inspect delivery before sending again.');
    sending = true;
    try {
      const before = await snapshot();
      if (before.hasDraft) throw new Error('The composer contains a draft; leave it intact.');
      if (before.generating || !before.composerEnabled) throw new Error('Muse is busy; read or wait first.');
      consume(before);
      pending = { fingerprint: museFingerprint(text.trim()), afterId: before.messages.at(-1)?.id || null };
      const composer = tab.playwright.getByRole('textbox', { name: 'Message', exact: true });
      try {
        await composer.fill(text);
        await composer.press('Enter');
      } catch {
        // A tool timeout can occur after delivery. Never blindly press Enter twice.
      }
      try { return await checkDelivery(); }
      catch { return { status: 'uncertain', messageId: null, checkpoint: checkpoint() }; }
    } finally { sending = false; }
  }

  async function wait({ timeoutMs = 20000, intervalMs = 1000, signal } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000 ||
        !Number.isFinite(intervalMs) || intervalMs < 100) {
      throw new Error('Use a 0–30000 ms wait and an interval of at least 100 ms.');
    }
    if (!url) throw new Error('Read the chat once before waiting to establish a baseline.');
    if (pending) return { status: 'delivery_uncertain', checkpoint: checkpoint() };
    const deadline = now() + timeoutMs;
    const replies = new Map();
    while (true) {
      if (signal?.aborted) return { status: 'stopped', checkpoint: checkpoint() };
      const state = await snapshot();
      const anchor = afterUserId ? state.messages.findIndex(m => m.id === afterUserId) : -1;
      if (afterUserId && anchor < 0) return { status: 'history_gap', checkpoint: checkpoint() };
      const tail = state.messages.slice(anchor + 1);
      if (afterUserId && tail.some(m => m.role === 'user')) {
        return { status: 'conversation_changed', checkpoint: checkpoint() };
      }
      const eligible = new Set(tail.map(m => m.id));
      const delta = consume(state);
      for (const m of delta.messages) if (m.role === 'assistant' && eligible.has(m.id)) replies.set(m.id, m);
      const result = { generating: state.generating, messages: Array.from(replies.values()), checkpoint: checkpoint() };
      if (replies.size && !state.generating) return { status: 'reply', ...result };
      if (now() >= deadline) return { status: 'waiting', ...result };
      await sleep(Math.min(intervalMs, deadline - now()));
    }
  }

  return { read, send, checkDelivery, wait, checkpoint };
}

if (typeof module !== 'undefined') {
  module.exports = { createMuseBridge, findMuseChats, readMuseDOM, museThreadURL, museFingerprint };
}
