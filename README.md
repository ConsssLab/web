# 鏈之英雄傳 ConSSS Wars — 無重之憶 · Weightless Memory

第 0 章「鏈國 0G」。一分鐘打得完的回合制策略戰，對手是一個**真的會讀盤的 AI agent**，
打完的戰報可以打包成「記憶碎片」錨定到 0G Chain。

**0G 黑客松**參賽作品，重點放在 0G 技術串接；美術與音樂時間盒管理
（全部是現畫的 inline SVG 與程序化 WebAudio，沒有任何圖檔或音檔）。

---

## 部署到 web.conssswars.com

這個 repo 就是網站本體，**不需要建置**。

### 1. 建立 Cloudflare Pages 專案

Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
→ 授權 GitHub → 選 `ConsssLab/web`。

| 欄位 | 填入的值 |
| --- | --- |
| 專案名稱 | `conssswars-web`（或任何沒被用掉的名字） |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | **留空** |
| Build output directory | `public` |
| Root directory | **留空**（網站就在 repo 根目錄） |

`functions/` 會被 Cloudflare 自動辨識成 Pages Functions，不需要額外設定。

### 2. 綁定 web.conssswars.com

專案 → **Custom domains** → **Set up a custom domain** → 輸入 `web.conssswars.com`。

`conssswars.com` 的 DNS 需要在 Cloudflare 上管理，Cloudflare 才會自動建立記錄並簽發憑證。
只加 `web` 這個子網域，apex 與 `play` 的既有記錄完全不動。

> ⚠️ 自訂網域要加在**這個新專案**裡。加到別的 Pages 專案上，那個專案的內容就會出現在
> `web.conssswars.com`。

### 3. 環境變數

**Settings → Variables and Secrets**，Production 與 Preview 都要設。
API 金鑰請選 **Secret**（加密），不要用一般變數。

| 變數 | 必要性 | 說明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | AI agent 必要 | OpenAI API 金鑰。**只存在 Function 端**，不會進前端 bundle。 |
| `OPENAI_MODEL` | 選用 | 預設 `gpt-4o-mini` |
| `AI_PROVIDER` | 選用 | `openai`（預設）或 `0g` |
| `OG_COMPUTE_API_KEY` | 用 0G Compute 時必要 | 從 pc.0g.ai 取得的 `sk-…` |
| `OG_COMPUTE_MODEL` | 選用 | 預設 `deepseek-chat-v3-0324` |
| `OG_RPC_URL` | 選用 | 預設 `https://evmrpc-testnet.0g.ai` |
| `OG_STORAGE_UPLOAD_URL` | 選用 | 設了才會真的上傳記憶碎片，沒設就只產生摘要 |
| `OG_STORAGE_TOKEN` | 選用 | 上述端點需要的 Bearer token |

**沒有設任何金鑰也能玩** —— AI agent 會退到本地啟發式對手，畫面上照實標示
「本地備援（未接上模型）」，不會假裝有接。

---

## 串了 0G 的哪些部分

| 0G 元件 | 用在哪 | 狀態 |
| --- | --- | --- |
| **0G Compute Network** | 敵方 AI agent 的大腦。Router 是 OpenAI 相容端點，把 `AI_PROVIDER` 改成 `0g` 就整支切過去，程式碼不用動。 | 已實作，換一個環境變數即生效 |
| **0G Chain（Galileo 16601）** | 標題頁即時顯示鏈高度；打完可以用玩家自己的錢包，把記憶碎片摘要寫進一筆交易的 calldata 錨定上鏈。 | 已實作，需要測試網 OG 當 gas |
| **0G Storage** | 記憶碎片的正規化與 SHA-256 摘要已完成；設了 `OG_STORAGE_UPLOAD_URL` 就會轉發上傳。 | 摘要已實作；上傳端點需自行設定 |

錨定交易走玩家自己的錢包，伺服器不保管任何私鑰。測試網 gas 可到
[faucet.0g.ai](https://faucet.0g.ai) 領。

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

`public/js/rules.js` 是純規則層（無 DOM、無網路），可以直接 import 跑對戰模擬。
**改任何數值前請重跑模擬** —— 現行數值是調出來的：合理玩法約第 6 回合收掉，亂打約七成會輸。

---

## 角色

| 角色 | 稱號 | 英文稱號 |
| --- | --- | --- |
| 零 Zero | 零界守望者 | Watcher of the Void |
| 蕙 Hue | 見證者 | The Witness |
| 刃 Ren | 零重刃 | Blade of Gravity |

形象照請放 `public/images/heroes.png`（三格拼版，左到右 零→蕙→刃）。
放了就自動採用；沒放則退回 `art.js` 現畫的 inline SVG，兩種情況都能正常運作。

---

## 本機開發

沒有建置步驟，任何靜態伺服器都能開前端：

```bash
cd public && python3 -m http.server 8788
```

但 `/api/*` 需要 Pages Functions。要連 AI agent 與 0G 端點，用 wrangler：

```bash
npx wrangler pages dev public --compatibility-date=2024-09-01 --binding OPENAI_API_KEY=sk-...
```

---

## 檔案配置

```
public/                  建置輸出目錄（直接就是成品）
├─ index.html            五個畫面：標題 / 劇情 / 簡報 / 戰鬥 / 結果
├─ images/               角色形象照（見該目錄的 README，放了就自動採用）
├─ css/style.css         紙白平塗風，iPhone 直式 390×844 為基準
└─ js/
   ├─ rules.js           純規則層，無 DOM 無網路，可直接跑對戰模擬
   ├─ story.js           劇情腳本、角色資料與結局文案
   ├─ art.js             全部美術（inline SVG，現畫，無圖檔）
   ├─ audio.js           程序化 BGM 與音效（WebAudio，無音檔）
   ├─ ai.js              AI agent 前端客戶端 + 離線備援
   ├─ og.js              錢包連線、切鏈、錨定交易
   └─ main.js            主流程與動畫節奏
functions/api/
├─ agent.js              AI agent 大腦（唯一持有金鑰的地方）
└─ og/{status,shard}.js  0G 鏈況、記憶碎片打包
```

---

## 安全性

- **API 金鑰只存在 Function 端**，前端拿不到，也不會出現在 bundle 裡。
- **模型輸出一律當成不可信資料**：只取白名單欄位、比對合法手牌清單、夾在算力預算內，
  前端 `rules.js` 還會再 validate 一次。台詞用 `textContent` 進 DOM，不走 `innerHTML`。
- 要上鏈的記憶碎片在 Function 端重新正規化，前端塞不進任意內容。
