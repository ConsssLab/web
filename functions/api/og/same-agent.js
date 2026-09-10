/**
 * POST /api/og/same-agent —— 驗證整場對戰是不是同一位 AI agent。
 *
 * 收下前端累積的每回合證據鏈（盤面雜湊、回應雜湊、簽名、簽章公鑰、模型），
 * 加上 /api/og/attest 拿到的 attestation，回報能證明到什麼程度。
 *
 * 這支刻意**不會**回傳單純的 true/false。能證明到哪一層取決於供應商給了什麼材料，
 * 把「只是紀錄一致」講成「已驗證」是這整個功能最容易犯、也最不該犯的錯。
 * 分級的定義見 tee.js 的 verifyChain。
 */

import { json, clampStr, clampInt, ogComputeConfig } from './_shared.js';
import { verifyChain, probeComputeModel } from './tee.js';

const MAX_BODY = 32 * 1024;
const MAX_TURNS = 12;

/** 只留白名單欄位，長度夾住 —— 這些字串會直接進畫面。 */
const normalizeTurn = (t) => ({
  turn: clampInt(t && t.turn, 1, 99, 1),
  boardHash: clampStr(t && t.boardHash, 70),
  responseHash: clampStr(t && t.responseHash, 70),
  signature: clampStr(t && t.signature, 400) || null,
  signer: clampStr(t && t.signer, 200) || null,
  measurement: clampStr(t && t.measurement, 200) || null,
  proofId: clampStr(t && t.proofId, 120) || null,
  // 實測 0G router 沒有回簽名，但每次回應都帶服務它的 provider 鏈上位址
  // （標頭 x-provider / body x_0g_trace.provider）。這是目前拿得到的最強身分。
  providerAddress: clampStr(t && t.providerAddress, 80) || null,
  model: clampStr(t && t.model, 60) || null,
  provider: clampStr(t && t.provider, 40) || null,
});

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: 'payload too large' }, 413);
    payload = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const chain = Array.isArray(payload && payload.chain)
    ? payload.chain.slice(0, MAX_TURNS).map(normalizeTurn)
    : [];
  // TEE 狀態由伺服器自己去 router 查，不採信前端送來的東西 ——
  // 這是要證明給玩家看的結論，材料不能由被證明的那一方提供。
  const probe = await probeComputeModel(ogComputeConfig(env));
  const attestation = probe.ok
    ? { modelInTee: probe.modelInTee, verifiability: probe.verifiability, teeType: probe.teeType, teeVerifier: probe.teeVerifier }
    : { error: probe.error || null };

  const verdict = verifyChain(chain, attestation);
  return json({
    ...verdict,
    // 逐回合攤開，讓畫面可以一格一格點亮，而不是只給一句結論
    perTurn: chain.map((t) => ({
      turn: t.turn,
      boardHash: t.boardHash,
      responseHash: t.responseHash,
      signed: Boolean(t.signature),
      signer: t.signer,
      providerAddress: t.providerAddress,
      model: t.model,
      // 「跟第一回合是不是同一個」—— 有簽章公鑰就比公鑰，沒有就比 provider 位址
      sameAsFirst: (() => {
        const mine = t.signer || t.providerAddress;
        const first = chain[0].signer || chain[0].providerAddress;
        return !mine || !first ? null : mine.toLowerCase() === first.toLowerCase();
      })(),
    })),
  });
}

export const onRequestGet = () => json({ error: 'use POST' }, 405);
