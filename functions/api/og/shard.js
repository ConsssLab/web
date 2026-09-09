/**
 * POST /api/og/shard —— 把一場戰鬥打包成「記憶碎片」。
 *
 * 流程刻意分成兩段，因為兩段的信任模型不一樣：
 *   1. 這支 Function 產生正規化後的碎片 JSON，並算出 SHA-256 摘要。
 *   2. 前端拿著摘要，用玩家自己的錢包在 0G Galileo 送一筆 calldata 交易上鏈存證。
 *      鏈上那步用玩家的錢包，所以伺服器不需要、也不應該保管任何私鑰。
 *
 * 0G Storage 上傳需要 merkle 提交 + 有錢的帳號，不適合塞在 Worker 裡硬幹。
 * 設了 OG_STORAGE_UPLOAD_URL（自架 / 官方 gateway）就轉發過去，
 * 沒設就回 mode:"local-digest"，前端會照實顯示「未設定」，不會謊稱已上傳。
 */

const MAX_BODY = 32 * 1024;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const hex = (buf) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const clampInt = (v, lo, hi, dflt = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
};

const clampStr = (v, max) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F<>]/g, '').slice(0, max) : '';

/** 只留白名單欄位，避免前端把任意內容塞進要上鏈的資料裡。 */
function normalize(raw) {
  const result = ['hero', 'forgetter', 'draw'].includes(raw && raw.result) ? raw.result : 'draw';
  return {
    schema: 'conssswars/memory-shard@1',
    chapter: 'weightless-memory',
    result,
    turns: clampInt(raw && raw.turns, 1, 99, 1),
    heroCore: clampInt(raw && raw.heroCore, -99, 99),
    forgetterCore: clampInt(raw && raw.forgetterCore, -99, 99),
    agentProvider: clampStr(raw && raw.agentProvider, 40),
    agentModel: clampStr(raw && raw.agentModel, 60),
    agentTurns: Array.isArray(raw && raw.agentTurns)
      ? raw.agentTurns.slice(0, 12).map((t) => ({
          turn: clampInt(t && t.turn, 1, 99, 1),
          plays: Array.isArray(t && t.plays)
            ? t.plays.slice(0, 4).map((p) => ({
                cardId: clampStr(p && p.cardId, 16),
                lane: clampInt(p && p.lane, 0, 2),
              }))
            : [],
          taunt: clampStr(t && t.taunt, 60),
        }))
      : [],
    createdAt: new Date().toISOString(),
  };
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

  const shard = normalize(payload);
  const bytes = new TextEncoder().encode(JSON.stringify(shard));
  const digest = '0x' + hex(await crypto.subtle.digest('SHA-256', bytes));

  const uploadUrl = env.OG_STORAGE_UPLOAD_URL;
  if (!uploadUrl) {
    return json({
      shard,
      digest,
      size: bytes.length,
      storage: {
        mode: 'local-digest',
        uploaded: false,
        note: '0G Storage 尚未設定，這一版只產生摘要。按左邊按鈕就能用錢包把它錨定到 0G Chain。',
      },
    });
  }

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    const res = await fetch(uploadUrl, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'content-type': 'application/json',
        ...(env.OG_STORAGE_TOKEN ? { authorization: `Bearer ${env.OG_STORAGE_TOKEN}` } : {}),
      },
      body: JSON.stringify(shard),
    }).finally(() => clearTimeout(timer));

    const text = await res.text();
    if (!res.ok) {
      return json({
        shard,
        digest,
        size: bytes.length,
        storage: {
          mode: 'remote',
          uploaded: false,
          note: `上傳失敗 ${res.status}: ${text.slice(0, 160)}`,
        },
      });
    }
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 400) };
    }
    return json({
      shard,
      digest,
      size: bytes.length,
      storage: { mode: 'remote', uploaded: true, response: body },
    });
  } catch (err) {
    return json({
      shard,
      digest,
      size: bytes.length,
      storage: {
        mode: 'remote',
        uploaded: false,
        note: String(err && err.message ? err.message : err).slice(0, 160),
      },
    });
  }
}

export const onRequestGet = () => json({ error: 'use POST' }, 405);
