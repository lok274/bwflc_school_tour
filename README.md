# 戶外學習日旅程助手

一個繁體中文、手機優先、可安裝及離線使用的 PWA。內容根據學校《有關戶外學習日事宜》通告整理，提供三日行程、五個景點導覽、GPS 個人打卡、紀念相片、旅程卡及準備清單。

## 模組架構與程式說明

入口 `src/app.js` 只建立及啟動應用；`controller.js` 管理路由權限與離頁生命週期，`store.js` 擁有個人紀錄，`page-models.js` 產生各頁不可修改的專用快照。畫面、GPS 打卡、相機、相片操作及確認提示各由獨立 ES Module 負責。沒有新增框架、套件或後端，既有本機資料格式不變。

完整的繁體中文導讀見 [詳細程式運作說明](docs/CODE_GUIDE.md)（2026-10-06 更新），包含初學者詞彙、模組及函數介面、四個頁面與景點詳情、資料結構、按鈕事件、GPS、相機與相片保存、旅程卡、非同步取消、失敗處理、離線部署、測試、修改範例及常見問題。建議先讀說明，再依序看 `app.js`、`controller.js`、`views.js`。

各頁只讀所需資料，修改須經指定操作；準備頁不能觸發打卡，景點詳情只能操作當站。離頁取消未完成定位、相簿及待處理相片，已開始的照片交易會完成保存。這是程式分工，不是加密、跨分頁或同源安全隔離。

目前底部導航為首頁、行程、景點、準備；準備頁有六項內建清單及自訂提醒。清除所有本機資料入口位於首頁底部，須知頁及相關程式碼已刪除。密碼加密與復原碼仍只有規劃，尚未實作。

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

目前有 88 項 Node 測試，涵蓋活動與景點資料、座標及範圍、狀態復原、模組接線、頁面快照與操作權限、離頁取消、寫入前後、清除失敗、路由及首頁清除入口、文字跳脫、圖片驗證、CSP、離線快取、Pages 發布白名單、原生視窗取消及相機解像度。瀏覽器 API 的模擬測試不等於真機驗證；相機、IndexedDB、Canvas、Service Worker 和下載亦有瀏覽器整合測試。

## 打卡與相機實機測試頁

開啟 [device-test.html](device-test.html)，本機網址為 `http://localhost:4173/device-test.html`。測試點是香港銅鑼灣東院道 11 號，WGS84 `22.27579, 114.19044`，基本半徑 100 米，計入定位誤差。來源為 [政府地址搜尋服務](https://www.als.gov.hk/lookup?q=11%20Eastern%20Hospital%20Road&n=10)；Google Maps 搜尋網址的 @ 座標是地圖視角中心，沒有當成地址座標。

GPS 只在按鈕後要求一次位置，可查看距離、精確度與核實結果。相機可獨立測試，拍攝／重拍／保存後讀回相片；選相成功不能證明即時相機正常。兩次確認清除測試資料，不影響五站打卡或準備清單。測試使用獨立 localStorage 鍵及 IndexedDB 名稱，但仍共用網站 origin，沒有額外加密。詳情及手機操作步驟見 [程式說明第 19 節](docs/CODE_GUIDE.md#19-東院道實機測試頁2026-10-06)。

正式 App 與測試頁都優先要求 1920×1080 的後置相機串流，實際尺寸由裝置及瀏覽器提供；不強制最低解像度。測試頁顯示實際影像尺寸，低於最長邊 1280 像素時提示可用手機相機拍照再從相簿保存。快門按原影格大小拍攝，保存最長邊仍為 1600：例如直向 1080×1920 保存成 900×1600。舊有 480×640 照片不會被放大或重寫，要增加細節須重新拍攝。詳見 [程式說明第 21 節](docs/CODE_GUIDE.md#21-相機解像度修正2026-10-06)。

手機須使用部署後的 HTTPS 網址；手機 localhost 不會連到電腦，普通 HTTP 區域網絡 IP 亦不能可靠使用 GPS／相機。此更新需要推送及 Pages 部署後才會在線上出現。

裝置頁有 15 項 Node 案例；返回鍵處理另加 18 項、解像度處理另加 4 項回歸案例，全部 88 項通過。`tests/browser/device-lab.integration.html` 的 14 項合成影像／模擬 GPS 驗證、資料隔離 8 項及既有瀏覽器 11 項均通過，只在空白獨立 origin 執行。快取版本 v25；新版在真機取得的相機解像度、GPS 及 Android 返回鍵仍須現場驗證。

## Android 手機返回鍵

主 App 與裝置測試頁均使用原生視窗關閉請求：相機開啟時先關閉相機，立即停止鏡頭並丟棄未保存拍攝；確認視窗開啟時取消目前及已排隊的確認，不觸發刪除、手動打卡或下載。沒有視窗時依瀏覽器紀錄返回上一頁，不新增虛構歷史或首頁入口。

直接開啟測試頁時，上一頁未必是 App 首頁；返回鍵可能依瀏覽器原本行為離開。以支援原生關閉請求的 Android Chrome 為驗收環境；不支援的版本保留關閉按鈕及離頁清理。權限視窗及系統相簿由手機處理。詳見 [程式說明第 20 節](docs/CODE_GUIDE.md#20-android-返回鍵2026-10-06)及 [Chrome 官方說明](https://developer.chrome.com/blog/new-in-chrome-126)。

已在桌面瀏覽器驗證 `requestClose()`、Esc、真正上一頁／前進，以及停止本機伺服器後的離線重載與跨頁返回。這些結果不能當成已按過 Android 實體鍵或手勢，亦沒有驗證真機相機指示燈。本機提交不會更新線上網站；須另行推送及部署才會發布本次修改。

## 私隱設計

- GPS 只在按下「到埗打卡」後讀取一次。
- 原始座標不會儲存；打卡只保留時間、方式及是否核實。
- 相片在瀏覽器 Canvas 重新編碼，最長邊不超過 1600px，目標為 WebP、不支援時接受實際 PNG，移除原始 EXIF 和位置中繼資料。
- 每個景點最多一張照片，以 Blob 形式保存在 IndexedDB。
- 清單與打卡存在 `localStorage` 的 `outdoorLearningDay.v3`。
- 沒有登入、分析工具、廣告、雲端資料庫或相片上傳。

## 安全加強與限制

- 文件在載入資產前套用 meta CSP：禁止內嵌 JavaScript、事件處理器、eval、資料 API 連線、表單提交、外部框架及外部資產；只允許同源程式／樣式／插畫及本機 Blob。進度環不用 inline style。
- 設定 `no-referrer`，避免資料來源連結收到本頁網址。CSP 是額外防線，不取代動態文字跳脫；允許的同源請求、導覽及已被攻陷的授權程式不因此完全隔離。
- 新相片先核對 MIME 白名單與 JPEG、PNG、WebP、HEIC／HEIF 檔頭，再解碼及重新編碼。檔頭檢查不是完整圖片驗證；損壞資料仍由解碼器拒絕。20 MiB 上限只限制檔案大小，不保證解碼前的記憶體上限。
- WebP 編碼不支援時可使用瀏覽器實際輸出的 PNG，記錄實際 MIME；不保存未知格式輸出或原檔。
- 離線快取只接受已列出的靜態資產；任意同範圍 GET 或帶查詢參數的回應不會加入快取。
- 旅程卡下載前需確認：照片人樣、校服、背景及打卡時間仍可透露私隱；移除 EXIF 不等於匿名化。清除 App 資料不會刪除已下載或分享的檔案。
- 本機資料沒有由 App 額外加密或密碼保護；請使用裝置鎖定，避免在共用裝置保存敏感照片。同一 origin 下其他應用共用瀏覽器儲存安全邊界，子目錄及資料庫名稱不能隔離它們。
- 本次保留儲存名稱、資料庫版本及現有個人紀錄，不新增後端、網域或上傳途徑。GitHub Pages 的 meta CSP 不支援 `frame-ancestors`；開發伺服器的 CSP、防嵌入及 Permissions-Policy 標頭不會自動套用至 Pages。

參考：[MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)、[OWASP 本機儲存安全](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)。

安全整合測試：用獨立本機連接埠啟動 `node server.mjs 4174`，再開啟 `http://127.0.0.1:4174/tests/browser/security.html`。測試只生成色塊相片，不讀取個人照片；會刻意觸發 CSP 拒絕訊息。此頁不在 Pages 發布白名單內。

頁面隔離整合測試：在空白獨立 origin 用 `node server.mjs 4176` 啟動，再開 `http://127.0.0.1:4176/tests/browser/isolation.html`。若有既存旅程紀錄便停止。測試使用真實 DOM、localStorage、Canvas 及 IndexedDB，清理它自行生成的資料；此頁不發布。

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

`npm run build` 會建立 `_site`，只複製 33 個允許的網站資產。不會發布 README、AGENTS、說明文件、測試、本機伺服器或通告。若 `_site` 已有檔案，建置會停止；先移走舊產物再重建，以避免殘留檔案混入發布包。這只限制網站發布包，不會隱藏公開 repository 中的原始碼。

目前使用相對網址及 hash 路由，支援 `https://<使用者>.github.io/<repository>/#home`，不需改寫路由或設定自訂網域。GitHub Pages 不會執行 `server.mjs`，其中的 HTTP 安全標頭也不會自動套用至 Pages；應以實際線上回應為準。

正式網址與 localhost 是不同 origin；原有本機清單、打卡及照片不會自動搬到線上網址。網站本身不會上傳這些資料。上線後需用手機實測定位／相機權限、相簿、下載、安裝及離線重載。

官方說明：[自訂 Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[HTTPS 設定](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)。
