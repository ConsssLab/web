/**
 * 0G 前端整合層。
 *
 * 分工：
 *   - /api/og/status  由 Function 讀鏈況（RPC 不經過瀏覽器，避免 CORS 與節點被亂打）
 *   - /api/og/shard   由 Function 正規化戰報並算摘要
 *   - 錨定交易        由玩家自己的錢包送出，伺服器不碰任何私鑰
 *
 * 錨定交易的做法：送一筆給自己的 0 值交易，把 32 bytes 摘要放進 calldata。
 * 不需要部署合約，chainscan 上就能直接看到那串 input data。
 */

/**
 * 0G Galileo 的錢包網路參數。
 *
 * chainId 刻意不寫死：0G 換過 chain ID（16601 → 16602），寫死的話錢包裡已經有
 * 同一個 RPC 的舊網路時，switch 會找不到、add 又會被擋（「同一個 RPC 已被別條鏈佔用」），
 * 結果就是交易根本送不出去。所以開場先跟 /api/og/status 要，那支是直接對 RPC 打
 * eth_chainId 讀回來的，鏈上是什麼就是什麼。下面的值只是還沒問到之前的預設。
 */
const DEFAULT_CHAIN_ID = '0x40da'; // 16602

export const GALILEO = {
  chainId: DEFAULT_CHAIN_ID,
  chainName: '0G-Galileo-Testnet',
  nativeCurrency: { name: 'OG', symbol: 'OG', decimals: 18 },
  rpcUrls: ['https://evmrpc-testnet.0g.ai'],
  blockExplorerUrls: ['https://chainscan-galileo.0g.ai'],
};

/** 用 /api/og/status 讀回來的真實鏈況校準上面那組參數。 */
export function calibrate(status) {
  const id = status && status.chain && status.chain.chainId;
  if (Number.isInteger(id) && id > 0) GALILEO.chainId = '0x' + id.toString(16);
  const rpc = status && status.network && status.network.rpcUrl;
  if (rpc) GALILEO.rpcUrls = [rpc];
  const exp = status && status.network && status.network.explorer;
  if (exp) GALILEO.blockExplorerUrls = [exp];
  return GALILEO.chainId;
}

export const FAUCET_URL = 'https://faucet.0g.ai';

const eth = () => (typeof window !== 'undefined' ? window.ethereum : null);

export const hasWallet = () => Boolean(eth());

export async function fetchStatus() {
  const res = await fetch('/api/og/status', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export async function buildShard(payload) {
  const res = await fetch('/api/og/shard', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`shard ${res.status}`);
  return res.json();
}

/**
 * 賽道一：請 0G Compute Network 上的「記憶編纂者」把這場戰鬥寫成檔案敘述。
 * 一場只呼叫一次，失敗就回本地模板 —— 結果畫面不能因為推論掛掉就空白。
 */
export async function narrate(payload) {
  try {
    const res = await fetch('/api/narrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** 賽道二：拿 root hash 問 0G Storage indexer，確認檔案真的被 storage node 收下了。 */
export async function storageInfo(root) {
  const q = root ? `?root=${encodeURIComponent(root)}` : '';
  const res = await fetch(`/api/og/storage${q}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`storage ${res.status}`);
  return res.json();
}

/**
 * 賽道三：把剛送出去的錨定交易從 0G Chain 讀回來重新驗一次。
 * 不是「錢包沒報錯就算成功」—— 這裡真的去讀 calldata，把摘要比對回來。
 */
export async function verifyAnchor(txHash, digest) {
  const res = await fetch(
    `/api/og/verify?tx=${encodeURIComponent(txHash)}&digest=${encodeURIComponent(digest)}`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`verify ${res.status}`);
  return res.json();
}

/** 連錢包並確保切到 Galileo。沒裝錢包就丟出可直接顯示給玩家的訊息。 */
export async function connect() {
  const provider = eth();
  if (!provider) throw new Error('找不到 EVM 錢包，請先安裝 MetaMask 之類的擴充套件。');

  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const address = accounts && accounts[0];
  if (!address) throw new Error('錢包沒有回傳帳號。');

  await ensureGalileo();
  return address;
}

export async function ensureGalileo() {
  const provider = eth();
  if (!provider) throw new Error('找不到 EVM 錢包。');

  // 還沒校準過就先問一次，免得拿錯的 chainId 去跟錢包比對
  if (!calibrated) {
    try {
      calibrate(await fetchStatus());
    } catch {
      // 讀不到就用預設值往下走，總比直接卡住好
    }
    calibrated = true;
  }

  const want = GALILEO.chainId.toLowerCase();
  const current = String(await provider.request({ method: 'eth_chainId' })).toLowerCase();
  if (current === want) return;

  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
    return;
  } catch (err) {
    // 4902 = 錢包不認識這條鏈，那就順手幫它加進去。其他錯誤直接往上丟。
    if (!err || (err.code !== 4902 && err.code !== -32603)) throw err;
  }

  try {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{ ...GALILEO, chainId: want }],
    });
  } catch (err) {
    const msg = String((err && (err.message || err.reason)) || err);
    // 錢包裡已經有同一個 RPC 但掛在別的 chainId 上 —— 這種情況加不進去，
    // 講清楚要怎麼處理，不要讓玩家對著一句原文錯誤發呆。
    if (/same RPC|already exists|existing network/i.test(msg)) {
      throw new Error(
        `你的錢包裡已經有一條用同一個 RPC 的 0G 網路，但 chain ID 跟這條（${want}）不同。` +
          '請在錢包的網路清單裡手動切到那條 0G Galileo，或把舊的那條刪掉再試一次。',
      );
    }
    throw err;
  }
}

let calibrated = false;

/**
 * 最小的合約建立 init code：
 *   60 00  PUSH1 0x00      堆疊 [0]
 *   80     DUP1             堆疊 [0, 0]
 *   f3     RETURN(0, 0)     回傳長度 0 的 runtime code
 *
 * 執行到 RETURN 就停了，所以接在後面的碎片摘要永遠不會被當成指令執行，
 * 但它整段都在交易的 input 裡，鏈上讀得到。部署出來的是一個空合約。
 */
const DEPLOY_PREFIX = '600080f3';

/**
 * 賽道三：把碎片摘要寫進 0G Galileo 的一筆交易。
 *
 * 為什麼是「合約建立」而不是普通轉帳：
 * MetaMask 禁止對自己錢包裡的帳戶發送帶 data 的交易
 * （External transactions to internal accounts cannot include data），
 * 而這正是原本「送一筆給自己」的做法。合約建立交易（to 留空）沒有這個限制，
 * 是 EVM 的一等公民交易型別，input 一樣完整留在鏈上，
 * /api/og/verify 照樣能用 eth_getTransactionByHash 讀回來重新解析。
 *
 * 這一步需要一點測試網 OG 當 gas，沒有的話先去 faucet 領。
 */
export async function anchorDigest(address, calldata) {
  const provider = eth();
  if (!provider) throw new Error('找不到 EVM 錢包。');
  if (!/^0x[0-9a-f]+$/i.test(calldata) || calldata.length < 34) {
    throw new Error('錨定資料格式不正確。');
  }
  await ensureGalileo();

  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from: address, value: '0x0', data: '0x' + DEPLOY_PREFIX + calldata.slice(2) }],
  });
  return { txHash, explorerUrl: `${GALILEO.blockExplorerUrls[0]}/tx/${txHash}` };
}

export const shortAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
