export function toHalfWidth(raw: string): string {
  return raw.replace(/[０-９Ａ-Ｚａ-ｚ．／　]/gu, character =>
    character === '　' ? ' ' : String.fromCharCode(character.charCodeAt(0) - 0xfee0));
}
