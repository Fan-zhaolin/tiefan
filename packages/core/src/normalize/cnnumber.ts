const digits: Readonly<Record<string, number>> = {
  '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9,
};

export function cnNumber(raw: string): number | null {
  if (raw === '半') return 0.5;
  if (raw.length === 1 && digits[raw] !== undefined) return digits[raw] ?? null;
  const tens = raw.match(/^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/u);
  if (tens) return (digits[tens[1] ?? '一'] ?? 1) * 10 + (digits[tens[2] ?? ''] ?? 0);
  const hundreds = raw.match(/^([一二两三四五六七八九])?百(.*)$/u);
  if (!hundreds) return null;
  const base = (digits[hundreds[1] ?? '一'] ?? 1) * 100;
  const tail = hundreds[2] ?? '';
  if (tail === '') return base;
  // 「一百五」的末位表示五十，不是五。
  if (tail.length === 1 && digits[tail] !== undefined) return base + (digits[tail] ?? 0) * 10;
  if (!/^([一二两三四五六七八九])?十([一二两三四五六七八九])?$/u.test(tail)) return null;
  const remainder = cnNumber(tail);
  return remainder === null ? null : base + remainder;
}

export function normalizeCnNumbers(
  text: string,
  onReplace?: (value: string, start: number, end: number) => void,
): string {
  return text.replace(/[一二三四五六七八九十两百半]+/gu, (token: string, start: number) => {
    let value = token;
    if (token.endsWith('两') && token.length > 1) {
      const quantity = cnNumber(token.slice(0, -1));
      if (quantity !== null) value = `${quantity}两`;
    } else {
      let previous = start - 1;
      while (previous >= 0 && /\s/u.test(text[previous] ?? '')) previous -= 1;
      // 数字后面的「两」保留为重量单位，其余数量中的「两」按二处理。
      const isWeightUnit = token === '两' && /\d/u.test(text[previous] ?? '');
      const quantity = isWeightUnit ? null : cnNumber(token);
      if (quantity !== null) value = String(quantity);
    }
    if (value !== token) onReplace?.(value, start, start + token.length);
    return value;
  });
}
