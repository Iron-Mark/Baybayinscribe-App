import { del } from '@vercel/blob';
import { requireApiAccess } from '@/lib/auth/api-access';
import db from '@/db/drizzle';
import { userInformation } from '@/db/schema/auth-schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(req: NextRequest) {
  try {
    const access = await requireApiAccess(req);
    if (access.response) return access.response;
    const userId = access.session.user.id;

    // Get the current profile picture URL from the database
    const user = await db.select({ profilePictureUrl: userInformation.profilePictureUrl })
      .from(userInformation)
      .where(eq(userInformation.userId, userId))
      .limit(1);

    const currentProfilePictureUrl = user[0]?.profilePictureUrl;

    // If a profile picture exists, delete it from blob storage
    if (currentProfilePictureUrl) {
      let ownedBlob = false;
      try {
        const picture = new URL(currentProfilePictureUrl);
        ownedBlob = picture.protocol === 'https:' &&
          picture.hostname.endsWith('.public.blob.vercel-storage.com') &&
          picture.pathname.startsWith(`/profile-pictures/${userId}/`);
      } catch { /* Relative/default avatars are unlinked, never sent to Blob. */ }
      if (ownedBlob) await del(currentProfilePictureUrl);
    }

    // Update the database to set profilePictureUrl to null
    await db.update(userInformation)
      .set({
        profilePictureUrl: null,
      })
      .where(eq(userInformation.userId, userId));

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error deleting profile picture:', error);
    return NextResponse.json({ error: "Failed to delete profile picture" }, { status: 500 });
  }
}
