import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireUser } from "./auth.ts";
import { errorMiddleware } from "./errors.ts";
import { ISSUER, listen, makeKeys } from "./test-helpers.ts";

let sign: Awaited<ReturnType<typeof makeKeys>>["sign"];
let srv: Awaited<ReturnType<typeof listen>>;

beforeAll(async () => {
  const keys = await makeKeys();
  sign = keys.sign;
  const app = express();
  app.get("/me", requireUser({ jwks: keys.jwks, issuer: ISSUER }), (req, res) => {
    res.json(req.user);
  });
  app.get("/sse", requireUser({ jwks: keys.jwks, issuer: ISSUER }, { allowQueryToken: true }), (req, res) => {
    res.json(req.user);
  });
  app.get("/boom", () => {
    throw new Error("secret stack detail");
  });
  app.use(errorMiddleware);
  srv = await listen(app);
});
afterAll(() => srv.close());

const get = (path: string, token?: string) =>
  fetch(srv.url + path, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

async function expect401(res: Response) {
  expect(res.status).toBe(401);
  const body = (await res.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe("unauthorized");
}

describe("requireUser", () => {
  it("rejects a missing token", async () => expect401(await get("/me")));
  it("rejects a malformed token", async () => expect401(await get("/me", "not-a-jwt")));
  it("rejects a non-Bearer scheme", async () => {
    await expect401(await fetch(`${srv.url}/me`, { headers: { Authorization: "Basic abc" } }));
  });
  it("rejects an expired token", async () => {
    const t = await sign("u1", { exp: Math.floor(Date.now() / 1000) - 60 });
    await expect401(await get("/me", t));
  });
  it("rejects a token signed by another key", async () => {
    await expect401(await get("/me", await sign("u1", { key: "other" })));
  });
  it("rejects the wrong issuer", async () => {
    await expect401(await get("/me", await sign("u1", { iss: "https://evil.example.test" })));
  });
  it("accepts a token with no issuer claim", async () => {
    const res = await get("/me", await sign("u1", { iss: null }));
    expect(res.status).toBe(200);
  });
  it("accepts a valid token and sets req.user", async () => {
    const res = await get("/me", await sign("user-1", { email: "a@b.test" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "user-1", email: "a@b.test" });
  });
  it("accepts ?access_token only where allowed", async () => {
    const t = await sign("user-2");
    expect((await fetch(`${srv.url}/sse?access_token=${t}`)).status).toBe(200);
    await expect401(await fetch(`${srv.url}/me?access_token=${t}`));
  });
});

describe("error middleware", () => {
  it("returns a typed 500 without leaking details", async () => {
    const res = await fetch(`${srv.url}/boom`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "internal_error", message: "internal server error" } });
  });
});
