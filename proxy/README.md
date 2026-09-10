# conssswars-zg-proxy

0G Storage 節點的轉發代理。主站在 Cloudflare Pages，但**這一段不能跑在 Cloudflare 上**。

## 為什麼要有這個服務

0G 的 storage node 長這樣：`http://34.19.125.196:5678` —— 裸 IP、明文 http、非標準埠。
瀏覽器不能直接打（https 頁面上是 mixed content，而且節點沒開 CORS），所以要一支代理。
但代理放在 Cloudflare Pages Functions 上會連撞兩道平台牆：

| 錯誤 | 原因 | 能不能繞 |
|---|---|---|
| `error 1003` Direct IP Access Not Allowed | Worker 不能對裸 IP 發出站請求 | 可以：改用 `a.b.c.d.sslip.io` 這種解析回同一個 IP 的名稱 |
| `error 521` Web Server Is Down | 節點在 5678，Workers 出站只支援固定幾個埠 | **不行** |

Node 沒有這兩個限制。所以把轉發搬到這裡，主站其他部分照舊留在 Cloudflare。

## 部署（Vercel）

```bash
cd proxy
npx vercel --prod
```

沒有 `vercel.json` 是刻意的 —— Vercel 會自動把 `api/` 底下的檔案當成 Node 函式，
不需要設定檔；寫死 `maxDuration` 之類的值反而可能在免費方案上讓部署直接失敗。

第一次會問幾個問題，全部照預設走：

| 問題 | 答 |
|---|---|
| Set up and deploy? | `y` |
| Which scope? | 你的帳號（Enter） |
| Link to existing project? | `n` |
| Project name? | Enter（用 `proxy`）或自己打一個 |
| In which directory is your code located? | Enter（`./`） |
| Want to modify these settings? | `n` |

記下輸出的 **Production** 網址，例如 `https://conssswars-zg-proxy.vercel.app`。

## 接回主站

在 Cloudflare Pages 專案設一個環境變數，指向剛剛那個網址：

```bash
npx wrangler pages secret put OG_ZG_PROXY_BASE --project-name conssswars-web
# 貼上：https://conssswars-zg-proxy.vercel.app/api
```

（或 Dashboard → Settings → Variables and Secrets 加 `OG_ZG_PROXY_BASE`。）

`/api/og/status` 會把這個值當成 `storage.zgProxy` 下發，前端就會改打這支服務。
沒設的話前端仍走同源的 `/api/og/zg`，那條路在 Cloudflare 上會失敗 —— 這是預期的。

## 路由

| 路徑 | 做什麼 |
|---|---|
| `POST /api/indexer` | 轉發到真的 0G indexer，並把回應裡每個節點的 `url` 改寫成下面那條路徑 |
| `POST /api/node/<簽章>/<base64url 的節點網址>/<其餘路徑>` | 轉發到那台真的 storage node |
| `GET /api/health` | 活著沒 |

## 環境變數

| 變數 | 預設 | 用途 |
|---|---|---|
| `OG_PROXY_SECRET` | 內建常數 | 簽章金鑰。擋的是「有人拿這個網域當跳板」，不是機密資料；沒設也能運作 |
| `OG_STORAGE_INDEXER` | `https://indexer-storage-testnet-turbo.0g.ai` | 上游 indexer，只接受 `0g.ai` 底下的 https |
| `ALLOWED_ORIGINS` | 空 | 額外放行的 CORS 來源，逗號分隔。`*.pages.dev` 與 localhost 內建放行 |
| `PUBLIC_BASE_URL` | 由請求標頭推斷 | 改寫節點網址時用的自身網址 |
| `ZG_ALLOW_LOOPBACK` | 未設 | **只給本機測試**，關掉內網過濾好把假節點架在 127.0.0.1。正式環境不要設 |

## 安全性

節點是裸 IP，沒有網域可以白名單，所以用 **HMAC 簽章**綁住：只有這支服務自己從
indexer 回應吐出來的網址才轉發得動，外人塞任意網址進來拿 403 —— 不會變成人人可用的
開放代理。另外擋掉內網 / link-local / 雲端 metadata 位址，並且不把 `cookie`、
`authorization` 這類標頭轉給第三方主機。
