"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useLearningResourceStore } from "@/app/store/store.lr";
import { authClient } from "@/app/lib/auth-client";
import type { LessonDetails } from "@/types/type.lessons";
import { isSampleContent } from '@/lib/showcase-content';

type LessonContextType = {
  lesson: LessonDetails | undefined;
  status: string;
  error: string | null;
  setLessonId: (id: string) => void;
  isGuest: boolean;
  completeGuestModule: (moduleId: string) => void;
};

const LessonContext = createContext<LessonContextType | undefined>(undefined);

export const LessonProvider: React.FC<{
  lessonId: string;
  children: React.ReactNode;
}> = ({ lessonId, children }) => {
  const [currentLessonId, setCurrentLessonId] = useState<string>(lessonId);
  const lesson = useLearningResourceStore((s) => s.lesson);
  const status = useLearningResourceStore((s) => s.status);
  const error = useLearningResourceStore((s) => s.error);
  const getLesson = useLearningResourceStore((s) => s.getLesson);
  const [isGuest, setIsGuest] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [guestFinished, setGuestFinished] = useState<string[]>([]);

  // The /lesson layout persists when navigating from the list to a lesson.
  useEffect(() => { setCurrentLessonId(lessonId); }, [lessonId]);

  useEffect(() => {
    (async () => {
      const session = await authClient.getSession();
      setIsGuest(!session.data || isSampleContent(currentLessonId));
      setSessionReady(true);
      if (session.data) setGuestFinished([]);
      if (currentLessonId) {
        getLesson(currentLessonId, session.data?.user.id);
      }
    })();

  }, [currentLessonId, getLesson]);

  const setLessonId = (id: string) => setCurrentLessonId(id);

  return (
    <LessonContext.Provider
      value={{
        lesson: lesson && isGuest ? { ...lesson, learning_resource_module: lesson.learning_resource_module.map((module) => ({
          ...module, is_finished: guestFinished.includes(module.id),
        })) } : lesson,
        status: sessionReady ? status : 'Loading', error: error || null, setLessonId, isGuest,
        completeGuestModule: (id) => setGuestFinished((finished) => finished.includes(id) ? finished : [...finished, id]),
      }}
    >
      {children}
    </LessonContext.Provider>
  );
};

export const useLessonContext = () => {
  const ctx = useContext(LessonContext);
  if (!ctx)
    throw new Error("useLessonContext must be used within a LessonProvider");
  return ctx;
};
