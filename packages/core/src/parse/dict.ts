import type { DataSet } from '../../../data/src/types.ts';
import { applyTextEdits, normalizeWithOffsets } from '../normalize/index.ts';

export interface Match {
  foodId: string;
  foodName: string;
  span: string;
  start: number;
  end: number;
}

interface Entry { key: string; foodId: string; foodName: string }
export interface Dict { entries: ReadonlyArray<Readonly<Entry>> }
const cache = new WeakMap<DataSet, Dict>();

function compact(text: string) {
  const source = normalizeWithOffsets(text);
  const edits = Array.from(source.text.matchAll(/\s+/gu), match => ({
    start: match.index, end: match.index + match[0].length, value: '',
  }));
  const result = applyTextEdits(source, edits);
  // 英文大小写折叠不改变字符长度，原文偏移仍可直接使用。
  return { ...result, text: result.text.replace(/[A-Z]/gu, character => character.toLowerCase()) };
}

export function buildDict(data: DataSet): Dict {
  const cached = cache.get(data);
  if (cached) return cached;
  const entries = new Map<string, Entry>();
  for (const dish of data.dishes) {
    for (const name of [dish.name, ...dish.aliases]) {
      const key = compact(name).text;
      if (key.length === 0) throw new Error(`${dish.id}: 食物名称或别名不能为空`);
      const owner = entries.get(key);
      if (owner && owner.foodId !== dish.id) throw new Error(`别名冲突：「${name}」同时映射 ${owner.foodId} 和 ${dish.id}`);
      entries.set(key, { key, foodId: dish.id, foodName: dish.name });
    }
  }
  const dict = { entries: [...entries.values()].sort((left, right) => right.key.length - left.key.length) };
  cache.set(data, dict);
  return dict;
}

export function matchAll(text: string, dict: Dict): Match[] {
  const source = compact(text);
  const matches: Match[] = [];
  let cursor = 0;
  while (cursor < source.text.length) {
    const entry = dict.entries.find(candidate => source.text.startsWith(candidate.key, cursor));
    if (!entry) {
      cursor += 1;
      continue;
    }
    const first = source.offsets[cursor];
    const last = source.offsets[cursor + entry.key.length - 1];
    if (first && last) matches.push({
      foodId: entry.foodId, foodName: entry.foodName,
      span: text.slice(first.start, last.end), start: first.start, end: last.end,
    });
    cursor += entry.key.length;
  }
  return matches;
}
