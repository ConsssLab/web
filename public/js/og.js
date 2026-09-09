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

export const GALILEO = {
  chainId: '0x40d9', // 16601
  chainName: '0G-Galileo-Testnet',
  nativeCurrency: { name: 'OG', symbol: 'OG', decimals: 18 },
  rpcUrls: ['https://evmrpc-testnet.0g.ai'],
  blockExplorerUrls: ['https://chainscan-galileo.0g.ai'],
};

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
  const current = await provider.request({ method: 'eth_chainId' });
  if (String(current).toLowerCase() === GALILEO.chainId) return;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: GALILEO.chainId }],
    });
  } catch (err) {
    // 4902 = 錢包還不認識這條鏈，那就順手幫它加進去
    if (err && (err.code === 4902 || err.code === -32603)) {
      await provider.request({ method: 'wallet_addEthereumChain', params: [GALILEO] });
    } else {
      throw err;
    }
  }
}

/**
 * 賽道三：把碎片摘要寫進 0G Galileo 的一筆交易。
 *
 * calldata 是 Function 端組好的 40 bytes（魔術字 CSSW + 版本 + 戰績 + SHA-256 摘要），
 * 送一筆給自己的 0 值交易帶上去 —— 不用部署合約，chainscan 上直接看得到 input data，
 * /api/og/verify 也能把它讀回來重新解析。這一步需要一點測試網 OG 當 gas。
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
    params: [{ from: address, to: address, value: '0x0', data: calldata }],
  });
  return { txHash, explorerUrl: `${GALILEO.blockExplorerUrls[0]}/tx/${txHash}` };
}

export const shortAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
