/**
 * 全部美術都是這支檔案現畫的 inline SVG —— 沒有任何點陣圖檔，也沒有沿用官網舊素材。
 *
 * 風格：紙白底 + 鈷藍 + 藏青，唯一暖色是鮭橘。全平塗、硬邊，像剪紙／絹印，
 * 投影是實心藏青色塊而不是模糊陰影，完全不用漸層發光。
 * 主題母題取植物、水面與礦石切片，加上藍橘交錯的流體大理石紋。
 */

export const PALETTE = {
  paper: '#F2F1EC',
  paperDeep: '#E6E4DC',
  ink: '#0E1F38',
  inkDeep: '#081420',
  navy: '#123A6B',
  slate: '#2E4B6E',
  blue: '#1B7FE0',
  blueDeep: '#0E4C8F',
  blueMid: '#3E9BE8',
  bluePale: '#9FD2F2',
  blueLight: '#D6EBFA',
  salmon: '#E8926B',
  salmonPale: '#F3B999',
  terracotta: '#C4562E',
  skin: '#E8B394',
  skinShade: '#CE8F6C',
};

const P = PALETTE;

/**
 * 依底色亮度挑字色。原本是寫死比對某一個色碼，改一次色票就會漏掉，
 * 淺藍底配白字就變成看不清楚 —— 用相對亮度算才不會再犯。
 */
export function contrastOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.42 ? PALETTE.ink : PALETTE.paper;
}

let uid = 0;
const gid = (p) => `${p}${++uid}`;

/* ── 母題零件 ────────────────────────────────────────── */

/**
 * 蕨葉。每片葉子是一枚沿著莖旋轉的細橢圓，往頂端逐漸變小。
 * 用三角形當葉子會變成鋸齒狀的閃電，不像植物。
 */
function fern(x, y, scale, color, rotate = 0, opacity = 1) {
  const leaves = [];
  for (let i = 0; i < 10; i++) {
    const t = 6 + i * 6.4;
    const len = 16 - i * 1.15;
    for (const dir of [1, -1]) {
      leaves.push(
        `<ellipse cx="${((dir * len) / 2).toFixed(1)}" cy="${-t}" rx="${(len / 2).toFixed(1)}" ry="2.6"
                  fill="${color}" transform="rotate(${dir * -36} 0 ${-t})"/>`,
      );
    }
  }
  return `<g transform="translate(${x} ${y}) rotate(${rotate}) scale(${scale})" opacity="${opacity}">
    <path d="M0 6 L0 -74" stroke="${color}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    ${leaves.join('')}
  </g>`;
}

/**
 * 睡蓮葉：圓形缺一個楔形角，加幾條放射狀葉脈。
 * 缺口是關鍵 —— 沒有缺口就只是一顆圓點，讀不出是葉子。
 */
function pad(x, y, r, color, rot = 20, vein = P.paper) {
  const a = (26 * Math.PI) / 180;
  const x1 = (r * Math.sin(a)).toFixed(1);
  const y1 = (-r * Math.cos(a)).toFixed(1);
  const x2 = (-r * Math.sin(a)).toFixed(1);
  const veins = Array.from({ length: 6 }, (_, i) => {
    const ang = -128 + i * 51;
    const rad = (ang * Math.PI) / 180;
    return `<path d="M0 0 L${(Math.sin(rad) * r * 0.86).toFixed(1)} ${(-Math.cos(rad) * r * 0.86).toFixed(1)}"
                  stroke="${vein}" stroke-width="1.4" opacity=".55"/>`;
  }).join('');
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
    <path d="M0 0 L${x1} ${y1} A${r} ${r} 0 1 1 ${x2} ${y1} Z" fill="${color}"/>
    ${veins}
  </g>`;
}

/** 小花，只有這裡用暖色 —— 整個畫面的唯一暖點就靠它。 */
function bloom(x, y, s, petal = P.salmon, core = P.ink) {
  const petals = Array.from(
    { length: 8 },
    (_, i) =>
      `<ellipse cx="0" cy="-8" rx="3.2" ry="7.5" fill="${petal}" transform="rotate(${i * 45})"/>`,
  ).join('');
  return `<g transform="translate(${x} ${y}) scale(${s})">${petals}<circle r="3.4" fill="${core}"/></g>`;
}

/**
 * 流體大理石紋：幾條硬邊波浪帶疊起來。
 * 參考圖裡那種藍橘交錯的流動感，用平塗色帶就能做出來，不需要漸層或濾鏡。
 */
function marble(id, w, h, tones) {
  const bands = tones
    .map((tone, i) => {
      const y = (h / tones.length) * i;
      const amp = 8 + (i % 3) * 5;
      const drop = h / tones.length + amp;
      return `<path d="M-10 ${y}
        C ${w * 0.25} ${y - amp}, ${w * 0.4} ${y + amp * 1.6}, ${w * 0.62} ${y + amp * 0.3}
        S ${w * 0.9} ${y - amp}, ${w + 10} ${y + amp * 0.6}
        L ${w + 10} ${y + drop} L -10 ${y + drop} Z" fill="${tone}"/>`;
    })
    .join('');
  return `<clipPath id="${id}-clip"><rect width="${w}" height="${h}"/></clipPath>
          <g id="${id}" clip-path="url(#${id}-clip)">${bands}</g>`;
}

/* ── 卡框 ────────────────────────────────────────── */

/**
 * 紙白卡框：實心藏青投影 + 細垂直線 overlay + 角落的微小拉丁字。
 * 那些數字在參考裡是純裝飾（像印刷校版記號），這裡照做。
 */
function frame(inner, { tint = P.blue, code = '20220' } = {}) {
  const hair = Array.from(
    { length: 9 },
    (_, i) =>
      `<path d="M${16 + i * 22} 0 V240" stroke="${P.ink}" stroke-width="0.4" opacity=".13"/>`,
  ).join('');
  const clip = gid('fc');
  return `<svg viewBox="-6 -6 222 252" xmlns="http://www.w3.org/2000/svg" role="img">
    <clipPath id="${clip}"><rect width="210" height="240"/></clipPath>
    <rect x="4" y="6" width="210" height="240" fill="${P.ink}"/>
    <rect width="210" height="240" fill="${P.paper}"/>
    <g clip-path="url(#${clip})">${inner}${hair}</g>
    <text x="10" y="232" font-size="7" letter-spacing="2.2" fill="${P.ink}" opacity=".55"
          font-family="ui-monospace, Menlo, monospace">${code}</text>
    <circle cx="196" cy="16" r="4.5" fill="none" stroke="${tint}" stroke-width="1.4"/>
    <rect width="210" height="240" fill="none" stroke="${P.ink}" stroke-width="1.6"/>
  </svg>`;
}

/* ── 臉與頭髮 ────────────────────────────────────────── */

/**
 * 硬邊平塗的日系臉。參考裡沒有任何柔邊或漸層，五官都是實心色塊，
 * 但眼睛必須是「杏形 + 粗上眼線 + 藍虹膜 + 白高光」才會像人 ——
 * 早一版把眼睛畫成橫矩形，結果整張臉像戴護目鏡的機器人。
 */
function face({ eye = P.blue, mood = 'calm' } = {}) {
  const iris = (cx) => `
    <circle cx="${cx}" cy="111" r="6.4" fill="${eye}"/>
    <circle cx="${cx}" cy="111" r="3" fill="${P.inkDeep}"/>
    <circle cx="${cx + 2.6}" cy="108" r="2.1" fill="${P.paper}"/>`;
  const mouth =
    mood === 'smirk'
      ? `<path d="M99 142 q7 6 14 -1" stroke="${P.terracotta}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
      : mood === 'grim'
        ? `<path d="M98 143 h14" stroke="${P.terracotta}" stroke-width="2.6" stroke-linecap="round"/>`
        : `<path d="M100 141 q5 5 10 0" stroke="${P.terracotta}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;

  return `
    <path d="M64 108 q-6 0 -6 8 t6 9z" fill="${P.skinShade}"/>
    <path d="M146 108 q6 0 6 8 t-6 9z" fill="${P.skinShade}"/>
    <path d="M105 56 C143 56 146 82 146 104 C146 134 128 158 105 166
             C82 158 64 134 64 104 C64 82 67 56 105 56z" fill="${P.skin}"/>
    <path d="M105 56 C143 56 146 82 146 104 C146 134 128 158 105 166z" fill="${P.skinShade}" opacity=".22"/>

    <path d="M74 111 Q87 98 100 112 Q88 123 74 111z" fill="${P.paper}"/>
    <path d="M136 111 Q123 98 110 112 Q122 123 136 111z" fill="${P.paper}"/>
    ${iris(87)}
    ${iris(123)}
    <path d="M74 111 Q87 98 100 112" stroke="${P.inkDeep}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M136 111 Q123 98 110 112" stroke="${P.inkDeep}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M75 92 Q87 86 99 91" stroke="${P.inkDeep}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M135 92 Q123 86 111 91" stroke="${P.inkDeep}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M103 126 l5 6 l-7 0z" fill="${P.skinShade}"/>
    ${mouth}`;
}

/**
 * 瀏海。下緣是鋸齒狀的髮束，這是讓三個角色長得不一樣的主要手段。
 * shape: 'straight'（零）｜'soft'（蕙）｜'spiky'（刃）
 */
function fringe(color, shape) {
  const teeth = {
    straight: 'L140 76 L133 104 L122 70 L110 96 L99 68 L87 98 L77 72 L69 104',
    soft: 'L141 84 L131 108 L119 78 L105 104 L92 78 L80 108 L70 84',
    spiky: 'L142 70 L134 100 L126 64 L114 94 L104 60 L92 92 L82 66 L70 98',
  }[shape];
  return `<path d="M62 106 C58 58 80 42 105 42 C130 42 152 58 148 106 ${teeth} Z" fill="${color}"/>`;
}

/* ── 角色 ────────────────────────────────────────── */

/** 零 —— 零界守望者。直瀏海、鈷藍挑染，額前浮著一枚無重之環。 */
function zero() {
  const m = gid('mz');
  return frame(
    `<defs>${marble(m, 210, 240, [P.blue, P.blueMid, P.ink, P.bluePale])}</defs>
     ${pad(26, 208, 44, P.blueLight)}
     ${fern(188, 216, 0.85, P.bluePale, 16)}
     <path d="M0 178 L210 152 V240 H0z" fill="${P.blueLight}"/>
     <path d="M56 92 q-4 -46 49 -46 q53 0 49 46 v58 q-14 -34 -49 -34 q-35 0 -49 34z" fill="${P.ink}"/>
     ${face({ eye: P.blue })}
     ${fringe(P.ink, 'straight')}
     <path d="M68 96 q10 -40 37 -44 q-20 16 -24 44z" fill="${P.blue}"/>
     <path d="M150 66 q10 28 4 62 l-12 -40z" fill="${P.ink}"/>
     <circle cx="105" cy="34" r="14" fill="none" stroke="${P.blue}" stroke-width="3.5"/>
     <path d="M58 240 q10 -60 47 -68 q37 8 47 68z" fill="${P.paper}"/>
     <path d="M58 240 q10 -60 47 -68 v68z" fill="${P.paperDeep}"/>
     <use href="#${m}" transform="translate(70,196) scale(0.33,0.14)" opacity=".9"/>
     <path d="M105 172 l14 12 l-14 56 l-14 -56z" fill="${P.blue}"/>
     <path d="M105 172 l14 12 l-14 56z" fill="${P.blueDeep}"/>`,
    { tint: P.blue, code: '0G / 01' },
  );
}

/** 蕙 —— 見證者。柔瀏海加低雙束，肩上背著一本抹不掉的紀錄。 */
function hue() {
  return frame(
    `${pad(182, 42, 38, P.blueLight)}
     ${fern(22, 212, 0.95, P.blue, -14)}
     ${bloom(180, 198, 1.4)}
     <path d="M0 186 L210 164 V240 H0z" fill="${P.bluePale}"/>
     <path d="M54 92 q-4 -48 51 -48 q55 0 51 48 v52 q-14 -30 -51 -30 q-37 0 -51 30z" fill="${P.ink}"/>
     <path d="M50 120 q-14 44 -2 84 l26 -16 l-8 -66z" fill="${P.ink}"/>
     <path d="M160 120 q14 44 2 84 l-26 -16 l8 -66z" fill="${P.ink}"/>
     ${face({ eye: P.blueDeep })}
     ${fringe(P.ink, 'soft')}
     <path d="M70 100 q10 -42 35 -46 q-19 18 -22 46z" fill="${P.slate}"/>
     <path d="M58 240 q10 -60 47 -68 q37 8 47 68z" fill="${P.paper}"/>
     <path d="M58 240 q10 -60 47 -68 v68z" fill="${P.paperDeep}"/>
     <path d="M64 208 q41 -14 82 0 l0 12 q-41 -14 -82 0z" fill="${P.blue}"/>
     <g transform="translate(126,176) rotate(9)">
       <rect x="0" y="0" width="46" height="58" fill="${P.ink}"/>
       <rect x="-3" y="-3" width="46" height="58" fill="${P.salmon}"/>
       <rect x="-3" y="-3" width="10" height="58" fill="${P.terracotta}"/>
       <path d="M15 12 h21 M15 24 h21 M15 36 h14" stroke="${P.paper}" stroke-width="2.6"/>
     </g>`,
    { tint: P.salmon, code: '0G / 02' },
  );
}

/** 刃 —— 零重刃。尖瀏海加呆毛，手上是一把沒有重量的刀。 */
function ren() {
  const m = gid('mk');
  return frame(
    `<defs>${marble(m, 210, 240, [P.blue, P.salmon, P.ink, P.blueMid])}</defs>
     ${fern(196, 92, 0.75, P.blueLight, 24)}
     ${pad(18, 38, 32, P.blueLight)}
     <path d="M0 182 L210 158 V240 H0z" fill="${P.blueLight}"/>
     <path d="M56 90 q-4 -46 49 -46 q53 0 49 46 v54 q-14 -32 -49 -32 q-35 0 -49 32z" fill="${P.inkDeep}"/>
     <path d="M104 40 l30 -22 l-8 32z" fill="${P.inkDeep}"/>
     <path d="M82 42 l-28 -20 l10 32z" fill="${P.inkDeep}"/>
     ${face({ eye: P.blueMid, mood: 'smirk' })}
     ${fringe(P.inkDeep, 'spiky')}
     <path d="M70 92 q10 -38 35 -42 q-19 16 -22 42z" fill="${P.blue}"/>
     <path d="M106 44 l24 -16 l-7 24z" fill="${P.salmon}"/>
     <path d="M58 240 q10 -60 47 -68 q37 8 47 68z" fill="${P.ink}"/>
     <use href="#${m}" transform="translate(60,172) scale(0.44,0.3)" opacity=".9"/>
     <g transform="translate(156,124) rotate(26)">
       <path d="M0 0 h9 V-92 l-4.5 -14 l-4.5 14z" fill="${P.paper}"/>
       <path d="M4.5 -106 l4.5 14 V0 h-4.5z" fill="${P.bluePale}"/>
       <rect x="-5" y="0" width="19" height="7" fill="${P.salmon}"/>
       <rect x="1" y="7" width="7" height="26" fill="${P.inkDeep}"/>
     </g>`,
    { tint: P.blueMid, code: '0G / 03' },
  );
}

/** 遺忘者 —— 敵方 AI agent。沒有臉，只有一張不斷重算的遮罩。 */
export function forgetterPortrait() {
  const m = gid('mf');
  return frame(
    `<defs>${marble(m, 210, 240, [P.ink, P.salmon, P.inkDeep, P.blue, P.terracotta])}</defs>
     ${fern(22, 228, 1, P.paperDeep, -8)}
     ${fern(190, 228, 1, P.paperDeep, 8)}
     <path d="M105 24 q60 24 56 98 q-4 72 -56 92 q-52 -20 -56 -92 q-4 -74 56 -98z" fill="${P.inkDeep}"/>
     <clipPath id="${m}-mask">
       <path d="M105 38 q50 22 46 88 q-4 62 -46 80 q-42 -18 -46 -80 q-4 -66 46 -88z"/>
     </clipPath>
     <g clip-path="url(#${m}-mask)"><use href="#${m}"/></g>
     <g fill="${P.paper}">
       <rect x="70" y="100" width="28" height="8"/>
       <rect x="112" y="100" width="28" height="8"/>
       <rect x="64" y="120" width="18" height="5" opacity=".7"/>
       <rect x="128" y="120" width="18" height="5" opacity=".7"/>
       <rect x="84" y="140" width="42" height="5" opacity=".5"/>
     </g>
     <g stroke="${P.ink}" stroke-width="1.6">
       <path d="M49 78 h-26 M49 124 h-34 M49 168 h-26"/>
       <path d="M161 78 h26 M161 124 h34 M161 168 h26"/>
     </g>
     <circle cx="105" cy="124" r="7" fill="${P.salmon}"/>`,
    { tint: P.terracotta, code: 'NULL / 00' },
  );
}

/** 世界觀圖：0G —— 記憶沒有重量，所以葉子與礦石切片全部浮在水面上。 */
export function worldPortrait() {
  const m = gid('mw');
  const pads = [
    [32, 190, 26, 10],
    [78, 214, 30, -24],
    [128, 196, 24, 34],
    [172, 220, 27, 8],
    [104, 168, 18, 62],
  ]
    .map(([x, y, r, rot], i) => pad(x, y, r, i % 2 ? P.blue : P.blueMid, rot))
    .join('');
  return frame(
    `<defs>${marble(m, 210, 80, [P.blue, P.bluePale, P.ink, P.blueMid])}</defs>
     <path d="M0 152 L210 138 V240 H0z" fill="${P.blueLight}"/>
     <use href="#${m}" transform="translate(0,160)" opacity=".18"/>
     ${fern(30, 168, 1.05, P.ink, -16)}
     ${fern(184, 164, 0.95, P.ink, 18)}
     ${pads}
     ${bloom(52, 74, 1.5)}
     ${bloom(160, 56, 1.1)}
     <g transform="translate(105,86)">
       <path d="M-38 0 L0 -34 L38 0 L0 34z" fill="${P.paper}" stroke="${P.ink}" stroke-width="2.4"/>
       <path d="M-38 0 L0 -34 L0 34z" fill="${P.blue}"/>
       <path d="M0 -34 L38 0 L0 0z" fill="${P.blueLight}"/>
       <circle r="7.5" fill="${P.salmon}"/>
     </g>
     <text x="105" y="143" text-anchor="middle" font-size="18" font-weight="800"
           letter-spacing="7" fill="${P.ink}">0G</text>`,
    { tint: P.blue, code: 'WEIGHTLESS' },
  );
}

const HERO_ART = { zero, hue, ren };

export function heroPortrait(key) {
  return (HERO_ART[key] || zero)();
}

/*
 * 角色形象照。定稿用的是一張三格拼版原圖（順序：零 / 蕙 / 刃），
 * 直接整張放進來、靠 CSS background-position 切三等分，
 * 這樣只要丟一個檔案就好，不必先把圖裁成三張。
 * 圖不存在時自動退回上面那組 inline SVG，畫面不會開天窗。
 */
/**
 * 三格拼版的角色形象照，左到右 零 → 蕙 → 刃。
 *
 * 副檔名不只認 .png：手邊的原圖常常是 jpg/jpeg/webp，逼使用者先轉檔只是白白多一步，
 * 所以按順序試，載得起來的那個就是。找不到任何一個就退回 art.js 現畫的 inline SVG。
 */
const HERO_SHEET_CANDIDATES = [
  '/images/heroes.png',
  '/images/heroes.jpg',
  '/images/heroes.jpeg',
  '/images/heroes.webp',
];

/** 實際載到的那個檔案；還沒測到之前先給預設值，讓 CSS 至少有東西可指。 */
export let HERO_SHEET = HERO_SHEET_CANDIDATES[0];
const HERO_INDEX = { zero: 0, hue: 1, ren: 2 };

let sheetState = null; // null = 還沒測；true / false = 測過的結果

function tryLoad(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

/**
 * 四個候選同時載，不要一個一個等。
 *
 * 線上有 SPA fallback（找不到檔案就回 index.html 200），所以不存在的副檔名
 * 不會快速 404，而是回一整份 HTML 才失敗。依序試的話光是前兩個就足以讓
 * 簡報畫面先畫完、退回 SVG。平行跑就只花「最慢的那一個」的時間，
 * 再依候選順序挑第一個成功的，結果仍然是確定的。
 */
export async function probeHeroSheet() {
  if (sheetState !== null) return sheetState;
  const results = await Promise.all(HERO_SHEET_CANDIDATES.map(tryLoad));
  const hit = results.findIndex(Boolean);
  if (hit === -1) return (sheetState = false);
  HERO_SHEET = HERO_SHEET_CANDIDATES[hit];
  return (sheetState = true);
}

export const heroSheetReady = () => sheetState === true;

/** 從拼版圖切出某一格。三格等寬，所以 background-size 放大三倍再左右位移。 */
export function heroPhoto(key) {
  const i = HERO_INDEX[key] ?? 0;
  const node = document.createElement('div');
  node.className = 'hero-photo';
  node.style.backgroundImage = `url('${HERO_SHEET}')`;
  node.style.backgroundPosition = `${(i / 2) * 100}% 50%`;
  return node;
}

export function portrait(kind) {
  if (kind === 'forgetter') return forgetterPortrait();
  if (kind === 'world') return worldPortrait();
  return heroPortrait('zero');
}

/**
 * 場上的單位棋子：礦石切片的感覺 —— 硬邊多邊形 + 實心投影。
 * 英雄方是藍系、遺忘者是墨黑與鮭橘，隔著手機螢幕也分得出來。
 */
export function unitChip(u) {
  const foe = u.side === 'forgetter';
  const edge = foe ? PALETTE.terracotta : PALETTE.ink;
  const glyphFill = contrastOn(u.tone);
  return `<svg viewBox="-4 -4 72 72" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M32 4 L58 20 V48 L32 64 L6 48 V20z" fill="${PALETTE.ink}" transform="translate(3,4)"/>
    <path d="M32 4 L58 20 V48 L32 64 L6 48 V20z" fill="${u.tone}"/>
    <path d="M32 4 L58 20 V48 L32 64z" fill="${PALETTE.paper}" opacity=".16"/>
    <path d="M32 4 L58 20 V48 L32 64 L6 48 V20z" fill="none" stroke="${edge}" stroke-width="2"/>
    <text x="32" y="41" text-anchor="middle" font-size="23" font-weight="800" fill="${glyphFill}">${u.glyph}</text>
  </svg>`;
}

/** 記憶核心：礦石切片。血量越低，缺角越大、裂痕越深。 */
export function coreIcon(side, ratio) {
  const tone = side === 'hero' ? PALETTE.blue : PALETTE.ink;
  const accent = side === 'hero' ? PALETTE.bluePale : PALETTE.terracotta;
  const lit = Math.max(0, Math.min(1, ratio));
  const cut = 30 - lit * 26; // 血少 = 上緣被削掉一大塊
  return `<svg viewBox="-3 -3 78 78" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M36 6 L64 22 V50 L36 66 L8 50 V22z" fill="${PALETTE.ink}" transform="translate(3,4)"/>
    <path d="M36 6 L64 22 V50 L36 66 L8 50 V22z" fill="${PALETTE.paper}"/>
    <clipPath id="${gid('cc')}-c"><path d="M36 6 L64 22 V50 L36 66 L8 50 V22z"/></clipPath>
    <path d="M8 ${22 + cut} L64 ${14 + cut} V50 L36 66 L8 50z" fill="${tone}"/>
    <path d="M36 ${34 + cut * 0.4} L64 ${20 + cut} V50 L36 66z" fill="${accent}" opacity=".55"/>
    ${lit < 0.5 ? `<path d="M30 14 L40 32 L26 44 L42 62" stroke="${PALETTE.terracotta}" stroke-width="2.6" fill="none"/>` : ''}
    <path d="M36 6 L64 22 V50 L36 66 L8 50 V22z" fill="none" stroke="${PALETTE.ink}" stroke-width="2.2"/>
  </svg>`;
}

/** 標題 logo：礦石切片 + 一朵鮭橘小花當唯一暖點。 */
export function logoMark() {
  return `<svg viewBox="-6 -6 132 132" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M60 4 L112 34 V94 L60 124 L8 94 V34z" fill="${PALETTE.ink}" transform="translate(5,6)"/>
    <path d="M60 4 L112 34 V94 L60 124 L8 94 V34z" fill="${PALETTE.paper}"/>
    <path d="M60 4 L112 34 V94 L60 124z" fill="${PALETTE.blue}"/>
    <path d="M60 4 L112 34 L60 64z" fill="${PALETTE.blueMid}"/>
    <path d="M8 34 L60 64 L60 124 L8 94z" fill="${PALETTE.blueLight}"/>
    ${bloom(60, 64, 2.1)}
    <path d="M60 4 L112 34 V94 L60 124 L8 94 V34z" fill="none" stroke="${PALETTE.ink}" stroke-width="3"/>
  </svg>`;
}
