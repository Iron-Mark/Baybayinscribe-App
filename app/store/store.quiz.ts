import { Status } from "@/types/type.loading";
import {
  metadata,
  quiz_answer_question,
  quiz_question,
  QuizSchema,
} from "@/db/schema/quiz-schema";
import { create } from "zustand";
import axios from "@/lib/axios";
import { ModifiedQuizAnswerQuestion, Quiz } from "@/types/type.quiz";
import { isSampleContent, SAMPLE_QUIZ_ID, sampleQuiz } from '@/lib/showcase-content';

export type QuizStore = {
  status: Status;
  quizAnswerUploadStatus: Status;
  quiz?: Quiz | undefined;
  quizzes?: Quiz[] | undefined;
  quiz_details?:
    | (typeof QuizSchema.$inferSelect & {
        metadata: typeof metadata.$inferSelect;
      } & { questions: (typeof quiz_question.$inferSelect)[] })
    | undefined;
  error?: string;
  answerHistory:
    | {
        attempt: number;
        score: number;
      }[]
    | undefined;

  saveQuiz: (
    quiz: typeof QuizSchema.$inferSelect & {
      metadata: typeof metadata.$inferSelect;
    } & { questions: (typeof quiz_question.$inferSelect)[] }
  ) => Promise<void>;

  loadQuiz: (quiz_id: string) => void;
  loadQuizDetails: (quiz_id: string) => void;

  submitQuizAnswers: (
    quiz_id: string,
    answers: ModifiedQuizAnswerQuestion[]
  ) => void;
  loadQuizAnswerHistory: (quiz_id: string, user_id: string) => void;

  saveLocalQuizProgress: (
    answer: typeof quiz_answer_question.$inferSelect
  ) => void;
  loadLocalQuizProgress: (quiz_id: string) => void;
  loadAllLocalQuizProgress: () => void;

  loadAllQuiz: () => void;
  loadMyQuizzes: (userId: string) => void;
  deleteQuiz: (quizId: string) => void;

  getQuizScoreAverage: (user_id: string) => Promise<{
    average: number;
    totalAnswers: number;
    correctAnswers: number;
    quizzesAnswered: number;
  }>;

  clearQuiz: () => void;
};

const useQuizStore = create<QuizStore>((set) => ({
  status: "Idle",
  quizAnswerUploadStatus: "Idle",
  answerHistory: undefined,
  clearQuiz: () => {
    set({
      quiz: undefined,
      answerHistory: undefined,
      status: "Idle",
      quizAnswerUploadStatus: "Idle",
    });
  },
  loadQuiz: async (quiz_id: string) => {
    if (isSampleContent(quiz_id)) {
      set({ quiz: quiz_id === SAMPLE_QUIZ_ID ? sampleQuiz : undefined, status: quiz_id === SAMPLE_QUIZ_ID ? 'Loaded' : 'Error', error: undefined });
      return;
    }
    set({ quiz: undefined, error: undefined, status: "Loading" });
    try {
      const response = await axios.get(`/quiz/get/${quiz_id}`);
      if (response.status === 200) {
        const quizData: Quiz = response.data;
        set({ quiz: quizData, status: "Loaded" });
      } else {
        set({ error: response.data.error, status: "Error" });
      }
    } catch (error: unknown) {
      set({
        error: "Couldn't load quiz. Try again: " + error,
        status: "Error",
      });
    }
  },
  saveQuiz: async (
    quiz: typeof QuizSchema.$inferSelect & {
      metadata: typeof metadata.$inferSelect;
    } & { questions: (typeof quiz_question.$inferSelect)[] }
  ) => {
    set({ status: "Loading" });
    try {
      const response = await axios.post(`/quiz/save`, quiz);
      if (response.status === 200) {
        set({ quiz: response.data, status: "Loaded" });
        return response.data;
      } else {
        set({ error: response.data.error, status: "Error" });
        throw new Error(response.data.error);
      }
    } catch (error: unknown) {
      set({ error: (error as Error).message || "Error", status: "Error" });
      throw error;
    }
  },
  loadQuizDetails: async (quiz_id: string) => {
    if (isSampleContent(quiz_id)) {
      set({ quiz_details: quiz_id === SAMPLE_QUIZ_ID ? sampleQuiz : undefined, status: quiz_id === SAMPLE_QUIZ_ID ? 'Loaded' : 'Error', error: undefined });
      return;
    }
    set({ status: "Loading" });
    try {
      const quizResponse = await axios.get(`/quiz/get/${quiz_id}`);
      const quiz: typeof QuizSchema.$inferSelect & {
        metadata: typeof metadata.$inferSelect;
      } & { questions: (typeof quiz_question.$inferSelect)[] } =
        quizResponse.data;
      set({ quiz_details: quiz, status: "Loaded" });
    } catch {
      set({ quiz_details: undefined, status: "Error", error: "Quiz is unavailable or not public." });
    }
  },
  submitQuizAnswers: async (quiz_id: string, answers) => {
    if (isSampleContent(quiz_id)) return; // Public examples never write account data.
    set({ status: "Loading" });
    try {
      await axios.post(`/quiz/answers/save/`, {
        answers: answers,
      });
      // Optional: set response or further handling here.
    } catch (error: unknown) {
      set({ error: (error as Error).message || "Error", status: "Error" });
    }
  },
  loadQuizAnswerHistory: async (quiz_id: string, user_id: string) => {
    if (isSampleContent(quiz_id)) { set({ answerHistory: undefined }); return; }
    set({ status: "Loading" });
    try {
      const response = await axios.get(
        `/quiz/answers/${quiz_id}?user_id=${user_id}`
      );
      if (response.status === 200) {
        const answers = response.data;
        console.log(answers);
        set({ answerHistory: answers, status: "Loaded" });
      } else {
        set({ error: response.data.error, status: "Error" });
      }
    } catch (error: unknown) {
      set({ error: (error as Error).message || "Error", status: "Error" });
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  saveLocalQuizProgress: (_: typeof quiz_answer_question.$inferSelect) => {
    // implement saveLocalQuizProgress functionality
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  loadLocalQuizProgress: (_: string) => {
    // implement loadLocalQuizProgress functionality
  },
  loadAllLocalQuizProgress: () => {
    // implement loadAllLocalQuizProgress functionality
  },
  loadAllQuiz: async () => {
    set({ status: "Loading" });
    try {
      const response = await axios.get(`/quiz/all`);
      if (response.status === 200) {
        const quizzes = response.data;
        if (Array.isArray(quizzes) && quizzes.length === 0) {
          set({ quizzes: [sampleQuiz], error: 'No live quizzes available. Showing a labelled bundled sample.', status: "Loaded" });
          return [sampleQuiz];
        }
        set({ quizzes, status: "Loaded" });
        return quizzes;
      } else {
        set({ error: response.data.error, status: "Error" });
      }
    } catch {
      set({
        quizzes: [sampleQuiz],
        status: "Loaded",
        error: "Live quizzes are unavailable. Showing a labelled bundled sample; scores are not saved.",
      });
      return [sampleQuiz];
    }
  },
  loadMyQuizzes: async (userId: string) => {
    set({ status: "Loading" });
    try {
      const response = await axios.post(`/quiz/my`, { userId: userId });
      if (response.status === 200) {
        const quizzes = response.data;
        if (Array.isArray(quizzes) && quizzes.length === 0) {
          set({ quizzes: undefined, status: "Loaded" });
          return undefined;
        }
        set({ quizzes, status: "Loaded" });
        return quizzes;
      } else {
        set({ error: response.data.error, status: "Error" });
      }
    } catch (error: unknown) {
      set({ error: (error as Error).message || "Error", status: "Error" });
    }
  },
  deleteQuiz: async (quizId: string) => {
    set({ status: "Loading" });
    try {
      const response = await axios.delete(`/quiz`, {
        data: { quizId: quizId },
      });
      if (response.status === 200) {
        set({ status: "Loaded" });
      } else {
        set({ error: response.data.error, status: "Error" });
      }
    } catch (error: unknown) {
      set({ error: (error as Error).message || "Error", status: "Error" });
    }
  },

  getQuizScoreAverage: async (
    user_id: string
  ): Promise<{
    average: number;
    totalAnswers: number;
    correctAnswers: number;
    quizzesAnswered: number;
  }> => {
    try {
      const response = await axios.get(
        `/lessons/progress/${user_id}/quiz/average`
      );
      if (response.status === 200) {
        return response.data;
      } else {
        throw new Error(response.data.error);
      }
    } catch (error: unknown) {
      console.error("Error fetching quiz score average:", error);
      throw new Error((error as Error).message || "Error fetching average");
    }
  },
}));

export default useQuizStore;
