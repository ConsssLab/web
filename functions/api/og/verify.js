/**
 * GET /api/og/verify?tx=0x… —— 賽道三：從 0G Chain 把錨定交易讀回來重新驗證。
 *
 * 為什麼要有這支：「按了按鈕、錢包跳出來」不等於資料真的在鏈上。
 * 這支直接對 0G Galileo 的 RPC 讀那筆交易與 receipt，把 calldata 依照
 * shard.js 寫進去的格式拆開，回報：
 *   - 這筆交易存不存在、進了哪個區塊、成功還失敗、幾個確認數
 *   - calldata 開頭是不是我們的魔術字 "CSSW"
 *   - 裡面那 32 bytes 摘要，跟前端手上的碎片摘要對不對得起來
 *
 * 全程唯讀，不需要任何金鑰。評審可以拿任何一筆 tx hash 自己打這支端點驗。
 */

import { json, rpc, rpcUrlOf, GALILEO, ANCHOR_MAGIC, clampStr } from './_shared.js';

const RESULT_NAME = { 0: 'draw', 1: 'hero', 2: 'forgetter' };
const TX_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * shard.js buildCalldata() 的反向操作。
 *
 * 魔術字用「找」的而不是「固定在開頭」：錨定交易是合約建立交易，
 * input 前面有一小段 init code（600080f3），碎片是接在它後面的。
 * 用搜尋的話，之後前綴再變、或是有人用別的方式把同一段資料送上鏈，都還是解得出來。
 */
function decodeCalldata(input) {
  const body = typeof input === 'string' && input.startsWith('0x') ? input.slice(2) : '';
  const at = body.toLowerCase().indexOf(ANCHOR_MAGIC.toLowerCase());
  if (at === -1) {
    return { recognized: false, reason: 'input 裡找不到 CSSW 魔術字，不是本遊戲的錨定交易' };
  }
  if (body.length - at < 80) {
    return { recognized: false, reason: '找到魔術字但後面的資料不完整' };
  }
  const u8 = (i) => parseInt(body.slice(at + i, at + i + 2), 16);
  const heroCoreRaw = u8(14);
  return {
    recognized: true,
    offset: at / 2,
    version: u8(8),
    result: RESULT_NAME[u8(10)] || 'draw',
    turns: u8(12),
    // heroCore 是用 uint8 補碼存的，超過 127 就是負數
    heroCore: heroCoreRaw > 127 ? heroCoreRaw - 256 : heroCoreRaw,
    digest: '0x' + body.slice(at + 16, at + 80).toLowerCase(),
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const tx = String(url.searchParams.get('tx') || '').trim();
  const expected = clampStr(url.searchParams.get('digest') || '', 70).toLowerCase();

  if (!TX_RE.test(tx)) return json({ error: '需要一個合法的 tx hash（0x + 64 hex）' }, 400);

  const rpcUrl = rpcUrlOf(env);
  try {
    const [txData, receipt, headHex] = await Promise.all([
      rpc(rpcUrl, 'eth_getTransactionByHash', [tx]),
      rpc(rpcUrl, 'eth_getTransactionReceipt', [tx]).catch(() => null),
      rpc(rpcUrl, 'eth_blockNumber').catch(() => null),
    ]);

    if (!txData) {
      return json({
        found: false,
        tx,
        chainId: GALILEO.chainId,
        note: '這條鏈上找不到這筆交易，可能還沒被打包，或是送到了別條鏈。',
      });
    }

    const decoded = decodeCalldata(txData.input);
    const blockNumber = txData.blockNumber ? parseInt(txData.blockNumber, 16) : null;
    const head = headHex ? parseInt(headHex, 16) : null;
    const digestMatch = expected
      ? decoded.recognized && decoded.digest === expected
      : null;

    return json({
      found: true,
      tx,
      chainId: GALILEO.chainId,
      network: GALILEO.name,
      from: txData.from,
      to: txData.to, // 合約建立交易這裡會是 null
      contractAddress: (receipt && receipt.contractAddress) || null,
      blockNumber,
      confirmations: blockNumber !== null && head !== null ? Math.max(0, head - blockNumber + 1) : null,
      status: receipt ? (receipt.status === '0x1' ? 'success' : 'failed') : 'pending',
      gasUsed: receipt && receipt.gasUsed ? parseInt(receipt.gasUsed, 16) : null,
      calldata: txData.input,
      decoded,
      expectedDigest: expected || null,
      digestMatch,
      explorerUrl: `${GALILEO.explorer}/tx/${tx}`,
    });
  } catch (err) {
    return json(
      { error: String(err && err.message ? err.message : err).slice(0, 200), tx, rpcUrl },
      502,
    );
  }
}
