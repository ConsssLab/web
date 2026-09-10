<div align="center">

<img src="public/images/logo.svg" alt="ConSSS Wars" width="150">

# 鏈之英雄傳 ConSSS Wars

### 第 0 章 · 無重之憶 — Weightless Memory

**一分鐘打得完的回合制策略戰，對手是一個真的會讀盤的 AI agent。**<br>
打完的戰報會被寫成「記憶碎片」，存進 0G Storage、錨定到 0G Chain，而且能從鏈上讀回來重新驗證。

[![0G Galileo](https://img.shields.io/badge/0G_Chain-Galileo_16602-1B7FE0?style=flat-square)](https://chainscan-galileo.0g.ai)
[![0G Compute](https://img.shields.io/badge/0G_Compute-TEE_Inference-0E4C8F?style=flat-square)](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/overview)
[![0G Storage](https://img.shields.io/badge/0G_Storage-Turbo_Indexer-3E9BE8?style=flat-square)](https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages_+_Functions-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com)
[![No build step](https://img.shields.io/badge/build-none-success?style=flat-square)](#本機開發)

[**▶ 線上試玩**](https://conssswars-web.pages.dev) · [**看 Demo 影片**](https://youtube.com/shorts/PV0HpkiGv24) · [給評審看這裡](#給評審--三十秒看完-0g-用在哪) · [遊戲規則](#遊戲規則三十秒版) · [部署](#部署到-cloudflare-pages)

</div>

---

## 🎬 Demo

<div align="center">

<a href="https://youtube.com/shorts/PV0HpkiGv24">
  <img src="https://img.youtube.com/vi/PV0HpkiGv24/hqdefault.jpg" alt="ConSSS Wars 無重之憶 — Demo 影片" width="420">
</a>

**[▶ 看 Demo 影片](https://youtube.com/shorts/PV0HpkiGv24)**

</div>

---

## 給評審 · 三十秒看完 0G 用在哪

一場戰鬥的資料被三條賽道**接力**處理，不是三個各自獨立的 demo：

```
0G Compute 的 TEE agent 寫出戰報敘述
        ↓  （這份敘述被封進記憶碎片）
記憶碎片 ──算 merkle root、玩家錢包付費──▶ 真的存進 0G Storage
        ↓  （碎片的 SHA-256）
摘要 ──合約建立交易──▶ 錨定到 0G Chain ──讀回來逐欄比對──▶ ✓
```

| 用了哪些 0G 技術 | 為什麼要用它 | 在哪一行用到 |
|---|---|---|
| **0G Compute Network**<br>TEE 可驗證推論 | 戰報要永久存檔，寫它的那個 agent 就不能是黑箱。金鑰在 pc.0g.ai 選 **Private（TEE enclave）** 開的，推論實際跑在 enclave 裡，不是只呼叫一個 OpenAI 相容端點。 | [`functions/api/narrate.js#L55-L134`](https://github.com/ConsssLab/web/blob/main/functions/api/narrate.js#L55-L134) |
| **0G Compute Network**<br>Router 設定 | 敵方 agent 與旁白 agent 共用同一份供應商工廠，把 `AI_PROVIDER` 改成 `0g` 就能整支切過去，不用改程式碼。 | [`functions/api/og/_shared.js#L22-L23`](https://github.com/ConsssLab/web/blob/main/functions/api/og/_shared.js#L22-L23) · [`functions/api/og/_shared.js#L82-L90`](https://github.com/ConsssLab/web/blob/main/functions/api/og/_shared.js#L82-L90) |
| **0G Storage**<br>真實寫入 | 記憶碎片要「永久保存」就必須真的落地。用官方 SDK 走完整協議：切 256-byte chunk 算 merkle root → 對 Flow 合約送 submit（付儲存費）→ 把 segment 傳給 storage node。**全程用玩家自己的錢包簽，伺服器不持有私鑰。** | [`public/js/storage.js#L65-L108`](https://github.com/ConsssLab/web/blob/main/public/js/storage.js#L65-L108)<br>節點代理（Node）：[`proxy/api/index.js`](https://github.com/ConsssLab/web/blob/main/proxy/api/index.js) —— 節點是裸 IP + 非標準埠，Cloudflare Workers 打不到（error 1003 / 521），這一段必須跑在 Node 上 |
| **0G Storage**<br>indexer 唯讀查詢 | 「上傳沒報錯」不等於存進去了。拿 root hash 回頭問 indexer，確認 storage node 真的收下並 finalized 才敢標成已存檔。唯讀、不需金鑰，評審可自行查證。 | [`functions/api/og/storage.js#L76-L114`](https://github.com/ConsssLab/web/blob/main/functions/api/og/storage.js#L76-L114) |
| **0G Storage**<br>節點活性探測 | 結果畫面的燈號要照實反映網路狀態，不能寫死成綠燈。 | [`functions/api/og/status.js#L34-L57`](https://github.com/ConsssLab/web/blob/main/functions/api/og/status.js#L34-L57) |
| **0G Chain**<br>錨定寫入 | 戰報需要一個不可竄改、有時間戳的存在證明。40 bytes 結構化 calldata（魔術字 `CSSW` + 版本 + 戰績 + SHA-256），用合約建立交易送出，chainscan 上一眼認得出來。 | [`functions/api/og/shard.js#L62-L84`](https://github.com/ConsssLab/web/blob/main/functions/api/og/shard.js#L62-L84) · [`public/js/og.js#L174-L199`](https://github.com/ConsssLab/web/blob/main/public/js/og.js#L174-L199) |
| **0G Chain**<br>鏈上回驗 | **這是整個專案的重點**：按了按鈕、錢包沒報錯，不代表資料真的在鏈上。所以再用 `eth_getTransactionByHash` 把交易讀回來、反解 calldata、跟本地碎片逐欄比對，四項全對才打勾。 | [`functions/api/og/verify.js#L19-L47`](https://github.com/ConsssLab/web/blob/main/functions/api/og/verify.js#L19-L47) · [`functions/api/og/verify.js#L49-L104`](https://github.com/ConsssLab/web/blob/main/functions/api/og/verify.js#L49-L104) |
| **0G Chain**<br>鏈況與網路切換 | 標題頁即時顯示 Galileo 區塊高度；chainId **從鏈上實際讀回來**校準而不是寫死（0G 換過 chain ID 16601→16602，寫死會讓切鏈整個失敗）。 | [`functions/api/og/status.js#L59-L150`](https://github.com/ConsssLab/web/blob/main/functions/api/og/status.js#L59-L150) · [`public/js/og.js#L116-L159`](https://github.com/ConsssLab/web/blob/main/public/js/og.js#L116-L159) |
| — **敵方 AI agent**<br>（OpenAI，非 0G） | 對戰時每回合都要叫一次，需要低延遲，所以另外走 OpenAI。模型輸出一律當不可信資料重新過濾。 | [`functions/api/agent.js#L173-L256`](https://github.com/ConsssLab/web/blob/main/functions/api/agent.js#L173-L256) · [`public/js/ai.js#L16-L65`](https://github.com/ConsssLab/web/blob/main/public/js/ai.js#L16-L65) |

### 評審可以自己打的端點

全部公開唯讀，不需要任何金鑰：

```bash
# 三條賽道現在各自的狀態（照實回報，沒接上就寫沒接上）
curl https://conssswars-web.pages.dev/api/og/status | jq

# 賽道二：indexer 活性與節點數
curl https://conssswars-web.pages.dev/api/og/storage | jq

# 賽道二：拿 0G Storage root 查檔案在不在網路上
curl "https://conssswars-web.pages.dev/api/og/storage?root=0x<你的root>" | jq

# 賽道三：拿任何一筆錨定交易的 hash 回來重驗
curl "https://conssswars-web.pages.dev/api/og/verify?tx=0x<你的交易hash>" | jq
```

---

## 這是什麼

三條「記憶迴廊」，七個回合，每回合兩點算力。你顧不了三條 —— **選哪條放掉就是勝負**。

對面那個「遺忘者」不是寫死的 AI：每回合把整個盤面送給一個大型語言模型，它讀完盤、
挑好要出的牌、還會回一句嘲諷。打完之後，這場戰鬥的完整紀錄（含 AI 每回合出了什麼、說了什麼）
會被 0G Compute 上的另一個 agent 寫成一段檔案敘述，封成「記憶碎片」，
存進 0G Storage，摘要錨定到 0G Chain —— 然後**再從鏈上讀回來比對一次**。

> 這一段是重點：按了按鈕、錢包沒跳錯，不代表資料真的在鏈上。
> 所以結果畫面有一顆「鏈上回驗」按鈕，會實際去讀那筆交易的 calldata，
> 重新解析、跟本地碎片的 SHA-256 比對，比對相符才敢標成 ✓。

美術與音樂全部是程式現畫、現合成的 —— 沒有任何圖檔、沒有任何音檔。
`art.js` 是 inline SVG，`audio.js` 是程序化 WebAudio。

---

## 遊戲規則（三十秒版）

- 三條「記憶迴廊」，每條 3 格。你在左、遺忘者在右。
- 每回合 **2 點算力** —— 顧不了三條，**選哪條放掉就是勝負**。
- 交戰**之前**先比火力：一條迴廊誰的攻擊力總和高，就啃對方核心 **2 點**。
  單位當回合陣亡也算數，所以「投入多少」比「殺幾隻」重要。
- 貼身或迎面撞上的單位互砍；打贏還活著的會乘勝追擊繼續前進。
- 走出邊界的單位直接打核心。核心 12 點，共 7 回合，先歸零的一方輸。

雙方牌組**刻意不對稱**：英雄方打得重，遺忘者比較耐打。數值完全鏡像的話，
雙方每回合互相抵銷，火力永遠打平，整局零傷害收在和局。

[`public/js/rules.js`](public/js/rules.js) 是純規則層（無 DOM、無網路），可以直接 import 跑對戰模擬：

```bash
npm run sim     # 跑 300 場隨機對戰，印出勝負分布與平均回合數
```

> ⚠️ **改任何數值前請先重跑模擬。** 現行數值是調出來的：
> 合理玩法約第 6 回合收掉，亂打約七成會輸（實測 300 場：71% 落敗，平均 3.7 回合）。

---

## 角色

| 角色 | 稱號 | English |
| --- | --- | --- |
| 零 Zero | 零界守望者 | Watcher of the Void |
| 蕙 Hue | 見證者 | The Witness |
| 刃 Ren | 零重刃 | Blade of Gravity |

形象照放 `public/images/heroes.{png,jpg,jpeg,webp}`（**一張**三格拼版，左到右 零→蕙→刃，
單格比例約 454×787）就會自動採用 —— 程式不裁圖，整張載入後用 CSS 取三等分之一。
沒放則退回 `art.js` 現畫的 inline SVG，兩種情況都能正常運作。細節見
[`public/images/README.md`](public/images/README.md)。

---

## 部署到 Cloudflare Pages

這個 repo 就是網站本體，**沒有建置步驟**：`public/` 直接是成品，
`functions/` 會被 Cloudflare 自動辨識成 Pages Functions。

### 方式 A · Dashboard 連 Git（推薦，設定一次就好）

Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → 選 `ConsssLab/web`。

| 欄位 | 填入的值 |
| --- | --- |
| 專案名稱 | `conssswars-web` |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | **留空** |
| Build output directory | `public` |
| Root directory | **留空** |

### 方式 B · 從本機一行推上去

```bash
npx wrangler login
npx wrangler pages deploy public --project-name conssswars-web
```

### 方式 C · GitHub Actions（推 main 就自動部署）

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) 已經寫好。
在 repo → Settings → Secrets and variables → Actions 補兩個 secret 就會生效：

| Secret | 從哪裡拿 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | My Profile → API Tokens，權限選 **Account → Cloudflare Pages → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard 右側欄可直接複製 |

> A 和 C 擇一即可，兩個都開會讓同一個 commit 部署兩次。

### 綁定 web.conssswars.com

專案 → **Custom domains** → **Set up a custom domain** → 輸入 `web.conssswars.com`。

`conssswars.com` 的 DNS 需要在 Cloudflare 上管理，Cloudflare 才會自動建記錄並簽憑證。
只加 `web` 這個子網域，apex 與 `play` 的既有記錄完全不動。

> ⚠️ 自訂網域要加在**這個新專案**裡。加到別的 Pages 專案上，那個專案的內容就會出現在 `web.conssswars.com`。

---

## 環境變數

**Settings → Variables and Secrets**，Production 與 Preview 都要設。
API 金鑰請選 **Secret**（加密），不要用一般變數。

| 變數 | 賽道 | 必要性 | 說明 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | 敵方 agent | 建議設 | OpenAI 金鑰。**只存在 Function 端**，不會進前端 bundle。 |
| `OPENAI_MODEL` | 敵方 agent | 選用 | 預設 `gpt-4o-mini` |
| `AI_PROVIDER` | 敵方 agent | 選用 | `openai`（預設）或 `0g`（敵方 agent 也切到 0G Compute） |
| `OG_COMPUTE_API_KEY` | 賽道一 | 建議設 | 0G Compute Router 金鑰，從 [pc.0g.ai](https://pc.0g.ai) 取得 |
| `OG_COMPUTE_MODEL` | 賽道一 | 選用 | 預設 `deepseek-chat-v3-0324` |
| `OG_STORAGE_INDEXER` | 賽道二 | 選用 | 預設 Turbo indexer；唯讀查詢不需金鑰 |
| `OG_STORAGE_UPLOAD_URL` | 賽道二 | 上傳才需要 | 指向 `0g-storage-client` gateway；沒設就只產生摘要 |
| `OG_STORAGE_TOKEN` | 賽道二 | 選用 | 上述 gateway 需要的 Bearer token |
| `OG_RPC_URL` | 賽道三 | 選用 | 預設 `https://evmrpc-testnet.0g.ai` |

**一個金鑰都沒設也能玩** —— AI agent 退到本地啟發式對手，畫面上照實標示
「本地備援（未接上模型）」，不會假裝有接。

---

## 本機開發

```bash
git clone https://github.com/ConsssLab/web.git && cd web
npm install

# 把 OpenAI 金鑰寫進 .env（互動輸入，不會留在 shell 記錄裡）
bash scripts/set-key.sh OPENAI_API_KEY

npm run dev          # http://127.0.0.1:8788，含 /api/* Functions
```

只想看前端、不需要 `/api/*` 的話，任何靜態伺服器都能開：

```bash
cd public && python3 -m http.server 8788
```

---

## 檔案配置

```
public/                     建置輸出目錄（直接就是成品，無建置步驟）
├─ index.html               五個畫面：標題 / 劇情 / 簡報 / 戰鬥 / 結果
├─ images/                  logo、demo 縮圖、角色形象照
├─ css/style.css            紙白平塗風，iPhone 直式 390×844 為基準
└─ js/
   ├─ rules.js              純規則層，無 DOM 無網路，可直接跑對戰模擬
   ├─ story.js              劇情腳本、角色資料與結局文案
   ├─ art.js                全部美術（inline SVG，現畫，無圖檔）
   ├─ audio.js              程序化 BGM 與音效（WebAudio，無音檔）
   ├─ ai.js                 敵方 AI agent 前端客戶端 + 離線備援
   ├─ og.js                 0G 前端整合：錢包、切鏈、錨定、回驗、Storage 查詢
   └─ main.js               主流程、動畫節奏、0G 三賽道狀態面板

functions/api/
├─ agent.js                 敵方 AI agent 大腦（OpenAI，唯一持有該金鑰的地方）
├─ narrate.js               賽道一：0G Compute 上的旁白 agent
└─ og/
   ├─ _shared.js            三支共用的網路常數與 JSON-RPC
   ├─ status.js             三賽道即時狀態
   ├─ shard.js              賽道二寫入 + 賽道三 calldata 組裝
   ├─ storage.js            賽道二唯讀查詢（indexer）
   └─ verify.js             賽道三鏈上回驗

scripts/
├─ set-key.sh               互動式寫入 .env 的金鑰
└─ simulate.mjs             對戰模擬，改數值前先跑這個
```

---

## 安全性

- **API 金鑰只存在 Function 端。** 前端拿不到，也不會出現在 bundle 裡。
- **不保管任何私鑰。** 上鏈那步走玩家自己的錢包；0G Storage 的寫入交給外部 gateway，
  Worker 裡沒有私鑰可偷。
- **模型輸出一律當成不可信資料。** 只取白名單欄位、比對合法手牌清單、夾在算力預算內
  ——[`sanitizePlays()`](functions/api/agent.js)，前端 `rules.js` 還會再 validate 一次。
  台詞用 `textContent` 進 DOM，不走 `innerHTML`。
- **要上鏈的資料在 Function 端重新正規化**，前端塞不進任意內容。

---

<div align="center">

測試網 gas 到 [faucet.0g.ai](https://faucet.0g.ai) 領 · 交易在 [chainscan-galileo.0g.ai](https://chainscan-galileo.0g.ai) 查

**ConSSS Lab** · 0G Hackathon 參賽作品

</div>
