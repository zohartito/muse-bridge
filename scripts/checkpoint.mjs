// Optional private checkpoint storage. No browser connection or network listener.
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const [command, alias] = process.argv.slice(2);
if (!['save', 'load'].includes(command) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(alias || '')) {
  throw new Error('Usage: node scripts/checkpoint.mjs save|load ALIAS (save reads JSON on stdin)');
}
const directory = process.env.MUSE_BRIDGE_STATE_DIR || join(homedir(), '.local/state/codex-muse-bridge');
const file = join(directory, `${alias}.json`);
if (command === 'load') {
  process.stdout.write(await readFile(file, 'utf8'));
} else {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const state = JSON.parse(input);
  if (state.version !== 1 || !Array.isArray(state.seen) || typeof state.url !== 'string') {
    throw new Error('Expected bridge.checkpoint() JSON.');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, `.${alias}-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(state) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
  process.stdout.write(`Saved checkpoint: ${alias}\n`);
}
