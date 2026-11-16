"use client";
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { toast } from "sonner";
import {
  Quiz,
  QuizQuestion,
  ModifiedQuizAnswerQuestion,
} from "../../../../../types/type.quiz";
import useQuizStore from "@/app/store/store.quiz";
import { useInferenceStore, InferenceState, InferenceStatus } from "@/app/store/store.inference";

// Helper function to get health based on difficulty
const getHealthByDifficulty = (difficulty: string): number => {
  switch (difficulty) {
    case "Easy":
      return 3;
    case "Moderate":
      return 2;
    case "Hard":
      return 1;
    default:
      return 3; // fallback to Easy
  }
};

// Helper function to get per-question time limit from user-configured time_limit
const getTimePerQuestion = (timeLimit: number): number => {
  return timeLimit || 30; // Use user-configured time limit or fallback to 30
};

type QuizTakeContextType = {
  quizId?: string;
  quiz?: Quiz;
  progress: number;
  currentQuestion: QuizQuestion | undefined;
  health?: number;
  inference?: InferenceState;
  isModelReady: boolean;
  setProgress: React.Dispatch<React.SetStateAction<number>>;
  onSubmit: () => void;
  subscribeToSubmit: (callback: () => void) => () => void;
  onTimerEnd: (callback: () => void) => () => void;
  setHealth: React.Dispatch<React.SetStateAction<number>>;
  answerHistory: ModifiedQuizAnswerQuestion[];
  recordAnswer: (record: ModifiedQuizAnswerQuestion) => void;
  getTimePerQuestion: () => number;
};

const QuizTakeContext = createContext<QuizTakeContextType | undefined>(
  undefined
);

export const useQuizTakeContext = () => {
  const context = useContext(QuizTakeContext);
  if (!context) {
    throw new Error(
      "useQuizTakeContext must be used within a QuizTakeProvider"
    );
  }
  return context;
};

export const QuizTakeProvider: React.FC<{
  children: React.ReactNode;
  params: { quiz_id: string };
}> = ({ children, params }) => {
  const [quiz, setQuiz] = useState<Quiz | undefined>();
  const [currentQuestion, setCurrentQuestion] = useState<
    QuizQuestion | undefined
  >(undefined);
  const [progress, setProgress] = useState(0);
  const inference = useInferenceStore();
  const [health, setHealth] = useState(3);
  const [answerHistory, setAnswerHistory] = useState<
    Array<ModifiedQuizAnswerQuestion>
  >([]);
  const [isModelReady, setIsModelReady] = useState(false);
  const loadedQuiz = useQuizStore((state) => state.quiz);
  const quizStatus = useQuizStore((state) => state.status);
  const loadQuiz = useQuizStore((state) => state.loadQuiz);
  const initLocalModel = useInferenceStore((state) => state.initLocalModel);
  const inferenceStatus = inference.status;
  const inferenceResult = inference.localInferenceResult;
  const clearResults = inference.clearResults;

  // Initialize quiz and model when component mounts
  useEffect(() => {
    const initializeQuizAndModel = async () => {
      // Load quiz first
      await loadQuiz(params.quiz_id);

      // Text-only quizzes must not block on an unused recognition model.
      const needsSketch = useQuizStore.getState().quiz?.questions.some(
        (question) => question.type === 'SKT' || question.type === 'sketch'
      );
      if (needsSketch && useInferenceStore.getState().status === InferenceStatus.IDLE) {
        initLocalModel();
      }
    };

    initializeQuizAndModel();
  }, [params.quiz_id, loadQuiz, initLocalModel]);

  // Monitor inference model status
  useEffect(() => {
    setIsModelReady(inferenceStatus === InferenceStatus.READY);

    if (inferenceStatus === InferenceStatus.ERROR) {
      toast.error(
        "Failed to load AI model. Sketch questions may not work properly."
      );
    } else if (inferenceStatus === InferenceStatus.READY) {
      console.log("Inference model is ready!");
    }
  }, [inferenceStatus]);
  useEffect(() => {
    setQuiz(loadedQuiz);
    setProgress(0);
    setAnswerHistory([]);
    if (loadedQuiz?.metadata.difficulty) {
      setHealth(getHealthByDifficulty(loadedQuiz.metadata.difficulty));
    }
  }, [loadedQuiz]);

  useEffect(() => {
    if (quizStatus === "Error") {
      toast.error("Failed to load quiz.");
    }
  }, [quizStatus]);

  useEffect(() => {
    if (!quiz) return;
    const curr = quiz.questions[progress];
    if (curr) {
      setCurrentQuestion(curr);
      console.log(curr.type);
      
      // Clear inference results if transitioning to non-sketch question
      const isSketchQuestion = curr.type === "sketch" || curr.type === "SKT";
      if (!isSketchQuestion && inferenceResult) {
        console.log("Clearing inference results for non-sketch question");
        clearResults();
      }
    } else {
      console.log("No more questions available.");
    }
  }, [quiz, progress, inferenceResult, clearResults]);

  const submitCallbacks = useRef<(() => void)[]>([]);
  const timerCallbacks = useRef<(() => void)[]>([]);

  const onSubmit = useCallback(() => {
    submitCallbacks.current.forEach((callback) => callback());
  }, []);

  const onTimerEnd = useCallback((callback: () => void) => {
    if (timerCallbacks.current.findIndex((cb) => cb === callback) === -1)
      timerCallbacks.current.push(callback);
    return () => {
      timerCallbacks.current = timerCallbacks.current.filter(
        (cb) => cb !== callback
      );
    };
  }, []);

  const subscribeToSubmit = useCallback((callback: () => void) => {
    if (submitCallbacks.current.findIndex((cb) => cb === callback) === -1)
      submitCallbacks.current.push(callback);
    return () => {
      submitCallbacks.current = submitCallbacks.current.filter(
        (cb) => cb !== callback
      );
    };
  }, []);
  const recordAnswer = useCallback((record: ModifiedQuizAnswerQuestion) => {
    setAnswerHistory((prev) => [...prev, record]);
  }, []);
  const getTimePerQuestionValue = () => {
    if (quiz?.metadata.time_limit) {
      return getTimePerQuestion(quiz.metadata.time_limit);
    }
    return 30; // fallback to 30 seconds if no time limit is set
  };

  return (
    <QuizTakeContext.Provider
      value={{
        progress,
        currentQuestion,
        health,
        answerHistory,
        quiz,
        inference: inference,
        isModelReady,
        setHealth,
        onTimerEnd,
        setProgress,
        onSubmit,
        subscribeToSubmit,
        recordAnswer,
        getTimePerQuestion: getTimePerQuestionValue,
      }}
    >
      {children}
    </QuizTakeContext.Provider>
  );
};
