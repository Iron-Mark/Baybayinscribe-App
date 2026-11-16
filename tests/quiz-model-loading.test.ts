import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';

async function initialization(types: string[] | undefined, status = 'IDLE') {
  let modelStarts = 0;
  let quizLoads = 0;
  const effects: (() => void)[] = [];
  const quizState = {
    quiz: types && { metadata: { quiz_id: 'synthetic' }, questions: types.map((type) => ({ type })) },
    status: 'Loaded', loadQuiz: async () => { quizLoads++; },
  };
  const modelState = { status, initLocalModel: () => { modelStarts++; }, clearResults() {} };
  const quizStore = Object.assign((select: (value: typeof quizState) => unknown) => select(quizState), { getState: () => quizState });
  const modelStore = Object.assign((select?: (value: typeof modelState) => unknown) => select ? select(modelState) : modelState, { getState: () => modelState });
  const react = {
    createContext: () => ({ Provider: 'provider' }), createElement: () => null,
    useContext: () => null, useState: (value: unknown) => [value, () => {}],
    useRef: (value: unknown) => ({ current: value }),
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void) => { effects.push(effect); },
  };
  const holder = { exports: {} as { QuizTakeProvider: (props: unknown) => unknown } };
  runInNewContext(transformSync(readFileSync('app/(screens)/quiz/take/[quiz_id]/QuizTakeContext.tsx', 'utf8'), { loader: 'tsx', format: 'cjs' }).code, {
    module: holder, console: { log() {} },
    require: (name: string) => {
      if (name === 'react') return { __esModule: true, default: react, ...react };
      if (name === 'sonner') return { toast: { error() {} } };
      if (name === '@/app/store/store.quiz') return { __esModule: true, default: quizStore };
      if (name === '@/app/store/store.inference') return { useInferenceStore: modelStore, InferenceStatus: { IDLE: 'IDLE', READY: 'READY', ERROR: 'ERROR' } };
      throw new Error(`Unexpected quiz-model test dependency: ${name}`);
    },
  });
  holder.exports.QuizTakeProvider({ children: null, params: { quiz_id: 'synthetic' } });
  effects[0]();
  await new Promise<void>((done) => setImmediate(done));
  return { modelStarts, quizLoads };
}

test('actual quiz initialization skips the model for text-only and unavailable quizzes', async () => {
  for (const types of [[], ['MCQ', 'IDT'], ['multipleChoice', 'quiz'], undefined]) {
    assert.deepEqual(await initialization(types), { modelStarts: 0, quizLoads: 1 });
  }
});

test('sketch aliases retain model initialization without reinitializing a ready model', async () => {
  for (const types of [['MCQ', 'SKT'], ['sketch']]) {
    assert.deepEqual(await initialization(types), { modelStarts: 1, quizLoads: 1 });
    assert.deepEqual(await initialization(types, 'READY'), { modelStarts: 0, quizLoads: 1 });
  }
});
