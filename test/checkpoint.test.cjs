const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, statSync, readdirSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {spawnSync} = require('node:child_process');

test('checkpoint CLI round trips in a private directory and rejects unsafe aliases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'muse-bridge-test-'));
  const env = {...process.env, MUSE_BRIDGE_STATE_DIR:join(dir, 'state')};
  const file = join(__dirname, '../scripts/checkpoint.mjs');
  const state = {version:1,url:'https://muse.ai/thread/example-test',seen:[],afterUserId:null,pending:null};
  try {
    const save = spawnSync(process.execPath,[file,'save','test'],{env,input:JSON.stringify(state),encoding:'utf8'});
    assert.equal(save.status, 0, save.stderr);
    const load = spawnSync(process.execPath,[file,'load','test'],{env,encoding:'utf8'});
    assert.equal(load.status, 0); assert.deepEqual(JSON.parse(load.stdout), state);
    assert.equal(statSync(join(env.MUSE_BRIDGE_STATE_DIR,'test.json')).mode & 0o777, 0o600);
    assert.equal(statSync(env.MUSE_BRIDGE_STATE_DIR).mode & 0o777, 0o700);
    assert.equal(spawnSync(process.execPath,[file,'save','../outside'],{env,input:JSON.stringify(state)}).status, 1);
    assert.deepEqual(readdirSync(env.MUSE_BRIDGE_STATE_DIR), ['test.json']);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});
