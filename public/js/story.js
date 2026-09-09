/**
 * 劇情腳本。開場 4 幕 + 結局，全部可跳過，讓「一分鐘打完」這件事成立。
 * 世界觀：鏈界諸國各據一鏈，本篇聚焦鏈國 0G —— 記憶沒有重量的無重之國。
 */

export const TITLE = {
  main: '鏈之英雄傳',
  en: 'ConSSS Wars',
  sub: '無重之憶',
  subEn: 'Weightless Memory',
  chapter: '第 0 章 · 鏈國 0G',
};

export const OPENING = [
  {
    speaker: '旁白',
    portrait: 'world',
    text: '鏈界之上，諸國各據一鏈。其中最輕的一國，叫做 0G。',
  },
  {
    speaker: '旁白',
    portrait: 'world',
    text: '在 0G，記憶沒有重量。所有被記得的事，都能無限地被取用、被驗證、被再想起一次。',
  },
  {
    speaker: '遺忘者',
    portrait: 'forgetter',
    text: '……那就讓它們，全部歸零。',
  },
  {
    speaker: '零',
    portrait: 'hero',
    text: '守住記憶核心。只要還有人記得，0G 就還在。',
  },
];

export const BRIEFING = {
  title: '一分鐘作戰',
  lines: [
    '三條「記憶迴廊」，你在左、遺忘者在右。',
    '每回合 2 點算力 —— 顧不了三條，選哪條放掉就是勝負。',
    '交戰前先比火力：一條迴廊誰的攻擊力總和高，就啃對方核心 2 點。',
    '核心 12 點，共 7 回合，先歸零的一方輸。',
    '對面是真的 AI agent —— 它每回合重新讀盤、重新決定。',
  ],
};

export const HEROES = [
  {
    key: 'zero',
    name: '零',
    en: 'Zero',
    role: '零界守望者',
    roleEn: 'Watcher of the Void',
    line: '我記得每一個人的名字。',
  },
  {
    key: 'hue',
    name: '蕙',
    en: 'Hue',
    role: '見證者',
    roleEn: 'The Witness',
    line: '被見證過的，就不會消失。',
  },
  {
    key: 'ren',
    name: '刃',
    en: 'Ren',
    role: '零重刃',
    roleEn: 'Blade of Gravity',
    line: '沒有重量，才砍得快。',
  },
];

export const ENDINGS = {
  hero: {
    title: '記憶存續',
    en: 'MEMORY PERSISTS',
    lines: [
      '遺忘者的演算法散成雜訊，記憶核心重新亮起。',
      '這一戰被寫成一枚「記憶碎片」—— 你可以把它留在 0G 上。',
    ],
  },
  forgetter: {
    title: '歸零',
    en: 'ZEROED',
    lines: ['核心熄滅了。這一段記憶，沒有人再想得起來。', '……但戰鬥紀錄還在。再來一次。'],
  },
  draw: {
    title: '懸置',
    en: 'SUSPENDED',
    lines: ['七回合結束，兩座核心都還亮著。', '記憶被懸置在無重之處，等待下一次驗證。'],
  },
};

/** 遺忘者的備援台詞：AI agent 叫不到時用，讓演出不會開天窗。 */
export const FALLBACK_TAUNTS = [
  '你守的東西，本來就沒有重量。',
  '再想一次看看，還想得起來嗎？',
  '我不需要贏。我只需要你忘記。',
  '每一格推進，都是一次多餘的執著。',
  '算力會耗盡，遺忘不會。',
  '你的核心正在變輕。',
];
