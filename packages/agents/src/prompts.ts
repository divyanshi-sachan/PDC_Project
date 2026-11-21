import { readFileSync } from "node:fs";

const cache = new Map<string, string>();

/**
 * Load a versioned prompt from `src/prompts/<name>.md`. Prompts are never edited after evals have run:
 * add a new version (v2) instead so eval runs stay comparable.
 */
export function loadPrompt(name: string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const text = readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf8").trim();
  cache.set(name, text);
  return text;
}
