import db from "@/db/drizzle";
import {
  learningResource,
  learningResourceModule,
  learningResourceProgress,
} from "@/db/schema/learning-resources";
import { file as FileSchema } from "@/db/schema/file-schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { user } from "@/db/schema/auth-schema";
import { requireApiAccess } from "@/lib/auth/api-access";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ resource_id: string }> }
) {
  const access = await requireApiAccess(request);
  if (access.response) return access.response;
  const { resource_id } = await params;

  if (!resource_id) {
    return new Response("Resource ID is required", { status: 400 });
  }

  const body = await request.json();
  const userId = body.userId || access.session.user.id;
  if (userId !== access.session.user.id && access.session.user.role !== "admin") {
    return NextResponse.json({ error: "Cannot read another user's progress" }, { status: 403 });
  }

  return readLesson(resource_id, userId, access.session.user.role);
}

/** Public content read; progress can only belong to the verified current actor. */
export async function GET(request: Request, { params }: { params: Promise<{ resource_id: string }> }) {
  const access = await requireApiAccess(request, { allowGuest: true });
  if (access.response) return access.response;
  const { resource_id } = await params;
  return readLesson(resource_id, access.session?.user.id, access.session?.user.role);
}

function isDatabaseUnconfigured(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 4) return false;
  const { message, cause } = error as { message?: unknown; cause?: unknown };
  if (typeof message === "string" && message.includes("DATABASE_URL is required for database access.")) {
    return true;
  }
  return isDatabaseUnconfigured(cause, depth + 1);
}

async function readLesson(resource_id: string, userId?: string, role?: string | null) {
  try {
    return await queryLesson(resource_id, userId, role);
  } catch (error) {
    if (isDatabaseUnconfigured(error)) return NextResponse.json({ message: "Lesson not found" }, { status: 404 });
    return NextResponse.json({ message: "Failed to fetch lesson" }, { status: 500 });
  }
}

async function queryLesson(resource_id: string, userId?: string, role?: string | null) {

  // Query the lesson with the joined modules and their files.
  const rows = await db
    .select()
    .from(learningResource)
    .where(role === "admin"
      ? eq(learningResource.id, resource_id)
      : and(eq(learningResource.id, resource_id), eq(learningResource.is_visible, true)))
    .leftJoin(
      learningResourceModule,
      eq(learningResource.id, learningResourceModule.learning_resource_id)
    )
    .leftJoin(FileSchema, eq(learningResourceModule.module_id, FileSchema.id));

  if (rows.length === 0) {
    return NextResponse.json({ message: "Lesson not found" }, { status: 404 });
  }

  // Get the lesson and user info from the first row
  const lessonRow = rows[0].learning_resource;
  const userInfo = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(user.id, lessonRow.created_by))
    .then((u) => u[0] || null);

  // Build modules array (resolve files, etc.)
  const modules = await Promise.all(
    rows
      .filter((row) => row.learning_resource_module)
      .map(async (row) => {
        let is_finished = false;
        if (userId && row.learning_resource_module) {
          const progress = await db
            .select()
            .from(learningResourceProgress)
            .where(
              and(
                eq(learningResourceProgress.user_id, userId),
                eq(
                  learningResourceProgress.learning_resource_module_id,
                  row.learning_resource_module.id!
                )
              )
            );
          is_finished = progress.length > 0;
        }
        return {
          ...row.learning_resource_module,
          file: row.file || null,
          is_finished,
        };
      })
  );

  const lesson = {
    learning_resource: { ...lessonRow, created_by: userInfo },
    learning_resource_module: modules,
  };

  return NextResponse.json(lesson, {
    status: 200,
});
}
