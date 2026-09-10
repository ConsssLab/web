/**
 * POST /api/narrate —— 賽道一：跑在 0G Compute Network 上的「記憶編纂者」。
 *
 * 這支跟 /api/agent 是兩個不同的 AI 角色，刻意分開跑在兩家推論供應商上：
 *
 *   /api/agent    敵方 AI agent「遺忘者」 → OpenAI API（對戰時要低延遲，每回合都叫）
 *   /api/narrate  戰後旁白「記憶編纂者」   → 0G Compute Network Router（一場只叫一次）
 *
 * 0G Compute 的服務跑在 TEE（可驗證推論）裡，Router 給的是 OpenAI 相容的
 * /chat/completions，所以同一套呼叫程式碼換 base URL 與金鑰就能切過去。
 * 這段旁白會被寫進記憶碎片，跟著上 0G Storage 與 0G Chain —— 三條賽道在這裡接起來。
 *
 * 沒設 OG_COMPUTE_API_KEY 就回本地模板文案，並照實標示「未接上 0G Compute」，不會假裝有接。
 */

import { json, ogComputeConfig, clampStr, clampInt } from './og/_shared.js';

const MAX_BODY = 8 * 1024;
const TIMEOUT_MS = 9000;
const MAX_NARRATION = 120;

const SYSTEM = `你是《鏈州英雄傳 ConSSS Wars》裡的「記憶編纂者」。
玩家剛在鏈國 0G 打完一場記憶迴廊的攻防，你要把這場戰鬥寫成一段要永久存進 0G Storage 的檔案敘述。

規則：
- 只寫兩句中文，總共不超過 50 個字。
- 第一句寫戰局實況（誰贏、打了幾回合、核心剩多少）。第二句寫這段記憶被封存的意象。
- 語氣冷靜、像檔案館的紀錄，不要用驚嘆號，不要自稱 AI，不要提到「模型」。
只輸出 JSON：{"narration":"兩句話","title":"6 字以內的碎片標題"}`;

/** 沒接上 0G Compute 時的本地文案：照樣有東西可存，但會標示來源是備援。 */
function localNarration(v) {
  const who =
    v.result === 'hero' ? '零界守望者守住了核心' : v.result === 'forgetter' ? '遺忘者吞掉了核心' : '雙方在核心前僵住';
  return {
    narration: `第 ${v.turns} 回合，${who}，記憶核心剩 ${v.heroCore} 點。這段迴廊被折疊成碎片，沉進無重的檔案層。`,
    title: '無重之憶',
  };
}

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

  const view = {
    result: ['hero', 'forgetter', 'draw'].includes(payload && payload.result) ? payload.result : 'draw',
    turns: clampInt(payload && payload.turns, 1, 99, 1),
    heroCore: clampInt(payload && payload.heroCore, -99, 99),
    forgetterCore: clampInt(payload && payload.forgetterCore, -99, 99),
    agentModel: clampStr(payload && payload.agentModel, 60),
  };

  const cfg = ogComputeConfig(env);
  const fallback = (note) =>
    json({
      ...localNarration(view),
      provider: 'fallback',
      providerLabel: '本地備援（未接上 0G Compute）',
      model: null,
      tee: false,
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
        temperature: 0.9,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(view) },
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

    const narration = clampStr(parsed.narration, MAX_NARRATION);
    const local = localNarration(view);
    return json({
      narration: narration || local.narration,
      title: clampStr(parsed.title, 20) || local.title,
      provider: cfg.id,
      providerLabel: cfg.label,
      model: cfg.model,
      // 0G Compute 的服務跑在 TEE 裡，Router 會在回應標頭帶驗證資訊
      tee: true,
      attestation: clampStr(res.headers.get('x-0g-attestation') || res.headers.get('x-tee-signature') || '', 80) || null,
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
