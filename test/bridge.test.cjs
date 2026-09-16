const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMuseBridge, findMuseChats, museThreadURL } = require('../scripts/muse-bridge.cjs');

const URL = 'https://muse.ai/thread/example-test';
const message = (id, role, text, busy = false) => ({ id, role, text, busy, turnId: id, links: [] });
function fixture(initial = []) {
  const model = { messages: structuredClone(initial), generating: false, hasDraft: false,
    composerEnabled: true, ready: true };
  let draft = '';
  const state = { model, url: URL, presses: 0, fills: 0, loseAck: false, failFill: false,
    immediateReply: false, time: 0 };
  const tab = {
    url: async () => state.url,
    playwright: {
      evaluate: async () => structuredClone(model),
      getByRole(role, options) {
        assert.equal(role, 'textbox');
        assert.deepEqual(options, { name: 'Message', exact: true });
        return {
          async fill(text) { state.fills++; if (state.failFill) throw Error('lost tool'); draft = text; },
          async press(key) {
            assert.equal(key, 'Enter'); state.presses++;
            model.messages.push(message(`u${state.presses}`, 'user', draft));
            if (state.immediateReply) model.messages.push(message('instant', 'assistant', 'Done.'));
            if (state.loseAck) throw Error('acknowledgement lost after send');
          }
        };
      }
    }
  };
  state.options = { now: () => state.time, sleep: async ms => { state.time += ms; await state.tick?.(); } };
  state.bridge = createMuseBridge(tab, state.options);
  state.tab = tab;
  return state;
}

test('find filters open Muse threads and never invents URLs', async () => {
  const tabs = [{id:'1',url:URL,title:'Project'}, {id:'2',url:'https://other.test/thread/x',title:'Project'}];
  assert.deepEqual(await findMuseChats({tabs:{list:async()=>tabs}}, 'project'), [tabs[0]]);
  assert.throws(() => museThreadURL('https://muse.ai.evil.test/thread/test'));
});

test('read tracks IDs, changed streams, equal text on different messages, and links', async () => {
  const s = fixture([message('old', 'assistant', 'Hello')]);
  assert.equal((await s.bridge.read()).messages.length, 1);
  assert.equal((await s.bridge.read()).messages.length, 0);
  s.model.messages.push({...message('new', 'assistant', 'Hello'), links:[{text:'link',url:'https://example.com'}]});
  assert.equal((await s.bridge.read()).messages[0].id, 'new');
  s.model.messages[1].text = 'Hello again';
  const change = (await s.bridge.read()).messages[0];
  assert.equal(change.change, 'updated'); assert.equal(change.links.length, 1);
});

test('immediate assistant reply is not consumed by send acknowledgement', async () => {
  const s = fixture(); s.immediateReply = true;
  assert.equal((await s.bridge.send('Hello')).status, 'sent');
  const reply = await s.bridge.wait({timeoutMs:0});
  assert.equal(reply.status, 'reply'); assert.equal(reply.messages[0].text, 'Done.');
});

test('lost acknowledgement observes delivery and does not press Enter twice', async () => {
  const s = fixture(); s.loseAck = true;
  assert.equal((await s.bridge.send('Hello')).status, 'sent');
  assert.equal(s.presses, 1);
});

test('unconfirmed send remains uncertain across checkpoint restore', async () => {
  const s = fixture(); s.failFill = true;
  const result = await s.bridge.send('Please review');
  assert.equal(result.status, 'uncertain');
  const restored = createMuseBridge(s.tab, {checkpoint:result.checkpoint});
  await assert.rejects(() => restored.send('Please review'), /pending/);
  assert.equal(s.presses, 0);
});

test('drafts and active generations are left intact', async () => {
  for (const property of ['hasDraft', 'generating']) {
    const s = fixture(); s.model[property] = true;
    await assert.rejects(() => s.bridge.send('Hello'));
    assert.equal(s.fills, 0); assert.equal(s.presses, 0);
  }
});

test('wait returns settled new text and later handoffs, not old history', async () => {
  const s = fixture([message('old', 'assistant', 'Old reply')]);
  await s.bridge.send('Review');
  s.model.generating = true;
  s.model.messages.push(message('a1', 'assistant', 'Work', true));
  s.tick = async () => { s.model.generating = false; s.model.messages.at(-1).busy = false;
    s.model.messages.at(-1).text = 'Working; I will report later.'; };
  const result = await s.bridge.wait({timeoutMs:2000});
  assert.equal(result.status, 'reply'); assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].text, 'Working; I will report later.');
  s.model.messages.push(message('a2', 'assistant', 'Finished.'));
  assert.equal((await s.bridge.wait({timeoutMs:0})).messages[0].id, 'a2');
});

test('bounded wait times out without sending any message', async () => {
  const s = fixture(); await s.bridge.read();
  const result = await s.bridge.wait({timeoutMs:2000});
  assert.equal(result.status, 'waiting'); assert.equal(s.time, 2000); assert.equal(s.presses, 0);
  assert.equal((await s.bridge.wait({signal:{aborted:true}})).status, 'stopped');
});

test('restored read does not replay previous text; cross-thread state is rejected', async () => {
  const s = fixture([message('a', 'assistant', 'Sensitive body stays out of checkpoint')]);
  await s.bridge.read();
  const saved = s.bridge.checkpoint();
  assert.ok(!JSON.stringify(saved).includes('Sensitive body'));
  const restored = createMuseBridge(s.tab, {checkpoint:saved});
  assert.deepEqual((await restored.read()).messages, []);
  s.url = 'https://muse.ai/thread/different';
  await assert.rejects(() => restored.read(), /Conversation changed/);
});

test('missing history and other writers cannot be mistaken for our reply', async () => {
  const s = fixture(); await s.bridge.send('Review');
  s.model.messages = [];
  assert.equal((await s.bridge.wait({timeoutMs:0})).status, 'history_gap');
  s.model.messages = [message('u1','user','Review'), message('u2','user','Someone else'), message('a','assistant','Their reply')];
  assert.equal((await s.bridge.wait({timeoutMs:0})).status, 'conversation_changed');
});
