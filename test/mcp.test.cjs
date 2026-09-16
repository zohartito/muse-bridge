'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { serve, TOOLS } = require('../mcp/server.cjs');

function collect(output) {
  const lines = [];
  output.on('data', chunk => {
    for (const line of String(chunk).split('\n')) if (line.trim()) lines.push(JSON.parse(line));
  });
  return lines;
}

async function tick() { await new Promise(resolve => setImmediate(resolve)); }

test('MCP server answers initialize, tools/list and ping without opening a browser', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let opened = 0;
  serve({ input, output, hostFactory: async () => { opened++; throw new Error('should not open'); } });
  const lines = collect(output);
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }) + '\n');
  await tick();
  assert.equal(lines.length, 3);
  assert.equal(lines[0].result.serverInfo.name, 'muse-bridge');
  assert.deepEqual(lines[1].result.tools.map(t => t.name),
    ['muse_status', 'muse_read', 'muse_send', 'muse_wait', 'muse_ask', 'muse_new']);
  assert.deepEqual(lines[2].result, {});
  assert.equal(opened, 0);
});

test('tools/call routes to the host and reports errors as isError content', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const fakeHost = { status: async () => ({ signedIn: true, url: 'https://muse.ai/' }), close: async () => {} };
  serve({ input, output, hostFactory: async () => fakeHost });
  const lines = collect(output);
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'muse_status', arguments: {} } }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'muse_read', arguments: { thread: 'https://example.com/x' } } }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'nope' }) + '\n');
  for (let i = 0; i < 20 && lines.length < 3; i++) await tick();
  const byId = Object.fromEntries(lines.map(l => [l.id, l]));
  assert.equal(JSON.parse(byId[1].result.content[0].text).signedIn, true);
  assert.equal(byId[2].result.isError, true);
  assert.match(JSON.parse(byId[2].result.content[0].text).message, /muse\.ai\/thread/);
  assert.equal(byId[3].error.code, -32601);
});

test('every tool declares an object input schema', () => {
  for (const tool of TOOLS) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.ok(tool.description.length > 20, tool.name);
  }
});
