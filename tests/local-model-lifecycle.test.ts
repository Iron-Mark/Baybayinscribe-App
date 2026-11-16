import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { create } from 'zustand';
import type { InferenceState } from '../app/store/store.inference';

function fixture() {
  const counts = { loads: 0, warmups: 0, inputsDisposed: 0, outputsDisposed: 0, modelsDisposed: 0 };
  const fail = { load: false, warmup: false };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tf = {
    ready: () => gate, setBackend: async () => true,
    ones: () => ({ dispose: () => { counts.inputsDisposed++; } }),
    loadGraphModel: async () => {
      counts.loads++;
      if (fail.load) throw new Error('synthetic network failure');
      return { inputs: [{ shape: [1, 4, 4, 3] }],
        dispose: () => { counts.modelsDisposed++; },
        executeAsync: async () => {
          counts.warmups++;
          if (fail.warmup) throw new Error('synthetic warmup failure');
          return [{ dispose: () => { counts.outputsDisposed++; } }];
        },
      };
    },
  };
  const holder = { exports: {} as {
    useInferenceStore: { getState: () => InferenceState };
    InferenceStatus: { READY: number; ERROR: number; LOADING: number };
  } };
  runInNewContext(transformSync(readFileSync('app/store/store.inference.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, {
    module: holder, console: { log() {}, warn() {}, error() {} },
    require: (name: string) => {
      if (name === '@tensorflow/tfjs') return tf;
      if (name === '@tensorflow/tfjs-backend-webgl') return {};
      if (name === 'zustand') return { create };
      if (name === '@/constants') return { LABELS: [] };
      if (name === 'inferencejs') return {};
      throw new Error(`Unexpected model dependency: ${name}`);
    },
  });
  return { ...holder.exports, counts, fail, release };
}

test('real model store shares concurrent initialization and reuses a ready model', async () => {
  const f = fixture();
  const init = f.useInferenceStore.getState().initLocalModel;
  const first = init();
  assert.equal(f.useInferenceStore.getState().status, f.InferenceStatus.LOADING);
  assert.strictEqual(init(), first);
  f.release();
  await first;
  await init();
  assert.equal(f.useInferenceStore.getState().status, f.InferenceStatus.READY);
  assert.equal(f.counts.loads, 1);
  assert.equal(f.counts.warmups, 1);
  assert.equal(f.counts.inputsDisposed, 1);
  assert.equal(f.counts.outputsDisposed, 1);
});

test('failed warmup frees its resources and can be retried', async () => {
  const f = fixture();
  f.fail.warmup = true;
  f.release();
  await f.useInferenceStore.getState().initLocalModel();
  assert.equal(f.useInferenceStore.getState().status, f.InferenceStatus.ERROR);
  assert.equal(f.counts.inputsDisposed, 1);
  assert.equal(f.counts.modelsDisposed, 1);
  f.fail.warmup = false;
  await f.useInferenceStore.getState().initLocalModel();
  assert.equal(f.useInferenceStore.getState().status, f.InferenceStatus.READY);
  assert.equal(f.counts.loads, 2);
});

test('failed model download clears the shared attempt so retry can succeed', async () => {
  const f = fixture();
  f.fail.load = true;
  f.release();
  await f.useInferenceStore.getState().initLocalModel();
  assert.equal(f.useInferenceStore.getState().status, f.InferenceStatus.ERROR);
  f.fail.load = false;
  await f.useInferenceStore.getState().initLocalModel();
  assert.equal(f.useInferenceStore.getState().status, f.InferenceStatus.READY);
  assert.equal(f.counts.loads, 2);
});
