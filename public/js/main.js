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

    const link = $('link-storage');
    link.href = `https://storagescan-galileo.0g.ai/file/${root}`;
    link.classList.remove('is-disabled');
    link.removeAttribute('aria-disabled');

    // 存完再跟 indexer 對一次，確認節點真的收下並完成同步
    try {
      const info = await OG.storageInfo(root);
      if (info && info.found) {
        renderTracks({ storage: { uploaded: true, root, finalized: info.finalized } });
        note.textContent = `已存進 0G Storage${info.finalized ? '（已 finalized）' : '（同步中）'}　root ${shortHash(root)}`;
        if (info.scanUrl) link.href = info.scanUrl;
      }
    } catch {
      // indexer 查詢失敗不影響「已上傳」這件事，畫面維持上一段的結果
    }
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
