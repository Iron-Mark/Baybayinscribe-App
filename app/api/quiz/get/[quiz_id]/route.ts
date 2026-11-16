"use server";

import { NextResponse } from "next/server";
import db from "@/db/drizzle";
import {
  QuizSchema,
  metadata,
  quiz_question,
} from "@/db/schema/quiz-schema";
import { eq } from "drizzle-orm";
import { requireApiAccess } from "@/lib/auth/api-access";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ quiz_id: string }> }
) {
  const access = await requireApiAccess(request, { allowGuest: true });
  if (access.response) return access.response;
  const { quiz_id } = await params;
  // Query quiz by id
  const quizRecords = await db
    .select()
    .from(QuizSchema)
    .where(eq(QuizSchema.id, quiz_id))
    .limit(1);
  if (!quizRecords || !quizRecords.length) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }
  const quiz = quizRecords[0];

  const metadataRecords = await db.select().from(metadata).where(eq(metadata.quiz_id, quiz_id)).limit(1);
  const meta = metadataRecords.length ? metadataRecords[0] : null;
  if (!meta || (!meta.is_public && (!access.session ||
      (access.session.user.role !== "admin" && quiz.created_by !== access.session.user.id)))) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }
  // Gameplay currently uses question answers locally; private quizzes must not reach this query.
  const questions = await db.select().from(quiz_question).where(eq(quiz_question.quiz_id, quiz_id));

  return NextResponse.json({
    quiz,
    metadata: meta,
    questions,
  });
}
