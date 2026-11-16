import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";

export async function GET(req: NextRequest) {
  try {
    const access = await requireApiAccess(req);
    if (access.response) return access.response;

    return NextResponse.json({ 
      isAdmin: access.session.user.role === "admin"
    });
  } catch (error) {
    console.error("Error verifying session:", error);
    return NextResponse.json({ isAdmin: false }, { status: 401 });
  }
}
