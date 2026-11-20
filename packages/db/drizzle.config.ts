import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { directDatabaseUrl } from "./src/env.ts";

// `.env.local` (written by `neon env pull`) overrides `.env`.
config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/migrations",
  // Migrations must use the DIRECT (non-pooled) Neon connection.
  dbCredentials: { url: directDatabaseUrl() },
  strict: true,
});
