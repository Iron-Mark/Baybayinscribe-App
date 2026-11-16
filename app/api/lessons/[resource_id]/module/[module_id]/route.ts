import { useModuleStore } from "@/app/store/server/server.store.modules";
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";
import { findReadableLesson, findLessonModule } from "@/lib/auth/lesson-access";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  params: { params: Promise<{ resource_id: string; module_id: string }> }
) {
  const access = await requireApiAccess(request, { allowGuest: true });
  if (access.response) return access.response;
  const { resource_id, module_id } = await params.params;
  if (!await findReadableLesson(resource_id, access.session?.user ?? {}) ||
      !await findLessonModule(resource_id, module_id, true)) {
    return NextResponse.json({ error: "Module not found" }, { status: 404 });
  }
  const result = await useModuleStore
    .getState()
    .getModule(resource_id, module_id);

  return NextResponse.json(result, { status: 200 });
}
