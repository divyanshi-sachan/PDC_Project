/**
 * Neon gives two connection strings for the same database:
 *  - pooled (`-pooler` host, PgBouncer transaction mode) → app query traffic (DATABASE_URL)
 *  - direct (no `-pooler`)                               → migrations, pg_dump, LISTEN/NOTIFY, session state
 * `neon env pull` writes DATABASE_URL_UNPOOLED; when it's absent we derive it by dropping `-pooler`.
 */
export function directDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_URL_UNPOOLED) return env.DATABASE_URL_UNPOOLED;
  const raw = env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set (see .env.example)");
  const url = new URL(raw);
  url.hostname = url.hostname.replace("-pooler.", ".");
  return url.toString();
}

export function pooledDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set (see .env.example)");
  return env.DATABASE_URL;
}
