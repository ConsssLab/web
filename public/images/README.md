# 角色形象照

把定稿的**三格拼版原圖**放進這個目錄，檔名叫 `heroes`，副檔名不限：

```
public/images/heroes.png     ← 這四個都認，按這個順序試
public/images/heroes.jpg
public/images/heroes.jpeg
public/images/heroes.webp
```

## 規格

- 一張圖包含三格，**等寬**，左到右順序固定為 **零 → 蕙 → 刃**。
- 直式。單格比例約 `454 × 787`（`public/css/style.css` 的 `.hero-photo`
  用 `aspect-ratio: 454 / 787` 對應，換比例的話兩邊要一起改）。
- 副檔名不用轉：`art.js` 會依序試 `.png` / `.jpg` / `.jpeg` / `.webp`，
  第一個載得起來的就採用。

## 運作方式

程式不會把圖裁開，而是整張載入、用 CSS `background-position` 取三等分之一，
所以**只要丟這一個檔案**，不必自己先裁成三張。

`public/js/art.js` 啟動時會探測這個檔案在不在：

- **在** → 三個角色都用原圖。
- **不在** → 自動退回 `art.js` 裡現畫的 inline SVG，畫面不會開天窗。

所以這個目錄空著也不會壞，只是看到的是備援的 SVG 版本。
