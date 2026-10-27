import { readFile, readdir, stat } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { formatTotal } from '@meal/core';
import { blurInput, dateKey, placeholderFor, portionOptions, readRecords, resolveRecord, writeRecords } from './model.ts';

// 用最小事件与节点替身运行真实内联脚本，检验副作用；不模拟浏览器布局。
async function bootApp(initial: Array<{ t: string; raw: string }> = []) {
  class Element {
    tag = '';
    href = '';
    download = '';
    textContent = '';
    value = '';
    hidden = false;
    className = '';
    children: Element[] = [];
    parentElement: Element | null = null;
    classList = { toggle: vi.fn() };
    listeners = new Map<string, Array<(event: object) => void>>();
    blur = vi.fn(() => { if (active === this) active = null; });
    focus() { active = this; this.fire('focus'); }
    addEventListener(type: string, handler: (event: object) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
    }
    fire(type: string) { for (const handler of this.listeners.get(type) ?? []) handler({ preventDefault() {} }); }
    click() { this.focus(); this.fire('click'); }
    setAttribute() {}
    append(...children: Element[]) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    replaceChildren(...children: Element[]) { this.children = []; this.append(...children); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  }
  let active: Element | null = null;
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/gu)].map(match => [`#${match[1]}`, new Element()]));
  const get = (id: string): Element => {
    const element = nodes.get(`#${id}`);
    if (!element) throw new Error(`测试页面缺少 ${id}`);
    return element;
  };
  get('total').parentElement = new Element();
  const values = new Map([[dateKey(new Date()), JSON.stringify(initial)]]);
  const storage = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, text: string) => { values.set(key, text); }),
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null };
  const created: Element[] = [];
  const createElement = vi.fn((tag: string) => { const element = new Element(); element.tag = tag; created.push(element); return element; });
  const urls = { createObjectURL: vi.fn((_blob: Blob) => 'blob:meal-test'), revokeObjectURL: vi.fn() };
  const dialog = vi.fn();
  const script = html.match(/<script>([\s\S]*)<\/script>/u)?.[1];
  if (!script) throw new Error('测试页面缺少内联脚本');
  get('settings').hidden = true;
  runInNewContext(script, { document: { querySelector: (selector: string) => nodes.get(selector), createElement, body: new Element(),
    createDocumentFragment: () => new Element() }, localStorage: storage, console, URL: urls, Blob, setTimeout: (action: () => void) => action(),
    alert: dialog, confirm: dialog, prompt: dialog }, { timeout: 2000 });
  const snapshot = (element: Element): object => ({ text: element.textContent, value: element.value, hidden: element.hidden,
    className: element.className, children: element.children.map(snapshot) });
  const text = (element: Element): string => [element.textContent, ...element.children.map(text)].join(' ');
  return { get, storage, values, createElement, created, urls, dialog, text, active: () => active,
    snapshot: () => JSON.stringify([...nodes].map(([id, element]) => [id, snapshot(element)])) };
}

describe('Web 账本与当前食物库', () => {
  it.each([
    [0, '又吃了什么…'], [4, '又吃了什么…'], [5, '早饭吃了什么…'], [9, '早饭吃了什么…'],
    [10, '中午吃了什么…'], [13, '中午吃了什么…'], [14, '下午吃了什么…'], [16, '下午吃了什么…'],
    [17, '晚上吃了什么…'], [21, '晚上吃了什么…'], [22, '又吃了什么…'], [23, '又吃了什么…'],
  ] as const)('%i 时的输入提示是 %s', (hour, text) => { expect(placeholderFor(hour)).toBe(text); });

  it('启动只读今天的 key，不枚举或加载其他日期', () => {
    const key = dateKey(new Date(2026, 9, 27, 12, 40));
    const storage = { getItem: vi.fn(() => '[{"t":"12:40","raw":"鸡胸200g"}]') };
    expect(key).toBe('meal:2026-10-27');
    expect(readRecords(storage, key)).toEqual([{ t: '12:40', raw: '鸡胸200g' }]);
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(key);
  });

  it.each(['坏掉的 JSON', '{}', 'null', '[null,{},1,{"t":1,"raw":"鸡胸"}]'])('损坏的存储降级为空，不抛异常：%s', text => {
    expect(readRecords({ getItem: () => text }, 'meal:2026-10-27')).toEqual([]);
  });

  it('存储被禁用、容量不足时仍可保留计算结果', () => {
    expect(readRecords({ getItem: () => { throw new Error('存储不可读'); } }, 'meal:2026-10-27')).toEqual([]);
    expect(writeRecords(null, 'meal:2026-10-27', [])).toBe(false);
    expect(writeRecords({ setItem: () => { throw new Error('存储不可写'); } }, 'meal:2026-10-27', [])).toBe(false);
    expect(resolveRecord({ t: '12:40', raw: '鸡胸200g' }).total.kcal).toBe(240);
  });

  it('存储为原始输入数组，不写营养结果快照', () => {
    const storage = { setItem: vi.fn() };
    const records = [{ t: '12:40', raw: '鸡胸200g' }];
    expect(writeRecords(storage, 'meal:2026-10-27', records)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith('meal:2026-10-27', JSON.stringify(records));
  });

  it.each(['米饭一碗 黄焖鸡', '鸡胸200g 黄焖鸡'])('未解析合计与 CLI 完全共用同一文案：%s', raw => {
    const result = resolveRecord({ t: '12:40', raw });
    expect(result.items).toHaveLength(2);
    expect(result.total).toEqual({ kcal: null, kcalRange: null, protein: null, carb: null, fat: null });
    expect(formatTotal(result.items)).toBe('合计不可用：有 1 项没认出');
  });

  it('先给区间，份量按钮仅来自已录入的碗和拳', () => {
    const result = resolveRecord({ t: '12:40', raw: '米饭' });
    expect(result.total.kcalRange).toEqual([166, 224]);
    expect(portionOptions(result.items[0]!)).toEqual([{ unit: '碗', grams: 150 }, { unit: '拳', grams: 140 }]);
  });

  it('点选一拳后按表内140g重新查表，给点值而不改营养数据', () => {
    const result = resolveRecord({ t: '12:40', raw: '米饭', portions: { '0': '拳' } });
    expect(result.items[0]).toMatchObject({ foodId: 'mifan', qty: 1, unit: '拳', grams: 140, kcal: 182, confidence: 'exact' });
    expect(result.total.kcal).toBe(182);
    expect(result.total.kcalRange).toBeNull();
    expect(portionOptions(result.items[0]!)).toEqual([]);
  });

  it('就这样只收起提问，不把估计值变成精确值', () => {
    const before = resolveRecord({ t: '12:40', raw: '米饭' });
    const after = resolveRecord({ t: '12:40', raw: '米饭', dismissed: [0] });
    expect(after).toEqual(before);
  });

  it('旧的不存在的份量单位不能生成数值；待录入菜品不补营养', () => {
    const rice = resolveRecord({ t: '12:40', raw: '米饭', portions: { '0': '不存在的单位' } });
    expect(rice.items[0]?.confidence).toBe('estimate');
    const unknown = resolveRecord({ t: '12:40', raw: '番茄炒蛋', portions: { '0': '盘' } });
    expect(unknown.items[0]?.confidence).toBe('unresolved');
    expect(unknown.total.kcal).toBeNull();
    expect(portionOptions(unknown.items[0]!)).toEqual([]);
  });

  it('今天不记的操作只调用失焦，不更改输入值和现有记录', () => {
    const input = { value: '尚未提交的内容', blur: vi.fn() };
    const records = [{ t: '12:40', raw: '鸡胸200g' }];
    const before = structuredClone(records);
    blurInput(input);
    expect(input.blur).toHaveBeenCalledExactlyOnceWith();
    expect(input.value).toBe('尚未提交的内容');
    expect(records).toEqual(before);
  });
});

describe('单文件构建产物', () => {
  const path = new URL('../dist/index.html', import.meta.url);
  it('dist 只有一个 index.html，大小小于150KB，JS/CSS/data全内联', async () => {
    expect(await readdir(new URL('../dist/', import.meta.url))).toEqual(['index.html']);
    expect((await stat(path)).size).toBeLessThan(150 * 1024);
    const html = await readFile(path, 'utf8');
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
    expect(html).toContain('mifan');
    expect(html).not.toMatch(/https?:\/\/|<script[^>]+src\s*=|<link[^>]+href\s*=|\bfetch\s*\(|@import|sourceMappingURL/iu);
    expect(html).not.toContain('acceptance');
    expect(html).not.toContain('APP_JS');
  });

  it('首屏为输入、时间线和固定底部，不含仪表或考核性文案与装饰', async () => {
    const html = await readFile(path, 'utf8');
    expect(html).toContain('id="meal-input"');
    expect(html).toContain('<ol id="timeline"');
    expect(html).toContain('id="total"');
    expect(html).toMatch(/id="skip-today"[^>]*>今天不记<\/button>/u);
    expect(html).toContain('id="settings" hidden');
    expect(html).not.toMatch(/达成率|进度环|百分比对比|连续天数|streak|达标|未达标|超标|记一笔|打卡|今日目标|太棒了|加油|[\u2190-\u21ff]|\p{Extended_Pictographic}/iu);
    expect(html).not.toMatch(/<dialog|<progress|\b(?:alert|confirm|prompt|fetch)\s*\(|Notification|serviceWorker|navigator\.vibrate|animation\s*:|transition\s*:/iu);
  });

  it('今天不记在已有记录时没有提交、存储、重绘或提示，只失焦', async () => {
    const app = await bootApp([{ t: '12:40', raw: '米饭一碗 黄焖鸡' }]);
    const input = app.get('meal-input');
    input.value = '尚未提交的鸡胸200g';
    input.focus();
    const before = app.snapshot();
    const stored = [...app.values];
    const reads = app.storage.getItem.mock.calls.length;
    const created = app.createElement.mock.calls.length;
    app.get('skip-today').click();
    expect(app.active()).toBeNull();
    expect(input.blur).toHaveBeenCalledExactlyOnceWith();
    expect(app.snapshot()).toBe(before);
    expect([...app.values]).toEqual(stored);
    expect(app.storage.getItem).toHaveBeenCalledTimes(reads);
    expect(app.storage.setItem).not.toHaveBeenCalled();
    expect(app.createElement).toHaveBeenCalledTimes(created);
    expect(app.dialog).not.toHaveBeenCalled();
  });

  it('实际内联脚本提交后原地显示、清空并聚焦，混有未知项时整日合计留空', async () => {
    const app = await bootApp();
    const input = app.get('meal-input');
    input.value = '鸡胸200g';
    app.get('meal-form').fire('submit');
    expect(app.get('total').textContent).toBe('240');
    expect(input.value).toBe('');
    expect(app.active()).toBe(input);
    input.value = '米饭一碗 黄焖鸡';
    app.get('meal-form').fire('submit');
    expect(app.get('total').textContent).toBe('合计不可用：有 1 项没认出');
    expect(app.get('total-label').hidden).toBe(true);
    const rendered = app.text(app.get('timeline'));
    expect(rendered.indexOf('米饭')).toBeLessThan(rendered.indexOf('鸡胸'));
    expect(app.storage.setItem).toHaveBeenCalledTimes(2);
    const records = JSON.parse(app.values.get(dateKey(new Date())) ?? '[]');
    expect(records.map((entry: object) => Object.keys(entry).sort())).toEqual([['raw', 't'], ['raw', 't']]);
    expect(app.dialog).not.toHaveBeenCalled();
  });

  it.each(['', '吃了点东西', '！！！'])('实际内联脚本的空输入或无实体不写记录：%j', async raw => {
    const app = await bootApp();
    app.get('meal-input').value = raw;
    app.get('meal-form').fire('submit');
    expect(app.get('input-message').textContent).toBe(`没认出是什么。原文：${raw}`);
    expect(app.storage.setItem).not.toHaveBeenCalled();
    expect(app.dialog).not.toHaveBeenCalled();
  });

  it('默认折叠的设置里导出所有饮食日期，使用本地下载且不带其他存储', async () => {
    const app = await bootApp([{ t: '12:40', raw: '鸡胸200g' }]);
    app.values.set('meal:2000-01-01', '[{"t":"08:00","raw":"米饭"}]');
    app.values.set('other-app', '不能导出');
    expect(app.get('settings').hidden).toBe(true);
    app.get('settings-toggle').click();
    expect(app.get('settings').hidden).toBe(false);
    app.get('export').click();
    const blob = app.urls.createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    const backup = JSON.parse(await blob!.text());
    expect(Object.keys(backup)).toEqual([dateKey(new Date()), 'meal:2000-01-01']);
    expect(backup[dateKey(new Date())]).toEqual([{ t: '12:40', raw: '鸡胸200g' }]);
    expect(app.created.find(element => element.tag === 'a')).toMatchObject({ download: 'meal-backup.json', href: 'blob:meal-test' });
    expect(app.urls.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:meal-test');
    expect(app.dialog).not.toHaveBeenCalled();
  });

  it('实际内联脚本处理十万字输入时不抛异常、不弹窗', async () => {
    const app = await bootApp();
    app.get('meal-input').value = '字'.repeat(100000);
    expect(() => app.get('meal-form').fire('submit')).not.toThrow();
    expect(app.get('total').textContent).toBe('合计不可用：有 1 项没认出');
    expect(app.dialog).not.toHaveBeenCalled();
  });
});
