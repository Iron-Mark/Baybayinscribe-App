import assert from "node:assert/strict";
import test from "node:test";
import { startQuestionTimer } from "../lib/quiz/question-timer";

test("question countdown expires exactly once", (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const ticks: number[] = [];
  let expirations = 0;
  const cancel = startQuestionTimer(3, (remaining) => ticks.push(remaining), () => { expirations++; });
  assert.deepEqual(ticks, [3]);
  context.mock.timers.tick(2000);
  assert.deepEqual(ticks, [3, 2, 1]);
  assert.equal(expirations, 0);
  context.mock.timers.tick(1000);
  assert.equal(expirations, 1);
  context.mock.timers.tick(10000);
  assert.equal(expirations, 1);
  cancel();
});

test("cancelling on question transition prevents the previous timer firing", (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  let expirations = 0;
  const cancel = startQuestionTimer(2, () => {}, () => { expirations++; });
  context.mock.timers.tick(1000);
  cancel();
  context.mock.timers.tick(10000);
  assert.equal(expirations, 0);
});

test("a zero-second question expires immediately without a running interval", (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  let expirations = 0;
  startQuestionTimer(0, () => {}, () => { expirations++; });
  assert.equal(expirations, 1);
  context.mock.timers.tick(10000);
  assert.equal(expirations, 1);
});
