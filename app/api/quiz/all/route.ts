import { NextResponse } from "next/server";
import db from "@/db/drizzle";
import { metadata, quiz_question, QuizSchema } from "@/db/schema/quiz-schema";
import { eq } from "drizzle-orm";
import { requireApiAccess } from "@/lib/auth/api-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const access = await requireApiAccess(request, { allowGuest: true });
    if (access.response) return access.response;
    const quizData = await db
      .select({
        metadata: metadata,  
        questionCount: db.$count(db.select().from(quiz_question).where(eq(quiz_question.quiz_id, QuizSchema.id))),
      })
      .from(QuizSchema)
      .leftJoin(metadata, eq(QuizSchema.id, metadata.quiz_id))
      .where(access.session?.user.role === "admin" ? undefined : eq(metadata.is_public, true))
      .groupBy(QuizSchema.id, metadata.quiz_id); 

    return NextResponse.json(quizData, { status: 200 });
  } catch (error) {
    console.error("Error fetching quiz data:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch quiz data" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
}
