import { applyTextEdits, normalizeWithOffsets } from '../normalize/index.ts';
import type { NormalizedText } from '../normalize/index.ts';
import { normalizeCnNumbers } from '../normalize/cnnumber.ts';
import { PORTION_MULTIPLIERS } from '../normalize/portions.ts';
import { buildUnitAliases } from '../normalize/units.ts';
import type { UnitData } from '../normalize/units.ts';

export interface Segment {
  span: string;
  raw: string;
  qty: number | null;
  unit: string | null;
  // start / end 是输入的归一化文本下标，采用左闭右开区间。
  start: number;
  end: number;
  approx?: boolean;
  // 带数量的片段是否还含食物文字，供词典之后的区间处理判断。
  hasFood?: boolean;
}

const approximateWords = '差不多|大概|左右|约';
export function approximationSide(text: string): 'previous' | 'next' | null {
  const word = text.match(new RegExp(approximateWords, 'u'))?.[0];
  return word ? (word === '左右' ? 'previous' : 'next') : null;
}
function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

// 此入口只供词典未命中区间使用，数字菜名必须先被字典保护。
export function prepareRuleText(raw: string): NormalizedText {
  const source = normalizeWithOffsets(raw);
  const edits: Array<{ value: string; start: number; end: number }> = [];
  normalizeCnNumbers(source.text, (value, start, end) => edits.push({ value, start, end }));
  return applyTextEdits(source, edits);
}

export function extractSegments(
  normalized: string, data: UnitData, raw = normalized,
  options: { allowBareQuantity?: boolean; leadingQuantityAfterFood?: boolean } = {},
): Segment[] {
  if (typeof normalized !== 'string' || normalized.trim() === '') return [];
  const prepared = prepareRuleText(normalized);
  const text = prepared.text;
  const aliases = buildUnitAliases(data);
  const unitPattern = [...aliases.keys()].sort((left, right) => right.length - left.length)
    .map(alias => `${escapePattern(alias)}${/[a-z]$/iu.test(alias) ? '(?![a-z])' : ''}`).join('|');
  const quantity = `(?<qty>[+-]?\\d+(?:\\.\\d+)?)(?:\\s*(?<size>[小中大])?\\s*(?<unit>${unitPattern || '(?!)'}))?`;
  const tokenizer = new RegExp(`(?<approx>${approximateWords})|${quantity}|(?<food>(?:(?!${approximateWords})\\p{Script=Han})+)|(?<other>.)`, 'giu');
  const source = raw === normalized ? prepared : prepareRuleText(raw);
  const offsets = source.text === text ? source.offsets : null;
  const segments: Segment[] = [];
  let pending: { start: number; end: number; food: boolean; qty: number | null; unit: string | null; approx: boolean } | null = null;
  const begin = (start: number, end: number): NonNullable<typeof pending> => ({ start, end, food: false, qty: null, unit: null, approx: false });
  const flush = (): void => {
    if (!pending) return;
    if (pending.food || (pending.qty !== null && (pending.unit !== null || options.allowBareQuantity))) {
      const { start, end } = pending;
      const span = text.slice(start, end).replace(new RegExp(approximateWords, 'gu'), '').trim();
      const first = offsets?.[start];
      const last = offsets?.[end - 1];
      segments.push({
        span, raw: first && last ? raw.slice(first.start, last.end) : text.slice(start, end),
        qty: pending.qty, unit: pending.unit ?? (pending.qty !== null && (pending.food || options.allowBareQuantity) ? 'g' : null),
        start: prepared.offsets[start]?.start ?? start,
        end: prepared.offsets[end - 1]?.end ?? end,
        ...(pending.approx ? { approx: true } : {}),
        ...(pending.qty !== null ? { hasFood: pending.food } : {}),
      });
    }
    pending = null;
  };

  for (const token of text.matchAll(tokenizer)) {
    const groups = token.groups ?? {};
    const start = token.index;
    const end = start + token[0].length;
    if (groups.approx !== undefined) {
      if (approximationSide(groups.approx) !== 'previous' && pending?.food && pending.qty !== null) flush();
      pending ??= begin(start, end);
      pending.approx = true;
      pending.end = end;
    } else if (groups.qty !== undefined) {
      if (pending && pending.qty !== null) flush();
      pending ??= begin(start, end);
      const value = Number(groups.qty);
      pending.unit = groups.unit === undefined ? null : aliases.get(groups.unit.toLowerCase()) ?? null;
      const absolute = data.units.find(unit => unit.id === pending?.unit);
      const scale = !absolute || absolute.grams === 0 ? PORTION_MULTIPLIERS[groups.size ?? ''] ?? 1 : 1;
      pending.qty = Number.isFinite(value) ? value * scale : null;
      pending.end = end;
    } else if (groups.food !== undefined) {
      // 已命中食物后的首个数量是后置份量，空白后的未知食物另起片段。
      if (pending && pending.qty !== null && (pending.food ||
        (options.leadingQuantityAfterFood && segments.length === 0 && /\s/u.test(text.slice(pending.end, start))))) flush();
      pending ??= begin(start, end);
      pending.food = true;
      pending.end = end;
    } else if (groups.other !== undefined && !/\s/u.test(groups.other)) {
      flush();
    }
  }
  flush();
  return segments;
}
