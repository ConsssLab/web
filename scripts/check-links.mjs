/**
 * 檢查 README 裡的行號連結有沒有跑掉。
 *
 * README 的賣點是「精確到行號」—— 評審會點進去。但只要改到被指到的檔案，行號就位移，
 * 連結會安靜地指向不相干的程式碼：範圍還在檔案內，所以肉眼看不出壞掉。
 * 實際發生過兩次，其中一次「賽道二 indexer 唯讀查詢」點下去落在兩個無關的小工具上。
 *
 * 這支不驗「行號是不是原本想指的東西」（那需要人判斷），只驗一件機械可查的事：
 * 起始行要是函式或註解區塊的開頭，結束行要是收尾。位移之後這兩個條件幾乎必然被破壞。
 *
 *   npm run check:links
 */

import { readFileSync } from 'node:fs';

const README = 'README.md';
const LINK = /`([^`]+?\.js)#L(\d+)-L(\d+)`/g;

const START_OK = /^(\/\*\*|\/\*|export\s|async\s|function\s|const\s|class\s)/;
const END_OK = /^(\}|\}\);|\};|export const .+;)$/;

const readme = readFileSync(README, 'utf8');
const seen = new Set();
let bad = 0;
let total = 0;

for (const [, path, aStr, bStr] of readme.matchAll(LINK)) {
  const key = `${path}#${aStr}-${bStr}`;
  if (seen.has(key)) continue;
  seen.add(key);
  total += 1;

  let lines;
  try {
    lines = readFileSync(path, 'utf8').split('\n');
  } catch {
    console.log(`❌ ${key}　檔案不存在`);
    bad += 1;
    continue;
  }

  const a = Number(aStr);
  const b = Number(bStr);
  if (b > lines.length) {
    console.log(`❌ ${key}　檔案只有 ${lines.length} 行`);
    bad += 1;
    continue;
  }

  const head = lines[a - 1].trim();
  const tail = lines[b - 1].trim();
  const ok = START_OK.test(head) && END_OK.test(tail);
  if (!ok) bad += 1;
  console.log(`${ok ? '✅' : '❌'} ${key}\n     起 ${head.slice(0, 60)}\n     訖 ${tail.slice(0, 60)}`);
}

console.log(
  bad === 0
    ? `\n${total} 個行號連結都落在函式起訖上。`
    : `\n${bad} / ${total} 個連結跑掉了 —— 被指到的檔案改過，行號要重算。`,
);
process.exit(bad === 0 ? 0 : 1);
