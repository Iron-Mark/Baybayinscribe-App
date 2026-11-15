import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";

export async function POST(request: Request) {
  const access = await requireApiAccess(request);
  if (access.response) return access.response;
  return NextResponse.json({ error: "Translation is not configured" }, { status: 501 });
}
