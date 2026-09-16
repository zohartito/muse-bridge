'use strict';
/* Standalone browser host for muse-bridge.cjs.
 * Opens a private, persistent Chromium profile that stays signed in to Muse,
 * and exposes the `browser.tabs` / `tab.playwright` shape the helper expects.
 * Any agent (Claude Code, Cursor, Codex, Gemini CLI, plain shell) can use it
 * through bin/muse.cjs or the MCP server; no host browser tools are needed.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const STATE_DIR = process.env.MUSE_BRIDGE_STATE_DIR ||
  path.join(os.homedir(), '.local', 'state', 'muse-bridge');
const PROFILE_DIR = path.join(STATE_DIR, 'profile');
const CHECKPOINT_DIR = path.join(STATE_DIR, 'checkpoints');
const MUSE_ORIGIN = 'https://muse.ai';
const NEW_THREAD_URL = `${MUSE_ORIGIN}/thread/new`;
const LOG_SELECTOR = '[role="log"][aria-label="Chat messages"]';
const COMPOSER_SELECTOR = 'textarea[aria-label="Message"]';

class NeedsLoginError extends Error {
  constructor(url) {
    super(`Muse is not signed in (landed on ${url}). Run: muse login`);
    this.code = 'needs_login';
  }
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }

function checkpointPath(url) {
  const key = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  return path.join(CHECKPOINT_DIR, `${key}.json`);
}

function loadCheckpoint(url) {
  try { return JSON.parse(fs.readFileSync(checkpointPath(url), 'utf8')); }
  catch { return null; }
}

function saveCheckpoint(checkpoint) {
  if (!checkpoint || !checkpoint.url) return;
  ensureDir(CHECKPOINT_DIR);
  fs.writeFileSync(checkpointPath(checkpoint.url), JSON.stringify(checkpoint), { mode: 0o600 });
}

function clearCheckpoint(url) {
  try { fs.unlinkSync(checkpointPath(url)); } catch { /* nothing saved */ }
}

async function pageLooksSignedOut(page) {
  const url = page.url();
  if (!url.startsWith(MUSE_ORIGIN)) return true;
  if (/\/(login|signin|sign-in|auth)/i.test(new URL(url).pathname)) return true;
  return page.evaluate(() => {
    const text = document.body ? document.body.innerText : '';
    return /\b(log in|sign in|continue with (google|apple|email))\b/i.test(text) &&
      !document.querySelector('textarea[aria-label="Message"]');
  }).catch(() => false);
}

async function waitForChat(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(([log, composer]) =>
      !!document.querySelector(log) && !!document.querySelector(composer),
    [LOG_SELECTOR, COMPOSER_SELECTOR]).catch(() => false);
    if (ready) return true;
    if (await pageLooksSignedOut(page)) throw new NeedsLoginError(page.url());
    await page.waitForTimeout(500);
  }
  throw new Error(`Muse chat did not become ready within ${timeoutMs} ms at ${page.url()}. ` +
    'Inspect with: muse login (opens a visible window).');
}

async function openHost({ headless = true, slowMo = 0 } = {}) {
  const { chromium } = require('playwright');
  ensureDir(PROFILE_DIR);
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless, slowMo,
      viewport: { width: 1280, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } catch (error) {
    if (/SingletonLock|ProcessSingleton|already running|in use/i.test(String(error))) {
      throw new Error('The Muse profile is already open in another process (a login window or a running MCP server). Close it and retry.');
    }
    throw error;
  }

  const tabs = new Map();
  function wrap(page) {
    const id = `tab-${tabs.size + 1}`;
    const tab = {
      id, page,
      url: () => page.url(),
      title: () => page.title().catch(() => ''),
      playwright: {
        evaluate: fn => page.evaluate(fn),
        getByRole: (role, options) => page.getByRole(role, options),
      },
    };
    tabs.set(id, tab);
    return tab;
  }

  const browser = {
    tabs: {
      async list() {
        return Promise.all([...tabs.values()].map(async tab =>
          ({ id: tab.id, url: tab.page.url(), title: await tab.title() })));
      },
      async get(id) {
        const tab = tabs.get(id);
        if (!tab) throw new Error(`Unknown tab ${id}`);
        return tab;
      },
    },
  };

  function blankPage() {
    return context.pages().find(p => p.url() === 'about:blank' && ![...tabs.values()].some(t => t.page === p));
  }

  async function openThread(url, { timeoutMs = 30000 } = {}) {
    const wanted = url.replace(/\/$/, '');
    for (const tab of tabs.values()) {
      if (!tab.page.isClosed() && tab.page.url().replace(/\/$/, '') === wanted) return tab;
    }
    const page = blankPage() || await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitForChat(page, timeoutMs);
    return wrap(page);
  }

  /* Open a fresh conversation. Tries the /thread/new route first, then the
   * visible "New side chat" control on the home page. */
  async function openNewThread({ timeoutMs = 30000 } = {}) {
    const page = blankPage() || await context.newPage();
    await page.goto(NEW_THREAD_URL, { waitUntil: 'domcontentloaded' });
    try { await waitForChat(page, Math.min(timeoutMs, 10000)); }
    catch (error) {
      if (error.code === 'needs_login') throw error;
      await page.goto(MUSE_ORIGIN, { waitUntil: 'domcontentloaded' });
      const control = page.getByRole('button', { name: /new (side )?chat/i }).first();
      await control.click({ timeout: 10000 });
      await waitForChat(page, timeoutMs);
    }
    return wrap(page);
  }

  async function status({ timeoutMs = 15000 } = {}) {
    const page = blankPage() || await context.newPage();
    await page.goto(MUSE_ORIGIN, { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hasChatUI = await page.evaluate(composer =>
        !!document.querySelector(composer) || !!document.querySelector('a[href^="/thread/"]'),
      COMPOSER_SELECTOR).catch(() => false);
      if (hasChatUI) return { signedIn: true, url: page.url(), profile: PROFILE_DIR };
      if (await pageLooksSignedOut(page)) return { signedIn: false, url: page.url(), profile: PROFILE_DIR };
      await page.waitForTimeout(500);
    }
    return { signedIn: false, url: page.url(), profile: PROFILE_DIR, note: 'Timed out without recognising the chat UI.' };
  }

  async function close() { await context.close().catch(() => {}); }

  return { browser, context, openThread, openNewThread, status, close, profileDir: PROFILE_DIR };
}

module.exports = {
  openHost, loadCheckpoint, saveCheckpoint, clearCheckpoint, NeedsLoginError,
  STATE_DIR, PROFILE_DIR, CHECKPOINT_DIR, MUSE_ORIGIN, NEW_THREAD_URL,
};
