/**
 * /api/og/zg/* —— 0G Storage 的同源代理。
 *
 * 為什麼需要它：
 *
 * SDK 上傳一個檔案要跟兩種主機講話 ——
 *   1. indexer：問「這個檔案該傳給哪些 storage node」（indexer_getShardedNodes）
 *   2. 那份清單裡的每一台 storage node：真正把 segment 傳上去（zgs_uploadSegment）
 *
 * 第 1 步從瀏覽器打得通，第 2 步打不通：那些 storage node 是各自獨立的主機，
 * 沒有為瀏覽器開 CORS，所以 axios 只會回一句沒有內容的 "Network Error"。
 *
 * 解法是把兩步都繞過這支 Function，讓瀏覽器全程只跟自己的網域講話：
 *
 *   前端 new Indexer('/api/og/zg/indexer')
 *          │
 *          ├─ 這支轉發到真的 indexer，
 *          │  並把回應裡每個節點的 url 改寫成 /api/og/zg/node/<編碼後的原始網址>
 *          │
 *          └─ 節點請求再由這支轉發到那台真的 storage node
 *
 * Flow 合約那步不經過這裡 —— 它走 MetaMask 簽名，本來就沒有 CORS 問題。
 *
 * 安全性：只准轉發到 0g.ai 底下的 https 主機，否則就成了任何人都能借用的開放代理。
 */

import { json, indexerOf } from '../_shared.js';

/** 只有這個網域（與其子網域）能被轉發。 */
const ALLOWED_SUFFIX = '.0g.ai';
const ALLOWED_EXACT = '0g.ai';

const MAX_BODY = 6 * 1024 * 1024; // 一個 segment 是 256KB，留足餘裕
const TIMEOUT_MS = 30000;

const b64urlEncode = (s) =>
  btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
};

/** 這個網址可以轉發嗎？只認 https 的 0g.ai。 */
function allowed(target) {
  let u;
  try {
    u = new URL(target);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  if (h !== ALLOWED_EXACT && !h.endsWith(ALLOWED_SUFFIX)) return null;
  return u;
}

/**
 * 把 JSON 裡所有指向外部主機的 url 欄位改寫成走這支代理。
 *
 * indexer 回傳的節點清單形狀在不同版本之間變過（有時是陣列，有時是
 * { trusted: [...] } 這種分片物件），所以不去假設結構，直接走訪整棵樹，
 * 看到叫 url 而且是 http(s) 開頭的字串就換掉。轉發不到的主機（非 0g.ai）
 * 原樣留著，讓它自己去失敗，不要靜悄悄地吞掉。
 */
function rewriteUrls(node, origin) {
  if (Array.isArray(node)) return node.map((n) => rewriteUrls(n, origin));
  if (!node || typeof node !== 'object') return node;

  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'url' && typeof v === 'string' && /^https?:\/\//i.test(v)) {
      out[k] = allowed(v) ? `${origin}/api/og/zg/node/${b64urlEncode(v)}` : v;
    } else {
      out[k] = rewriteUrls(v, origin);
    }
  }
  return out;
}

async function forward(target, request, { rewrite = null } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const body =
      request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
    if (body && body.length > MAX_BODY) return json({ error: 'payload too large' }, 413);

    const res = await fetch(target.toString(), {
      method: request.method,
      signal: ac.signal,
      // 只帶必要的標頭：不要把 cookie、authorization 之類的東西轉給第三方主機
      headers: { 'content-type': request.headers.get('content-type') || 'application/json' },
      body,
    });

    const text = await res.text();
    if (!rewrite) {
      return new Response(text, {
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') || 'application/json',
          'cache-control': 'no-store',
        },
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // 不是 JSON 就原樣回去，改寫本來就只對 JSON 有意義
      return new Response(text, {
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') || 'text/plain' },
      });
    }
    return json(rewrite(parsed), res.status);
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? '轉發逾時' : String(err && err.message ? err.message : err);
    return json({ error: `代理轉發失敗：${msg}`.slice(0, 200) }, 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest({ request, params, env }) {
  const segments = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const origin = new URL(request.url).origin;

  // ── /api/og/zg/indexer ──────────────────────────────
  // 轉發到真的 indexer，並把回應裡的節點網址改寫成走這支代理。
  if (segments[0] === 'indexer' && segments.length === 1) {
    const target = allowed(indexerOf(env));
    if (!target) return json({ error: 'indexer 設定不是合法的 0g.ai https 網址' }, 500);
    return forward(target, request, { rewrite: (data) => rewriteUrls(data, origin) });
  }

  // ── /api/og/zg/node/<編碼網址>/<其餘路徑> ─────────────
  // 轉發到那台真的 storage node。
  if (segments[0] === 'node' && segments.length >= 2) {
    let decoded;
    try {
      decoded = b64urlDecode(segments[1]);
    } catch {
      return json({ error: '節點網址編碼不正確' }, 400);
    }
    const base = allowed(decoded);
    if (!base) return json({ error: '只允許轉發到 0g.ai 的 https 主機' }, 403);

    // 保留節點網址本身的路徑，再接上代理路徑剩下的部分
    const rest = segments.slice(2).map(encodeURIComponent).join('/');
    const target = new URL(
      [base.pathname.replace(/\/+$/, ''), rest].filter(Boolean).join('/') || '/',
      base.origin,
    );
    target.search = new URL(request.url).search;
    return forward(target, request);
  }

  return json({ error: 'unknown proxy route' }, 404);
}
