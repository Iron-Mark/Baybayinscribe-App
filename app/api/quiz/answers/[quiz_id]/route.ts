"use server"

import db from "@/db/drizzle";
import {
  quiz_answer_question,
  QuizSchema,
} from "@/db/schema/quiz-schema";
import { and, asc, eq } from "drizzle-orm";
import { requireApiAccess } from "@/lib/auth/api-access";

export async function GET(
  request: Request,
  params: { params: Promise<{ quiz_id: string }> }
) {
  const access = await requireApiAccess(request);
  if (access.response) return access.response;
  const { quiz_id } = await params.params;

  // Get user_id from query string (?user_id=...)
  const { searchParams } = new URL(request.url);
  const user_id = searchParams.get("user_id");
  if (user_id && user_id !== access.session.user.id && access.session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  if (!quiz_id || !user_id) {
    return new Response("Quiz ID and User ID are required", { status: 400 });
  }

  const answers = await db
    .select()
    .from(QuizSchema)
    .leftJoin(
      quiz_answer_question,
      eq(quiz_answer_question.quiz_id, QuizSchema.id)
    )
    .where(and(eq(QuizSchema.id, quiz_id), eq(quiz_answer_question.user_id, user_id)))
    .orderBy(asc(quiz_answer_question.answered_at));

  // Group by attempt
  const attemptsMap = new Map<
    number,
    { answers: (typeof quiz_answer_question.$inferSelect)[] }
  >();
  for (const row of answers) {
    const answer = row.quiz_answer_question;
    if (!answer) continue;
    const attemptNum = answer.attempt ?? 1;
    if (!attemptsMap.has(attemptNum)) {
      attemptsMap.set(attemptNum, { answers: [] });
    }
    attemptsMap.get(attemptNum)!.answers.push(answer);
  }

  // Build result: [{ attempt, score, time_took }]
  const result = Array.from(attemptsMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([attempt, { answers }]) => ({
      attempt,
      score: answers.filter(a => a.is_correct).length,
    }));

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}
