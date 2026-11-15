import db from "@/db/drizzle";
import { metadata, QuizSchema, quiz_answer_question, quiz_question } from "@/db/schema/quiz-schema";
import { eq, desc, and } from "drizzle-orm";
import { requireApiAccess } from "@/lib/auth/api-access";

type SubmittedAnswer = {
  quiz_id: string;
  quiz_question_id: string;
  user_id?: string | null;
  user_answer: string | null;
};

function isSubmittedAnswer(value: unknown): value is SubmittedAnswer {
  return typeof value === "object" && value !== null &&
    "quiz_id" in value && typeof value.quiz_id === "string" && value.quiz_id.length > 0 &&
    "quiz_question_id" in value && typeof value.quiz_question_id === "string" && value.quiz_question_id.length > 0 &&
    (!("user_id" in value) || value.user_id === null || typeof value.user_id === "string") &&
    "user_answer" in value && (typeof value.user_answer === "string" || value.user_answer === null);
}

/** Match existing gameplay rules using persisted questions, never client scores. */
function gradeAnswer(question: typeof quiz_question.$inferSelect, answer: string | null) {
  if (answer === null || answer === "Unanswered" || answer === "No detection") return false;
  if (question.type === "MCQ" || question.type === "multipleChoice") {
    const index = Number.parseInt(question.correct_answer ?? "0");
    return Number.isInteger(index) &&
      Array.isArray(question.options) && typeof question.options[index] === "string" &&
      answer === question.options[index];
  }
  if (question.type === "IDT" || question.type === "quiz" || question.type === "identification") {
    const normalize = (value: string) => value.trim().toLowerCase().replaceAll(" ", "");
    return question.correct_answer !== null && normalize(answer) === normalize(question.correct_answer);
  }
  if (question.type === "SKT" || question.type === "sketch") {
    return question.character !== null && answer === question.character;
  }
  return false;
}

export async function POST(request: Request) {
  const access = await requireApiAccess(request);
  if (access.response) return access.response;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("answers" in body) ||
        !Array.isArray(body.answers) || body.answers.length === 0 || body.answers.length > 500 ||
        !body.answers.every(isSubmittedAnswer)) {
      return new Response("Invalid input", { status: 400 });
    }
    const answers = body.answers;
    const userId = access.session.user.id;
    // Even an administrator submits an attempt only as the authenticated user.
    if (("user_id" in body && body.user_id != null && body.user_id !== userId) ||
        answers.some((answer) => answer.user_id != null && answer.user_id !== userId)) {
      return new Response("Forbidden", { status: 403 });
    }
    const quizId = answers[0].quiz_id;
    if (answers.some((answer) => answer.quiz_id !== quizId) ||
        new Set(answers.map((answer) => answer.quiz_question_id)).size !== answers.length) {
      return new Response("Answers must reference distinct questions in one quiz", { status: 400 });
    }
    const [quiz] = await db.select().from(QuizSchema).where(eq(QuizSchema.id, quizId)).limit(1);
    const [meta] = await db.select().from(metadata).where(eq(metadata.quiz_id, quizId)).limit(1);
    if (!quiz || !meta || (!meta.is_public && access.session.user.role !== "admin" && quiz.created_by !== userId)) {
      return new Response("Quiz not found", { status: 404 });
    }
    const questions = await db.select().from(quiz_question).where(eq(quiz_question.quiz_id, quizId));
    const questionsById = new Map(questions.map((question) => [question.id, question]));
    if (answers.some((answer) => !questionsById.has(answer.quiz_question_id))) {
      return new Response("Question does not belong to this quiz", { status: 400 });
    }
    // A history query failure must not silently invent attempt 1.
    const latest = await db.select({ attempt: quiz_answer_question.attempt })
      .from(quiz_answer_question)
      .where(and(eq(quiz_answer_question.quiz_id, quizId), eq(quiz_answer_question.user_id, userId)))
      .orderBy(desc(quiz_answer_question.attempt)).limit(1);
    const nextAttempt = (latest[0]?.attempt ?? 0) + 1;
    const processedAnswers = answers.map((answer) => ({
      attempt: nextAttempt,
      quiz_id: quizId,
      quiz_question_id: answer.quiz_question_id,
      user_id: userId,
      user_answer: answer.user_answer,
      is_correct: gradeAnswer(questionsById.get(answer.quiz_question_id)!, answer.user_answer),
      answered_at: new Date().toISOString(),
    }));
    await db.insert(quiz_answer_question).values(processedAnswers);
    return new Response("Answers saved successfully", { status: 200 });
  } catch (error) {
    console.error("Error saving quiz answers:", error);
    return new Response("Unable to save answers", { status: 500 });
  }
}
