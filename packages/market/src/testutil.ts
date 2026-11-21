import { readFileSync } from "node:fs";

export function fixture(name: string): string {
  return readFileSync(new URL(`../tests/fixtures/${name}`, import.meta.url), "utf8");
}

export interface FakeFetch {
  (url: string): Promise<Response>;
  calls: string[];
}

/** Counting fake fetch. `route` returns [status, body] for a URL. */
export function fakeFetch(route: (url: string) => [number, string]): FakeFetch {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    const [status, body] = route(url);
    return new Response(body, { status });
  };
  return Object.assign(fn, { calls });
}

export const NOW = () => new Date("2026-11-21T12:00:00.000Z");
