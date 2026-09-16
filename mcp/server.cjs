'use strict';
/* Minimal MCP server (stdio, newline-delimited JSON-RPC 2.0) exposing Muse
 * chat operations to any MCP client: Claude Code, Cursor, Codex, Gemini CLI,
 * Windsurf, Zed, etc. No SDK dependency; the protocol surface used here is
 * initialize / tools/list / tools/call / ping.
 */
const { openHost } = require('../scripts/host-playwright.cjs');
const ops = require('../scripts/ops.cjs');
const { version } = require('../package.json');

const THREAD = { type: 'string', description: 'Observed https://muse.ai/thread/<id> conversation URL.' };
const TEXT = { type: 'string', description: 'Message text to send to Muse (one message).' };
const TIMEOUT = { type: 'number', description: 'Seconds to wait for Muse to finish replying (default 90). Keep under your client\'s tool timeout; call muse_wait again for long tasks.' };

const TOOLS = [
  { name: 'muse_status', description: 'Check whether the saved Muse browser profile is signed in.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'muse_read', description: 'Read a Muse conversation. Returns messages that appeared or changed since the last read of this thread (first read returns the loaded window). Use reset:true to re-read everything loaded.',
    inputSchema: { type: 'object', required: ['thread'], properties: { thread: THREAD, reset: { type: 'boolean' } } } },
  { name: 'muse_send', description: 'Send one message to an existing Muse conversation and report delivery (sent | uncertain). Does not wait for the reply; follow with muse_wait.',
    inputSchema: { type: 'object', required: ['thread', 'text'], properties: { thread: THREAD, text: TEXT } } },
  { name: 'muse_wait', description: 'Wait for Muse to finish its reply in a conversation. Status reply = new assistant text and generation stopped; waiting = still generating (partial text included); read the text to judge whether the task is actually done.',
    inputSchema: { type: 'object', required: ['thread'], properties: { thread: THREAD, timeout: TIMEOUT } } },
  { name: 'muse_ask', description: 'Send a message to an existing Muse conversation and wait for the reply in one call.',
    inputSchema: { type: 'object', required: ['thread', 'text'], properties: { thread: THREAD, text: TEXT, timeout: TIMEOUT } } },
  { name: 'muse_new', description: 'Start a new Muse conversation with a first message, wait for the reply, and return the permanent thread URL for follow-ups.',
    inputSchema: { type: 'object', required: ['text'], properties: { text: TEXT, timeout: TIMEOUT } } },
];

function serve({ input = process.stdin, output = process.stdout, hostFactory = openHost } = {}) {
  let host = null;
  let queue = Promise.resolve();
  const seconds = value => Number(value || 90) * 1000;

  async function getHost() {
    if (!host) host = await hostFactory({ headless: true });
    return host;
  }

  async function callTool(name, args = {}) {
    const h = await getHost();
    switch (name) {
      case 'muse_status': return ops.status(h);
      case 'muse_read': return ops.read(h, args.thread, { reset: !!args.reset });
      case 'muse_send': return ops.send(h, args.thread, args.text);
      case 'muse_wait': return ops.wait(h, args.thread, { timeoutMs: seconds(args.timeout) });
      case 'muse_ask': return ops.ask(h, args.thread, args.text, { timeoutMs: seconds(args.timeout) });
      case 'muse_new': return ops.newChat(h, args.text, { timeoutMs: seconds(args.timeout) });
      default: throw new Error(`Unknown tool ${name}`);
    }
  }

  function write(message) { output.write(JSON.stringify(message) + '\n'); }
  function reply(id, result) { write({ jsonrpc: '2.0', id, result }); }
  function fail(id, code, message) { write({ jsonrpc: '2.0', id, error: { code, message } }); }

  function handle(request) {
    const { id, method, params = {} } = request;
    if (method === 'initialize') {
      return reply(id, { protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} }, serverInfo: { name: 'muse-bridge', version } });
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: TOOLS });
    if (method === 'tools/call') {
      // One writer at a time: browser actions on the shared profile are serialized.
      queue = queue.then(async () => {
        try {
          const result = await callTool(params.name, params.arguments);
          reply(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        } catch (error) {
          reply(id, { isError: true, content: [{ type: 'text',
            text: JSON.stringify({ status: 'error', code: error.code || 'error', message: error.message }) }] });
        }
      });
      return;
    }
    if (method && method.startsWith('notifications/')) return; // notifications get no response
    if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
  }

  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let request;
      try { request = JSON.parse(line); } catch { fail(null, -32700, 'Parse error'); continue; }
      handle(request);
    }
  });
  const shutdown = async () => { if (host) await host.close(); if (input === process.stdin) process.exit(0); };
  input.on('end', shutdown);
  if (input === process.stdin) {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
  return { shutdown };
}

module.exports = { serve, TOOLS };
if (require.main === module) serve();
