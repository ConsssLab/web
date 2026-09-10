/**
 * 鏈州英雄傳 ConSSS Wars — 無重之憶 · Weightless Memory
 * 純規則層（deterministic，無 DOM、無網路），前端與 AI agent 提示共用同一份定義。
 *
 * 戰場：3 條「記憶迴廊」，每條 3 格。
 *   格子 0 = 玩家出兵格，格子 2 = 遺忘者出兵格。
 *   玩家單位每回合往右推進一格，走出格子 2 就打對方核心；遺忘者反之。
 * 一回合 = 玩家部署 → AI agent 部署 → 交戰 → 推進。
 */

/*
 * 這幾個數字是跑過對戰模擬調出來的，改動前請重跑一次：
 *   算力 2/回合 → 三條迴廊不可能全顧，每回合都得選要放掉哪一條（這是核心決策）。
 *   核心 12 + 壓制 2 → 好手大約第 6 回合收掉，落在「一分鐘」的預算內。
 */
export const LANES = 3;
export const TRACK = 3;
export const CORE_HP = 12;
export const MAX_TURNS = 7;
export const COMPUTE_PER_TURN = 2;
export const COMPUTE_CAP = 4;

export const LANE_NAMES = ['記憶迴廊 I', '記憶迴廊 II', '記憶迴廊 III'];

/** 玩家（零界守望者）的牌組。cost = 算力。 */
export const HERO_CARDS = {
  SENTINEL: {
    id: 'SENTINEL',
    name: '憶哨兵',
    en: 'Memory Sentinel',
    cost: 1,
    atk: 2,
    hp: 3,
    kind: 'unit',
    glyph: '哨',
    tone: '#3E9BE8',
  },
  BLADE: {
    id: 'BLADE',
    name: '零重刃',
    en: 'Zero-Weight Blade',
    cost: 2,
    atk: 4,
    hp: 3,
    kind: 'unit',
    glyph: '刃',
    tone: '#1B6FD0',
  },
  WITNESS: {
    id: 'WITNESS',
    name: '見證者',
    en: 'Witness',
    cost: 2,
    atk: 1,
    hp: 8,
    kind: 'unit',
    glyph: '證',
    tone: '#77BEEC',
  },
  RECALL: {
    id: 'RECALL',
    name: '溯憶術',
    en: 'Recall',
    cost: 3,
    kind: 'spell',
    dmg: 3,
    heal: 3,
    glyph: '憶',
    tone: '#0E4C8F',
  },
};

/**
 * 遺忘者（AI agent）的牌組。刻意「不」跟玩家鏡像對稱：
 * 英雄方打得重、遺忘者比較耐打。數值完全相同的話，雙方每回合互相抵銷，
 * 迴廊火力永遠打平，整局零傷害收在和局 —— 有落差才會分出控制權。
 */
export const FORGETTER_CARDS = {
  GLITCH: {
    id: 'GLITCH',
    name: '雜訊',
    en: 'Glitch',
    cost: 1,
    atk: 3,
    hp: 2,
    kind: 'unit',
    glyph: '訊',
    tone: '#E8926B',
  },
  ERASER: {
    id: 'ERASER',
    name: '抹除者',
    en: 'Eraser',
    cost: 2,
    atk: 3,
    hp: 4,
    kind: 'unit',
    glyph: '抹',
    tone: '#16283F',
  },
  VOID: {
    id: 'VOID',
    name: '虛數殼',
    en: 'Void Shell',
    cost: 2,
    atk: 2,
    hp: 7,
    kind: 'unit',
    glyph: '虛',
    tone: '#2E4B6E',
  },
  PURGE: {
    id: 'PURGE',
    name: '清算',
    en: 'Purge',
    cost: 3,
    kind: 'spell',
    dmg: 3,
    heal: 3,
    glyph: '清',
    tone: '#C4562E',
  },
};

export const cardsFor = (side) => (side === 'hero' ? HERO_CARDS : FORGETTER_CARDS);

/** 該陣營的出兵格。 */
export const spawnCell = (side) => (side === 'hero' ? 0 : TRACK - 1);
/** 該陣營的前進方向。 */
export const forward = (side) => (side === 'hero' ? 1 : -1);

let nextUid = 1;

export function createState(seed = Date.now()) {
  return {
    turn: 1,
    seed,
    phase: 'hero',
    lanes: Array.from({ length: LANES }, () => Array.from({ length: TRACK }, () => null)),
    core: { hero: CORE_HP, forgetter: CORE_HP },
    compute: { hero: COMPUTE_PER_TURN, forgetter: COMPUTE_PER_TURN },
    log: [],
    over: null,
  };
}

export function cloneState(s) {
  return JSON.parse(JSON.stringify(s));
}

/** 這一手是否合法？回傳 null 代表合法，否則回傳中文原因。 */
export function validate(state, side, cardId, lane) {
  if (state.over) return '戰鬥已結束';
  if (!Number.isInteger(lane) || lane < 0 || lane >= LANES) return '迴廊編號不存在';
  const card = cardsFor(side)[cardId];
  if (!card) return '沒有這張牌';
  if (state.compute[side] < card.cost) return '算力不足';
  if (card.kind === 'unit' && state.lanes[lane][spawnCell(side)]) return '出兵格已被佔據';
  return null;
}

export function legalPlays(state, side) {
  const out = [];
  for (const cardId of Object.keys(cardsFor(side))) {
    for (let lane = 0; lane < LANES; lane++) {
      if (!validate(state, side, cardId, lane)) out.push({ cardId, lane });
    }
  }
  return out;
}

/** 就地套用一手牌。呼叫前請先 validate。回傳這一手產生的事件，供動畫使用。 */
export function applyPlay(state, side, cardId, lane) {
  const card = cardsFor(side)[cardId];
  const events = [];
  state.compute[side] -= card.cost;

  if (card.kind === 'unit') {
    const cell = spawnCell(side);
    state.lanes[lane][cell] = {
      uid: nextUid++,
      side,
      type: card.id,
      name: card.name,
      glyph: card.glyph,
      tone: card.tone,
      atk: card.atk,
      hp: card.hp,
      maxHp: card.hp,
    };
    events.push({ kind: 'deploy', side, lane, cell, card: card.id });
  } else {
    const foe = side === 'hero' ? 'forgetter' : 'hero';
    for (let c = 0; c < TRACK; c++) {
      const u = state.lanes[lane][c];
      if (u && u.side === foe) {
        u.hp -= card.dmg;
        events.push({ kind: 'spellHit', lane, cell: c, amount: card.dmg });
      }
    }
    sweepDead(state, events);
    state.core[side] = Math.min(CORE_HP, state.core[side] + card.heal);
    events.push({ kind: 'heal', side, amount: card.heal });
  }
  return events;
}

function sweepDead(state, events) {
  for (let l = 0; l < LANES; l++) {
    for (let c = 0; c < TRACK; c++) {
      const u = state.lanes[l][c];
      if (u && u.hp <= 0) {
        events.push({ kind: 'death', lane: l, cell: c, side: u.side, uid: u.uid });
        state.lanes[l][c] = null;
      }
    }
  }
}

/**
 * 交戰 + 推進。雙方部署完之後跑一次。
 *
 * 1) 貼身（相鄰）的敵對單位互砍，雙方同時受傷。
 * 2) 其餘單位同時推進；兩個敵對單位想踏進同一格，就在迴廊中央撞上，原地互砍。
 * 3) 打贏還活著的單位「乘勝追擊」，同一回合就繼續前進 —— 沒有這條，
 *    雙方每回合都補一個擋路兵，戰線會永遠卡在中間變成無限平手。
 * 4) 走出戰場邊界的單位直接打對方核心，然後從場上消失。
 * 5) 壓制：交戰「之前」先比較每條迴廊雙方的總攻擊力，高的一方打對方核心。
 *    「誰站得住」改成「誰的火力大」，是為了打破鏡像僵局 —— 只看有沒有人的話，
 *    雙方每回合各補一個擋路兵就能鎖死全部三條迴廊，整局零傷害收在和局。
 *    比火力就一定會分出高下，玩家也有明確的施力點：這條要壓過去就得投更重的牌。
 *    先結算是因為交戰常常同歸於盡，等打完再看迴廊早就空了，投入多少都白費。
 *
 * 推進刻意「同時」結算：先算出所有單位的意圖再一起套用，
 * 否則先掃描到的一方會白撿一格，形成不公平的先手優勢。
 */
export const CONTROL_DAMAGE = 2;

export function resolveCombat(state) {
  const events = [];
  const engaged = new Set();

  // 1) 壓制：先看這回合誰在每條迴廊投入比較多火力
  for (let l = 0; l < LANES; l++) {
    let heroAtk = 0;
    let foeAtk = 0;
    for (const u of state.lanes[l]) {
      if (!u) continue;
      if (u.side === 'hero') heroAtk += u.atk;
      else foeAtk += u.atk;
    }
    if (heroAtk === foeAtk) continue; // 火力打平就沒有人拿到控制權
    const winner = heroAtk > foeAtk ? 'hero' : 'forgetter';
    const loser = winner === 'hero' ? 'forgetter' : 'hero';
    state.core[loser] -= CONTROL_DAMAGE;
    events.push({ kind: 'control', side: winner, lane: l, amount: CONTROL_DAMAGE });
  }

  // 2) 貼身交戰
  for (let l = 0; l < LANES; l++) {
    for (let c = 0; c < TRACK - 1; c++) {
      const a = state.lanes[l][c];
      const b = state.lanes[l][c + 1];
      if (!a || !b || a.side === b.side) continue;
      const dmgToB = a.atk;
      const dmgToA = b.atk;
      a.hp -= dmgToA;
      b.hp -= dmgToB;
      // 只有雙方都撐住才算被纏住；打贏的那個等一下可以繼續走
      if (a.hp > 0 && b.hp > 0) {
        engaged.add(a.uid);
        engaged.add(b.uid);
      }
      events.push({ kind: 'clash', lane: l, cellA: c, cellB: c + 1, dmgToA, dmgToB });
    }
  }
  sweepDead(state, events);

  // 3) 推進
  for (let l = 0; l < LANES; l++) {
    const lane = state.lanes[l];

    // 收集意圖。各陣營都從最前排開始，後面的才能遞補剛空出來的格子。
    const intents = [];
    for (let c = TRACK - 1; c >= 0; c--) {
      const u = lane[c];
      if (u && u.side === 'hero' && !engaged.has(u.uid)) intents.push({ u, from: c, to: c + 1 });
    }
    for (let c = 0; c < TRACK; c++) {
      const u = lane[c];
      if (u && u.side === 'forgetter' && !engaged.has(u.uid))
        intents.push({ u, from: c, to: c - 1 });
    }

    // 迎面對撞：兩個敵對單位指向同一格，就在那裡撞上並互砍。
    const blocked = new Set();
    const seen = new Set();
    for (const a of intents) {
      for (const b of intents) {
        if (a.u.side === b.u.side || a.to !== b.to) continue;
        if (seen.has(a.u.uid) || seen.has(b.u.uid)) continue;
        seen.add(a.u.uid);
        seen.add(b.u.uid);
        const dmgToA = b.u.atk;
        const dmgToB = a.u.atk;
        a.u.hp -= dmgToA;
        b.u.hp -= dmgToB;
        // 同樣的道理：對面倒下了就讓贏家走下去，否則兩邊卡住
        if (a.u.hp > 0 && b.u.hp > 0) {
          blocked.add(a.u.uid);
          blocked.add(b.u.uid);
        }
        events.push({ kind: 'clash', lane: l, cellA: a.from, cellB: b.from, dmgToA, dmgToB });
      }
    }
    sweepDead(state, events);

    for (const it of intents) {
      const { u, from, to } = it;
      if (u.hp <= 0 || blocked.has(u.uid)) continue;
      if (lane[from] !== u) continue; // 已經被清掉了
      if (to >= TRACK || to < 0) {
        const foe = u.side === 'hero' ? 'forgetter' : 'hero';
        state.core[foe] -= u.atk;
        lane[from] = null;
        events.push({ kind: 'breakthrough', side: u.side, lane: l, amount: u.atk, glyph: u.glyph });
      } else if (!lane[to]) {
        lane[to] = u;
        lane[from] = null;
        events.push({ kind: 'move', uid: u.uid, lane: l, from, to });
      }
    }
  }

  checkOver(state);
  return events;
}

export function checkOver(state) {
  const { hero, forgetter } = state.core;
  if (hero <= 0 && forgetter <= 0) state.over = 'draw';
  else if (forgetter <= 0) state.over = 'hero';
  else if (hero <= 0) state.over = 'forgetter';
  else if (state.turn > MAX_TURNS) {
    state.over = hero > forgetter ? 'hero' : forgetter > hero ? 'forgetter' : 'draw';
  }
  return state.over;
}

export function endRound(state) {
  state.turn += 1;
  for (const side of ['hero', 'forgetter']) {
    state.compute[side] = Math.min(COMPUTE_CAP, state.compute[side] + COMPUTE_PER_TURN);
  }
  checkOver(state);
}

/** 壓成給 AI agent 看的精簡棋盤。刻意不含 uid，讓提示穩定又短。 */
export function toAgentView(state) {
  return {
    turn: state.turn,
    maxTurns: MAX_TURNS,
    yourCoreHp: state.core.forgetter,
    enemyCoreHp: state.core.hero,
    yourCompute: state.compute.forgetter,
    lanes: state.lanes.map((cells, i) => ({
      lane: i,
      name: LANE_NAMES[i],
      cells: cells.map((u) =>
        u
          ? { owner: u.side === 'forgetter' ? 'you' : 'enemy', type: u.type, atk: u.atk, hp: u.hp }
          : null,
      ),
    })),
    yourSpawnCellOccupied: state.lanes.map((cells) => Boolean(cells[TRACK - 1])),
  };
}
