

一個繁體中文、手機優先、可安裝及離線使用的 PWA。內容根據學校《有關戶外學習日事宜》通告整理，提供三日行程、五個景點導覽、GPS 個人打卡、紀念相片、旅程卡及準備清單。



已在桌面瀏覽器驗證 `requestClose()`、Esc、真正上一頁／前進，以及停止本機伺服器後的離線重載與跨頁返回。這些結果不能當成已按過 Android 實體鍵或手勢，亦沒有驗證真機相機指示燈。本機提交不會更新線上網站；須另行推送及部署才會發布本次修改。

## 私隱設計

- GPS 只在按下「到埗打卡」後讀取一次。
- 原始座標不會儲存；打卡只保留時間、方式及是否核實。
- 相片在瀏覽器 Canvas 重新編碼，最長邊不超過 1600px，目標為 WebP、不支援時接受實際 PNG，移除原始 EXIF 和位置中繼資料。
- 每個景點可保存多張照片，以獨立 photoId 及 Blob 形式保存在 IndexedDB。新增不覆蓋舊照，相簿支援一次選多張，逐張處理；每張可獨立刪除或下載旅程卡。
- 清單與打卡存在 `localStorage` 的 `outdoorLearningDay.v3`。
- 沒有登入、分析工具、廣告、雲端資料庫或相片上傳。

## 安全加強與限制

- 文件在載入資產前套用 meta CSP：禁止內嵌 JavaScript、事件處理器、eval、資料 API 連線、表單提交、外部框架及外部資產；只允許同源程式／樣式／插畫及本機 Blob。進度環不用 inline style。
- 設定 `no-referrer`，避免資料來源連結收到本頁網址。CSP 是額外防線，不取代動態文字跳脫；允許的同源請求、導覽及已被攻陷的授權程式不因此完全隔離。
- 新相片先核對 MIME、靜態 JPEG／PNG／WebP 結構及來源尺寸，再解碼及重新編碼。每張最多 20 MiB、寬高 8192px、5000 萬像素；超限、動畫、矛盾或不能安全核對的結構會在原生解碼前拒絕。HEIC／HEIF 暫不直接匯入，須先在手機轉成 JPEG；已保存的 WebP／PNG 相片不受影響。這些上限限制資源需求，不能保證所有裝置不會缺記憶體；完整圖片仍須由瀏覽器成功解碼。
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

多相片瀏覽器整合測試：在空白測試 origin 開啟 `tests/browser/multi-photo.html`，驗證舊版遷移、多選保存、重新載入、逐張刪除及整站清除。

多相片更新已驗證：107 項 Node 測試通過；手機及桌面尺寸各 8 項多相片瀏覽器測試通過；原有資料隔離 9 項、照片／CSP 11 項及裝置頁 16 項通過。測試影像及 GPS 為合成／模擬，未實測手機原生相機或真機 GPS。

## 儲存相片到手機

每張紀念照有「儲存到手機」及選取控制項，也可「選取全部」再按「匯出已選相片」。App 先逐張製作純相片 JPEG（品質 92%、沿用已保存尺寸、不放大、不加入原始 EXIF），準備完成後再按「開啟手機分享選單」，由你選擇儲存或分享位置。App 內副本仍然保留，沒有新增相片上傳服務。

網頁不能自動控制手機相簿。iPhone、Android、瀏覽器及已安裝的 PWA 提供的分享選項可能不同；沒有相簿儲存選項時，可使用每張圖片的下載按鈕。下載可能進入「下載」或「檔案」，需另按手機提供的選項儲存到相簿。多張不會自動連續下載。

分享取消不下載、不刪照；失敗保留準備結果供重試。任一相片轉換失敗會停止整組匯出，並指出失敗的相片。離頁、取消打卡、刪照、清除資料或相片版本更新會令尚未交給系統的匯出失效。已交給手機系統、下載或分享的副本不能由 App 撤回或清除。

此更新已有 117 項 Node 測試通過；`tests/browser/photo-export.html` 在 390×844、768×1024、1280×900 各有 8 項整合測試通過，包括真實 JPEG 下載、解碼及最終分享按鈕的 user activation。原有多相片 8 項、資料隔離 9 項、照片／CSP 11 項、裝置頁 16 項均通過；正式頁的離線重載、IndexedDB 讀回、JPEG 製作與下載通過。分享結果以模擬 API 驗證，未實測手機原生分享選單、相簿位置及安裝 PWA；真機驗證步驟見導讀第 25 節。IndexedDB 版本仍為 2，無資料遷移；離線快取更新為 v29，發布包仍只含 33 個網站資產。本次功能更新尚未提交、推送或部署。

### 2026-10-06 相片解碼資源限制修補

共用解碼入口已加入來源尺寸及靜態圖片結構預檢，匯入、JPEG 匯出與旅程卡均使用它；不允許預檢失敗後改用 Image 解碼。依使用者同意，HEIC／HEIF 暫停直接匯入，先轉為 JPEG。既有資料格式與相片保留，快取升至 v30，仍發布 33 個網站資產。

125 項 Node 測試通過，新增 8 項來源像素回歸測試。瀏覽器安全測試 14 項、多相片 8 項、資料隔離 9 項、裝置頁 16 項及三種視窗尺寸各 8 項相片匯出驗證通過；正式頁 v30 離線重載、相片讀回與 JPEG 下載通過。超大壓縮 PNG 以攔截原生解碼呼叫驗證提早拒絕，沒有在手機上故意觸發記憶體耗盡；實際手機分享與相簿位置仍須真機確認。此修補及相片匯出功能一併發布；推送 main 後由 GitHub Actions 重新測試、建置及部署 GitHub Pages。
