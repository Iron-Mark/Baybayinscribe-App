import { betterAuth } from "better-auth";
import db from "../../db/drizzle";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { schema } from "../../db/schema/auth-schema";
import { sendEmail } from "./email";
import { admin } from "better-auth/plugins";
import { jwt } from "better-auth/plugins";
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx } from "better-auth/api";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: schema,
  }),
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
  trustedOrigins: [process.env.NEXT_PUBLIC_SITE_URL as string,],
  customPaths: {
    resetPassword: "/auth/register/resetpassword",
  },
  rateLimit: {
    enabled: true,
    customRules: {
      "/change-email": { window: 60 * 60, max: 5 },
      "/send-verification-email": { window: 60 * 60, max: 5 },
      "/verify-email": { window: 60 * 60, max: 15 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Better Auth otherwise logs/swallow mail-task errors even when awaiting.
      // Override only this request's email-verification task runner, not globally.
      const emailContext = { context: { context: {
        runInBackgroundOrAwait: async (task: Promise<unknown> | void) => { await task; },
      } } };
      if (ctx.path !== "/change-email") {
        if (ctx.path === "/verify-email" || ctx.path === "/send-verification-email") return emailContext;
        return;
      }
      // This also protects direct calls to Better Auth, not just our wrapper.
      const session = await getAuthoritativeSessionFromCtx(ctx);
      if (!session?.user) throw new APIError("UNAUTHORIZED", { message: "Sign in before changing email." });
      if ("banned" in session.user && session.user.banned === true) {
        throw new APIError("FORBIDDEN", { message: "Forbidden" });
      }
      if (!session.user.emailVerified) {
        throw new APIError("FORBIDDEN", { code: "CURRENT_EMAIL_UNVERIFIED", message: "Verify your current email before requesting an email change." });
      }
      const age = Date.now() - new Date(session.session.createdAt).getTime();
      if (!Number.isFinite(age) || age < 0 || age >= 15 * 60 * 1000) {
        throw new APIError("FORBIDDEN", { code: "SESSION_NOT_FRESH", message: "Sign in again before changing email." });
      }
      return emailContext;
    }),
  },
  user: {
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: false,
      sendChangeEmailConfirmation: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Confirm your email change",
          text: `If you requested an email change, confirm it here: ${url}\nIf you did not request this, do not follow the link.`,
        });
      },
    },
  },
  emailVerification: {
    expiresIn: 60 * 60,
    autoSignInAfterVerification: false,
    sendOnSignUp: false,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({ to: user.email, subject: "Verify your email address", text: `Verify this email address: ${url}` });
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, token }) => {
      const resetPasswordUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/auth/register/resetpassword?token=${token}`;
      await sendEmail({
        to: user.email,
        subject: "Reset your password",
        text: `Click the link to reset your password: ${resetPasswordUrl}`,
      });
    },
  },  socialProviders: {
    google: { 
      clientId: process.env.GOOGLE_CLIENT_ID as string, 
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
    facebook: {
      clientId: process.env.FACEBOOK_CLIENT_ID as string,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET as string,
    },
    // reddit: {
    //   clientId: process.env.REDDIT_CLIENT_ID as string,
    //   clientSecret: process.env.REDDIT_CLIENT_SECRET as string,
    //   redirectURI: `${process.env.NEXT_PUBLIC_BETTER_AUTH_URL}/callback/reddit`,
    //   scope: ["identity", "read"],
    //   mapProfileToUser: (profile) => {
    //     // Reddit doesn't provide email, so we create a unique email-like identifier
    //     // using the user's Reddit ID and name to ensure uniqueness
    //     const uniqueEmail = `reddit_${profile.id}@reddit.local`;
        
    //     return {
    //       email: uniqueEmail,
    //       emailVerified: false, // Reddit doesn't provide email verification
    //       name: profile.name || `reddit_user_${profile.id}`,
    //     };
    //   },
    // },
  },
  plugins: [
    jwt(),
    admin(),
  ],
});
