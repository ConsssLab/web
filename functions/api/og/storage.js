/**
 * GET /api/og/storage?root=0x… —— 賽道二：直接問 0G Storage indexer 這個檔案在不在網路上。
 *
 * 上傳（寫）要私鑰，所以走 gateway（見 shard.js）；查詢（讀）不用，
 * 任何人拿 root hash 打 indexer 就能確認檔案是否已經被 storage node 收下並完成同步。
 * 這支就是把那個唯讀查詢包成一個端點，前端在結果畫面上顯示，評審也可以自己打。
 *
 * 沒帶 root 時回報 indexer 本身的活性（節點清單），用來畫「0G Storage 連線中」的燈號。
 */

import { json, indexerOf, GALILEO } from './_shared.js';

const ROOT_RE = /^0x[0-9a-fA-F]{64}$/;
const TIMEOUT_MS = 8000;

async function getJson(url, timeoutMs = TIMEOUT_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * indexer 的節點清單是 JSON-RPC，不是 REST，所以這裡單獨打一發。
 * 方法名在 0g-storage-client 版本之間改過，兩個都試，先中的就用。
 */
const INDEXER_METHODS = ['indexer_getShardedNodes', 'indexer_getNodes'];

function countNodes(result) {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === 'object') {
    const buckets = Array.isArray(result.trusted)
      ? result.trusted
      : Object.values(result).filter(Array.isArray).flat();
    return buckets.length;
  }
  return 0;
}

async function indexerNodes(indexer) {
  const errors = [];
  for (const method of INDEXER_METHODS) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(indexer, {
        method: 'POST',
        signal: ac.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || 'indexer error');
      return { count: countNodes(data.result), method };
    } catch (err) {
      errors.push(`${method}: ${String(err && err.message ? err.message : err).slice(0, 60)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(errors.join(' | ').slice(0, 160));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const root = String(url.searchParams.get('root') || '').trim();
  const indexer = indexerOf(env);

  if (!root) {
    try {
      const { count, method } = await indexerNodes(indexer);
      return json({ indexer, reachable: true, nodeCount: count, method, network: 'turbo' });
    } catch (err) {
      return json({
        indexer,
        reachable: false,
        error: String(err && err.message ? err.message : err).slice(0, 160),
      });
    }
  }

  if (!ROOT_RE.test(root)) return json({ error: '需要一個合法的 0G Storage root（0x + 64 hex）' }, 400);

  try {
    const info = await getJson(`${indexer.replace(/\/+$/, '')}/file/info/${root}`);
    const found = Boolean(info.ok && info.body && info.body.finalized !== undefined);
    return json({
      indexer,
      root,
      found,
      finalized: found ? Boolean(info.body.finalized) : null,
      pruned: found ? Boolean(info.body.pruned) : null,
      info: info.body,
      scanUrl: `${GALILEO.storageScan}/file/${root}`,
    });
  } catch (err) {
    return json(
      { indexer, root, error: String(err && err.message ? err.message : err).slice(0, 160) },
      502,
    );
  }
}
