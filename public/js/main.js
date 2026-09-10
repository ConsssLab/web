/**
 * 遊戲主流程：標題 → 劇情 → 簡報 → 戰鬥 → 結果。
 *
 * 節奏是照「一分鐘打完」設計的：7 回合，每回合玩家出牌約 4 秒、
 * AI agent 思考 1～2 秒、結算動畫約 1 秒。AI 逾時會走備援，不會卡住玩家。
 */

import * as R from './rules.js';
import * as ART from './art.js';
import * as OG from './og.js';
import * as ZGS from './storage.js';
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
  agentPending: null,
  teeChain: [],
  teeVerdict: null,
  ogStatus: null,
  wallet: null,
  shard: null,
  anchorTx: null,
  storageRoot: null,
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
    // 用鏈上真實的 chainId 校準錢包參數，寫死會在 0G 換 chain ID 時整個切鏈失敗
    OG.calibrate(s);
    const chain = s.chain.ok
      ? `0G Galileo #${s.chain.blockNumber.toLocaleString()}`
      : '0G Galileo 連線失敗';
    // 敵方 agent（OpenAI）與旁白 agent（0G Compute）是兩個不同的服務，這裡報敵方那個
    const foe = s.enemyAgent || s.compute;
    const brain = foe.configured
      ? `敵方 agent：${foe.label} · ${foe.model}`
      : `敵方 agent：${foe.label}（未設金鑰，走本地備援）`;
    text.textContent = `${chain} ｜ ${brain}`;
    dot.dataset.state = s.chain.ok ? (foe.configured ? 'ok' : 'warn') : 'bad';
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

  renderHeroCards();
  show('brief');
}

/**
 * 三張英雄卡。抽出來是因為形象照的探測是非同步的 ——
 * 畫面可能先用 SVG 畫好，探測晚一點才回來說「圖其實在」，
 * 那時要能就地換成照片，不然玩家看到的永遠是備援版本。
 */
function renderHeroCards() {
  const heroes = $('brief-heroes');
  if (!heroes) return;
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
  game.teeChain = [];
  game.teeVerdict = null;
  game.shard = null;
  el.taunt.classList.add('is-empty');
  game.agentPending = null;
  show('battle');
  render();
  beginAgentThinking();
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

/**
 * 同時出牌：回合一開始就用「玩家還沒部署」的盤面去問 agent。
 *
 * 原本是等玩家按下結束回合、才把當前盤面送過去 —— 那等於它拿到你的答案卷才作答。
 * 在「逐條迴廊比火力」的規則下後手幾乎必勝：只要在你投重兵的那條放掉，
 * 另外兩條各補一點就淨賺。模擬顯示對上會下棋的對手，玩家勝率是 0%。
 *
 * 改成回合開始就送出，還有一個附帶好處：它的思考時間跟你的重疊，回合更順。
 * 它從舊盤面挑的手可能已經不合法（例如你用溯憶術清掉了它的出兵格附近），
 * applyAgentPlays 每一手都會 validate，不合法的自動略過 —— 這正是戰爭迷霧該有的樣子。
 */
function beginAgentThinking() {
  const snapshot = R.cloneState(game.state);
  const summary = `第 ${snapshot.turn} 回合，我方核心 ${snapshot.core.forgetter}，敵方核心 ${snapshot.core.hero}`;
  setAgentChip('AI agent 讀盤中…', true);
  // 刻意不 await：讓它在玩家思考的同時決策
  game.agentPending = askAgent(snapshot, summary).catch((err) => ({
    plays: [],
    taunt: '',
    reason: '',
    providerLabel: '本地備援',
    provider: null,
    model: null,
    error: String((err && err.message) || err),
  }));
}

async function endTurn() {
  if (game.busy || game.state.over) return;
  game.busy = true;
  game.selected = null;
  render();

  // ── 遺忘者（AI agent）回合 ──
  // 它在你部署之前就開始想了，這裡只是等它回來
  sfx.agent();
  const decision = await (game.agentPending || Promise.resolve({ plays: [], taunt: '', reason: '', providerLabel: '本地備援' }));
  game.agentPending = null;
  game.agentInfo = decision;

  const { applied } = applyAgentPlays(game.state, decision.plays, R.applyPlay);
  game.agentTurns.push({ turn: game.state.turn, plays: applied, taunt: decision.taunt });
  // TEE 證據鏈：有拿到才收，沒拿到就不收 —— 鏈的長度短於回合數本身就是一種訊號
  if (decision.evidence) game.teeChain.push(decision.evidence);

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
  beginAgentThinking(); // 新回合：它跟你同時開始想
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
  $('shard-narration').textContent = '';
  $('btn-anchor').disabled = true;
  $('btn-verify').disabled = true;
  $('btn-storage').disabled = true;
  $('proof').hidden = true;
  game.anchorTx = null;
  show('result');
  renderTracks();
  buildShard(result);
}

/**
 * 結果畫面的「0G 三賽道」面板。
 * 資料來源是 /api/og/status（開場就抓過一次），這裡只負責畫燈號與說明文字。
 * 沒設定就寫沒設定 —— 這面板是給評審看的，不能寫得比實際接上的還好看。
 */
function renderTracks(overrides = {}) {
  const s = game.ogStatus;
  const set = (key, state, text) => {
    const li = document.querySelector(`.track[data-track="${key}"]`);
    if (!li) return;
    li.querySelector('.track-dot').dataset.state = state;
    $(`track-${key}`).textContent = text;
  };

  if (!s) {
    set('compute', 'idle', '狀態讀取中…');
    set('storage', 'idle', '狀態讀取中…');
    set('chain', 'idle', '狀態讀取中…');
    return;
  }

  // 賽道一：戰後旁白跑在 0G Compute 上，敵方 agent 走 OpenAI，兩個都報
  const narrator = overrides.narrator;
  if (narrator && narrator.provider === '0g-compute') {
    set('compute', 'ok', `${narrator.model}${narrator.tee ? ' · TEE' : ''}`);
  } else if (s.compute.configured) {
    set('compute', 'ok', `${s.compute.model} · TEE 就緒`);
  } else {
    set('compute', 'warn', '未設金鑰，旁白走本地備援');
  }

  // 賽道二：indexer 通不通是一回事，有沒有設上傳端點是另一回事
  // 上傳現在是用玩家錢包在瀏覽器端做的，所以不再有「未設上傳端點」這回事：
  // indexer 通就代表可以傳，傳完就顯示 root。
  const st = overrides.storage;
  if (st && st.uploaded) {
    set('storage', 'ok', `已存檔${st.finalized ? '（finalized）' : ''} ${shortHash(st.root)}`);
  } else if (s.storage.live) {
    set('storage', 'ok', `indexer 連線正常（${s.storage.nodeCount} 節點）· 可上傳`);
  } else {
    set('storage', 'bad', 'indexer 連線失敗');
  }

  // 賽道三：先報鏈高度，錨定並回驗之後改報區塊與確認數
  const v = overrides.verify;
  if (v && v.found) {
    set(
      'chain',
      v.digestMatch === false ? 'warn' : 'ok',
      `#${v.blockNumber} · ${v.status} · 摘要${v.digestMatch ? '相符 ✓' : '不符'}`,
    );
  } else if (s.chain.ok) {
    set('chain', 'ok', `Galileo #${s.chain.blockNumber.toLocaleString()}`);
  } else {
    set('chain', 'bad', 'RPC 連線失敗');
  }
}

async function buildShard(result) {
  const summary = {
    result,
    turns: game.state.turn,
    heroCore: game.state.core.hero,
    forgetterCore: game.state.core.forgetter,
    agentModel: game.agentInfo.model || '',
  };

  // 賽道一：先請 0G Compute 上的「記憶編纂者」寫一段敘述，寫完才封進碎片，
  // 這樣三條賽道是串起來的 —— 0G 推論的產物會跟著上 0G Storage 與 0G Chain。
  let narrator = null;
  try {
    narrator = await OG.narrate(summary);
    if (narrator && narrator.narration) {
      $('shard-narration').textContent = narrator.narration;
      renderTracks({ narrator });
    }
  } catch {
    // 旁白拿不到不影響存檔，繼續往下走
  }

  try {
    const data = await OG.buildShard({
      ...summary,
      agentProvider: game.agentInfo.provider || 'unknown',
      narrator: narrator ? narrator.provider : '',
      narration: narrator ? narrator.narration : '',
      agentTurns: game.agentTurns,
      teeChain: game.teeChain,
    });
    game.shard = data;
    $('shard-digest').textContent = data.digest;
    $('shard-mode').textContent = data.storage.uploaded
      ? `0G Storage 已存檔${data.storage.txSeq !== null ? ` · txSeq ${data.storage.txSeq}` : ''}`
      : '本地摘要';
    $('shard-note').textContent =
      data.storage.note || '按下方按鈕，用你的錢包把這枚碎片錨定到 0G Galileo 測試網。';
    $('btn-anchor').disabled = false;
    $('btn-storage').disabled = false;
    renderTracks({ narrator, storage: data.storage });

    // 有 root 就再去問一次 indexer，確認檔案真的被 storage node 收下了
    if (data.storage.root) {
      OG.storageInfo(data.storage.root)
        .then((info) => {
          if (info && info.found) {
            $('shard-mode').textContent = `0G Storage 已存檔${info.finalized ? ' · finalized' : ''}`;
            const link = $('link-explorer');
            link.href = info.scanUrl;
            link.textContent = '在 0G Storage 上查看 ↗';
            link.classList.remove('is-disabled');
            link.removeAttribute('aria-disabled');
          }
        })
        .catch(() => {});
    }
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
  try {
    // 每一步都講出來。之前整段只顯示「錢包確認中…」，切鏈失敗時玩家看不出卡在哪。
    btn.textContent = '連接錢包…';
    note.textContent = '請在錢包視窗按下連接。';
    if (!game.wallet) game.wallet = await OG.connect();

    btn.textContent = '切換到 0G…';
    note.textContent = '正在確認錢包切到 0G Galileo 測試網。';
    await OG.ensureGalileo();

    btn.textContent = '等待簽名…';
    note.textContent = '錢包會跳出一筆 0 值交易，calldata 就是這枚記憶碎片的摘要。';
    const { txHash, explorerUrl } = await OG.anchorDigest(
      game.wallet,
      game.shard.calldata || game.shard.digest,
    );

    // 簽完立刻把交易連結交到玩家手上，不要讓他對著沒反應的畫面等
    game.anchorTx = txHash;
    const link = $('link-explorer');
    link.href = explorerUrl;
    link.textContent = '在區塊鏈上查看 ↗';
    link.classList.remove('is-disabled');
    link.removeAttribute('aria-disabled');
    btn.textContent = '已送出 · 等待打包';
    note.textContent = `${OG.shortAddress(game.wallet)} → ${txHash.slice(0, 18)}…　交易已送出，正在等它進區塊。`;
    $('btn-verify').disabled = false;

    // 自動輪詢回驗，直到讀得到為止（Galileo 出塊很快，通常兩三次就有）
    await pollVerify();
  } catch (err) {
    const msg = err && (err.message || err.reason) ? err.message || err.reason : String(err);
    note.textContent = /insufficient|balance/i.test(msg)
      ? `餘額不足付 gas。到 ${OG.FAUCET_URL} 領一點測試網 OG 再試一次。`
      : /user rejected|user denied|4001/i.test(msg)
        ? '你在錢包按了取消，沒有送出任何交易。'
        : /internal accounts cannot include data/i.test(msg)
          ? '錢包擋下了這筆交易（不允許對自己的帳戶送出帶資料的交易）。請重新整理頁面再試一次 —— 新版已改用合約建立交易繞開這個限制。'
          : msg.slice(0, 240);
    btn.textContent = '錨定到 0G Chain';
    btn.disabled = false;
  }
}

/** 交易剛送出通常還沒進區塊，每 3 秒回驗一次，最多試 8 次（約 24 秒）。 */
async function pollVerify(attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    await sleep(3000);
    const done = await verifyAnchor({ quiet: i < attempts - 1 });
    if (done) return true;
    $('shard-note').textContent = `交易已送出，等待進區塊…（第 ${i + 1} 次確認）`;
  }
  return false;
}

const RESULT_ZH = { hero: '零界守望者', forgetter: '遺忘者', draw: '和局' };
// 兩欄並排的空間有限，截短一點才不會一個換行一個不換行，反而難比對。
// 完整摘要在上方那個 code 區塊裡，要逐字比對看那邊。
const shortHash = (h) => (typeof h === 'string' && h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h || '—');

/**
 * 把回驗結果畫成「本地 vs 鏈上」的並排對照表。
 *
 * 光說一句「摘要相符」看不出在驗什麼。這張表把兩邊的值攤開擺著：
 * 左邊是本地這枚碎片，右邊是從 0G Chain 那筆交易的 calldata 解回來的，
 * 逐欄比對打勾。玩家（和評審）可以直接對照，也可以點連結去 chainscan 看原始 input。
 */
function renderProof(v) {
  const box = $('proof');
  const local = game.shard && game.shard.shard;
  if (!v || !v.found || !v.decoded || !v.decoded.recognized || !local) {
    box.hidden = true;
    return;
  }

  const rows = [
    ['摘要 SHA-256', shortHash(game.shard.digest), shortHash(v.decoded.digest), v.digestMatch === true],
    ['勝負', RESULT_ZH[local.result] || local.result, RESULT_ZH[v.decoded.result] || v.decoded.result, local.result === v.decoded.result],
    ['回合數', String(local.turns), String(v.decoded.turns), local.turns === v.decoded.turns],
    ['記憶核心', String(local.heroCore), String(v.decoded.heroCore), local.heroCore === v.decoded.heroCore],
  ];

  const tbody = $('proof-rows');
  tbody.innerHTML = '';
  for (const [field, mine, chain, ok] of rows) {
    const tr = document.createElement('tr');
    const td = (text, cls) => {
      const cell = document.createElement('td');
      if (cls) cell.className = cls;
      cell.textContent = text; // 鏈上讀回來的東西一律當不可信資料，不走 innerHTML
      return cell;
    };
    tr.appendChild(td(field, 'proof-field'));
    tr.appendChild(td(mine, 'proof-val'));
    tr.appendChild(td(chain, 'proof-val'));
    const mark = td(ok ? '✓' : '✗', 'proof-mark');
    mark.dataset.ok = String(Boolean(ok));
    tr.appendChild(mark);
    tbody.appendChild(tr);
  }

  const allOk = rows.every((r) => r[3]);
  const badge = $('proof-badge');
  badge.textContent = allOk ? '四項全部相符' : '有欄位不一致';
  badge.dataset.state = allOk ? 'ok' : 'bad';

  const parts = [`0G Galileo 區塊 #${v.blockNumber}`];
  if (v.confirmations !== null && v.confirmations !== undefined) parts.push(`${v.confirmations} 個確認`);
  if (v.status) parts.push(v.status === 'success' ? '交易成功' : v.status);
  parts.push(`tx ${shortHash(v.tx)}`);
  $('proof-meta').textContent = parts.join(' · ');

  box.hidden = false;
}

/**
 * 賽道二：把記憶碎片真的傳進 0G Storage。
 *
 * 整段用玩家自己的錢包做（算 merkle root → Flow 合約 submit → 傳 segment），
 * 伺服器不碰私鑰。傳完再回頭問一次 indexer，確認 storage node 真的收下了 ——
 * 跟賽道三一樣，「沒報錯」不算數，查得到才算。
 */
async function uploadToStorage() {
  if (!game.shard) return;
  const btn = $('btn-storage');
  const note = $('shard-note');
  const st = game.ogStatus && game.ogStatus.storage;
  btn.disabled = true;

  try {
    const { root, tx } = await ZGS.upload(game.shard.shard, {
      proxyBase: st && st.zgProxy,
      rpc: game.ogStatus && game.ogStatus.network && game.ogStatus.network.rpcUrl,
      onStep: (msg) => {
        btn.textContent = '上傳中…';
        note.textContent = msg;
      },
    });

    game.storageRoot = root;
    btn.textContent = '已存檔 ✓';
    $('shard-mode').textContent = '0G Storage 已存檔';
    note.textContent = `0G Storage root ${shortHash(root)}${tx ? `　submit tx ${shortHash(String(tx))}` : ''}`;
    renderTracks({ storage: { uploaded: true, root } });

    // 「在 0G Storage 上查看」要等真的查得到才開放。
    //
    // 之前是上傳完就直接把連結指到 storagescan 的 /file/<root>，結果點下去 404 ——
    // 那個站根本沒有這條路徑，檔案頁是用提交序號定位的（/submission/<txSeq>），
    // 而序號要跟 indexer 查了才知道。所以改成查到序號才解鎖按鈕；查不到就照實
    // 留成不可按，不要給玩家一個會 404 的連結。
    await pollStorage(root, note);
  } catch (err) {
    btn.textContent = '存進 0G Storage';
    btn.disabled = false;
    note.textContent = '診斷中…';
    // explainError 會再從瀏覽器打一次 indexer，跟伺服器端的結果交叉比對
    note.textContent = await ZGS.explainError(err, {
      proxyBase: st && st.zgProxy,
      serverSaysLive: Boolean(st && st.live),
    });
  }
}

/**
 * 上傳完之後跟 indexer 要這個檔案的提交序號，拿到才解鎖 storagescan 連結。
 *
 * 為什麼要輪詢：segment 傳完不等於索引好。節點要先把 log entry 同步進來，
 * indexer 才答得出 tx.seq。實測這中間有幾秒到十幾秒，馬上查通常是空的。
 *
 * 每一輪都照實更新畫面上那句話，不要讓玩家對著沒反應的按鈕猜。
 * 輪完還是沒有就維持不可按，並說明檔案已經上傳、只是還沒被索引到。
 */
async function pollStorage(root, note, attempts = 6) {
  const link = $('link-storage');

  for (let i = 0; i < attempts; i++) {
    let info = null;
    try {
      info = await OG.storageInfo(root);
    } catch {
      // indexer 查詢失敗不影響「已上傳」這件事，下一輪再試
    }

    if (info && info.found) {
      renderTracks({ storage: { uploaded: true, root, finalized: info.finalized } });
      note.textContent = `已存進 0G Storage${info.finalized ? '（已 finalized）' : '（同步中）'}　root ${shortHash(root)}`;

      if (info.scanUrl) {
        link.href = info.scanUrl;
        link.classList.remove('is-disabled');
        link.removeAttribute('aria-disabled');
        return true;
      }
    }

    if (i < attempts - 1) {
      note.textContent = `已存進 0G Storage　root ${shortHash(root)}　等待索引…（第 ${i + 1} 次查詢）`;
      await sleep(3000);
    }
  }

  note.textContent = `已存進 0G Storage　root ${shortHash(root)}　storagescan 還沒索引到這筆，稍後可用 root 自行查詢`;
  return false;
}

/**
 * 賽道一的收尾：驗證整場對戰是不是同一位 AI agent。
 *
 * 這跟「鏈上回驗」驗的不是同一件事 —— 那個驗資料有沒有真的上鏈，這個驗
 * 「跟你對打的對手中途有沒有被換掉」。做法是把每回合的證據（它看到的盤面雜湊、
 * 它回應的雜湊、enclave 簽名、簽章公鑰）串起來，看是不是同一把公鑰、
 * 而且那把公鑰對得上 attestation 裡的 enclave measurement。
 *
 * 結果分四級，刻意不做成通過／不通過：能證明到哪一層完全取決於供應商回了什麼。
 * 把「只是紀錄一致」畫成綠燈，比沒有這個功能更糟。
 */
/**
 * 等級的文案刻意分得很細，因為能證明到哪一層完全取決於供應商給了什麼材料。
 *
 * 實測 0G router **不隨回應附簽名**，但每次回應都帶服務它的 provider 鏈上位址
 * （標頭 x-provider）。所以現實中最常落在 same-provider —— 它是有意義的證據
 * （provider 中途被換掉會被抓到），但不是我們自己驗過的密碼學證明，文案必須講清楚。
 */
const TEE_BADGE = {
  attested: '已驗證 · enclave 等級',
  signed: '部分驗證 · 缺 attestation',
  'same-provider': '同一個 provider · TEE 模型',
  'same-provider-untrusted': '同一個 provider · 但非 TEE 模型',
  changed: '⚠ 中途換過 agent',
  consistent: '未驗證 · 僅紀錄一致',
  none: '無法驗證',
};

async function verifyTee() {
  const btn = $('btn-tee');
  const panel = $('tee');
  const reason = $('tee-reason');
  btn.disabled = true;
  btn.textContent = '驗證中…';

  try {
    // TEE 狀態由伺服器自己去 router 查 —— 要證明給玩家看的結論，
    // 材料不能由被證明的那一方（前端）提供。
    const res = await fetch('/api/og/same-agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chain: game.teeChain }),
    });
    if (!res.ok) throw new Error(`same-agent ${res.status}`);
    const v = await res.json();
    game.teeVerdict = v;

    const badge = $('tee-badge');
    badge.textContent = TEE_BADGE[v.level] || v.level;
    badge.dataset.level = v.level;
    reason.textContent = v.reason;

    // 逐回合亮燈：跟第一回合同一個身分＝藍、換過＝橘、完全沒身分＝空心。
    // 身分優先看簽章公鑰，沒有就看 provider 位址。
    const list = $('tee-turns');
    list.textContent = '';
    for (const t of v.perTurn || []) {
      const li = document.createElement('li');
      li.className = 'tee-turn';
      const identified = t.signed || Boolean(t.providerAddress);
      li.dataset.state = !identified ? 'unsigned' : t.sameAsFirst === false ? 'changed' : 'ok';
      const dot = document.createElement('span');
      dot.className = 'tee-turn-dot';
      const label = document.createElement('span');
      label.textContent = `第 ${t.turn} 回合`;
      li.append(dot, label);
      list.appendChild(li);
    }
    if (!(v.perTurn || []).length) {
      const li = document.createElement('li');
      li.className = 'tee-turn';
      li.dataset.state = 'unsigned';
      li.textContent = '這一場沒有任何回合留下證據';
      list.appendChild(li);
    }

    const meta = $('tee-meta');
    meta.textContent = '';
    const rows = [
      ['回合數', `${v.turns} 回合，其中 ${v.addressedTurns ?? 0} 回合帶有 provider 位址、${v.signedTurns} 回合帶有簽名`],
      ['模型', (v.models || []).join(' / ') || '—'],
      ['TEE 等級', v.verifiability ? `${v.verifiability}（TeeML 才是模型跑在 enclave 裡）` : '未取得'],
      ['provider 位址', v.providerAddress || '未取得或中途換過'],
      ['簽章公鑰', v.signer || '0G 目前不隨回應附簽名'],
      ['enclave measurement', v.measurement || '未取得'],
    ];
    for (const [k, val] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = val;
      meta.append(dt, dd);
    }

    panel.hidden = false;
    btn.textContent = '重新驗證';
  } catch (err) {
    panel.hidden = false;
    $('tee-badge').textContent = '驗證失敗';
    $('tee-badge').dataset.level = 'none';
    reason.textContent = `驗證請求本身失敗：${String((err && err.message) || err).slice(0, 120)}`;
    btn.textContent = 'TEE 驗證 · 是同一位 agent 嗎';
  } finally {
    btn.disabled = false;
  }
}

/**
 * 賽道三的收尾：把剛送出去的交易從 0G Chain 讀回來，重新解析 calldata 並比對摘要。
 * 「錢包沒報錯」不算證明，讀得回來、摘要對得上才算。
 */
async function verifyAnchor({ quiet = false } = {}) {
  if (!game.anchorTx || !game.shard) return false;
  const btn = $('btn-verify');
  const anchorBtn = $('btn-anchor');
  const note = $('shard-note');
  btn.disabled = true;
  if (!quiet) btn.textContent = '回驗中…';
  try {
    const v = await OG.verifyAnchor(game.anchorTx, game.shard.digest);
    renderTracks({ verify: v });

    if (!v.found) {
      btn.textContent = '鏈上回驗';
      btn.disabled = false;
      $('proof').hidden = true;
    $('tee').hidden = true;
    $('btn-tee').textContent = 'TEE 驗證 · 是同一位 agent 嗎';
      if (!quiet) note.textContent = '交易還沒進區塊，等幾秒再按一次回驗。';
      return false;
    }

    renderProof(v);

    btn.textContent = v.digestMatch ? '已回驗 ✓' : '回驗：摘要不符';
    anchorBtn.textContent = v.digestMatch ? '已上鏈 ✓' : '已上鏈（摘要不符）';
    note.textContent = v.digestMatch
      ? `已寫入 0G Galileo 區塊 #${v.blockNumber}（${v.confirmations} 個確認）。鏈上讀回的 calldata 解出 ${v.decoded.turns} 回合、核心 ${v.decoded.heroCore}，摘要與本地碎片相符 ✓`
      : `區塊 #${v.blockNumber}，但鏈上摘要與本地碎片不一致。`;
    if (!v.digestMatch) btn.disabled = false;
    return true;
  } catch (err) {
    btn.textContent = '鏈上回驗';
    btn.disabled = false;
    if (!quiet) note.textContent = String(err && err.message ? err.message : err).slice(0, 200);
    return false;
  }
}

function initResult() {
  $('btn-anchor').addEventListener('click', anchor);
  $('btn-verify').addEventListener('click', () => {
    sfx.tap();
    verifyAnchor({ quiet: false });
  });
  $('btn-storage').addEventListener('click', () => {
    sfx.tap();
    uploadToStorage();
  });
  $('btn-tee').addEventListener('click', () => {
    sfx.tap();
    verifyTee();
  });
  $('btn-again').addEventListener('click', () => {
    sfx.tap();
    $('btn-anchor').textContent = '錨定到 0G Chain';
    $('btn-verify').textContent = '鏈上回驗';
    $('btn-storage').textContent = '存進 0G Storage';
    const sl = $('link-storage');
    sl.href = 'https://storagescan-galileo.0g.ai';
    sl.classList.add('is-disabled');
    sl.setAttribute('aria-disabled', 'true');
    game.anchorTx = null;
    game.storageRoot = null;
    $('proof').hidden = true;
    const link = $('link-explorer');
    link.href = 'https://chainscan-galileo.0g.ai';
    link.textContent = '在區塊鏈上查看 ↗';
    link.classList.add('is-disabled');
    link.setAttribute('aria-disabled', 'true');
    startBattle();
  });
}

/* ══════════════ 啟動 ══════════════ */

// 探測結束後如果簡報畫面已經畫好了，就地把 SVG 換成形象照
ART.probeHeroSheet().then((ok) => {
  if (ok && el.screens.brief.classList.contains('is-active')) renderHeroCards();
});
initTitle();
initStory();
initBriefing();
initBattle();
initResult();
