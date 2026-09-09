# 廠商套件（vendored）

這個 repo 沒有建置步驟，所以第三方套件直接放預先打包好的瀏覽器版 ESM，
由頁面用動態 `import()` 在需要時才載入 —— 不進首屏，不影響開場速度。

| 檔案 | 來源 | 版本 | 用途 |
| --- | --- | --- | --- |
| `zgstorage.esm.min.js` | [`@0gfoundation/0g-storage-ts-sdk`](https://www.npmjs.com/package/@0gfoundation/0g-storage-ts-sdk) `dist/zgstorage.esm.min.js` | 1.2.12 | 賽道二：0G Storage 的 merkle 樹計算、Flow 合約 submit、segment 上傳 |
| `ethers.min.js` | [`ethers`](https://www.npmjs.com/package/ethers) `dist/ethers.min.js` | 6.13.1 | 把 MetaMask 包成 SDK 要的 signer |

兩個都是官方發佈的產物，未經修改。要更新的話：

```bash
npm pack @0gfoundation/0g-storage-ts-sdk ethers
# 解開後把上表那兩個檔案覆蓋過來，並更新這張表的版本號
```
