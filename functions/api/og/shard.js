/**
 * POST /api/og/shard —— 把一場戰鬥打包成「記憶碎片」。
 *
 * 這支同時服務兩條 0G 賽道，流程刻意分成兩段，因為兩段的信任模型不一樣：
 *
 *   賽道二 0G Storage：這支 Function 產生正規化後的碎片 JSON，算出 SHA-256 內容摘要，
 *     並在設定了 OG_STORAGE_UPLOAD_URL 時把檔案送進 0G Storage（gateway / indexer）。
 *     上傳成功會拿到 0G Storage 的 root hash 與 txSeq，可在 storagescan 上查到。
 *
 *   賽道三 0G Chain：這支只負責把要上鏈的 calldata 組好（魔術字 + 版本 + 戰績 + 摘要），
 *     真正送交易的是前端玩家自己的錢包。伺服器不保管任何私鑰。
 *
 * 沒設定 0G Storage 端點時回 mode:"local-digest"，前端照實顯示「未上傳」，不會謊稱有傳。
 */

import {
  json,
  sha256Hex,
  clampStr,
  clampInt,
  indexerOf,
  GALILEO,
  ANCHOR_MAGIC,
} from './_shared.js';

const MAX_BODY = 32 * 1024;
const UPLOAD_TIMEOUT_MS = 12000;

/** 只留白名單欄位，避免前端把任意內容塞進要上鏈 / 要進 0G Storage 的資料裡。 */
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
    narrator: clampStr(raw && raw.narrator, 40),
    narration: clampStr(raw && raw.narration, 300),
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

const RESULT_CODE = { hero: 1, forgetter: 2, draw: 0 };
const byte = (n) => (n & 0xff).toString(16).padStart(2, '0');

/**
 * 賽道三要送上 0G Chain 的 calldata。
 *
 *   [0..4)   魔術字 "CSSW"，讓 chainscan 上一眼認得出是本遊戲寫的
 *   [4]      格式版本
 *   [5]      勝負（0 和局 / 1 英雄 / 2 遺忘者）
 *   [6]      回合數
 *   [7]      英雄核心剩餘（uint8，負數補碼）
 *   [8..40)  碎片 JSON 的 SHA-256 摘要
 *
 * 固定 40 bytes，/api/og/verify 反過來就能從鏈上讀回來重新解析並比對。
 */
function buildCalldata(shard, digest) {
  return (
    '0x' +
    ANCHOR_MAGIC +
    byte(1) +
    byte(RESULT_CODE[shard.result] ?? 0) +
    byte(shard.turns) +
    byte(shard.heroCore) +
    digest.slice(2)
  );
}

/**
 * 賽道二：把碎片送進 0G Storage。
 *
 * 0G Storage 的寫入要先在鏈上送 Flow 合約的 submit（付費），再把 segment 傳給
 * storage node，所以正規做法是掛一個持有測試網私鑰的 0g-storage-client gateway，
 * 這支 Function 只負責把檔案轉發過去 —— Worker 裡不放私鑰。
 * 回傳裡的 root 就是 0G Storage 的 merkle root，可直接拿去 storagescan / indexer 查。
 */
async function uploadToStorage(env, shard, bytes) {
  const uploadUrl = env.OG_STORAGE_UPLOAD_URL;
  const indexer = indexerOf(env);

  if (!uploadUrl) {
    return {
      mode: 'local-digest',
      uploaded: false,
      indexer,
      note: '0G Storage 上傳端點未設定（OG_STORAGE_UPLOAD_URL），這一版只產生內容摘要。摘要照樣可以用錢包錨定到 0G Chain。',
    };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(uploadUrl, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'content-type': 'application/json',
        ...(env.OG_STORAGE_TOKEN ? { authorization: `Bearer ${env.OG_STORAGE_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        name: `memory-shard-${shard.createdAt}.json`,
        contentType: 'application/json',
        size: bytes.length,
        data: shard,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      return {
        mode: 'remote',
        uploaded: false,
        indexer,
        note: `0G Storage 上傳失敗 ${res.status}: ${text.slice(0, 160)}`,
      };
    }

    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 400) };
    }

    // gateway 實作之間欄位名不一致，常見的幾種都認一下。
    const root = clampStr(body.root || body.rootHash || body.fileRoot || '', 80);
    const txSeq = body.txSeq ?? body.tx_seq ?? null;
    return {
      mode: 'remote',
      uploaded: true,
      indexer,
      root: root || null,
      txSeq: txSeq === null ? null : clampInt(txSeq, 0, Number.MAX_SAFE_INTEGER),
      scanUrl: root ? `${GALILEO.storageScan}/file/${root}` : null,
      response: body,
    };
  } catch (err) {
    return {
      mode: 'remote',
      uploaded: false,
      indexer,
      note: String(err && err.message ? err.message : err).slice(0, 160),
    };
  } finally {
    clearTimeout(timer);
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

  const shard = normalize(payload);
  const bytes = new TextEncoder().encode(JSON.stringify(shard));
  const digest = await sha256Hex(bytes);
  const storage = await uploadToStorage(env, shard, bytes);

  return json({
    shard,
    digest,
    size: bytes.length,
    calldata: buildCalldata(shard, digest),
    storage,
  });
}

export const onRequestGet = () => json({ error: 'use POST' }, 405);
