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

const DEFAULT_INDEXER = 'https://indexer-storage-testnet-turbo.0g.ai';
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

  step('載入 0G Storage SDK…');
  const { zg, ethers } = await loadModules();

  if (!window.ethereum) throw new Error('找不到 EVM 錢包，請先安裝 MetaMask。');

  step('計算 merkle root…');
  const data = new zg.MemData(encode(shard));
  const [tree, treeErr] = await data.merkleTree();
  if (treeErr) throw new Error(`merkle 計算失敗：${treeErr}`);
  const root = tree.rootHash();
  step(`root ${root.slice(0, 10)}… 已算出，等待錢包簽名`);

  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  step('送出 Flow 合約 submit 並上傳 segment…');
  const client = new zg.Indexer(indexer || DEFAULT_INDEXER);
  const [tx, err] = await client.upload(data, rpc || DEFAULT_RPC, signer);
  if (err) throw new Error(String(err && err.message ? err.message : err));

  return { root, tx: typeof tx === 'string' ? tx : tx && (tx.txHash || tx.hash) };
}

/** 把 SDK 丟回來的錯誤翻成玩家看得懂的話。 */
export function explainError(err) {
  const msg = String((err && (err.message || err.reason)) || err);
  if (/insufficient|balance|funds/i.test(msg)) {
    return '餘額不足付儲存費與 gas。到 faucet.0g.ai 領一點測試網 OG 再試一次。';
  }
  if (/user rejected|user denied|4001|ACTION_REJECTED/i.test(msg)) {
    return '你在錢包按了取消，沒有上傳任何東西。';
  }
  if (/network|fetch|timeout|ECONN/i.test(msg)) {
    return `連不上 0G Storage 節點：${msg.slice(0, 140)}`;
  }
  return msg.slice(0, 200);
}
