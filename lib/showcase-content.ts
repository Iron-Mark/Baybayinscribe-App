import { mockLessons } from '@/constants/mock/mockLessons';
import { mockQuizzes } from '@/constants/mock/mockQuizzes';

/** Deliberately separate IDs: these are public bundled examples, never DB rows. */
export const SAMPLE_LESSON_ID = 'sample-baybayin-introduction';
export const SAMPLE_QUIZ_ID = 'sample-baybayin-basics';
export const isSampleContent = (id?: string) => id?.startsWith('sample-') === true;
const date = new Date('2024-01-01T00:00:00.000Z');
export const sampleLesson = {
  ...mockLessons[0], id: SAMPLE_LESSON_ID, title: 'Sample: Introduction to Baybayin',
  description: 'Bundled showcase example, not recovered original course content. ' + mockLessons[0].description,
};
export const sampleFile = {
  id: 'sample-file-basics', name: 'baybayin-basics.md', url: '/showcase/baybayin-basics.md',
  uploaded_by: null, learning_resource_id: SAMPLE_LESSON_ID, createdAt: date, updatedAt: date,
};
export const sampleModule = {
  id: 'sample-module-basics', module_id: sampleFile.id, module_name: 'Sample: vowels and practice',
  module_description: 'A small bundled demonstration. Completion is not saved to an account.',
  learning_resource_id: SAMPLE_LESSON_ID, createdAt: date, updatedAt: date,
};
export const sampleLessonDetail = {
  learning_resource: sampleLesson,
  learning_resource_module: [{ ...sampleModule, file: sampleFile, is_finished: false }],
};
// Reuse only the first existing public example. Normalize the old fixture's
// answer text to the index expected by the existing MCQ player.
const originalQuiz = mockQuizzes.find((quiz) => quiz.metadata.is_public)!;
export const sampleQuiz = {
  ...originalQuiz, id: SAMPLE_QUIZ_ID, created_by: 'bundled-showcase',
  metadata: { ...originalQuiz.metadata, quiz_id: SAMPLE_QUIZ_ID, quiz_name: 'Sample: Baybayin Basics',
    description: 'Bundled practice example. Scores stay in this visit and are never saved to an account.' },
  questions: originalQuiz.questions.map((question, index) => ({ ...question,
    id: `sample-question-${index + 1}`, quiz_id: SAMPLE_QUIZ_ID, display_text: null,
    correct_answer: String(question.options.indexOf(question.correct_answer)),
  })),
};
