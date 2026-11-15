import { useServerLrStore } from "@/app/store/server/server.store.lr";
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";

export async function POST(request: Request) {
  try {
    const access = await requireApiAccess(request, { admin: true });
    if (access.response) return access.response;
    const body = await request.json();
    const title = body.title?.toString();
    const description = body.description?.toString();
    const created_by = access.session.user.id;
    const is_visible = !!body.is_visible;

    if (!title || !description) {
      return new Response(
        JSON.stringify({ error: "Title and description are required" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    const lessonsState = useServerLrStore.getState();
    const lesson = await lessonsState.createLesson(title, description, created_by, is_visible);

    console.log("Lesson created:", lesson);

    return NextResponse.json(lesson, { status: 201 });
  } catch (error) {
    console.error("Error creating lesson:", error);
    return new Response(JSON.stringify({ error: "Failed to create lesson" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
