/**
 * 敵方 AI agent 的前端客戶端。
 *
 * 只負責：送棋盤 → 收決策 → 把每一手再 validate 一次才套用。
 * 伺服器已經過濾過一次，這裡再擋一次是因為前端才是真正的規則權威（rules.js），
 * 而且網路那端的東西本來就不該無條件相信。
 */

import { toAgentView, legalPlays, validate } from './rules.js';
import { FALLBACK_TAUNTS } from './story.js';

const TIMEOUT_MS = 11000;

const randomTaunt = () => FALLBACK_TAUNTS[Math.floor(Math.random() * FALLBACK_TAUNTS.length)];

/**
 * 問 AI agent 這回合要出什麼。
 * 永遠會回傳可以用的東西 —— 網路掛了也不能讓玩家卡在「思考中」。
 */
export async function askAgent(state, summary = '') {
  const view = toAgentView(state);
  const legal = legalPlays(state, 'forgetter');
  const offline = {
    plays: localPlays(state, legal),
    taunt: randomTaunt(),
    reason: '離線推演',
    provider: 'offline',
    providerLabel: '離線備援（前端）',
    model: null,
  };

  if (!legal.length) return { ...offline, plays: [], reason: '無牌可出' };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ view, legal, summary }),
    });
    if (!res.ok) return offline;
    const data = await res.json();

    // 最後一道關卡：伺服器說可以，也要通得過本地規則才算數。
    const plays = (Array.isArray(data.plays) ? data.plays : [])
      .filter((p) => p && typeof p.cardId === 'string' && Number.isInteger(p.lane))
      .slice(0, 4);

    return {
      plays,
      taunt: data.taunt || randomTaunt(),
      reason: data.reason || '',
      provider: data.provider || 'unknown',
      providerLabel: data.providerLabel || data.provider || '未知',
      model: data.model || null,
      note: data.note || null,
      // 這一回合的 TEE 證據（盤面雜湊、回應雜湊、簽名、簽章公鑰）。
      // 供應商沒回傳可驗證的材料時會是 null —— 前端必須照實顯示，不可以當成通過。
      evidence: data.evidence || null,
    };
  } catch {
    return offline;
  } finally {
    clearTimeout(timer);
  }
}

/** 純前端的備援決策，跟 Function 裡那份同樣邏輯，用在完全連不上的時候。 */
function localPlays(state, legal) {
  const cost = { GLITCH: 1, ERASER: 2, VOID: 2, PURGE: 3 };
  const plays = [];
  let compute = state.compute.forgetter;
  const pick = (cardId, lane) => {
    if (compute < cost[cardId]) return false;
    if (!legal.some((l) => l.cardId === cardId && l.lane === lane)) return false;
    plays.push({ cardId, lane });
    compute -= cost[cardId];
    return true;
  };

  // 敵人（玩家）越靠近 cell 2 越危險，優先擋那條迴廊
  const ranked = state.lanes
    .map((cells, lane) => {
      const idx = cells.findIndex((u) => u && u.side === 'hero');
      const count = cells.filter((u) => u && u.side === 'hero').length;
      return { lane, deep: idx === -1 ? -1 : cells.length - 1 - idx, count };
    })
    .sort((a, b) => b.deep - a.deep || b.count - a.count);

  for (const r of ranked) {
    if (r.count >= 2) pick('PURGE', r.lane);
    else if (r.count >= 1) pick('ERASER', r.lane);
  }
  for (const r of ranked) {
    if (compute <= 0) break;
    pick('ERASER', r.lane) || pick('GLITCH', r.lane);
  }
  return plays;
}

/** 把 AI 的每一手依序套用，跳過不合法的（棋盤會隨著前一手改變）。 */
export function applyAgentPlays(state, plays, applyPlay) {
  const applied = [];
  const events = [];
  for (const p of plays) {
    if (validate(state, 'forgetter', p.cardId, p.lane)) continue;
    events.push(...applyPlay(state, 'forgetter', p.cardId, p.lane));
    applied.push(p);
  }
  return { applied, events };
}
