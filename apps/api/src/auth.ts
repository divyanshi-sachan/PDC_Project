import type { RequestHandler } from "express";
import { type JWTVerifyGetKey, jwtVerify } from "jose";
import { ApiError } from "./errors.ts";

export interface AuthOptions {
  /** Key resolver. Production: `createRemoteJWKSet(new URL(NEON_AUTH_JWKS_URL))`; tests inject a local key. */
  jwks: JWTVerifyGetKey;
  /** Origin of NEON_AUTH_BASE_URL. If a token carries `iss` it must equal this. */
  issuer?: string | undefined;
}

const unauthorized = (message = "missing or invalid access token") =>
  new ApiError(401, "unauthorized", message);

const stripSlash = (s: string) => s.replace(/\/+$/, "");

/**
 * Verifies `Authorization: Bearer <jwt>` (Neon Auth EdDSA token) and sets `req.user`.
 *
 * `allowQueryToken` additionally accepts `?access_token=`. Use it ONLY on the SSE route: the browser
 * `EventSource` cannot set headers. Tradeoff: a token in a URL can leak into proxy/access logs, browser
 * history and Referer headers. Mitigations: tokens are short-lived (~15 min), the param is honoured on
 * that single route, responses send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and this
 * server never logs request URLs. Prefer a fetch-based SSE client with a header when possible.
 * Note the token is verified at connect time only; an open stream outlives the token's expiry.
 */
export function requireUser(opts: AuthOptions, { allowQueryToken = false } = {}): RequestHandler {
  return async (req, _res, next) => {
    let token: string | undefined;
    const h = req.headers.authorization;
    if (h !== undefined) {
      const m = /^Bearer\s+(\S+)$/i.exec(h);
      if (!m?.[1]) throw unauthorized();
      token = m[1];
    } else if (allowQueryToken && typeof req.query.access_token === "string") {
      token = req.query.access_token;
    }
    if (!token) throw unauthorized();
    try {
      const { payload } = await jwtVerify(token, opts.jwks, { algorithms: ["EdDSA"] });
      if (typeof payload.sub !== "string" || payload.sub === "") throw new Error("no sub");
      if (opts.issuer && payload.iss !== undefined && stripSlash(payload.iss) !== stripSlash(opts.issuer)) {
        throw new Error("wrong issuer");
      }
      req.user = {
        id: payload.sub,
        ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      };
    } catch {
      throw unauthorized();
    }
    next();
  };
}

/** Narrow `req.user` after `requireUser`. */
export function userOf(req: { user?: { id: string; email?: string } }): { id: string; email?: string } {
  if (!req.user) throw unauthorized();
  return req.user;
}
