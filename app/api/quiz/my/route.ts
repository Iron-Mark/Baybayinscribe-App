import db from "@/db/drizzle";
import { metadata, quiz_question, QuizSchema } from "@/db/schema/quiz-schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";

export async function POST(request: Request) {
  const access = await requireApiAccess(request);
  if (access.response) return access.response;
  const { userId } = await request.json();
  if (userId && userId !== access.session.user.id && access.session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!userId) {
    return NextResponse.json(
      { error: "User ID is required." },
      { status: 400 }
    );
  }

  const userQuizzes = await db
    .select()
    .from(QuizSchema)
    .leftJoin(metadata, eq(QuizSchema.id, metadata.quiz_id))
    .where(eq(QuizSchema.created_by, userId));

  // For each quiz, fetch its questions and attach under "questions"
  const quizzesWithQuestions = await Promise.all(
    userQuizzes.map(async (quiz) => {
      const quizId =
        quiz.metadata!.quiz_id;
      const questions = await db
        .select()
        .from(quiz_question)
        .where(eq(quiz_question.quiz_id, quizId));
      return {
        ...quiz,
        questions,
      };
    })
  );

  return NextResponse.json(quizzesWithQuestions, { status: 200 });
}
