import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('desktop save acknowledgements retain request IDs and do not expose raw Electron IPC', async () => {
  const events = new EventEmitter();
  const sent: { channel: string; value: { ok: boolean; requestId: string; message?: string } }[] =
    [];
  let bridge:
    | { onBeforeClose: (callback: () => Promise<void>) => () => void; ipcRenderer?: unknown }
    | undefined;
  const ipcRenderer = Object.assign(events, {
    send(channel: string, value: (typeof sent)[number]['value']) {
      sent.push({ channel, value });
    },
  });
  runInNewContext(readFileSync('desktop/preload.cjs', 'utf8'), {
    require: (name: string) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld(_name: string, exposed: typeof bridge) {
            bridge = exposed;
          },
        },
        ipcRenderer,
      };
    },
    process: { contextIsolated: true, sandboxed: true },
  });
  assert.ok(bridge);
  assert.equal(bridge.ipcRenderer, undefined);
  const unsubscribe = bridge.onBeforeClose(async () => {});
  events.emit('frame:save-before-close', {}, 'close-attempt-1');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent[0].channel, 'frame:save-result');
  assert.equal(sent[0].value.requestId, 'close-attempt-1');
  assert.equal(sent[0].value.ok, true);
  unsubscribe();
  const failure = bridge.onBeforeClose(async () => {
    throw new Error('Unsaved asset draft');
  });
  events.emit('frame:save-before-close', {}, 'close-attempt-2');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent[1].value.requestId, 'close-attempt-2');
  assert.equal(sent[1].value.ok, false);
  assert.equal(sent[1].value.message, 'Unsaved asset draft');
  events.emit('frame:save-before-close', {}, { invalid: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 2);
  failure();
  assert.equal(events.listenerCount('frame:save-before-close'), 0);
});
