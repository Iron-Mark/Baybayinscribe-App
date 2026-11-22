import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";
import { pool } from "@/db/drizzle";

export async function PUT(req: NextRequest) {
  try {
    const access = await requireApiAccess(req);
    if (access.response) return access.response;
    const userId = access.session.user.id;

    const body = await req.json();
    const {
      firstName,
      lastName,
      username,
      contactNumber,
      dateOfBirth,
      email,
      profilePictureUrl
    } = body;

    if (email !== undefined &&
        (typeof email !== "string" || email.trim().toLowerCase() !== access.session.user.email.toLowerCase())) {
      return NextResponse.json({ error: "Email changes require confirmation through the email-change flow." }, { status: 409 });
    }

    if (
      !username || username.length > 30 ||
      !firstName || firstName.length > 30 ||
      !lastName || lastName.length > 30 ||
      (contactNumber && !/^\d{11}$/.test(contactNumber))
    ) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    try {
      // Check if username is taken by another user
      const existingResult = await pool.query(
        `SELECT * FROM "user_information" WHERE username = $1 AND user_id != $2`,
        [username, userId]
      );

      if (existingResult.rows.length > 0) {
        return NextResponse.json({ error: "Username already taken" }, { status: 409 });
      }

      // Update user information
      await pool.query(
        `UPDATE "user_information" 
         SET username = $1, 
             first_name = $2, 
             last_name = $3, 
             contact_number = $4, 
             date_of_birth = $5,
             profile_picture_url = $6,
             updated_at = NOW() 
         WHERE user_id = $7`,
        [username, firstName, lastName, contactNumber, dateOfBirth, profilePictureUrl, userId]
      );

      return NextResponse.json({ success: true });
    } catch (dbError) {
      console.error("Database error:", dbError);
      return NextResponse.json({ error: "Database operation failed" }, { status: 500 });
    }
  } catch (error) {
    console.error("Error updating user information:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
