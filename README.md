
一個繁體中文、手機優先、可安裝及離線使用的 PWA。提供三日行程、五個景點導覽、GPS 個人打卡、紀念相片、旅程卡及準備清單。
首頁加入公開公告及自願訂閱的手機通知。旅程相片、GPS、清單和打卡繼續只保存在裝置內；通知訂閱另行管理。iPhone 須先把 App 加入主畫面。

推送後台已設定，老師由[公告管理頁](https://bwflc-school-tour-push.bwflc-school-tour-lok274.workers.dev/admin)登入及發送公告，操作說明見 [push-backend](push-backend/README.md)。使用者已確認 Android 手機收到測試通知；iPhone 尚未實測。`npm test` 驗證前台，`npm run test:push` 驗證後台，`npm run build` 只整理可發布的前台資產。
