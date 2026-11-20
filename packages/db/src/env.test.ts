import { describe, expect, test } from "vitest";
import { directDatabaseUrl } from "./env.ts";

describe("directDatabaseUrl", () => {
  test("strips -pooler from a Neon pooled host", () => {
    const url = directDatabaseUrl({
      DATABASE_URL:
        "postgresql://u:p@ep-cool-name-123-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
    });
    expect(new URL(url).hostname).toBe("ep-cool-name-123.ap-southeast-1.aws.neon.tech");
    expect(new URL(url).searchParams.get("sslmode")).toBe("require");
  });

  test("prefers DATABASE_URL_UNPOOLED when present", () => {
    expect(
      directDatabaseUrl({ DATABASE_URL: "postgres://a/x", DATABASE_URL_UNPOOLED: "postgres://b/x" }),
    ).toBe("postgres://b/x");
  });

  test("leaves a non-pooled URL unchanged", () => {
    expect(new URL(directDatabaseUrl({ DATABASE_URL: "postgres://u:p@localhost:5432/db" })).hostname).toBe(
      "localhost",
    );
  });

  test("throws when unset", () => {
    expect(() => directDatabaseUrl({})).toThrow(/DATABASE_URL/);
  });
});
