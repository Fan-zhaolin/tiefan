import { formatItemKcal, formatPortion, formatTotal, parseMeal } from '@meal/core';
import data from '@meal/data';
import { blurInput, dateKey, placeholderFor, portionOptions, readRecords, resolveRecord, writeRecords } from './model.ts';
import type { SavedMeal } from './model.ts';

const input = document.querySelector<HTMLInputElement>('#meal-input')!;
const form = document.querySelector<HTMLFormElement>('#meal-form')!;
const timeline = document.querySelector<HTMLOListElement>('#timeline')!;
const message = document.querySelector<HTMLParagraphElement>('#input-message')!;
const total = document.querySelector<HTMLOutputElement>('#total')!;
const totalLabel = document.querySelector<HTMLSpanElement>('#total-label')!;
let storage: Storage | null = null;
try { storage = localStorage; } catch { /* 本地存储不可用时保留内存中的结果。 */ }
let key = dateKey(new Date());
let records = readRecords(storage, key);

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}

function showMessage(text: string): void {
  message.textContent = text;
  message.hidden = text === '';
}

function save(): void {
  if (!writeRecords(storage, key, records)) showMessage('暂时存不下来，结果仍在页面上。');
}

function render(): void {
  const now = new Date();
  input.placeholder = placeholderFor(now.getHours());
  document.querySelector('#date')!.textContent = `${now.getMonth() + 1}月${now.getDate()}日`;
  const results = records.map(saved => resolveRecord(saved));
  const fragment = document.createDocumentFragment();
  // 只反转记录的到达顺序，新记录在上，不按热量或其他数值排序。
  records.map((saved, index) => ({ saved, index })).reverse().forEach(({ saved, index }) => {
    const entry = textElement('li', '', 'entry');
    entry.append(textElement('p', saved.raw, 'source'));
    results[index]?.items.forEach((item, itemIndex) => {
      const row = textElement('div', '', `food-row${item.confidence === 'unresolved' ? ' muted' : ''}`);
      const macros = [item.protein, item.carb, item.fat].map(value => value === null ? '—' : String(Math.round(value)));
      row.append(textElement('time', saved.t), textElement('span', item.foodName ?? item.raw, 'food-name'),
        textElement('span', formatPortion(item), 'portion'), textElement('span', formatItemKcal(item), 'kcal'),
        textElement('span', `P${macros[0]} C${macros[1]} F${macros[2]}`, 'macros'));
      entry.append(row);
      const options = portionOptions(item);
      if (options.length === 0 || (Array.isArray(saved.dismissed) && saved.dismissed.includes(itemIndex))) return;
      const question = textElement('div', '', 'portion-question');
      question.append(textElement('p', formatTotal([item]), 'range'), textElement('p', `多大的${item.foodName ?? '份量'}？`));
      const actions = textElement('div', '', 'portion-actions');
      for (const portion of options) {
        const button = textElement('button', `一${portion.unit}`);
        button.type = 'button';
        button.addEventListener('click', () => {
          const previous = typeof saved.portions === 'object' && saved.portions !== null ? saved.portions : {};
          saved.portions = { ...previous, [itemIndex]: portion.unit };
          save();
          render();
        });
        actions.append(button);
      }
      const leave = textElement('button', '就这样', 'leave');
      leave.type = 'button';
      leave.addEventListener('click', () => {
        saved.dismissed = [...(Array.isArray(saved.dismissed) ? saved.dismissed : []), itemIndex];
        save();
        render();
      });
      actions.append(leave);
      question.append(actions);
      entry.append(question);
    });
    fragment.append(entry);
  });
  timeline.replaceChildren(fragment);
  document.querySelector<HTMLElement>('#empty')!.hidden = records.length > 0;
  const items = results.flatMap(result => result.items);
  const value = items.length === 0 ? '—' : formatTotal(items);
  const unavailable = value.startsWith('合计不可用');
  total.textContent = value;
  totalLabel.hidden = unavailable;
  total.parentElement!.classList.toggle('unavailable', unavailable);
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const raw = input.value;
  const now = new Date();
  const current = dateKey(now);
  if (current !== key) { key = current; records = readRecords(storage, key); }
  const result = parseMeal(raw, data);
  if (result.items.length === 0) { showMessage(`没认出是什么。原文：${raw}`); return; }
  showMessage('');
  records.push({ t: now.toTimeString().slice(0, 5), raw });
  save();
  render();
  input.value = '';
  input.focus();
});
input.addEventListener('keydown', event => { if (event.key === 'Enter' && event.isComposing) event.preventDefault(); });
input.addEventListener('focus', () => { input.placeholder = placeholderFor(new Date().getHours()); });

const skip = document.querySelector<HTMLButtonElement>('#skip-today')!;
skip.addEventListener('click', () => { blurInput(input); skip.blur(); });

const settings = document.querySelector<HTMLElement>('#settings')!;
const settingsToggle = document.querySelector<HTMLButtonElement>('#settings-toggle')!;
settingsToggle.addEventListener('click', () => {
  settings.hidden = !settings.hidden;
  settingsToggle.setAttribute('aria-expanded', String(!settings.hidden));
});
document.querySelector('#export')!.addEventListener('click', () => {
  try {
    const backup: Record<string, unknown> = {};
    if (storage) for (let index = 0; index < storage.length; index += 1) {
      const savedKey = storage.key(index);
      if (savedKey?.startsWith('meal:')) backup[savedKey] = JSON.parse(storage.getItem(savedKey) ?? '[]');
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'meal-backup.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch { showMessage('暂时导出不了，本地记录仍保留。'); }
});

render();
