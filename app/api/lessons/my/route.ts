import db from "@/db/drizzle";
import {
    learningResource,
    learningResourceModule
} from "@/db/schema/learning-resources";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";

export async function POST(request: Request) {
  const access = await requireApiAccess(request);
  if (access.response) return access.response;
  const { userId } = await request.json();

  if (userId && userId !== access.session.user.id) {
    return NextResponse.json({ error: "Cannot read another user's lessons" }, { status: 403 });
  }

  if (!userId) {
    return NextResponse.json(
      { error: "User ID is required." },
      { status: 400 }
    );
  }

  const userLessons = await db
    .select()
    .from(learningResource)
    .where(access.session.user.role === "admin"
      ? eq(learningResource.created_by, access.session.user.id)
      : and(eq(learningResource.created_by, access.session.user.id), eq(learningResource.is_visible, true)));

  // For each lesson, fetch its modules and attach under "modules"
  const lessonsWithModules = await Promise.all(
    userLessons.map(async (lesson) => {
      const lessonId = lesson.id;
      const modules = await db
        .select()
        .from(learningResourceModule)
        .where(eq(learningResourceModule.learning_resource_id, lessonId));
      return {
        ...lesson,
        modules,
      };
    })
  );

  if (lessonsWithModules.length === 0) {
    return NextResponse.json(
      { message: "No lessons found for this user." },
    );
  }

  return NextResponse.json(lessonsWithModules, { status: 200 });
}
