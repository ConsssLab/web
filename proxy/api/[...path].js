/**
 * 0G Storage 節點的轉發代理（Node / Vercel 版）。
 *
 * 為什麼需要一個「不是 Cloudflare」的代理：
 *
 * 主站跑在 Cloudflare Pages。原本的代理寫成 Pages Function，結果連撞兩道
 * 平台牆，而 0G 的 storage node 兩道都踩到：
 *
 *   error 1003  Direct IP Access Not Allowed
 *               Worker 不能對裸 IP 發出站請求，而節點清一色是裸 IP
 *               （實測 http://34.19.125.196:5678）。
 *               這道還能繞：改用 a.b.c.d.sslip.io 這種會解析回同一個 IP 的名稱。
 *
 *   error 521   Web Server Is Down
 *               節點跑在 5678，Cloudflare Workers 的出站只支援固定幾個埠。
 *               這道繞不掉。
 *
 * Node 沒有這兩個限制，一般的 fetch 就能打 http://IP:5678。所以把這一段搬出來。
 *
 * 流程跟原本一樣，只是換了執行環境：
 *
 *   前端 new Indexer('https://<這個服務>/api/indexer')
 *          │
 *          ├─ /api/indexer 轉發到真的 0G indexer，
 *          │  並把回應裡每個節點的 url 改寫成 /api/node/<簽章>/<編碼後的原始網址>
 *          │
 *          └─ /api/node/... 再轉發到那台真的 storage node
 *
 * 安全性：節點是裸 IP，沒有網域可以白名單，所以用 HMAC 簽章綁住 ——
 * 只有這支服務自己從 indexer 回應吐出來的網址才轉發得動，外人塞一個任意網址
 * 進來會被擋，不會變成人人可用的開放代理。另外擋掉內網位址。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** 上游 indexer。只認 0g.ai 底下的 https。 */
const DEFAULT_INDEXER = 'https://indexer-storage-testnet-turbo.0g.ai';
const INDEXER_SUFFIX = '.0g.ai';
const INDEXER_EXACT = '0g.ai';

const MAX_BODY = 6 * 1024 * 1024; // 一個 segment 是 256KB，留足餘裕
const TIMEOUT_MS = 45000;

const b64urlEncode = (s) => Buffer.from(s, 'utf8').toString('base64url');
const b64urlDecode = (s) => Buffer.from(s, 'base64url').toString('utf8');

const secretOf = () => process.env.OG_PROXY_SECRET || 'conssswars/og-zg-proxy/v1';

/** 取 HMAC 前 16 bytes 轉十六進位：32 個字，夠短也夠難猜。 */
const sign = (url) => createHmac('sha256', secretOf()).update(url).digest('hex').slice(0, 32);

/** 定時比對，不要因為提早 return 而洩漏正確簽章的前綴。 */
function sameSig(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

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
 * 節點網址是 indexer 給的，正常都是公網 IP；但簽章金鑰萬一外流，這道防線
 * 讓這支服務仍然打不到任何內部服務（含雲端 metadata 端點）。
 *
 * ZG_ALLOW_LOOPBACK 只給本機測試用 —— 有了它才能把假的 storage node 架在
 * 127.0.0.1 上跑完整條鏈路。正式環境不要設。
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
  if (process.env.ZG_ALLOW_LOOPBACK === '1') return u;

  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return null;
  }
  if (PRIVATE_V4.test(h)) return null;
  if (h === '::1' || h === '::' || /^f[cd]/.test(h) || h.startsWith('fe80:')) return null;
  return u;
}

/**
 * 把 JSON 裡所有指向 storage node 的 url 欄位改寫成走這支服務。
 *
 * indexer 回傳的節點清單形狀在版本之間變過（有時是陣列，有時是
 * { trusted: [...] }），所以不假設結構，直接走訪整棵樹，看到叫 url 而且是
 * http(s) 開頭的字串就換掉。打不到的（內網位址）原樣留著，讓它自己去失敗。
 */
function rewriteUrls(node, base) {
  if (Array.isArray(node)) return node.map((n) => rewriteUrls(n, base));
  if (!node || typeof node !== 'object') return node;

  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'url' && typeof v === 'string' && /^https?:\/\//i.test(v)) {
      out[k] = publicTarget(v) ? `${base}/api/node/${sign(v)}/${b64urlEncode(v)}` : v;
    } else {
      out[k] = rewriteUrls(v, base);
    }
  }
  return out;
}

/**
 * 誰可以跨網域呼叫這支服務。
 *
 * 主站在 *.pages.dev，本機開發在 localhost。要放行別的網域就設
 * ALLOWED_ORIGINS（逗號分隔）。認不出來的來源不給 CORS 標頭，
 * 瀏覽器那邊就會被擋下來。
 */
function corsOrigin(origin) {
  if (!origin) return null;
  const list = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.includes(origin)) return origin;
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && u.hostname.endsWith('.pages.dev')) return origin;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return origin;
  } catch {
    return null;
  }
  return null;
}

function setCors(req, res) {
  const origin = corsOrigin(req.headers.origin);
  if (!origin) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-max-age', '86400');
}

const send = (res, status, data) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(data));
};

/** 原樣讀 body，不經過 JSON 解析再序列化 —— segment 要一個 byte 都不差。 */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function forward(target, req, res, { rewrite = null } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const method = req.method || 'GET';
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);

    const upstream = await fetch(target.toString(), {
      method,
      signal: ac.signal,
      // 只帶必要的標頭：不要把 cookie、authorization 之類的東西轉給第三方主機
      headers: { 'content-type': req.headers['content-type'] || 'application/json' },
      body,
    });

    const text = await upstream.text();
    if (!rewrite) {
      res.statusCode = upstream.status;
      res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
      res.setHeader('cache-control', 'no-store');
      return res.end(text);
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // 不是 JSON 就原樣回去，改寫本來就只對 JSON 有意義
      res.statusCode = upstream.status;
      res.setHeader('content-type', upstream.headers.get('content-type') || 'text/plain');
      return res.end(text);
    }
    return send(res, upstream.status, rewrite(parsed));
  } catch (err) {
    const msg =
      err && err.name === 'AbortError' ? '轉發逾時' : String(err && err.message ? err.message : err);
    return send(res, 502, { error: `代理轉發失敗：${msg}`.slice(0, 200) });
  } finally {
    clearTimeout(timer);
  }
}

/** 這支服務自己的外部網址，節點網址要改寫成指向它。 */
function selfBase(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const raw = req.query?.path ?? [];
  const segments = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);

  // ── /api/indexer ────────────────────────────────────
  if (segments[0] === 'indexer' && segments.length === 1) {
    const target = allowedIndexer(process.env.OG_STORAGE_INDEXER || DEFAULT_INDEXER);
    if (!target) return send(res, 500, { error: 'indexer 設定不是合法的 0g.ai https 網址' });
    const base = selfBase(req);
    return forward(target, req, res, { rewrite: (data) => rewriteUrls(data, base) });
  }

  // ── /api/node/<簽章>/<編碼網址>/<其餘路徑> ────────────
  if (segments[0] === 'node' && segments.length >= 3) {
    let decoded;
    try {
      decoded = b64urlDecode(segments[2]);
    } catch {
      return send(res, 400, { error: '節點網址編碼不正確' });
    }
    if (!sameSig(segments[1], sign(decoded))) {
      return send(res, 403, { error: '節點網址簽章不符：這支代理只轉發自己發出的節點位址' });
    }
    const upstreamBase = publicTarget(decoded);
    if (!upstreamBase) return send(res, 403, { error: '不允許轉發到這個位址' });

    // 保留節點網址本身的路徑，再接上代理路徑剩下的部分
    const rest = segments.slice(3).map(encodeURIComponent).join('/');
    const target = new URL(
      [upstreamBase.pathname.replace(/\/+$/, ''), rest].filter(Boolean).join('/') || '/',
      upstreamBase.origin,
    );
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    target.search = qs;
    return forward(target, req, res);
  }

  // ── /api/health ─────────────────────────────────────
  if (segments[0] === 'health') {
    return send(res, 200, { ok: true, service: 'conssswars-zg-proxy' });
  }

  return send(res, 404, { error: 'unknown proxy route' });
}
