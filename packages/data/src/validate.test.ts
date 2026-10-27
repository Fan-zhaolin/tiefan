import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { readData } from '../scripts/load.ts';
import type { DataSet, Dish } from './types.ts';
import { checkAll, checkDish } from '../src/rules';

const { data: original } = await readData();

function failures(data: DataSet) {
  return checkAll(data).filter(result => !result.ok);
}

function getDish(data: DataSet, id = 'jixiong'): Dish {
  const dish = data.dishes.find(item => item.id === id);
  if (!dish) throw new Error(`测试缺少食物 ${id}`);
  return dish;
}

describe('数据层校验', () => {
  it('保留当前 9 个文件，只有番茄炒蛋待录入', async () => {
    const files = await readdir(new URL('../dishes/', import.meta.url));
    expect(files.sort()).toEqual(['fanqie.yaml', 'fanqiechaodan.yaml', 'jidan.yaml', 'jixiong.yaml', 'mifan.yaml', 'niunai.yaml', 'niurou.yaml', 'xia.yaml', 'yanmai.yaml']);
    const results = checkAll(original);
    expect(results.every(result => result.ok)).toBe(true);
    expect(results.map(result => result.rule)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(original.dishes.filter(dish => dish.kcal === null).map(dish => dish.id)).toEqual(['fanqiechaodan']);
    expect(results.find(result => result.rule === 11)?.msg).toBe('规则 11：23 项名称/别名回归；11 条缺数据用例已标注跳过。');
    expect(original.units).toHaveLength(6);
    expect(original.methods).toHaveLength(10);
  });

  // 以下数值只用于故意破坏内存中的数据副本，不写入食物 YAML。
  const invalidCases: Array<[string, (data: DataSet) => void, number]> = [
    ['规则 1 拦住鸡胸热量改成 9', data => { getDish(data).kcal = 9; }, 1],
    ['规则 2 拦住宏量总和超过 100', data => { getDish(data).protein = 100; }, 2],
    ['规则 3 拦住热量超过 900', data => { getDish(data).kcal = 901; }, 3],
    ['规则 3 拦住负数热量', data => { getDish(data).kcal = -1; }, 3],
    ['规则 4 拦住宏量超过 100', data => { getDish(data).fat = 101; }, 4],
    ['规则 4 拦住非有限数值', data => { getDish(data).fat = Infinity; }, 4],
    ['规则 5 拦住非法 id', data => { getDish(data).id = 'Bad'; }, 5],
    ['规则 5 拦住重复 id', data => { getDish(data, 'jidan').id = 'jixiong'; }, 5],
    ['规则 6 拦住别名与其他名称冲突', data => { getDish(data).aliases.push('鸡蛋'); }, 6],
    ['规则 7 拦住非中文份量单位', data => { getDish(data).portions = [{ unit: 'g', grams: 100 }]; }, 7],
    ['规则 7 拦住零克份量', data => { getDish(data).portions = [{ unit: '份', grams: 0 }]; }, 7],
    ['规则 7 拦住份量超过 2000', data => { getDish(data).portions = [{ unit: '份', grams: 2001 }]; }, 7],
    ['规则 8 拦住不存在的做法', data => { getDish(data).method = 'missing'; }, 8],
    ['规则 9 拦住自造来源', data => { Object.assign(getDish(data), { source: 'OTHER' }); }, 9],
    ['规则 9 拦住缺少品牌说明的标签来源', data => { Object.assign(getDish(data), { source: 'LABEL', note: '' }); }, 9],
    ['规则 10 拦住一拳米饭 300g', data => { getDish(data, 'mifan').portions = [{ unit: '拳', grams: 300 }]; }, 10],
    ['规则 10 拦住一碗米饭超过 400g', data => { getDish(data, 'mifan').portions = [{ unit: '碗', grams: 401 }]; }, 10],
    ['规则 10 拦住一份炒菜超过 800g', data => { getDish(data, 'fanqiechaodan').portions = [{ unit: '份', grams: 801 }]; }, 10],
    ['规则 11 拦住已支持别名被移除', data => { getDish(data, 'mifan').aliases = []; }, 11],
    ['待录入必须有明确说明', data => { getDish(data, 'fanqiechaodan').note = ''; }, 0],
    ['不允许用待录入掩盖数值', data => { getDish(data).note = '待录入'; }, 0],
    ['营养字段不允许缺失', data => { Reflect.deleteProperty(getDish(data), 'kcal'); }, 3],
    ['非空热量必须有完整宏量', data => { getDish(data).protein = null; }, 1],
    ['热量必须为整数', data => { getDish(data).kcal = 120.1; }, 0],
    ['宏量最多保留一位小数', data => { getDish(data).fat = 2.62; }, 0],
    ['种类不能用数组冒充枚举字符串', data => { Object.assign(getDish(data), { kind: ['ingredient'] }); }, 0],
  ];
  it.each(invalidCases)('%s', (_name, mutate, rule) => {
    const data = structuredClone(original);
    mutate(data);
    const results = failures(data);
    expect(results.length).toBeGreaterThan(0);
    expect(results.map(result => result.rule)).toContain(rule);
  });

  it('两条指定反向验证只触发各自对应规则', () => {
    const chicken = structuredClone(original);
    getDish(chicken).kcal = 9;
    expect(failures(chicken).map(result => result.rule)).toEqual([1]);
    const rice = structuredClone(original);
    getDish(rice, 'mifan').portions = [{ unit: '碗', grams: 150 }, { unit: '拳', grams: 300 }];
    expect(failures(rice).map(result => result.rule)).toEqual([10]);
  });

  it('零热量必须注明豁免，有标记时按低热量规则处理且不发生除零错误', () => {
    const data = structuredClone(original);
    Object.assign(getDish(data), { kcal: 0, protein: 0, carb: 0, fat: 0 });
    expect(failures(data).map(result => result.rule)).toContain(1);
    getDish(data).note = '规则1豁免：低热量';
    expect(failures(data)).toEqual([]);
    getDish(data).protein = 1;
    expect(failures(data)).toEqual([]);
    expect(checkAll(data).find(result => result.rule === 1)?.msg).toContain('kcal=0 < 40');
    getDish(data).note = '';
    expect(failures(data).map(result => result.rule)).toContain(1);
  });

  it('只给注明原因的酒类或纯纤维包装食品放宽到 0.30', () => {
    const data = structuredClone(original);
    Object.assign(getDish(data), { kind: 'packaged', kcal: 144, note: '普通包装食品' });
    expect(failures(data).map(result => result.rule)).toContain(1);
    getDish(data).note = '酒类；豁免原因：含有酒精提供的能量。';
    expect(failures(data)).toEqual([]);
    getDish(data).kcal = 170;
    expect(failures(data).map(result => result.rule)).toContain(1);
  });

  it.each([null, [], {}, { dishes: null, units: [], methods: [] }])('拒绝非法数据集结构：%j', input => {
    expect(failures(input as unknown as DataSet).map(result => result.rule)).toContain(0);
  });

  it('拒绝损坏的验收语料，不默默跳过', () => {
    const missing = { ...original, acceptance: null } as unknown as DataSet;
    const malformed = { ...original, acceptance: [{ id: 'bad', input: '', expect: { foods: '米饭' } }] } as unknown as DataSet;
    expect(failures(missing).map(result => result.rule)).toContain(11);
    expect(failures(malformed).map(result => result.rule)).toContain(11);
  });

  it('错误文案保留规则、条目和计算明细', () => {
    const data = structuredClone(original);
    getDish(data).kcal = 9;
    const result = failures(data).find(result => result.rule === 1);
    expect(result?.msg).toBe('✗ jixiong: 规则 1 宏量自洽，偏差 11.60 > 0.15\n  kcal=9, 4P+4C+9F=113.4\n✗ jixiong: 规则 1 符合豁免条件，但 note 缺少「规则1豁免」，不予豁免');
  });

  it('番茄明确按低热量条件豁免，命令行与纯函数结论一致', () => {
    const result = checkAll(original).find(result => result.rule === 1);
    expect(result?.ok).toBe(true);
    expect(result?.msg).toContain('规则 1 豁免：fanqie（kcal=18 < 40；note 已注明「规则1豁免」）。');
    const command = spawnSync(process.execPath, ['scripts/validate.ts'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
    expect(command.status).toBe(0);
    expect(command.stderr).toBe('');
    expect(command.stdout).toContain('规则 1 豁免：fanqie（kcal=18 < 40；note 已注明「规则1豁免」）。');
    expect(command.stdout).toContain('校验通过：9 个文件');
  });

  it('缺少豁免标记时不能豁免番茄', () => {
    const data = structuredClone(original);
    getDish(data, 'fanqie').note = 'FDC 170457 红熟番茄';
    const result = failures(data).find(result => result.rule === 1);
    expect(result?.msg).toContain('note 缺少「规则1豁免」');
  });

  it('低热量边界严格为小于 40，40 本身不豁免', () => {
    const data = structuredClone(original);
    Object.assign(getDish(data), { kcal: 40, note: '规则1豁免：边界测试' });
    expect(failures(data).map(result => result.rule)).toContain(1);
    getDish(data).kcal = 39;
    expect(failures(data)).toEqual([]);
  });

  it('高纤维条件可豁免高热量食物，比例必须严格大于 20%', () => {
    const data = structuredClone(original);
    const oats = getDish(data, 'yanmai');
    Object.assign(oats, { kcal: 100, fiber: 14, note: '规则1豁免：纤维条件测试' });
    expect(failures(data)).toEqual([]);
    expect(checkAll(data).find(result => result.rule === 1)?.msg).toContain('fiber=14 > carb*0.2');
    oats.fiber = 13.54;
    expect(failures(data).map(result => result.rule)).toContain(1);
  });

  it('高纤维条件同样必须有明确豁免标记', () => {
    const data = structuredClone(original);
    Object.assign(getDish(data, 'yanmai'), { kcal: 100, fiber: 14, note: '纤维含量已录入' });
    expect(failures(data).find(result => result.rule === 1)?.msg).toContain('note 缺少「规则1豁免」');
  });

  it('缺少 fiber 时不能从 note 推断纤维占比', () => {
    const data = structuredClone(original);
    Object.assign(getDish(data, 'yanmai'), { kcal: 100, note: '规则1豁免：纤维占比>20%' });
    expect(failures(data).map(result => result.rule)).toContain(1);
  });

  it('豁免不能掩盖宏量字段缺失', () => {
    const data = structuredClone(original);
    getDish(data, 'fanqie').protein = null;
    expect(failures(data).find(result => result.rule === 1)?.msg).toContain('宏量缺失');
  });

  it('豁免不能绕过其它规则的宏量上界与总量校验', () => {
    const data = structuredClone(original);
    getDish(data, 'fanqie').fat = 101;
    expect(failures(data).map(result => result.rule)).toEqual([2, 4]);
  });

  it('普通宏量自洽阈值仍为 0.15，恰好边界通过，超过则拒绝', () => {
    const data = structuredClone(original);
    Object.assign(getDish(data), { kcal: 100, protein: 25, carb: 1.5, fat: 1 });
    expect(failures(data)).toEqual([]);
    getDish(data).protein = 25.1;
    expect(failures(data).map(result => result.rule)).toContain(1);
  });

  it('既有包装食品例外阈值仍为 0.30，超过则拒绝', () => {
    const data = structuredClone(original);
    Object.assign(getDish(data), { kind: 'packaged', kcal: 100, protein: 25, carb: 3, fat: 2, note: '酒类；豁免原因：酒精提供能量' });
    expect(failures(data)).toEqual([]);
    getDish(data).fat = 2.1;
    expect(failures(data).map(result => result.rule)).toContain(1);
  });

  it('单菜接口与全库接口共用同一套判断，并且不改变输入', () => {
    const data = structuredClone(original);
    const before = structuredClone(data);
    expect(checkDish(getDish(data, 'fanqie'), data).every(result => result.ok)).toBe(true);
    expect(checkAll(data)).toEqual(checkAll(data));
    expect(data).toEqual(before);
    getDish(data, 'fanqie').note = '';
    expect(checkDish(getDish(data, 'fanqie'), data).find(result => result.rule === 1)?.ok).toBe(false);
    expect(checkAll(data).find(result => result.rule === 1)?.ok).toBe(false);
  });

  it('构建产物不携带验收语料', async () => {
    const build = spawnSync(process.execPath, ['scripts/build.ts'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
    expect(build.status, build.stderr || build.stdout).toBe(0);
    const json = await readFile(new URL('../dist/data.json', import.meta.url), 'utf8');
    expect(JSON.stringify(JSON.parse(json))).not.toContain('acceptance');
  });

  it('没有显式注入验收语料时报告规则 11 失败', () => {
    const data = structuredClone(original);
    delete data.acceptance;
    expect(failures(data).map(result => result.rule)).toEqual([11]);
  });

  it('不能把有完整数据的用例标成skip', () => {
    const data = structuredClone(original);
    const fixture = data.acceptance?.find(fixture => fixture.id === '03');
    if (!fixture) throw new Error('测试缺少用例03');
    fixture.skip = true;
    fixture.skip_reason = '缺 鸡胸 数据';
    expect(failures(data).find(result => result.rule === 11)?.msg).toContain('不允许继续 skip');
  });

  it('跳过理由不能写错缺少的食物', () => {
    const data = structuredClone(original);
    const fixture = data.acceptance?.find(fixture => fixture.id === '09');
    if (!fixture) throw new Error('测试缺少用例09');
    fixture.skip_reason = '缺 鸡胸 数据';
    expect(failures(data).find(result => result.rule === 11)?.msg).toContain('skip_reason 与缺数据不一致');
  });

  it('真正缺数据的用例必须显式注明skip', () => {
    const data = structuredClone(original);
    const fixture = data.acceptance?.find(fixture => fixture.id === '09');
    if (!fixture) throw new Error('测试缺少用例09');
    delete fixture.skip;
    expect(failures(data).find(result => result.rule === 11)?.msg).toContain('必须显式标注 skip');
  });
});
