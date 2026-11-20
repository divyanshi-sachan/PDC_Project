/**
 * `pnpm cli auth smoke [--email you+test@example.com]`
 * End-to-end proof against the real Neon Managed Auth branch:
 *   sign up → current user → sign out → (no session) → sign in → current user → row in neon_auth.
 * Never prints passwords, tokens or cookies.
 */
import { randomBytes } from "node:crypto";
import { cookieJarContext, createDealpilotAuth } from "@dealpilot/auth";
import { createDb, sql } from "@dealpilot/db";

const ORIGIN = "http://localhost:3000"; // localhost origins are pre-trusted by Neon Auth

function userLine(u: {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: Date | string;
}) {
  return `id=${u.id} email=${u.email} name="${u.name}" verified=${u.emailVerified} created=${new Date(u.createdAt).toISOString()}`;
}

export async function authSmoke(emailArg?: string) {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  if (!baseUrl) throw new Error("NEON_AUTH_BASE_URL missing — run `neon env pull`");
  // CLI-only: the session_data cookie lives in this process, so an ephemeral secret is fine.
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET ?? randomBytes(32).toString("base64");

  const { ctx, jar } = cookieJarContext(ORIGIN);
  const auth = createDealpilotAuth({ baseUrl, cookieSecret, context: () => ctx });

  const email = emailArg ?? `dealpilot.smoke+${Date.now()}@example.com`;
  const password = randomBytes(18).toString("base64url"); // never printed
  const step = (s: string) => console.log(`\n▶ ${s}`);

  step(`signUp.email (${email})`);
  const up = await auth.signUp.email({ email, password, name: "DealPilot Smoke Test" });
  if (up.error)
    throw new Error(`sign-up failed: ${up.error.status ?? ""} ${up.error.message ?? up.error.code}`);
  console.log(`  ok · session cookies set: ${jar.size}`);

  step("getSession (current user)");
  const s1 = await auth.getSession();
  if (!s1.data?.user) throw new Error(`no session after sign-up: ${JSON.stringify(s1.error)}`);
  console.log(`  ${userLine(s1.data.user)}`);

  step("signOut → getSession should be empty");
  const out = await auth.signOut();
  if (out.error) throw new Error(`sign-out failed: ${out.error.message}`);
  jar.clear();
  const s2 = await auth.getSession();
  console.log(`  session after sign-out: ${s2.data?.user ? "STILL PRESENT ✗" : "none ✓"}`);
  if (s2.data?.user) throw new Error("session survived sign-out");

  step("signIn.email with wrong password → rejected");
  const bad = await auth.signIn.email({ email, password: `${password}x` });
  console.log(
    `  rejected: ${bad.error ? `✓ (${bad.error.status} ${bad.error.code ?? bad.error.message})` : "NO ✗"}`,
  );
  if (!bad.error) throw new Error("wrong password was accepted");

  step("signIn.email → getSession");
  const inn = await auth.signIn.email({ email, password });
  if (inn.error) throw new Error(`sign-in failed: ${inn.error.message}`);
  const s3 = await auth.getSession();
  if (s3.data?.user?.id !== s1.data.user.id) throw new Error("signed-in user differs from signed-up user");
  console.log(`  ${userLine(s3.data.user)}`);

  if (process.env.DATABASE_URL) {
    step("row in neon_auth schema (Postgres)");
    const { db, close } = createDb(process.env.DATABASE_URL, { max: 1 });
    try {
      const rows = await db.execute<{ id: string; email: string }>(
        sql`select id, email from neon_auth."user" where email = ${email}`,
      );
      console.log(
        `  neon_auth.user rows for ${email}: ${rows.length}${rows[0] ? ` (id=${rows[0].id})` : ""}`,
      );
    } finally {
      await close();
    }
  }
  console.log("\n✔ Neon Auth email/password flow works end to end");
}
