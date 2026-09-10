/**
 * 0G 端點共用工具：網路常數、JSON 回應、JSON-RPC。
 *
 * 三個 0G 賽道（Compute / Storage / Chain）的 Function 都會用到這裡的東西，
 * 集中一份，避免各自抄一次常數之後改到不同步。
 */

export const GALILEO = {
  name: '0G-Galileo-Testnet',
  chainId: 16602,
  chainIdHex: '0x40DA',
  currency: { name: 'OG', symbol: 'OG', decimals: 18 },
  rpcUrl: 'https://evmrpc-testnet.0g.ai',
  explorer: 'https://chainscan-galileo.0g.ai',
  storageScan: 'https://storagescan-galileo.0g.ai',
  faucet: 'https://faucet.0g.ai',
};

/** 0G Storage Turbo 網（較快、費用較高）的 indexer；要換 Standard 網改環境變數即可。 */
export const STORAGE_INDEXER = 'https://indexer-storage-testnet-turbo.0g.ai';

/** 0G Compute Network Router：OpenAI 相容的 /chat/completions 端點。 */
export const OG_ROUTER_BASE = 'https://router-api.0g.ai/v1';

/**
 * 錨定交易 calldata 的魔術字：ASCII "CSSW"。
 * 有這四個 byte，就能在 chainscan 上把我們的交易從一般轉帳裡認出來，
 * /api/og/verify 也靠它判斷一筆交易是不是本遊戲寫的。
 */
export const ANCHOR_MAGIC = '43535357';

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const hex = (buf) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

export const sha256Hex = async (bytes) => '0x' + hex(await crypto.subtle.digest('SHA-256', bytes));

/** 逾時可控的 JSON-RPC：公開節點卡住時不能把整個 Function 一起拖死。 */
export async function rpc(url, method, params = [], timeoutMs = 6000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'rpc error');
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

export const rpcUrlOf = (env) => env.OG_RPC_URL || GALILEO.rpcUrl;
export const indexerOf = (env) => env.OG_STORAGE_INDEXER || STORAGE_INDEXER;

/**
 * 敵方 agent 的供應商。**預設 0G Compute**，設 AI_PROVIDER=openai 才會切回 OpenAI。
 *
 * 一開始是反過來的（預設 OpenAI，理由是低延遲）。但那讓「TEE」這件事變成空話：
 * 跟玩家對打的 agent 根本不在 enclave 裡，也就無從證明「整場都是同一位」。
 * 要讓那個主張成立，敵方 agent 必須跑在 0G Compute 上並帶回可驗證的簽名，
 * 所以預設改過來。沒設金鑰時仍會退回本地啟發式，並照實標示。
 */
export function providerConfig(env) {
  const choice = String(env.AI_PROVIDER || '0g').toLowerCase();
  if (choice === '0g' || choice === '0g-compute') return ogComputeConfig(env);
  return {
    id: 'openai',
    label: 'OpenAI API',
    base: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    key: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL || 'gpt-4o-mini',
    keyName: 'OPENAI_API_KEY',
  };
}

/**
 * 預設模型。**必須是 verifiability = TeeML 的那幾個之一。**
 *
 * router 的 /v1/models 會標三種狀態，差別直接決定我們的主張成不成立：
 *
 *   TeeML    模型本身跑在 TEE 裡          ← 只有這個撐得起「同一位 agent」
 *   TeeTLS   TEE 只終結 TLS，推論在上游廠商那邊跑（大多數模型是這種）
 *   （沒有） 完全沒有 TEE —— Claude / GPT 系列都屬於這類
 *
 * 撰文當下 TeeML 的只有五個：0gm-1.0-35b-a3b、0gm-1.0-35b-a3b-sia、glm-5.3、
 * whisper-large-v3、z-image-turbo。選 0gm-1.0-35b-a3b 的理由：
 *   · 支援 response_format —— 我們需要 JSON 模式，-sia 那個不支援
 *   · glm-5.3 的 deep thinking 永遠開著且關不掉，逐回合呼叫太慢
 *   · 便宜（$0.00000008 / prompt token）
 *
 * 換模型前先確認它是 TeeML，否則畫面上的 TEE 主張會變成空話。
 */
const OG_COMPUTE_DEFAULT_MODEL = '0gm-1.0-35b-a3b';

/** 0G Compute Network Router 的設定。跟敵方 agent 用哪家無關，這個永遠指向 0G。 */
export const ogComputeConfig = (env) => ({
  id: '0g-compute',
  label: '0G Compute Network Router',
  base: env.OG_COMPUTE_BASE_URL || OG_ROUTER_BASE,
  key: env.OG_COMPUTE_API_KEY,
  model: env.OG_COMPUTE_MODEL || OG_COMPUTE_DEFAULT_MODEL,
  keyName: 'OG_COMPUTE_API_KEY',
});

/** 去掉控制字元與角括號：這些字串最後都會進 DOM 或上鏈。 */
const BAD_CHARS = new RegExp('[\\u0000-\\u001F\\u007F<>]', 'g');

export const clampStr = (v, max) =>
  typeof v === 'string' ? v.replace(BAD_CHARS, '').slice(0, max) : '';

export const clampInt = (v, lo, hi, dflt = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
};
