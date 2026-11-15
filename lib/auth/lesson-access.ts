import db from "@/db/drizzle";
import { learningResource, learningResourceModule } from "@/db/schema/learning-resources";
import { and, eq } from "drizzle-orm";

/** Hidden lessons are available only to administrators, never through learner reads. */
export async function findReadableLesson(resourceId: string, viewer: { role?: string | null }) {
  const lessons = await db.select().from(learningResource).where(
    viewer.role === "admin"
      ? eq(learningResource.id, resourceId)
      : and(eq(learningResource.id, resourceId), eq(learningResource.is_visible, true))
  ).limit(1);
  return lessons[0] ?? null;
}

/** The viewing URL uses the file ID; mutations and progress use the module row ID. */
export async function findLessonModule(resourceId: string, moduleId: string, byFileId = false) {
  const modules = await db.select().from(learningResourceModule).where(and(
    eq(learningResourceModule.learning_resource_id, resourceId),
    eq(byFileId ? learningResourceModule.module_id : learningResourceModule.id, moduleId),
  )).limit(1);
  return modules[0] ?? null;
}
