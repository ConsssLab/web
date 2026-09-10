/**
 * 賽道二：把記憶碎片真的寫進 0G Storage。
 *
 * 為什麼在瀏覽器做而不是在 Function 裡做：
 * 0G Storage 的寫入不只是丟一個 HTTP 上傳 —— 要先算出檔案的 merkle root，
 * 在 0G Chain 上對 Flow 合約送一筆 submit 交易（要付儲存費），拿到 txSeq 之後
 * 才能把 segment 傳給 storage node。中間那筆交易需要私鑰。
 *
 * 私鑰不進伺服器，所以整段用玩家自己的錢包做，跟賽道三的錨定同一個原則：
 * 伺服器只負責產生要存的內容，簽名與付費永遠在玩家手上。
 *
 * SDK 是官方的 @0gfoundation/0g-storage-ts-sdk 瀏覽器版，放在 /vendor/。
 * 用動態 import 在按下按鈕時才載入 —— 那兩個 bundle 加起來一百多萬 bytes，
 * 不能讓它拖慢開場。
 */

const SDK_URL = '/vendor/zgstorage.esm.min.js';
const ETHERS_URL = '/vendor/ethers.min.js';

/**
 * indexer 走自家的同源代理，不直接打 0g.ai。
 *
 * 直接打的話 indexer 本身通得過，但它回傳的 storage node 是另一批主機，
 * 那些主機沒為瀏覽器開 CORS，SDK 傳 segment 時只會拿到一句沒有內容的
 * "Network Error"。代理會把節點網址一併改寫成走同一支 Function，
 * 整條上傳鏈路就都是同源的了。見 functions/api/og/zg/[[path]].js。
 */
const DEFAULT_INDEXER = '/api/og/zg/indexer';

/** EVM RPC 維持直連：它走 MetaMask 與公開節點，實測瀏覽器打得通。 */
const DEFAULT_RPC = 'https://evmrpc-testnet.0g.ai';

let modsPromise = null;

/** 兩個 bundle 只載一次，之後共用。 */
function loadModules() {
  if (!modsPromise) {
    modsPromise = Promise.all([import(SDK_URL), import(ETHERS_URL)]).then(([zg, ethers]) => ({
      zg,
      ethers,
    }));
  }
  return modsPromise;
}

const encode = (shard) => new TextEncoder().encode(JSON.stringify(shard));

/**
 * 只算 merkle root，不碰網路也不碰錢包。
 *
 * 這就是 0G Storage 用來指認一個檔案的 root hash：資料切成 256 bytes 的 chunk，
 * 每 1024 個 chunk 一個 segment，逐層 hash 上去。同樣的內容永遠算出同樣的 root，
 * 所以上傳前就能先把它顯示給玩家看，也能拿去 indexer 查這個檔案在不在網路上。
 */
export async function computeRoot(shard) {
  const { zg } = await loadModules();
  const data = new zg.MemData(encode(shard));
  const [tree, err] = await data.merkleTree();
  if (err) throw new Error(`merkle 計算失敗：${err}`);
  return tree.rootHash();
}

/**
 * 完整上傳：算 root → 用玩家錢包送 Flow 合約的 submit → 傳 segment 給 storage node。
 *
 * onStep 會在每個階段被呼叫一次，讓畫面可以照實顯示進度 ——
 * 這段要跟鏈上互動，慢的時候十幾秒跑不掉，不能讓玩家對著沒反應的畫面等。
 */
export async function upload(shard, { indexer, rpc, onStep } = {}) {
  const step = (msg) => {
    if (typeof onStep === 'function') onStep(msg);
  };

  if (!window.ethereum) throw new Error('找不到 EVM 錢包，請先安裝 MetaMask。');

  // 錢包要在最前面連。
  //
  // 瀏覽器只把「使用者剛剛點擊」之後的一小段時間算成使用者手勢，
  // 中間 await 一個一百多萬 bytes 的動態 import 之後手勢就過期了 ——
  // 那時再叫錢包，MetaMask 的視窗不會被帶到前景（手機的 in-app 瀏覽器尤其明顯），
  // 畫面就會卡在「等待錢包」但什麼都沒跳出來。所以先連錢包，再做重的事。
  step('連接錢包…');
  await window.ethereum.request({ method: 'eth_requestAccounts' });

  step('載入 0G Storage SDK…');
  const { zg, ethers } = await loadModules();

  step('計算 merkle root…');
  const data = new zg.MemData(encode(shard));
  const [tree, treeErr] = await data.merkleTree();
  if (treeErr) throw new Error(`merkle 計算失敗：${treeErr}`);
  const root = tree.rootHash();
  step(`root ${root.slice(0, 10)}… 已算出，等待錢包簽名`);

  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  step('送出 Flow 合約 submit 並上傳 segment…');
  // 這裡刻意忽略呼叫端傳進來的真實 indexer 網址，一律走代理 ——
  // 直連的話 segment 那步會被 storage node 的 CORS 擋掉。
  const client = new zg.Indexer(new URL(DEFAULT_INDEXER, location.origin).toString());
  const [tx, err] = await client.upload(data, rpc || DEFAULT_RPC, signer);
  if (err) throw new Error(String(err && err.message ? err.message : err));

  return { root, tx: typeof tx === 'string' ? tx : tx && (tx.txHash || tx.hash) };
}

/**
 * 從瀏覽器直接打一次 indexer，用來分辨「真的連不上」與「被 CORS 擋掉」。
 *
 * 這兩種在 JS 裡都長成同一個 TypeError（瀏覽器不會告訴你是不是 CORS），
 * 所以單看前端分不出來。但我們有第二個資訊來源：/api/og/status 是從
 * Cloudflare 的伺服器端打同一個 indexer 的。伺服器連得到、瀏覽器連不到，
 * 那就是對方沒開 CORS，而不是玩家網路有問題 —— 這兩件事的處理方式差很多，
 * 不講清楚玩家只會一直重試。
 */
export async function probeIndexerFromBrowser(indexer) {
  try {
    const res = await fetch(indexer, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'indexer_getShardedNodes', params: [] }),
    });
    return { reachable: true, status: res.status };
  } catch (err) {
    return { reachable: false, error: String((err && err.message) || err) };
  }
}

/**
 * 把 SDK 丟回來的錯誤翻成玩家看得懂的話。
 *
 * serverSaysLive 是 /api/og/status 回報的 storage.live —— 拿它跟前端的探測結果
 * 交叉比對才能給出正確的診斷，光看錯誤字串會把 CORS 誤判成網路問題。
 * 不管分到哪一類，原始訊息都保留在後面，否則出事時完全無從查起。
 */
export async function explainError(err, { indexer, serverSaysLive } = {}) {
  const msg = String((err && (err.message || err.reason)) || err);

  if (/insufficient|balance|funds/i.test(msg)) {
    return '餘額不足付儲存費與 gas。到 faucet.0g.ai 領一點測試網 OG 再試一次。';
  }
  if (/user rejected|user denied|4001|ACTION_REJECTED/i.test(msg)) {
    return '你在錢包按了取消，沒有上傳任何東西。';
  }
  if ((err && err.code === -32002) || /already processing|already pending/i.test(msg)) {
    return '錢包已經有一個待處理的請求。請打開 MetaMask 按下確認，不要重複點這顆按鈕。';
  }

  if (/failed to fetch|network|fetch|timeout|ECONN|load failed/i.test(msg)) {
    if (indexer) {
      const probe = await probeIndexerFromBrowser(indexer);
      if (!probe.reachable && serverSaysLive) {
        return `0G Storage 的 indexer 不允許瀏覽器直接連線（CORS）—— 伺服器端連得到，這個瀏覽器連不到。這是節點端的限制，不是你的網路問題。原始錯誤：${msg.slice(0, 100)}`;
      }
      if (!probe.reachable) {
        return `連不上 0G Storage 節點（伺服器端也連不到，可能是節點在維護）。原始錯誤：${msg.slice(0, 100)}`;
      }
      return `indexer 連得到，但上傳過程中斷 —— 可能是卡在後面的 storage node 或 Flow 合約那步。原始錯誤：${msg.slice(0, 140)}`;
    }
    return `連線失敗：${msg.slice(0, 160)}`;
  }

  return msg.slice(0, 220);
}
