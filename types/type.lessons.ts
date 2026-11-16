import { learningResource, learningResourceModule, learningResourceProgress } from "@/db/schema/learning-resources"
import type { file } from "@/db/schema/file-schema";

export type LearningResource = typeof learningResource.$inferSelect;
export type LearningResourceModule = typeof learningResourceModule.$inferSelect;
export type LearningResourceProgress = typeof learningResourceProgress.$inferSelect;
export type LastLessonProgress = LearningResourceProgress & {
  moduleName: string | null;
  lessonTitle: string | null;
};

export type LearningModuleDetails = LearningResourceModule & {
  file?: (typeof file.$inferSelect)[] | null;
};

export type LessonDetails = {
  learning_resource: LearningResource;
  learning_resource_module: (LearningResourceModule & {
    is_finished: boolean;
    file: typeof file.$inferSelect | null;
  })[];
};
