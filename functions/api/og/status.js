/**
 * GET /api/og/status —— 回報這個部署接上了 0G 的哪些部分。
 *
 * 前端用它來畫「0G 連線狀態」面板：鏈是活的嗎？AI agent 現在跑在誰身上？
 * 儲存有沒有設定？沒設定就誠實顯示「未設定」，不會假裝有接。
 */

export const GALILEO = {
  name: '0G-Galileo-Testnet',
  chainId: 16601,
  chainIdHex: '0x40D9',
  currency: { name: 'OG', symbol: 'OG', decimals: 18 },
  rpcUrl: 'https://evmrpc-testnet.0g.ai',
  explorer: 'https://chainscan-galileo.0g.ai',
  storageScan: 'https://storagescan-galileo.0g.ai',
  faucet: 'https://faucet.0g.ai',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function rpc(url, method, params = [], timeoutMs = 6000) {
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

export async function onRequestGet({ env }) {
  const rpcUrl = env.OG_RPC_URL || GALILEO.rpcUrl;
  const aiProvider = String(env.AI_PROVIDER || 'openai').toLowerCase();
  const usingOgCompute = aiProvider === '0g' || aiProvider === '0g-compute';

  const out = {
    network: { ...GALILEO, rpcUrl },
    chain: { ok: false, blockNumber: null, chainId: null, error: null },
    compute: {
      provider: usingOgCompute ? '0g-compute' : 'openai',
      label: usingOgCompute ? '0G Compute Network Router' : 'OpenAI API',
      model: usingOgCompute
        ? env.OG_COMPUTE_MODEL || 'deepseek-chat-v3-0324'
        : env.OPENAI_MODEL || 'gpt-4o-mini',
      configured: Boolean(usingOgCompute ? env.OG_COMPUTE_API_KEY : env.OPENAI_API_KEY),
    },
    storage: {
      configured: Boolean(env.OG_STORAGE_UPLOAD_URL),
      indexer: env.OG_STORAGE_INDEXER || 'https://indexer-storage-testnet-turbo.0g.ai',
      mode: env.OG_STORAGE_UPLOAD_URL ? 'remote' : 'local-digest',
    },
  };

  try {
    const [block, chainId] = await Promise.all([
      rpc(rpcUrl, 'eth_blockNumber'),
      rpc(rpcUrl, 'eth_chainId'),
    ]);
    out.chain.ok = true;
    out.chain.blockNumber = parseInt(block, 16);
    out.chain.chainId = parseInt(chainId, 16);
  } catch (err) {
    out.chain.error = String(err && err.message ? err.message : err).slice(0, 160);
  }

  return json(out);
}
