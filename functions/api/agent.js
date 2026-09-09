/**
 * POST /api/agent —— 遺忘者（敵方 AI agent）的大腦。
 *
 * 為什麼放在 Pages Function 而不是瀏覽器：API key 不能出現在前端 bundle 裡。
 * 這支就是唯一持有金鑰的地方，前端只送棋盤、只收回合決策。
 *
 * 供應商可切換，兩邊都是 OpenAI 相容的 /chat/completions：
 *   AI_PROVIDER=openai （預設，本版指定用 OpenAI API）
 *   AI_PROVIDER=0g     （改走 0G Compute Network Router，換 base URL 與金鑰即可）
 *
 * 模型輸出一律當成不可信資料：只挑白名單欄位、比對 legal 清單、夾在算力上限內，
 * 前端 rules.js 還會再 validate 一次。台詞用 textContent 塞進 DOM，不走 innerHTML。
 */

const OPENAI_BASE = 'https://api.openai.com/v1';
const OG_ROUTER_BASE = 'https://router-api.0g.ai/v1';

const MAX_BODY = 16 * 1024;
const MAX_PLAYS = 4;
const MAX_TAUNT = 60;
const TIMEOUT_MS = 9000;

const COST = { GLITCH: 1, ERASER: 2, VOID: 2, PURGE: 3 };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

function providerConfig(env) {
  const choice = String(env.AI_PROVIDER || 'openai').toLowerCase();
  if (choice === '0g' || choice === '0g-compute') {
    return {
      id: '0g-compute',
      label: '0G Compute Network Router',
      base: env.OG_COMPUTE_BASE_URL || OG_ROUTER_BASE,
      key: env.OG_COMPUTE_API_KEY,
      model: env.OG_COMPUTE_MODEL || 'deepseek-chat-v3-0324',
      keyName: 'OG_COMPUTE_API_KEY',
    };
  }
  return {
    id: 'openai',
    label: 'OpenAI API',
    base: env.OPENAI_BASE_URL || OPENAI_BASE,
    key: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL || 'gpt-4o-mini',
    keyName: 'OPENAI_API_KEY',
  };
}

const SYSTEM = `你是回合制策略遊戲《鏈之英雄傳 ConSSS Wars》裡的反派 AI agent「遺忘者」。
你在鏈國 0G 進攻對方的「記憶核心」。你要贏，也要有角色感。

戰場規則：
- 3 條迴廊（lane 0/1/2），每條 3 格（cell 0/1/2）。
- 你從 cell 2 出兵，往 cell 0 推進；敵人從 cell 0 出兵，往 cell 2 推進。
- 回合結算時：相鄰的敵對單位互砍（同時扣血）；迎面走進同一格的也會互砍。
- 沒被擋住的單位往前一格；走出邊界就對敵方核心造成等同攻擊力的傷害，然後消失。
- 你的出兵格（cell 2）被佔住時，那條迴廊這回合就不能再出兵。

你的牌（cost 是算力）：
- GLITCH 雜訊：cost 1，攻 3 血 2。打得痛但很脆，適合搶迴廊火力。
- ERASER 抹除者：cost 2，攻 3 血 4。耐打的主力。
- VOID 虛數殼：cost 2，攻 2 血 7。很難殺，適合卡住迴廊。
- PURGE 清算：cost 3，法術，對指定迴廊的所有敵方單位造成 3 傷，並回復自己核心 3 點。

重要：每回合交戰「之前」會先比較每條迴廊雙方的總攻擊力，高的一方對敵方核心造成 2 點壓制傷害。
所以「在哪條迴廊投入多少火力」比單純殺兵更重要 —— 即使單位當回合就陣亡，投入的火力一樣算數。

策略提示：敵方單位推進到 cell 1 或 2 時要優先處理；三條迴廊的火力都要顧，被壓制的迴廊每回合都在扣血；算力沒用完等於浪費。

只輸出 JSON，不要 markdown、不要多餘說明，格式如下：
{"plays":[{"cardId":"ERASER","lane":1}],"taunt":"20 字以內的中文嘲諷","reason":"12 字以內的中文決策理由"}
plays 依施放順序排列，總花費不可超過 yourCompute，且每一手都必須出現在 legalPlays 清單裡。`;

/**
 * 供應商掛掉時的備援：不呼叫網路，用簡單規則撐住演出，玩家不會卡住。
 * 目標是「像個像樣的對手」而不是最佳解 —— 擋住被入侵的迴廊、搶下沒人的迴廊
 * （空迴廊每回合會被壓制扣血，讓給對方等於白送傷害），最後把算力花乾淨。
 */
function heuristic(view, legal) {
  const plays = [];
  let compute = view.yourCompute;
  const canPlay = (cardId, lane) =>
    compute >= COST[cardId] && legal.some((p) => p.cardId === cardId && p.lane === lane);
  const take = (cardId, lane) => {
    if (!canPlay(cardId, lane)) return false;
    plays.push({ cardId, lane });
    compute -= COST[cardId];
    return true;
  };

  const lanes = view.lanes.map((l) => {
    const mine = l.cells.filter((c) => c && c.owner === 'you').length;
    const foes = l.cells.filter((c) => c && c.owner === 'enemy').length;
    // cell 索引越小代表敵人越靠近我方核心
    const deep = l.cells.findIndex((c) => c && c.owner === 'enemy');
    return { lane: l.lane, mine, foes, deep: deep === -1 ? 99 : deep };
  });

  // 1) 對方在這條迴廊有兩個以上單位 → 清算一次賺最多
  for (const l of [...lanes].sort((a, b) => b.foes - a.foes)) {
    if (plays.length >= MAX_PLAYS) break;
    if (l.foes >= 2) take('PURGE', l.lane);
  }

  // 2) 最深入的威脅優先擋。對方單位多就派虛數殼卡住，否則用抹除者換掉它
  for (const l of [...lanes].sort((a, b) => a.deep - b.deep)) {
    if (plays.length >= MAX_PLAYS || compute <= 0) break;
    if (l.deep === 99) continue;
    if (l.foes >= 2) take('VOID', l.lane) || take('ERASER', l.lane);
    else take('ERASER', l.lane) || take('GLITCH', l.lane);
  }

  // 3) 沒人的迴廊要占住，空著等於每回合白送壓制傷害
  for (const l of [...lanes].sort((a, b) => a.mine + a.foes - (b.mine + b.foes))) {
    if (plays.length >= MAX_PLAYS || compute <= 0) break;
    if (l.mine === 0) take('ERASER', l.lane) || take('GLITCH', l.lane);
  }

  // 4) 算力沒花完就是浪費
  for (const l of lanes) {
    if (plays.length >= MAX_PLAYS || compute <= 0) break;
    take('ERASER', l.lane) || take('VOID', l.lane) || take('GLITCH', l.lane);
  }
  return plays;
}

/** 模型回來的東西一律重新過濾：只留白名單欄位，且必須落在 legal 清單與算力預算內。 */
function sanitizePlays(raw, legal, budget) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  let spent = 0;
  for (const p of raw.slice(0, MAX_PLAYS)) {
    if (!p || typeof p !== 'object') continue;
    const cardId = String(p.cardId || '').toUpperCase();
    const lane = Number(p.lane);
    if (!(cardId in COST)) continue;
    if (!Number.isInteger(lane) || lane < 0 || lane > 2) continue;
    if (!legal.some((l) => l.cardId === cardId && l.lane === lane)) continue;
    if (spent + COST[cardId] > budget) continue;
    spent += COST[cardId];
    out.push({ cardId, lane });
  }
  return out;
}

// 去掉控制字元與角括號，長度也夾住：台詞會直接顯示在畫面上。
const sanitizeText = (v, max) =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u001F\u007F<>]/g, '')
        .trim()
        .slice(0, max)
    : '';

function extractJson(text) {
  if (typeof text !== 'string') return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: 'payload too large' }, 413);
    payload = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const view = payload && payload.view;
  const legal = Array.isArray(payload && payload.legal) ? payload.legal.slice(0, 64) : [];
  if (!view || !Array.isArray(view.lanes) || typeof view.yourCompute !== 'number') {
    return json({ error: 'invalid board state' }, 400);
  }

  const cfg = providerConfig(env);
  const fallback = (note) =>
    json({
      plays: heuristic(view, legal),
      taunt: '',
      reason: '本地啟發式',
      provider: 'fallback',
      providerLabel: '本地備援（未接上模型）',
      model: null,
      note,
    });

  if (!cfg.key) return fallback(`未設定 ${cfg.keyName}`);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.8,
        max_tokens: 320,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              board: view,
              legalPlays: legal,
              lastTurnSummary: sanitizeText(payload.summary, 200),
            }),
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return fallback(`${cfg.label} ${res.status}: ${detail.slice(0, 160)}`);
    }

    const data = await res.json();
    const message = data && data.choices && data.choices[0] && data.choices[0].message;
    const parsed = extractJson(message && message.content);
    if (!parsed) return fallback(`${cfg.label} 回傳無法解析`);

    const plays = sanitizePlays(parsed.plays, legal, view.yourCompute);
    return json({
      plays: plays.length ? plays : heuristic(view, legal),
      usedFallbackPlays: plays.length === 0,
      taunt: sanitizeText(parsed.taunt, MAX_TAUNT),
      reason: sanitizeText(parsed.reason, 40),
      provider: cfg.id,
      providerLabel: cfg.label,
      model: cfg.model,
    });
  } catch (err) {
    return fallback(
      err && err.name === 'AbortError' ? `${cfg.label} 逾時` : String(err).slice(0, 160),
    );
  } finally {
    clearTimeout(timer);
  }
}

export const onRequestGet = () => json({ error: 'use POST' }, 405);
