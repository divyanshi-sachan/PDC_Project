/**
 * DealPilot auth = Neon Managed Better Auth via the framework-agnostic
 * `@neon/auth/server` toolkit. Neon hosts the auth server (users/sessions live
 * in the `neon_auth` schema) — we never run `betterAuth()` or auth migrations.
 *
 * Two request contexts:
 *  - Express: `authContextMiddleware()` binds each req/res via AsyncLocalStorage.
 *  - Scripts/CLI/tests: `cookieJarContext()` keeps cookies in memory.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  type CookieOptions,
  createAuthServer,
  extractNeonAuthCookies,
  type NeonAuthServer,
  type RequestContext,
} from "@neon/auth/server";

export type { NeonAuthServer };

export interface AuthEnv {
  /** Branch Managed Auth URL (includes path). Written by `neon deploy` / `neon env pull`. */
  NEON_AUTH_BASE_URL?: string | undefined;
  /** ≥32 chars, app-owned (not injected by Neon). `openssl rand -base64 32`. */
  NEON_AUTH_COOKIE_SECRET?: string | undefined;
}

export function authConfigFromEnv(env: AuthEnv = process.env) {
  if (!env.NEON_AUTH_BASE_URL) throw new Error("NEON_AUTH_BASE_URL is not set — run `neon env pull`");
  if (!env.NEON_AUTH_COOKIE_SECRET || env.NEON_AUTH_COOKIE_SECRET.length < 32) {
    throw new Error("NEON_AUTH_COOKIE_SECRET must be set (≥32 chars): `openssl rand -base64 32`");
  }
  return { baseUrl: env.NEON_AUTH_BASE_URL, cookieSecret: env.NEON_AUTH_COOKIE_SECRET };
}

// ---------------------------------------------------------------- cookie jar

/** In-memory cookie jar context for non-HTTP callers (CLI, tests). */
export function cookieJarContext(origin: string) {
  const jar = new Map<string, string>();
  const ctx: RequestContext = {
    getCookies: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    setCookie: (name: string, value: string, options?: CookieOptions) => {
      if (options?.maxAge === 0 || value === "") jar.delete(name);
      else jar.set(name, value);
    },
    getHeader: (name: string) => (name.toLowerCase() === "origin" ? origin : null),
    getOrigin: () => origin,
    getFramework: () => "dealpilot-cli",
  } as RequestContext;
  return { ctx, jar };
}

// ---------------------------------------------------------------- express

/** Minimal structural types so this package doesn't depend on Express. */
export interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
}
export interface HttpRes {
  append(field: string, value: string): unknown;
}

const als = new AsyncLocalStorage<{ req: HttpReq; res: HttpRes }>();

function serializeCookie(name: string, value: string, o: CookieOptions = {}): string {
  const parts = [`${name}=${value}`, `Path=${o.path ?? "/"}`];
  if (o.maxAge !== undefined) parts.push(`Max-Age=${o.maxAge}`);
  if (o.expires) parts.push(`Expires=${o.expires.toUTCString()}`);
  if (o.domain) parts.push(`Domain=${o.domain}`);
  if (o.httpOnly !== false) parts.push("HttpOnly");
  if (o.secure) parts.push("Secure");
  if (o.sameSite) parts.push(`SameSite=${o.sameSite[0]?.toUpperCase()}${o.sameSite.slice(1)}`);
  if (o.partitioned) parts.push("Partitioned");
  return parts.join("; ");
}

const header = (req: HttpReq, name: string): string | null => {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
};

/** RequestContext backed by the Express request currently in AsyncLocalStorage. */
export const expressContext = (): RequestContext => {
  const store = als.getStore();
  if (!store) throw new Error("auth used outside authContextMiddleware()");
  const { req, res } = store;
  return {
    getCookies: () => extractNeonAuthCookies(new Headers({ cookie: header(req, "cookie") ?? "" })),
    setCookie: (name: string, value: string, options?: CookieOptions) =>
      res.append("Set-Cookie", serializeCookie(name, value, options)),
    getHeader: (name: string) => header(req, name),
    getOrigin: () => header(req, "origin") ?? "",
    getFramework: () => "express",
  } as RequestContext;
};

/** Express middleware: `app.use(authContextMiddleware())` before any route that uses `auth`. */
export const authContextMiddleware =
  () =>
  (req: HttpReq, res: HttpRes, next: () => void): void => {
    als.run({ req, res }, next);
  };

// ---------------------------------------------------------------- factory

export function createDealpilotAuth(opts: {
  baseUrl: string;
  cookieSecret: string;
  context: () => RequestContext;
}): NeonAuthServer {
  return createAuthServer({
    baseUrl: opts.baseUrl,
    cookieSecret: opts.cookieSecret,
    context: opts.context,
    sameSite: "lax",
  });
}
