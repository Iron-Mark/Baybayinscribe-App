import assert from 'node:assert/strict';
import test from 'node:test';
import axios from '../lib/axios';
import { useLearningResourceStore } from '../app/store/store.lr';
import { useModuleStore } from '../app/store/store.modules';
import useQuizStore from '../app/store/store.quiz';
import { sampleLesson, sampleModule, sampleFile, sampleQuiz, SAMPLE_LESSON_ID, SAMPLE_QUIZ_ID } from '../lib/showcase-content';

test('bundled showcase reuses public examples with separate IDs and valid MCQ indexes', () => {
  assert.equal(sampleLesson.is_visible, true);
  assert.equal(sampleQuiz.metadata.is_public, true);
  assert.ok(sampleLesson.title.startsWith('Sample:'));
  assert.ok(sampleQuiz.metadata.quiz_name.startsWith('Sample:'));
  for (const question of sampleQuiz.questions) {
    assert.equal(question.quiz_id, SAMPLE_QUIZ_ID);
    assert.ok(Number(question.correct_answer) >= 0);
    assert.ok(Number(question.correct_answer) < question.options.length);
  }
});

test('unavailable content gets labelled samples, which load and practice without API writes', async () => {
  const original = axios.defaults.adapter;
  let calls = 0;
  axios.defaults.adapter = async () => { calls++; throw new Error('Synthetic unavailable backend'); };
  try {
    await useLearningResourceStore.getState().getAllLessons();
    assert.equal(useLearningResourceStore.getState().lessons?.[0].id, SAMPLE_LESSON_ID);
    assert.match(useLearningResourceStore.getState().error ?? '', /bundled sample/);
    await useQuizStore.getState().loadAllQuiz();
    assert.equal(useQuizStore.getState().quizzes?.[0].metadata.quiz_id, SAMPLE_QUIZ_ID);
    const before = calls;
    await useLearningResourceStore.getState().getLesson(SAMPLE_LESSON_ID, 'signed-in-actor');
    await useModuleStore.getState().getModule(SAMPLE_LESSON_ID, sampleFile.id);
    assert.equal(useModuleStore.getState().module?.id, sampleModule.id);
    await useQuizStore.getState().loadQuiz(SAMPLE_QUIZ_ID);
    await useQuizStore.getState().loadQuizDetails(SAMPLE_QUIZ_ID);
    await useQuizStore.getState().loadQuizAnswerHistory(SAMPLE_QUIZ_ID, 'signed-in-actor');
    await useQuizStore.getState().submitQuizAnswers(SAMPLE_QUIZ_ID, []);
    assert.equal(calls, before, 'sample reads/history/results must not access the backend');
    await useLearningResourceStore.getState().getLesson('sample-missing');
    assert.equal(useLearningResourceStore.getState().lesson, undefined);
    await useModuleStore.getState().getModule(SAMPLE_LESSON_ID, 'sample-missing');
    assert.equal(useModuleStore.getState().module, null);
    assert.equal(calls, before);
  } finally { axios.defaults.adapter = original; }
});
