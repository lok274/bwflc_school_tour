# 戶外學習日旅程助手

一個繁體中文、手機優先、可安裝及離線使用的 PWA。內容根據學校《有關戶外學習日事宜》通告整理，提供三日行程、五個景點導覽、GPS 個人打卡、紀念相片、旅程卡及準備清單。

## 本機啟動

需要 Node.js 18 或以上版本，不需要安裝任何套件。

```powershell
npm start
```

然後開啟 `http://localhost:4173`。如要改用其他連接埠：

```powershell
npm start -- 8080
```

## 測試

```powershell
npm test
```

自動測試涵蓋通告資料、景點資料完整度、GCJ-02／WGS84 座標轉換、GPS 範圍、倒數狀態及本機狀態復原。相機、IndexedDB、Service Worker 和下載功能需在瀏覽器作整合測試。

## 私隱設計

- GPS 只在按下「到埗打卡」後讀取一次。
- 原始座標不會儲存；打卡只保留時間、方式及是否核實。
- 相片在瀏覽器 Canvas 重新編碼為最長邊 1600px 的 WebP，移除 EXIF 和位置資料。
- 每個景點最多一張照片，以 Blob 形式保存在 IndexedDB。
- 清單與打卡存在 `localStorage` 的 `outdoorLearningDay.v3`。
- 沒有登入、分析工具、廣告、雲端資料庫或相片上傳。

## HTTPS 與裝置功能

`localhost` 可直接測試 GPS、相機及 Service Worker。公開部署時必須使用 HTTPS。相機不支援或權限被拒時，App 會改用裝置相簿選擇器；GPS 不可用或精確度不足時，可選擇未核實手動打卡。

## 景點與座標

景點介紹以學校、政府及文化機構資料為主要依據。地理中心使用高德地圖 GCJ-02 POI，App 會在距離計算前轉為 WGS84，以配合瀏覽器 Geolocation API。打卡只屬個人紀錄，不作校方出席證明。

## 離線更新

Service Worker 會快取應用程式、五張原創插畫及圖示。修改已部署檔案後，請同步更新 `sw.js` 的 `CACHE_NAME`，讓瀏覽器移除舊快取。

## GitHub Pages HTTPS 部署

專案已包含 `.github/workflows/pages.yml`，測試通過後才部署預設分支。PR 只執行測試及發布包檢查，不發布網站。不需要安裝套件或提供額外 token。

1. 本次公開版本依使用者要求移除班別及老師姓名（包括原始碼），保留日期與行程。後續不得未經授權重新加入名單。Pages 網站通常可被任何人瀏覽，私有 repository 不代表網站私有。
2. 將本專案根目錄內容放入選定的 GitHub repository 根目錄，包括隱藏的 `.github` 目錄；不要上傳整個工作目錄、通告原檔或本機資料。
3. 在 repository 的 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。
4. 推送至預設分支，或在 Actions 選擇此 workflow 並從預設分支執行 **Run workflow**。
5. 等待 build 與 deploy 成功，以部署輸出的 HTTPS 網址驗收；在 Pages 設定確認 **Enforce HTTPS**。

`npm run build` 會建立 `_site`，只複製 17 個允許的網站資產。不會發布 README、AGENTS、測試、本機伺服器或通告。若 `_site` 已有檔案，建置會停止；先移走舊產物再重建，以避免殘留檔案混入發布包。這只限制網站發布包，不會隱藏公開 repository 中的原始碼。

目前使用相對網址及 hash 路由，支援 `https://<使用者>.github.io/<repository>/#home`，不需改寫路由或設定自訂網域。GitHub Pages 不會執行 `server.mjs`，其中的 HTTP 安全標頭也不會自動套用至 Pages；應以實際線上回應為準。

正式網址與 localhost 是不同 origin；原有本機清單、打卡及照片不會自動搬到線上網址。網站本身不會上傳這些資料。上線後需用手機實測定位／相機權限、相簿、下載、安裝及離線重載。

官方說明：[自訂 Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[HTTPS 設定](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)。
