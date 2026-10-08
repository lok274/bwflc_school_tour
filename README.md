
一個繁體中文、手機優先、可安裝及離線使用的 PWA。提供三日行程、五個景點導覽、GPS 個人打卡、紀念相片、旅程卡及準備清單。
首頁提供自願訂閱的手機通知。旅程相片、清單和打卡繼續只保存在裝置內；原始 GPS 座標不會保存，通知訂閱另行管理。iPhone 須先把 App 加入主畫面。

正式景點頁及 `device-test.html` 都可重複拍照累積相片，或按「從相簿加入多張圖片」一次選取多張。正式景點須先打卡；測試相機毋須打卡，使用獨立測試儲存，保留既有相片。兩頁都可逐張按「儲存到手機」，或勾選／全選後「匯出已選相片」。JPEG 準備完成後再按「開啟手機分享選單」，自行選擇儲存；不支援分享或沒有相簿選項時可逐張下載。下載可能位於「下載」或「檔案」，網頁不能保證直接存入相簿。App 內副本會保留，刪除 App 副本不能刪除已匯出的檔案。HEIC／HEIF 仍須先轉成 JPEG。

推送後台已設定，老師由[公告管理頁](https://bwflc-school-tour-push.bwflc-school-tour-lok274.workers.dev/admin)登入及發送公告，操作說明見 [push-backend](push-backend/README.md)。使用者已確認 Android 手機收到測試通知；iPhone 尚未實測。`npm test` 驗證前台，`npm run test:push` 驗證後台，`npm run build` 只整理可發布的前台資產。
