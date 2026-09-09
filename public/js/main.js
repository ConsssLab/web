/**
 * 遊戲主流程：標題 → 劇情 → 簡報 → 戰鬥 → 結果。
 *
 * 節奏是照「一分鐘打完」設計的：7 回合，每回合玩家出牌約 4 秒、
 * AI agent 思考 1～2 秒、結算動畫約 1 秒。AI 逾時會走備援，不會卡住玩家。
 */

import * as R from './rules.js';
import * as ART from './art.js';
import * as OG from './og.js';
import { music, sfx } from './audio.js';
import { TITLE, OPENING, BRIEFING, HEROES, ENDINGS } from './story.js';
import { askAgent, applyAgentPlays } from './ai.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const el = {
  screens: {
    title: $('screen-title'),
    story: $('screen-story'),
    brief: $('screen-brief'),
    battle: $('screen-battle'),
    result: $('screen-result'),
  },
  board: $('board'),
  hand: $('hand'),
  compute: $('compute'),
  trayHint: $('tray-hint'),
  turnNum: $('turn-num'),
  heroBar: $('hero-bar'),
  foeBar: $('foe-bar'),
  heroHp: $('hero-hp'),
  foeHp: $('foe-hp'),
  heroCore: $('hero-core'),
  foeCore: $('foe-core'),
  agentChip: $('agent-chip'),
  agentChipText: $('agent-chip-text'),
  taunt: $('taunt'),
  tauntText: $('taunt-text'),
  tauntFace: $('taunt-face'),
};

const game = {
  state: null,
  selected: null,
  busy: false,
  agentInfo: { providerLabel: '尚未呼叫', provider: null, model: null },
  agentTurns: [],
  ogStatus: null,
  wallet: null,
  shard: null,
};

function show(name) {
  for (const [key, node] of Object.entries(el.screens)) {
    node.classList.toggle('is-active', key === name);
  }
  window.scrollTo(0, 0);
}

/* ══════════════ 標題 ══════════════ */

function initTitle() {
  $('title-logo').innerHTML = ART.logoMark();
  $('title-chapter').textContent = TITLE.chapter;
  $('btn-start').addEventListener('click', () => {
    sfx.tap();
    startStory();
  });
  $('btn-skip-story').addEventListener('click', () => {
    sfx.tap();
    showBriefing();
  });
  $('btn-music').addEventListener('click', (e) => {
    const on = music.toggle();
    e.currentTarget.textContent = on ? '♪ 音樂 開' : '♪ 音樂 關';
    e.currentTarget.setAttribute('aria-pressed', String(on));
  });
  loadOgStatus();
}

async function loadOgStatus() {
  const dot = document.querySelector('#og-strip .og-dot');
  const text = $('og-strip-text');
  try {
    const s = await OG.fetchStatus();
    game.ogStatus = s;
    const chain = s.chain.ok
      ? `0G Galileo #${s.chain.blockNumber.toLocaleString()}`
      : '0G Galileo 連線失敗';
    const brain = s.compute.configured
      ? `AI agent：${s.compute.label} · ${s.compute.model}`
      : `AI agent：${s.compute.label}（未設金鑰，走本地備援）`;
    text.textContent = `${chain} ｜ ${brain}`;
    dot.dataset.state = s.chain.ok ? (s.compute.configured ? 'ok' : 'warn') : 'bad';
  } catch {
    text.textContent = '0G 狀態讀取失敗 —— 遊戲仍可離線遊玩。';
    dot.dataset.state = 'bad';
  }
}

/* ══════════════ 劇情 ══════════════ */

let storyIndex = 0;

function startStory() {
  storyIndex = 0;
  show('story');
  renderStoryBeat();
}

function renderStoryBeat() {
  const beat = OPENING[storyIndex];
  if (!beat) return showBriefing();
  const art = $('story-art');
  // 劇情裡的英雄鏡頭同樣優先用原圖
  if (beat.portrait === 'hero' && ART.heroSheetReady()) {
    art.innerHTML = '';
    art.appendChild(ART.heroPhoto(beat.hero || 'zero'));
  } else {
    art.innerHTML = ART.portrait(beat.portrait);
  }
  art.style.animation = 'none';
  void art.offsetWidth;
  art.style.animation = '';
  $('story-speaker').textContent = beat.speaker;
  $('story-text').textContent = beat.text;
}

function initStory() {
  el.screens.story.addEventListener('click', (e) => {
    if (e.target.closest('#btn-story-skip')) return;
    sfx.tap();
    storyIndex += 1;
    renderStoryBeat();
  });
  $('btn-story-skip').addEventListener('click', (e) => {
    e.stopPropagation();
    sfx.tap();
    showBriefing();
  });
}

/* ══════════════ 簡報 ══════════════ */

function showBriefing() {
  const list = $('brief-list');
  list.innerHTML = '';
  for (const line of BRIEFING.lines) {
    const li = document.createElement('li');
    li.textContent = line;
    list.appendChild(li);
  }

  const heroes = $('brief-heroes');
  heroes.innerHTML = '';
  for (const h of HEROES) {
    const card = document.createElement('div');
    card.className = 'hero-card';
    if (ART.heroSheetReady()) card.appendChild(ART.heroPhoto(h.key));
    else card.innerHTML = ART.heroPortrait(h.key);
    const name = document.createElement('b');
    name.textContent = h.name;
    const role = document.createElement('span');
    role.textContent = h.role;
    card.append(name, role);
    heroes.appendChild(card);
  }
  show('brief');
}

function initBriefing() {
  $('btn-battle').addEventListener('click', () => {
    sfx.tap();
    startBattle();
  });
}

/* ══════════════ 戰鬥 ══════════════ */

function startBattle() {
  game.state = R.createState();
  game.selected = null;
  game.busy = false;
  game.agentTurns = [];
  game.shard = null;
  el.taunt.classList.add('is-empty');
  setAgentChip('AI agent 待命');
  show('battle');
  render();
}

function setAgentChip(text, thinking = false) {
  el.agentChipText.textContent = text;
  el.agentChip.classList.toggle('is-thinking', thinking);
}

function render() {
  const s = game.state;
  el.turnNum.textContent = String(Math.min(s.turn, R.MAX_TURNS));

  const heroRatio = Math.max(0, s.core.hero) / R.CORE_HP;
  const foeRatio = Math.max(0, s.core.forgetter) / R.CORE_HP;
  el.heroBar.style.width = `${heroRatio * 100}%`;
  el.foeBar.style.width = `${foeRatio * 100}%`;
  el.heroHp.textContent = String(Math.max(0, s.core.hero));
  el.foeHp.textContent = String(Math.max(0, s.core.forgetter));
  el.heroCore.innerHTML = ART.coreIcon('hero', heroRatio);
  el.foeCore.innerHTML = ART.coreIcon('forgetter', foeRatio);

  renderBoard();
  renderHand();
  renderCompute();
}

function renderBoard() {
  const s = game.state;
  el.board.innerHTML = '';
  for (let l = 0; l < R.LANES; l++) {
    const lane = document.createElement('div');
    lane.className = 'lane';
    lane.dataset.lane = String(l);

    const tag = document.createElement('span');
    tag.className = 'lane-tag';
    tag.textContent = R.LANE_NAMES[l];
    lane.appendChild(tag);

    // 壓制是主要傷害來源，火力對比一定要看得見
    let heroAtk = 0;
    let foeAtk = 0;
    for (const u of s.lanes[l]) {
      if (!u) continue;
      if (u.side === 'hero') heroAtk += u.atk;
      else foeAtk += u.atk;
    }
    const power = document.createElement('span');
    power.className = 'lane-power';
    power.dataset.hold = heroAtk > foeAtk ? 'hero' : foeAtk > heroAtk ? 'foe' : 'tie';
    power.textContent = `火力 ${heroAtk} : ${foeAtk}`;
    lane.appendChild(power);

    for (let c = 0; c < R.TRACK; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      if (c === 0) cell.classList.add('cell--spawn-hero');
      if (c === R.TRACK - 1) cell.classList.add('cell--spawn-foe');
      cell.dataset.cell = `${l}-${c}`;

      const u = s.lanes[l][c];
      if (u) {
        const box = document.createElement('div');
        box.className = 'unit';
        box.dataset.uid = String(u.uid);
        box.innerHTML = ART.unitChip(u);
        const atk = document.createElement('span');
        atk.className = 'unit-atk';
        atk.textContent = String(u.atk);
        const hp = document.createElement('span');
        hp.className = 'unit-hp';
        hp.textContent = String(u.hp);
        box.append(atk, hp);
        cell.appendChild(box);
      }
      lane.appendChild(cell);
    }

    if (game.selected) {
      const reason = R.validate(s, 'hero', game.selected, l);
      lane.classList.toggle('is-target', !reason);
      lane.classList.toggle('is-blocked', Boolean(reason));
      if (!reason) lane.addEventListener('click', () => playSelected(l));
    }
    el.board.appendChild(lane);
  }
}

function renderHand() {
  const s = game.state;
  el.hand.innerHTML = '';
  for (const card of Object.values(R.HERO_CARDS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card';
    btn.disabled = game.busy || !R.legalPlays(s, 'hero').some((p) => p.cardId === card.id);
    btn.classList.toggle('is-selected', game.selected === card.id);

    const glyph = document.createElement('span');
    glyph.className = 'card-glyph';
    glyph.style.background = card.tone;
    glyph.style.color = ART.contrastOn(card.tone);
    glyph.textContent = card.glyph;

    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = card.name;

    const stat = document.createElement('span');
    stat.className = 'card-stat';
    stat.textContent =
      card.kind === 'unit' ? `攻 ${card.atk} · 血 ${card.hp}` : `全體 ${card.dmg} 傷`;

    const cost = document.createElement('span');
    cost.className = 'card-cost';
    cost.textContent = `算力 ${card.cost}`;

    btn.append(glyph, name, stat, cost);
    btn.addEventListener('click', () => {
      sfx.tap();
      game.selected = game.selected === card.id ? null : card.id;
      el.trayHint.textContent = game.selected
        ? '點一條發亮的迴廊部署。'
        : '選一張牌，再點一條迴廊部署。';
      render();
    });
    el.hand.appendChild(btn);
  }
}

function renderCompute() {
  el.compute.innerHTML = '';
  const value = game.state.compute.hero;
  const num = document.createElement('span');
  num.className = 'compute-num';
  num.textContent = `算力 ${value}`;
  el.compute.appendChild(num);
  for (let i = 0; i < R.COMPUTE_CAP; i++) {
    const pip = document.createElement('span');
    pip.className = 'pip' + (i < value ? ' is-full' : '');
    el.compute.appendChild(pip);
  }
}

function playSelected(lane) {
  if (game.busy || !game.selected) return;
  const cardId = game.selected;
  if (R.validate(game.state, 'hero', cardId, lane)) return;

  const card = R.HERO_CARDS[cardId];
  card.kind === 'spell' ? sfx.spell() : sfx.deploy();
  R.applyPlay(game.state, 'hero', cardId, lane);

  // 出完之後如果同一張牌還付得起，就留著選取狀態，連續部署比較順手
  const stillLegal = R.legalPlays(game.state, 'hero').some((p) => p.cardId === cardId);
  game.selected = stillLegal ? cardId : null;
  el.trayHint.textContent = game.selected
    ? '點一條發亮的迴廊部署。'
    : '選一張牌，再點一條迴廊部署。';
  render();
}

async function endTurn() {
  if (game.busy || game.state.over) return;
  game.busy = true;
  game.selected = null;
  render();

  // ── 遺忘者（AI agent）回合 ──
  setAgentChip('AI agent 讀盤中…', true);
  sfx.agent();
  const summary = `第 ${game.state.turn} 回合，我方核心 ${game.state.core.forgetter}，敵方核心 ${game.state.core.hero}`;
  const decision = await askAgent(game.state, summary);
  game.agentInfo = decision;

  const { applied } = applyAgentPlays(game.state, decision.plays, R.applyPlay);
  game.agentTurns.push({ turn: game.state.turn, plays: applied, taunt: decision.taunt });

  const modelTag = decision.model ? ` · ${decision.model}` : '';
  setAgentChip(
    `${decision.providerLabel}${modelTag}${decision.reason ? ` · ${decision.reason}` : ''}`,
  );
  if (applied.length) sfx.deploy();
  render();

  if (decision.taunt) {
    el.tauntFace.innerHTML = ART.forgetterPortrait();
    el.tauntText.textContent = decision.taunt;
    el.taunt.classList.remove('is-empty');
  }
  await sleep(decision.taunt ? 900 : 350);

  // ── 結算 ──
  el.trayHint.textContent = '結算中…';
  const events = R.resolveCombat(game.state);
  await animateResolve(events);
  render();

  if (!game.state.over) {
    R.endRound(game.state);
  }

  if (game.state.over) {
    await sleep(500);
    finish();
    return;
  }

  el.taunt.classList.add('is-empty');
  el.trayHint.textContent = '選一張牌，再點一條迴廊部署。';
  game.busy = false;
  render();
}

/** 動畫刻意壓在 1 秒內：一分鐘的遊戲不能把時間花在等特效。 */
async function animateResolve(events) {
  const clashes = events.filter((e) => e.kind === 'clash');
  const breaks = events.filter((e) => e.kind === 'breakthrough');
  const controls = events.filter((e) => e.kind === 'control');

  if (controls.length) {
    for (const c of controls) {
      const laneNode = el.board.children[c.lane];
      if (laneNode) {
        laneNode.classList.add(c.side === 'hero' ? 'is-held-hero' : 'is-held-foe');
      }
      popDamage(c.side === 'hero' ? el.foeCore : el.heroCore, c.amount);
    }
    sfx.hit();
    await sleep(420);
  }

  if (clashes.length) {
    sfx.clash();
    for (const c of clashes) {
      for (const cellIdx of [c.cellA, c.cellB]) {
        const node = el.board.querySelector(`[data-cell="${c.lane}-${cellIdx}"] .unit`);
        if (node) node.classList.add('is-clashing');
      }
    }
    await sleep(320);
  }

  if (breaks.length) {
    sfx.hit();
    for (const b of breaks) popDamage(b.side === 'hero' ? el.foeCore : el.heroCore, b.amount);
    await sleep(420);
  }

  if (!clashes.length && !breaks.length && !controls.length) await sleep(220);
}

function popDamage(target, amount) {
  const pop = document.createElement('span');
  pop.className = 'float-dmg';
  pop.textContent = `-${amount}`;
  target.style.position = 'relative';
  target.appendChild(pop);
  setTimeout(() => pop.remove(), 800);
}

function initBattle() {
  $('btn-end').addEventListener('click', () => {
    sfx.tap();
    endTurn();
  });
}

/* ══════════════ 結果 + 0G 錨定 ══════════════ */

function finish() {
  const result = game.state.over;
  const ending = ENDINGS[result] || ENDINGS.draw;
  result === 'hero' ? sfx.win() : sfx.lose();

  $('result-en').textContent = ending.en;
  $('result-title').textContent = ending.title;
  const lines = $('result-lines');
  lines.innerHTML = '';
  for (const line of ending.lines) {
    const p = document.createElement('p');
    p.textContent = line;
    lines.appendChild(p);
  }

  $('shard-mode').textContent = '產生中…';
  $('shard-digest').textContent = '—';
  $('shard-note').textContent = '';
  $('btn-anchor').disabled = true;
  show('result');
  buildShard(result);
}

async function buildShard(result) {
  try {
    const data = await OG.buildShard({
      result,
      turns: game.state.turn,
      heroCore: game.state.core.hero,
      forgetterCore: game.state.core.forgetter,
      agentProvider: game.agentInfo.provider || 'unknown',
      agentModel: game.agentInfo.model || '',
      agentTurns: game.agentTurns,
    });
    game.shard = data;
    $('shard-digest').textContent = data.digest;
    $('shard-mode').textContent = data.storage.uploaded ? '0G Storage 已上傳' : '本地摘要';
    $('shard-note').textContent =
      data.storage.note || '按下方按鈕，用你的錢包把這枚摘要錨定到 0G Galileo 測試網。';
    $('btn-anchor').disabled = false;
  } catch (err) {
    $('shard-mode').textContent = '產生失敗';
    $('shard-note').textContent = String(err && err.message ? err.message : err);
  }
}

async function anchor() {
  const btn = $('btn-anchor');
  const note = $('shard-note');
  if (!game.shard) return;

  if (!OG.hasWallet()) {
    note.textContent =
      '找不到 EVM 錢包。請安裝 MetaMask，並到 faucet.0g.ai 領一點測試網 OG 當 gas。';
    return;
  }

  btn.disabled = true;
  btn.textContent = '錢包確認中…';
  try {
    if (!game.wallet) game.wallet = await OG.connect();
    const { txHash, explorerUrl } = await OG.anchorDigest(game.wallet, game.shard.digest);
    btn.textContent = '已錨定 ✓';
    note.textContent = `${OG.shortAddress(game.wallet)} 已送出：${txHash}`;
    const link = $('link-explorer');
    link.href = explorerUrl;
    link.textContent = '看這筆交易 ↗';
  } catch (err) {
    const msg = err && (err.message || err.reason) ? err.message || err.reason : String(err);
    note.textContent = /insufficient/i.test(msg)
      ? `餘額不足，請先到 ${OG.FAUCET_URL} 領測試網 OG。`
      : msg.slice(0, 200);
    btn.textContent = '錨定到 0G Chain';
    btn.disabled = false;
  }
}

function initResult() {
  $('btn-anchor').addEventListener('click', anchor);
  $('btn-again').addEventListener('click', () => {
    sfx.tap();
    $('btn-anchor').textContent = '錨定到 0G Chain';
    startBattle();
  });
}

/* ══════════════ 啟動 ══════════════ */

ART.probeHeroSheet();
initTitle();
initStory();
initBriefing();
initBattle();
initResult();
