import { toHalfWidth } from './fullwidth.ts';

interface SourceRange { start: number; end: number }
interface Edit extends SourceRange { value: string }
export interface NormalizedText {
  text: string;
  raw: string;
  offsets: SourceRange[];
}

export function applyTextEdits(source: NormalizedText, edits: Edit[]): NormalizedText {
  const parts: string[] = [];
  const offsets: SourceRange[] = [];
  let cursor = 0;
  const copy = (start: number, end: number): void => {
    parts.push(source.text.slice(start, end));
    for (let index = start; index < end; index += 1) {
      const range = source.offsets[index];
      if (range) offsets.push(range);
    }
  };
  for (const edit of edits) {
    copy(cursor, edit.start);
    parts.push(edit.value);
    const first = source.offsets[edit.start];
    const last = source.offsets[edit.end - 1];
    if (first && last) {
      for (let index = 0; index < edit.value.length; index += 1) offsets.push({ start: first.start, end: last.end });
    }
    cursor = edit.end;
  }
  copy(cursor, source.text.length);
  return { text: parts.join(''), raw: source.raw, offsets };
}

export function normalizeWithOffsets(raw: string): NormalizedText {
  if (typeof raw !== 'string') return { text: '', raw: '', offsets: [] };
  let source: NormalizedText = {
    text: toHalfWidth(raw), raw,
    offsets: Array.from({ length: raw.length }, (_, start) => ({ start, end: start + 1 })),
  };
  const whitespaceEdits = Array.from(source.text.matchAll(/\s+/gu), match => ({
    start: match.index, end: match.index + match[0].length, value: ' ',
  }));
  source = applyTextEdits(source, whitespaceEdits);
  const start = source.text.length - source.text.trimStart().length;
  const end = source.text.trimEnd().length;
  return { text: source.text.slice(start, end), raw, offsets: source.offsets.slice(start, end) };
}

export function normalize(raw: string): string {
  return normalizeWithOffsets(raw).text;
}
