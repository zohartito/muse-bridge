#!/usr/bin/env node
'use strict';
/* muse — drive a signed-in Muse (muse.ai) chat from any agent or shell.
 *
 *   muse login                      open a visible window; sign in once, then close it
 *   muse status                     is the saved profile signed in?
 *   muse read <thread-url> [--all]  new messages since last read (--all resets the baseline)
 *   muse send <thread-url> <text|--file f|->      send one message, report delivery
 *   muse wait <thread-url> [--timeout 600]        wait for Muse to finish replying
 *   muse ask  <thread-url> <text|--file f|->  [--timeout 600]   send, then wait for the reply
 *   muse new  <text|--file f|-> [--timeout 600]   start a new chat, send, wait; prints its URL
 *   muse mcp                        run as an MCP server over stdio
 *
 * Output is JSON on stdout; add --text to print only the reply text.
 */
const fs = require('node:fs');
const path = require('node:path');
const { openHost, PROFILE_DIR } = require('../scripts/host-playwright.cjs');
const ops = require('../scripts/ops.cjs');

function parseArgs(argv) {
  const flags = {}; const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-') { positional.push('-'); continue; }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (['timeout', 'file', 'interval'].includes(key)) { flags[key] = next; i++; }
      else flags[key] = true;
    } else positional.push(arg);
  }
  return { flags, positional };
}

function readText(flags, positional) {
  if (flags.file) return fs.readFileSync(path.resolve(flags.file), 'utf8');
  if (positional.includes('-')) return fs.readFileSync(0, 'utf8');
  const text = positional.join(' ');
  if (!text.trim()) throw new Error('Provide message text, --file <path>, or - for stdin.');
  return text;
}

function print(result, flags) {
  if (flags.text) {
    const text = (result.messages || []).filter(m => m.role === 'assistant').map(m => m.text).join('\n\n');
    process.stdout.write((text || `[${result.status}] no assistant text`) + '\n');
  } else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

async function login() {
  const host = await openHost({ headless: false });
  const page = host.context.pages()[0] || await host.context.newPage();
  await page.goto('https://muse.ai', { waitUntil: 'domcontentloaded' });
  process.stderr.write(`Sign in to Muse in the window that opened (profile: ${PROFILE_DIR}).\n` +
    'Close the window when a chat is visible. Waiting...\n');
  await new Promise(resolve => host.context.on('close', resolve));
  process.stdout.write(JSON.stringify({ status: 'window_closed', profile: PROFILE_DIR,
    next: 'muse status' }, null, 2) + '\n');
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseArgs(rest);
  const timeoutMs = Number(flags.timeout || 600) * 1000;
  const intervalMs = Number(flags.interval || 1) * 1000;

  if (!command || flags.help || command === 'help') {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 14).map(l => l.replace(/^ \*\s?/, '')).join('\n') + '\n');
    return;
  }
  if (command === 'login') return login();
  if (command === 'mcp') return require('../mcp/server.cjs').serve();

  const host = await openHost({ headless: !flags.headed });
  try {
    let result;
    switch (command) {
      case 'status': result = await ops.status(host); break;
      case 'read': result = await ops.read(host, positional[0], { reset: !!flags.all }); break;
      case 'send': result = await ops.send(host, positional[0], readText(flags, positional.slice(1))); break;
      case 'wait': result = await ops.wait(host, positional[0], { timeoutMs, intervalMs }); break;
      case 'ask': result = await ops.ask(host, positional[0], readText(flags, positional.slice(1)), { timeoutMs, intervalMs }); break;
      case 'new': result = await ops.newChat(host, readText(flags, positional), { timeoutMs, intervalMs }); break;
      default: throw new Error(`Unknown command "${command}". Run: muse help`);
    }
    print(result, flags);
  } finally { await host.close(); }
}

main().catch(error => {
  process.stdout.write(JSON.stringify({ status: 'error', code: error.code || 'error', message: error.message }, null, 2) + '\n');
  process.exit(1);
});
