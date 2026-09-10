/**
 * TEE 證據的抽取與驗證。
 *
 * 我們想證明的一件事：**跟你對打的 AI agent，整場七回合都是同一位，中途沒被換掉。**
 *
 * 0G Compute 的做法是：provider 啟動時在 enclave 內生成一組簽章金鑰，私鑰永遠不出
 * enclave；CPU/GPU 的 attestation 報告把那把公鑰綁定到這個 enclave 環境（含程式碼與
 * 模型的 measurement）。之後每一次推論的回應都用那把 enclave 私鑰簽名。
 *
 * 於是「同一位」的證明就是：
 *   1. 每回合的回應都有簽名，且
 *   2. 所有簽名都能用同一把公鑰驗過，且
 *   3. 那把公鑰綁定的 measurement 從頭到尾沒變。
 *
 * ── 這支為什麼寫得這麼「容忍」──
 *
 * 0G 把驗證材料放在回應的哪個欄位、標頭叫什麼名字，我們沒有辦法在開發環境裡實際打一次
 * 確認（docs.0g.ai 在我們的建置環境連不到）。所以這裡不押寶在單一欄位名上：
 * 標頭與 JSON 樹都走訪一遍，看到像簽名 / 公鑰 / measurement 的鍵就收下來。
 *
 * 最重要的原則：**抽不到就回報抽不到**。寧可讓畫面顯示「供應商沒有回傳簽名」，
 * 也不要因為欄位名猜錯就假裝驗過了 —— 那比沒有這個功能更糟。
 */

import { sha256Hex, ogComputeConfig } from './_shared.js';

/** 這些鍵名任一出現（不分大小寫、忽略底線與連字號）就當成該類材料。 */
const KEYS = {
  signature: ['signature', 'sig', 'responsesignature', 'teesignature', 'ogsignature', 'proofsignature'],
  signer: ['signeraddress', 'signingaddress', 'signer', 'publickey', 'pubkey', 'signingkey', 'teepublickey', 'providerpubkey'],
  measurement: ['measurement', 'mrenclave', 'mrsigner', 'enclavemeasurement', 'codehash', 'imagehash', 'rtmr'],
  quote: ['quote', 'attestation', 'attestationreport', 'rareport', 'teequote', 'evidence'],
  proofId: ['proofid', 'proof', 'requestid', 'inferenceid', 'resid', 'reskey'],
  // 實測回應裡真正拿得到的身分：服務這一次推論的 provider 鏈上位址。
  // 標頭是 x-provider，body 是 x_0g_trace.provider，兩邊同值。
  providerAddress: ['provider', 'provideraddress'],
};

const norm = (k) => String(k).toLowerCase().replace(/[-_\s]/g, '');

/** 值要像個「證據」：夠長的字串或 hex，不是 true/1 這種佔位。 */
function usable(v) {
  if (typeof v === 'string') return v.trim().length >= 8;
  if (v && typeof v === 'object') return Object.keys(v).length > 0;
  return false;
}

const shorten = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 400 ? s.slice(0, 400) + '…' : s;
};

/**
 * 走訪整棵 JSON 樹 + 回應標頭，把各類材料撈出來。
 * 同一類撈到多個時取第一個 —— 巢狀越淺的越可能是正主，所以用廣度優先。
 */
export function extractEvidence(headers, body) {
  const found = {};
  const take = (kind, value) => {
    if (!found[kind] && usable(value)) found[kind] = typeof value === 'string' ? value.trim() : value;
  };

  if (headers && typeof headers.forEach === 'function') {
    headers.forEach((value, name) => {
      const n = norm(name).replace(/^x/, '');
      for (const [kind, names] of Object.entries(KEYS)) {
        if (names.some((k) => n === k || n.endsWith(k))) take(kind, value);
      }
    });
  }

  const queue = [body];
  let guard = 0;
  while (queue.length && guard++ < 500) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) { queue.push(...node.slice(0, 32)); continue; }
    for (const [k, v] of Object.entries(node)) {
      const n = norm(k);
      for (const [kind, names] of Object.entries(KEYS)) {
        if (names.includes(n)) take(kind, v);
      }
      if (v && typeof v === 'object') queue.push(v);
    }
  }
  return found;
}

/**
 * 查這個 key 在 router 上看得到哪些模型，並回報設定的那個是什麼狀態。
 *
 * 為什麼要查：我們的預設模型名曾經寫成 router 上根本不存在的 deepseek-chat-v3-0324，
 * 每一回合都拿到 404 → 靜靜退回本地啟發式。整段期間狀態燈是綠的，因為當時只檢查
 * 「有沒有設金鑰」。有金鑰不代表叫得動那個模型。
 *
 * 順便把 verifiability 一起回報，因為它決定 TEE 的主張成不成立：
 *   TeeML    模型本身跑在 TEE 裡          ← 只有這個撐得起「同一位 agent」
 *   TeeTLS   TEE 只終結 TLS，推論在上游廠商那邊
 *   （沒有） 完全沒有 TEE
 */
export async function probeComputeModel(cfg, timeoutMs = 6000) {
  if (!cfg.key) return { ok: false, error: `未設定 ${cfg.keyName}` };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.base.replace(/\/+$/, '')}/models`, {
      signal: ac.signal,
      headers: { authorization: `Bearer ${cfg.key}`, accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, error: `models ${res.status}` };
    const data = await res.json();
    const list = Array.isArray(data && data.data) ? data.data : [];
    const hit = list.find((m) => m && m.id === cfg.model);
    if (!hit) {
      return {
        ok: false,
        available: list.length,
        error: `router 上沒有 ${cfg.model} 這個模型`,
        teeModels: list.filter((m) => m && m.verifiability === 'TeeML').map((m) => m.id).slice(0, 8),
      };
    }
    return {
      ok: true,
      available: list.length,
      verifiability: hit.verifiability || null,
      teeAttested: Boolean(hit.tee_attested),
      teeType: hit.tee_type || null,
      teeVerifier: hit.tee_verifier || null,
      // TeeTLS 只保證傳輸層在 enclave 裡，推論本身不是 —— 不能拿來主張「同一位 agent」
      modelInTee: hit.verifiability === 'TeeML',
    };
  } catch (err) {
    return { ok: false, error: err && err.name === 'AbortError' ? 'models 逾時' : String(err).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

/** 這一回合的證據封包。boardHash 綁住「它看到的盤面」，responseHash 綁住「它說了什麼」。 */
export async function sealTurn({ turn, view, legal, rawResponse, headers, body, model, provider }) {
  const evidence = extractEvidence(headers, body);
  const enc = new TextEncoder();
  return {
    turn,
    // 盤面雜湊用送出去的原始內容算，之後可以重算比對，證明沒有被事後修改
    boardHash: await sha256Hex(enc.encode(JSON.stringify({ board: view, legalPlays: legal }))),
    responseHash: await sha256Hex(enc.encode(String(rawResponse || ''))),
    model: model || null,
    provider: provider || null,
    signature: evidence.signature ? shorten(evidence.signature) : null,
    signer: evidence.signer ? shorten(evidence.signer) : null,
    providerAddress: evidence.providerAddress ? shorten(evidence.providerAddress) : null,
    measurement: evidence.measurement ? shorten(evidence.measurement) : null,
    proofId: evidence.proofId ? shorten(evidence.proofId) : null,
  };
}

/**
 * 驗一整場：所有回合是不是同一位 agent。
 *
 * 回傳的 level 是刻意分級的，因為能證明到什麼程度取決於供應商給了什麼：
 *
 *   attested       有簽名、同一把公鑰，而且公鑰對得上 attestation 的 measurement
 *                  → 這才是「enclave 等級」的證明
 *   signed         有簽名、同一把公鑰，但拿不到 attestation
 *                  → 證明所有回應出自同一把金鑰，但沒證明那把金鑰真的長在 enclave 裡
 *   changed        有簽名，但公鑰中途換過
 *                  → 這是**否定**的結果，不是中性的。它正是「agent 被換掉」的樣子，
 *                    必須顯眼地講出來，不能跟「沒拿到材料」混為一談
 *   consistent     沒有（或只有部分）簽名，只有「每回合供應商與模型都相同」
 *                  → 這只是我們自己伺服器的紀錄，你得相信我們。不是密碼學證明。
 *   none           連一回合的紀錄都沒有，或供應商／模型本身就換過
 *
 * 前端必須照這個分級顯示，不可以把 consistent 畫成綠燈。
 */
export function verifyChain(chain, attestation) {
  const turns = Array.isArray(chain) ? chain : [];
  if (turns.length === 0) return { level: 'none', ok: false, turns: 0, reason: '沒有任何回合的紀錄' };

  const lower = (v) => (v ? String(v).toLowerCase() : null);
  const signers = new Set(turns.map((t) => lower(t.signer)).filter(Boolean));
  const addresses = new Set(turns.map((t) => lower(t.providerAddress)).filter(Boolean));
  const models = new Set(turns.map((t) => t.model).filter(Boolean));
  const providers = new Set(turns.map((t) => t.provider).filter(Boolean));
  const signed = turns.filter((t) => t.signature).length;
  const addressed = turns.filter((t) => t.providerAddress).length;

  const allSigned = signed === turns.length;
  const allAddressed = addressed === turns.length;
  const sameSigner = signers.size === 1;
  const sameAddress = addresses.size === 1;
  const sameModel = models.size <= 1;
  const sameProvider = providers.size <= 1;

  const attestedKey = (attestation && (attestation.publicKey || attestation.signer)) || null;
  const keyMatches =
    Boolean(attestedKey) && sameSigner
      ? String([...signers][0]).includes(String(attestedKey).toLowerCase().slice(0, 16))
      : false;
  const modelInTee = Boolean(attestation && attestation.modelInTee);

  let level;
  if (signers.size > 1 || addresses.size > 1) level = 'changed';
  else if (allSigned && sameSigner && keyMatches && attestation && attestation.measurement) level = 'attested';
  else if (allSigned && sameSigner) level = 'signed';
  else if (allAddressed && sameAddress && modelInTee) level = 'same-provider';
  else if (allAddressed && sameAddress) level = 'same-provider-untrusted';
  else if (sameModel && sameProvider) level = 'consistent';
  else level = 'none';

  const teeTag = attestation && attestation.verifiability ? `（${attestation.verifiability}${attestation.teeType ? ' · ' + attestation.teeType : ''}）` : '';
  const reason = {
    attested: '每回合都有簽名、同一把 enclave 公鑰，且對得上 attestation 的 measurement',
    signed: `每回合都有簽名且出自同一把公鑰，但沒取得 attestation${attestation && attestation.error ? `（${attestation.error}）` : ''}，無法證明那把金鑰長在 enclave 裡`,
    'same-provider': `每一回合都由同一個 provider（${[...addresses][0]}）服務，而該模型在 router 上登記為在 TEE 內執行${teeTag}。0G 目前不隨回應附簽名，所以這一級靠的是 router 的回報，不是我們自己驗過的密碼學證明`,
    'same-provider-untrusted': `每一回合都由同一個 provider（${[...addresses][0]}）服務，但該模型沒有登記為在 TEE 內執行 —— 換一個 verifiability = TeeML 的模型才撐得起 TEE 的主張`,
    changed: signers.size > 1
      ? `簽章公鑰中途換過（出現 ${signers.size} 把）—— 這正是「agent 被換掉」的樣子`
      : `provider 位址中途換過（出現 ${addresses.size} 個）—— 不能主張整場是同一位 agent`,
    consistent: `拿不到 provider 位址也拿不到簽名（${signed}/${turns.length} 回合有簽名）。目前只能說每回合的供應商與模型相同 —— 這是我們伺服器的紀錄，不是密碼學證明`,
    none: '每回合的供應商或模型不一致，無法主張是同一位 agent',
  }[level];

  return {
    level,
    // ok 只留給真正驗過密碼學證明的那一級。same-provider 是有意義的證據，但不是證明。
    ok: level === 'attested',
    turns: turns.length,
    signedTurns: signed,
    addressedTurns: addressed,
    sameSigner,
    sameAddress,
    sameModel,
    sameProvider,
    signer: sameSigner ? [...signers][0] : null,
    providerAddress: sameAddress ? [...addresses][0] : null,
    models: [...models],
    providers: [...providers],
    verifiability: (attestation && attestation.verifiability) || null,
    measurement: (attestation && attestation.measurement) || null,
    reason,
  };
}
