/**
 * Split filing section text into overlapping, paragraph-aligned chunks while
 * keeping exact character offsets back into the section text, so every
 * retrieved chunk can be cited as a span.
 */
export interface Chunk {
  ordinal: number;
  text: string;
  /** Offsets into the original section text: text === section.slice(charStart, charEnd). */
  charStart: number;
  charEnd: number;
  tokenCount: number;
}

export interface ChunkOptions {
  /** Target chunk size in (estimated) tokens. */
  maxTokens?: number;
  /** Overlap between consecutive chunks in (estimated) tokens. */
  overlapTokens?: number;
}

/** Rough token estimate (≈4 chars/token for English prose) — good enough for sizing. */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 4);

interface Piece {
  start: number;
  end: number;
}

/** Paragraph boundaries (blank lines), falling back to sentences for very long paragraphs. */
function pieces(text: string, maxChars: number): Piece[] {
  const out: Piece[] = [];
  const para = /\S[\s\S]*?(?=\n\s*\n|$)/g;
  for (const m of text.matchAll(para)) {
    const start = m.index ?? 0;
    const end = start + m[0].trimEnd().length;
    if (end - start <= maxChars) {
      out.push({ start, end });
      continue;
    }
    // Split oversized paragraph on sentence ends, then hard-wrap as last resort.
    let s = start;
    const sentence = /[.!?]["')\]]?\s+/g;
    sentence.lastIndex = start;
    let cut = start;
    for (let mm = sentence.exec(text); mm && mm.index < end; mm = sentence.exec(text)) {
      const next = mm.index + mm[0].length;
      if (next - s > maxChars && cut > s) {
        out.push({ start: s, end: cut });
        s = cut;
      }
      cut = next;
    }
    while (end - s > maxChars) {
      out.push({ start: s, end: s + maxChars });
      s += maxChars;
    }
    if (end > s) out.push({ start: s, end });
  }
  return out;
}

export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = (opts.maxTokens ?? 512) * 4;
  const overlapChars = (opts.overlapTokens ?? 64) * 4;
  const ps = pieces(text, maxChars);
  const chunks: Chunk[] = [];
  let i = 0;
  while (i < ps.length) {
    const first = ps[i] as Piece;
    let j = i;
    while (j + 1 < ps.length && (ps[j + 1] as Piece).end - first.start <= maxChars) j++;
    const charStart = first.start;
    const charEnd = (ps[j] as Piece).end;
    const slice = text.slice(charStart, charEnd);
    chunks.push({
      ordinal: chunks.length,
      text: slice,
      charStart,
      charEnd,
      tokenCount: estimateTokens(slice),
    });
    if (j + 1 >= ps.length) break;
    // Next chunk starts at the earliest piece that keeps ≤ overlapChars of overlap.
    let k = j + 1;
    while (k - 1 > i && charEnd - (ps[k - 1] as Piece).start <= overlapChars) k--;
    i = k;
  }
  return chunks;
}
