/**
 * GET /api/og/attest —— 取得 0G Compute provider 的 attestation（遠端證明）。
 *
 * 這是「同一位 agent」證明鏈的第一環：attestation 報告裡有 enclave 的 measurement
 * （程式碼與模型的雜湊）與一把 enclave 內生成的公鑰，由硬體廠商與 0G 的驗證服務背書。
 * 有了它，才能主張「後面每回合的簽名確實出自這個 enclave」，而不只是「出自某把金鑰」。
 *
 * ── 為什麼要吃環境變數 ──
 *
 * attestation 的實際端點與回應格式，我們沒有辦法在建置環境裡打一次確認
 * （*.0g.ai 在那裡連不到）。與其猜一個網址寫死、然後在評審面前 404，
 * 不如讓它可設定：OG_COMPUTE_ATTESTATION_URL 指到哪就打哪。
 *
 * 沒設定時**照實回報沒設定**，不編造。前端會把它顯示成「未取得 attestation」，
 * 而不是綠燈 —— 這個功能的價值完全建立在「不說謊」上面。
 */

import { json, ogComputeConfig } from './_shared.js';
import { extractEvidence } from './tee.js';

const TIMEOUT_MS = 8000;

export async function onRequestGet({ env }) {
  const cfg = ogComputeConfig(env);
  const url = env.OG_COMPUTE_ATTESTATION_URL;

  if (!url) {
    return json({
      configured: false,
      endpoint: null,
      model: cfg.model,
      router: cfg.base,
      error:
        '未設定 OG_COMPUTE_ATTESTATION_URL。沒有 attestation 就無法證明簽章金鑰長在 enclave 裡 —— ' +
        '這種情況下最多只能證明「所有回合出自同一把金鑰」，畫面會照實標示。',
    });
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        accept: 'application/json',
        ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}),
      },
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 600) };
    }
    if (!res.ok) {
      return json({ configured: true, endpoint: url, ok: false, status: res.status, error: text.slice(0, 200) });
    }

    // 欄位名不押寶，跟每回合的簽名用同一套容忍抽取
    const found = extractEvidence(res.headers, body);
    return json({
      configured: true,
      endpoint: url,
      ok: Boolean(found.measurement || found.quote),
      measurement: found.measurement || null,
      publicKey: found.signer || null,
      quotePresent: Boolean(found.quote),
      model: cfg.model,
      router: cfg.base,
      raw: body,
    });
  } catch (err) {
    return json({
      configured: true,
      endpoint: url,
      ok: false,
      error: String(err && err.name === 'AbortError' ? '逾時' : (err && err.message) || err).slice(0, 200),
    });
  } finally {
    clearTimeout(timer);
  }
}
