/**
 * GET /api/og/status —— 回報這個部署接上了 0G 的哪三條賽道，以及各自現在活不活。
 *
 * 前端拿它畫標題頁的連線燈號與結果頁的「0G 三賽道」面板。
 * 每一格都照實回報 configured / live，沒設定就寫沒設定，不會假裝有接。
 *
 *   賽道一 0G Compute Network —— 戰後旁白「記憶編纂者」跑在上面（敵方 agent 走 OpenAI）
 *   賽道二 0G Storage        —— 記憶碎片存檔，indexer 唯讀查詢隨時可打
 *   賽道三 0G Chain (Galileo) —— 碎片摘要錨定上鏈，可讀回來重新驗證
 */

import { json, rpc, rpcUrlOf, indexerOf, GALILEO, providerConfig, ogComputeConfig } from './_shared.js';

/** indexer 的活性探測：能拿到節點清單就算通。 */
async function probeIndexer(indexer, timeoutMs = 5000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(indexer, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'indexer_getNodes', params: [] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'indexer error');
    return { ok: true, nodeCount: Array.isArray(data.result) ? data.result.length : 0 };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestGet({ env }) {
  const rpcUrl = rpcUrlOf(env);
  const indexer = indexerOf(env);
  const enemy = providerConfig(env);
  const compute = ogComputeConfig(env);

  const out = {
    network: { ...GALILEO, rpcUrl },

    // ── 賽道一：0G Compute Network ──────────────────────
    compute: {
      track: 1,
      product: '0G Compute Network',
      role: '戰後旁白「記憶編纂者」',
      label: compute.label,
      model: compute.model,
      endpoint: compute.base,
      configured: Boolean(compute.key),
      tee: Boolean(compute.key),
    },

    // 敵方 AI agent 另外報，因為它照指定走 OpenAI（也可用 AI_PROVIDER=0g 整支切過來）
    enemyAgent: {
      provider: enemy.id,
      label: enemy.label,
      model: enemy.model,
      configured: Boolean(enemy.key),
    },

    // ── 賽道二：0G Storage ──────────────────────────────
    storage: {
      track: 2,
      product: '0G Storage',
      role: '記憶碎片永久存檔',
      indexer,
      network: 'turbo',
      uploadConfigured: Boolean(env.OG_STORAGE_UPLOAD_URL),
      mode: env.OG_STORAGE_UPLOAD_URL ? 'remote' : 'local-digest',
      scan: GALILEO.storageScan,
      live: false,
      nodeCount: null,
      error: null,
    },

    // ── 賽道三：0G Chain (Galileo 16601) ────────────────
    chain: {
      track: 3,
      product: '0G Chain · Galileo Testnet',
      role: '碎片摘要錨定與鏈上回驗',
      ok: false,
      blockNumber: null,
      chainId: null,
      gasPriceGwei: null,
      explorer: GALILEO.explorer,
      faucet: GALILEO.faucet,
      error: null,
    },
  };

  const [chainRes, indexerRes] = await Promise.all([
    Promise.all([
      rpc(rpcUrl, 'eth_blockNumber'),
      rpc(rpcUrl, 'eth_chainId'),
      rpc(rpcUrl, 'eth_gasPrice').catch(() => null),
    ]).then(
      (r) => ({ ok: true, r }),
      (err) => ({ ok: false, err }),
    ),
    probeIndexer(indexer),
  ]);

  if (chainRes.ok) {
    const [block, chainId, gasPrice] = chainRes.r;
    out.chain.ok = true;
    out.chain.blockNumber = parseInt(block, 16);
    out.chain.chainId = parseInt(chainId, 16);
    out.chain.gasPriceGwei = gasPrice ? Number((parseInt(gasPrice, 16) / 1e9).toFixed(4)) : null;
  } else {
    const e = chainRes.err;
    out.chain.error = String(e && e.message ? e.message : e).slice(0, 160);
  }

  out.storage.live = indexerRes.ok;
  out.storage.nodeCount = indexerRes.ok ? indexerRes.nodeCount : null;
  out.storage.error = indexerRes.ok ? null : indexerRes.error;

  return json(out);
}

export { GALILEO };
