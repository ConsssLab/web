/**
 * /api/og/zg/* —— 0G Storage 的同源代理。
 *
 * 為什麼需要它：
 *
 * SDK 上傳一個檔案要跟兩種主機講話 ——
 *   1. indexer：問「這個檔案該傳給哪些 storage node」（indexer_getShardedNodes）
 *   2. 那份清單裡的每一台 storage node：真正把 segment 傳上去（zgs_uploadSegment）
 *
 * 第 1 步從瀏覽器打得通，第 2 步打不通。實測拿到的節點長這樣：
 *
 *   http://34.19.125.196:5678
 *
 * 裸 IP、明文 http、非標準埠 —— 對一個 https 的頁面來說這是 mixed content，
 * 瀏覽器連送都不會送就直接擋掉（Chrome console 明講 "This request has been
 * blocked; the content must be served over HTTPS"）。就算改成 https，那些節點
 * 也沒為瀏覽器開 CORS。兩個問題都只有一個解法：不要讓瀏覽器直接碰它們。
 *
 *   前端 new Indexer('/api/og/zg/indexer')
 *          │
 *          ├─ 這支轉發到真的 indexer，
 *          │  並把回應裡每個節點的 url 改寫成 /api/og/zg/node/<簽章>/<編碼後的原始網址>
 *          │
 *          └─ 節點請求再由這支轉發到那台真的 storage node
 *
 * 整條鏈路對瀏覽器來說都是同源的 https，mixed content 與 CORS 一起消失。
 * Flow 合約那步不經過這裡 —— 它走 MetaMask 簽名，本來就沒有這兩個問題。
 *
 * 安全性：節點網址是裸 IP，沒有網域可以白名單，所以改用簽章 ——
 * 只有這支代理自己從 indexer 回應裡吐出來的網址才轉發得動（HMAC 綁住），
 * 外人塞一個任意網址進來會被擋，不會變成人人可用的開放代理。
 * 另外再擋掉內網位址，避免有人拿它去打 Cloudflare 內部或 metadata 端點。
 */

import { json, indexerOf } from '../_shared.js';

/** indexer 本身仍然只認 0g.ai 的 https（它是設定值，不是外部資料）。 */
const INDEXER_SUFFIX = '.0g.ai';
const INDEXER_EXACT = '0g.ai';

const MAX_BODY = 6 * 1024 * 1024; // 一個 segment 是 256KB，留足餘裕
const TIMEOUT_MS = 30000;

const enc = new TextEncoder();

const b64urlEncode = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
};

/**
 * 簽章金鑰。設了 OG_PROXY_SECRET 就用它，沒設就退回內建常數 ——
 * 這個簽章擋的是「有人拿我們的網域當跳板」，不是機密資料，
 * 沒設也不該讓整個上傳功能掛掉。要更嚴就在 Pages 設一個 secret。
 */
const secretOf = (env) => (env && env.OG_PROXY_SECRET) || 'conssswars/og-zg-proxy/v1';

const keyCache = new Map();
function signingKey(secret) {
  if (!keyCache.has(secret)) {
    keyCache.set(
      secret,
      crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
      ]),
    );
  }
  return keyCache.get(secret);
}

/** 取 HMAC 前 16 bytes 轉十六進位：32 個字，夠短也夠難猜。 */
async function sign(url, env) {
  const mac = await crypto.subtle.sign('HMAC', await signingKey(secretOf(env)), enc.encode(url));
  return Array.from(new Uint8Array(mac).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 定時比對，不要因為提早 return 而洩漏正確簽章的前綴。 */
function sameSig(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** indexer 設定值的檢查：https 而且在 0g.ai 底下。 */
function allowedIndexer(target) {
  let u;
  try {
    u = new URL(target);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  if (h !== INDEXER_EXACT && !h.endsWith(INDEXER_SUFFIX)) return null;
  return u;
}

/**
 * 內網位址一律拒絕。
 *
 * 節點網址是 indexer 給的，正常情況都是公網 IP；但簽章金鑰萬一外流，
 * 這道防線可以讓這支代理仍然打不到任何內部服務（含雲端 metadata 端點）。
 */
const PRIVATE_V4 =
  /^(0|10|127)\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

function publicTarget(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return null;
  }
  if (PRIVATE_V4.test(h)) return null;
  if (h === '::1' || h === '::' || /^f[cd]/.test(h) || h.startsWith('fe80:')) return null;
  return u;
}

/**
 * Cloudflare 不讓 Worker 對裸 IP 發出站請求 —— 會直接回 error code 1003
 * （Direct IP Access Not Allowed），連線根本沒發出去。而 0G 的 storage node
 * 清一色是裸 IP（實測 http://34.19.125.196:5678）。
 *
 * sslip.io 是一個公開的 DNS 服務：a.b.c.d.sslip.io 永遠解析回 a.b.c.d。
 * 換上它之後 Cloudflare 有 hostname 可以打，連到的還是同一台機器同一個埠。
 *
 * 只對裸 IPv4 動手。indexer 之後若改成回傳網域名稱，這裡就自動不生效。
 */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IP_DNS_SUFFIX = '.sslip.io';

function dnsResolvable(url) {
  if (IPV4.test(url.hostname)) url.hostname = url.hostname + IP_DNS_SUFFIX;
  return url;
}

/**
 * 把 JSON 裡所有指向 storage node 的 url 欄位改寫成走這支代理。
 *
 * indexer 回傳的節點清單形狀在不同版本之間變過（有時是陣列，有時是
 * { trusted: [...] } 這種分片物件），所以不去假設結構，直接走訪整棵樹，
 * 看到叫 url 而且是 http(s) 開頭的字串就換掉。打不到的（內網位址）原樣留著，
 * 讓它自己去失敗，不要靜悄悄地吞掉。
 *
 * 這裡是非同步的，因為每個網址都要簽一次章。
 */
async function rewriteUrls(node, origin, env) {
  if (Array.isArray(node)) return Promise.all(node.map((n) => rewriteUrls(n, origin, env)));
  if (!node || typeof node !== 'object') return node;

  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'url' && typeof v === 'string' && /^https?:\/\//i.test(v)) {
      if (publicTarget(v)) {
        out[k] = `${origin}/api/og/zg/node/${await sign(v, env)}/${b64urlEncode(v)}`;
      } else {
        out[k] = v;
      }
    } else {
      out[k] = await rewriteUrls(v, origin, env);
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
    return json(await rewrite(parsed), res.status);
  } catch (err) {
    const msg =
      err && err.name === 'AbortError' ? '轉發逾時' : String(err && err.message ? err.message : err);
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
    const target = allowedIndexer(indexerOf(env));
    if (!target) return json({ error: 'indexer 設定不是合法的 0g.ai https 網址' }, 500);
    return forward(target, request, { rewrite: (data) => rewriteUrls(data, origin, env) });
  }

  // ── /api/og/zg/node/<簽章>/<編碼網址>/<其餘路徑> ───────
  // 轉發到那台真的 storage node。簽章不對就不轉。
  if (segments[0] === 'node' && segments.length >= 3) {
    let decoded;
    try {
      decoded = b64urlDecode(segments[2]);
    } catch {
      return json({ error: '節點網址編碼不正確' }, 400);
    }
    if (!sameSig(segments[1], await sign(decoded, env))) {
      return json({ error: '節點網址簽章不符：這支代理只轉發自己發出的節點位址' }, 403);
    }
    const base = publicTarget(decoded);
    if (!base) return json({ error: '不允許轉發到這個位址' }, 403);

    // 保留節點網址本身的路徑，再接上代理路徑剩下的部分
    const rest = segments.slice(3).map(encodeURIComponent).join('/');
    const target = new URL(
      [base.pathname.replace(/\/+$/, ''), rest].filter(Boolean).join('/') || '/',
      base.origin,
    );
    target.search = new URL(request.url).search;
    return forward(dnsResolvable(target), request);
  }

  return json({ error: 'unknown proxy route' }, 404);
}
