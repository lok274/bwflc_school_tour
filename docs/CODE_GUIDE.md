# 戶外學習日 Webapp 程式運作說明

這份導讀說明現在的源碼如何由模組組成，以及點擊打卡、影相和清單時，資料如何流動。重點是看懂「誰負責甚麼」和非同步操作的保護，再學會安全地修改功能。這次拆分沒有新增後端、第三方套件、登入或上傳，也沒有改動既有使用者資料的儲存名稱與版本。

## 先理解模組化

JavaScript ES Module 是一份可明確匯出功能、再由另一份檔案匯入的程式。例子是 `formatting.js` 匯出 `escapeHtml`，畫面模組匯入它處理文字。瀏覽器按依賴關係載入檔案，因此不需要把所有程式放在同一檔案，也不依靠全域函數名稱互相呼叫。

本專案採用函數工廠：`createCameraController(...)` 建立一個相機控制器，回傳 `openCamera`、`stopCamera` 等操作。控制器內的串流、待確認照片及計數器留在函數閉包內，不是全域變數。閉包的意思是：回傳的函數仍可讀取建立它時所屬的變數。

模組化改善分工和可測試性，但不是安全隔離。這些模組仍在同一網站、同一頁面執行；不能把拆檔視為加密、沙盒或不同權限。

## 檔案分工

| 檔案 | 責任 | 主要介面 |
| --- | --- | --- |
| `index.html` | 固定頁面骨架、導航、相機及確認 dialog、CSP | 載入 `src/app.js` |
| `styles.css` | 手機優先排版、印章動畫、焦點與減少動畫樣式 | CSS class |
| `src/app.js` | 唯一啟動入口 | 建立控制器，呼叫 `start()` |
| `src/controller.js` | 接線、持有 model、路由、事件、焦點、清單及清除 | `createAppController` |
| `src/views.js` | 讀取 model，回傳各頁 HTML 字串 | `createViews`、`renderHome` 等 |
| `src/formatting.js` | HTML 跳脫、景點查找、香港時間格式 | `escapeHtml`、`getAttraction`、`formatDateTime` |
| `src/data.js` | 靜態活動、景點、清單與地理設定 | `TRIP_DATA`、`ATTRACTIONS`、`BUILTIN_CHECKLIST` |
| `src/state.js` | 清單與打卡正規化、本機保存、進度及日期階段 | `loadState`、`saveState`、`normalizeState` |
| `src/geo.js` | 座標轉換、球面距離與範圍判定 | `evaluateGeofence`、`haversineDistance` |
| `src/check-in.js` | 一次定位、手動確認、建立個人打卡 | `createCheckInController`、`startCheckIn` |
| `src/camera.js` | 相機預覽、快門、重拍、停止 tracks | `createCameraController` |
| `src/photos.js` | 圖片驗證及重新編碼、IndexedDB、Canvas 旅程卡 | `compressPhoto`、`savePhotoRecord`、`createTravelCard` |
| `src/photo-actions.js` | 相片操作的狀態核對、刪相、下載確認 | `createPhotoActions` |
| `src/operations.js` | 非同步操作是否過期、相片工作的等待 | `createOperationGuard` |
| `src/feedback.js` | 提示訊息、獨立排隊確認、印章動畫 | `createFeedback` |
| `sw.js` | 離線靜態快取及更新 | install、activate、fetch 事件 |
| `scripts/build-pages.mjs` | 只複製批准的網站檔案 | `buildPages` |
| `server.mjs` | 本機靜態伺服器及開發安全標頭 | `npm start` |

依賴方向如下。相機不直接寫資料庫；畫面不直接要求 GPS；地理模組也不知道按鈕或 HTML 是甚麼。

```text
index.html → app.js → controller.js
                       ├─ views.js → data.js、state.js、formatting.js
                       ├─ check-in.js → geo.js、formatting.js
                       ├─ camera.js → 拍攝結果交給 photo-actions.js
                       ├─ photo-actions.js → photos.js
                       ├─ operations.js → 過期核對與工作等待
                       └─ feedback.js → 確認與提示
```

箭頭表示組合或呼叫關係，不表示網絡傳送。控制器把需要的函數傳入其他模組，功能模組不反向 import 控制器，因此沒有循環依賴。

## 網站啟動流程

`index.html` 先宣告安全政策，再載入樣式與模組入口。HTML 的 `<main id="app">` 初時只顯示載入提示，導航及兩個 dialog 則一直留在骨架內。

`app.js` 的完整入口很短：

```javascript
import { createAppController } from "./controller.js";

const application = createAppController();
application.start();
```

`createAppController` 先取得 DOM 元素，透過 `loadState(localStorage)` 讀回清單與打卡，建立相片記錄與 Blob URL 的 Map，再建立各模組並安裝事件處理器。工廠每個 document 只呼叫一次，否則會重複安裝事件。除了入口，功能模組只定義功能，import 本身不會開相機或要求定位。

`start()` 更新連線提示，等待 `refreshPhotos()` 讀 IndexedDB，然後 `render()` 顯示目前路由。最後嘗試註冊 Service Worker。相片資料庫不支援或讀取失敗時，網站仍可顯示行程與清單；離線註冊失敗則顯示提示。

## 接線與最新狀態

控制器持有 `state`、`photoRecords`、`photoUrls` 和安裝提示。功能模組透過 `getModel()` 或 `getState()` 讀它們，而不是永遠握着第一次讀到的物件：

```javascript
const getModel = () => ({ state, photoRecords, photoUrls, installPrompt });
const views = createViews({ getModel });
```

原因是 `saveState` 正規化後會回傳新物件；清除資料後也會換成 `createDefaultState()`。若模組只保存舊 `state`，重設後可能仍顯示舊紀錄。getter 是稍後呼叫才讀取目前變數的函數，解決這種過期引用。下載前後亦重新讀取相片 Map，確認照片沒有被替換。

`createAppController` 可接收 `environment`、`photoService` 和 `feedbackService`。正式啟動使用瀏覽器環境及真正服務；測試注入模擬位置、相機與儲存服務。這叫依賴注入，讓測試能控制錯誤及延遲，而不用修改真正模組或發出權限要求。相片服務預設使用瀏覽器 API；測試替換整個服務，不假定換環境就能替換其 IndexedDB。

`getSnapshot()` 供讀取目前 model，例如畫面與測試使用。它不是複製、凍結或安全權限邊界；一般功能應經控制器的既有操作改動資料，不直接修改 snapshot。

## 路由與畫面

`currentRoute()` 讀網址的 hash，例如 `#prepare` 或 `#attraction/future-school`。一般頁面只接受 home、itinerary、attractions、prepare；景點 ID 必須存在於 `ATTRACTIONS`。不存在的景點返回景點列表，其餘未知頁面回首頁。

`render()` 根據路由呼叫對應的畫面函數，把回傳字串放進 `app.innerHTML`，並更新底部導航的 `aria-current`。畫面模組只讀資料與建立字串，不寫 DOM、不保存、不要求相機或 GPS。首頁顯示旅程介紹、行程與景點導覽入口及本機私隱提示。清除所有本機資料的入口位於準備頁。

換 hash 時先停止相機及關閉拍攝 dialog，再重畫、移動主內容焦點和捲回頂部。勾選清單等同頁重畫則根據 input 的 data 屬性找回新的對應元素，避免鍵盤焦點消失。

文字跳脫由 `escapeHtml` 把 `& < > " '` 換成 HTML entity。例如提醒 `<script>test</script>` 會作為文字顯示，而非插入真正 script。照片尺寸等由本機資料庫讀回的動態文字亦跳脫。靜態連結及圖像設定來自受控資料檔；若日後允許使用者輸入 URL，需要另外驗證 URL，不能只靠文字跳脫。

## 點擊與清單更新

控制器使用事件委派：在 document 安裝一次 click 監聽器，用 `event.target.closest("button, a")` 找按鈕，再根據 `data-checkin`、`data-camera-open` 等屬性呼叫對應模組。重畫會換掉按鈕，但 document 的監聽器仍在，不用逐一重新綁定。

清單勾選先更新 `state.checklist` 或自訂項目的 `done`，再 `persist()`，最後 `render()`。新增提醒會去除前後空白並截到 120 字；`normalizeState` 另限制可接受的 ID、數量與內容。刪除提醒以 ID 篩走該項。

`saveState` 在保存前正規化資料並更新時間。儲存失敗時顯示警告，畫面上的暫存變更不等於已永久寫入裝置。重新開頁以實際保存的資料為準。

## GPS 打卡流程

點擊「到埗打卡」後，`startCheckIn(attractionId, button)` 查景點及現有紀錄，取得操作 token，再停用按鈕顯示忙碌狀態。它只呼叫一次 `getCurrentPosition`，不使用背景 `watchPosition`；要求高精確度，逾時 10 秒，允許最多 60 秒的位置快取。

位置成功後，`evaluateGeofence` 把地理設定中的 GCJ-02 中心近似轉為 WGS84，再用 Haversine 算球面距離。兩種座標系統不能直接混用，否則會產生明顯偏差。

有效誤差非負且不超過 200 米，並且距離不超過「景點半徑＋回報誤差」，才回傳 verified。若位置明確超出這個範圍，先判 too-far，不因精確度較低而提供手動繞過。誤差不足以可靠核實但未明確太遠，或權限被拒、逾時、不支援，才提供未核實手動確認。

確認後 `recordCheckIn` 再核對 token，建立以下資料，保存、重畫、顯示印章：

```javascript
{
  attractionId: "future-school",
  checkedInAt: "2026-11-05T04:00:00.000Z",
  method: "gps",       // 手動時為 "manual"
  verified: true      // 手動時必須 false
}
```

這是結構示例，不是某人的真實打卡。沒有保存 latitude、longitude 或原始 accuracy。它只是個人紀念，不是校方出席證明，也不能防止裝置擁有人改寫本機資料。

## 相機與相簿流程

`openCamera` 只有已打卡才可開啟。它要求 `video.facingMode.ideal = "environment"` 並關閉音訊；ideal 是優先使用後置鏡頭的提示，不保證每部裝置都有或一定選中後鏡。沒有 API 或權限失敗便改用相簿選擇器。

相機模組持有 `cameraStream`。當權限 Promise 回覆時，會核對請求代數、dialog 是否仍開着、景點與操作 token；使用者已離開便立即停止剛取得的 tracks，而不接到 video。

按快門後，`captureCameraFrame` 把 video 當前像素畫上隱藏 Canvas，產生暫存 JPEG Blob，顯示 Blob URL 預覽。重拍會移除這個暫存 Blob 與 URL，返回預覽；不會寫入 IndexedDB。Canvas 非同步回覆亦核對捕捉代數，避免取消後出現舊畫面。

選「使用照片」先取出待確認 Blob，再停止相機、關閉 dialog，將 Blob 交給 `processPhoto`。相簿的 file input change 也走同一條處理流程，因此兩個入口都有相同驗證和壓縮。取消、關閉、換路由、pagehide 與離開頁面都停止 tracks。

## 相片驗證與儲存

`photos.js` 提供較低層的圖像與資料庫操作；`photo-actions.js` 負責「目前是否仍容許這個操作」及畫面提示。這樣相片格式處理不用知道按鈕，而非同步取消也不用塞進圖片解碼器。

`compressPhoto(input, attractionId)` 的次序是：

1. 確認是非空 Blob、不超過 20 MiB；MIME 與首 512 bytes 的支援格式檔頭須一致。拒絕 SVG、未知格式與假冒資料，無 MIME 可用檔頭辨認。
2. 用 `createImageBitmap` 解碼及方向處理，不支援時改用 Image。HEIC／HEIF 是否真正可解碼仍取決於瀏覽器。
3. 計算 `scale = Math.min(1, 1600 / Math.max(width, height))`。例如 4000×3000 會變成 1600×1200，小圖不放大。
4. 在新 Canvas 重畫像素，再要求約 0.82 品質的 WebP。瀏覽器若實際回傳 PNG，保存真實 MIME；拒絕未知輸出。
5. 回傳 `PhotoRecord`，不是原檔。Canvas 重新編碼不帶原始 EXIF、相機型號與 GPS 中繼資料，但畫面中的人樣仍在。

`PhotoRecord` 包括 attractionId、blob、mime、width、height、createdAt、version。相片操作層另加 `writeId`，用於分辨自己寫入的版本。IndexedDB 的 object store 以 attractionId 作 key，`put` 會取代同景點記錄，所以每站只保存一張。

資料庫交易等到 `transaction.oncomplete` 才回報完成，而不是只看到單一 request 成功便視為全筆保存完成。讀取用 readonly、寫入及刪除用 readwrite，完成或失敗都關閉資料庫連線。

已儲存 Blob 以 `URL.createObjectURL` 供 img 顯示。`refreshPhotos` 更新記錄及 URL，舊 URL 會釋放，頁面離開也會釋放。Blob URL 是目前頁面的本機引用，不是相片上傳網址。儲存空間不足或解碼失敗只影響相片，不取消已完成的打卡。

## 非同步取消為何需要代數

壓縮、相機權限、資料庫寫入、GPS 和確認都不是立即完成。假設相片正在壓縮，使用者已取消打卡；若壓縮完成後無條件保存，就會恢復已刪照片。

`operations.js` 對整體資料和每個景點分別計數。`operationToken(id)` 記錄開始時的兩個代數，`isCurrentOperation(id, token)` 核對現在代數及重設鎖。取消某站令該站代數增加；清除所有資料令整體代數增加。這不是取消瀏覽器工作本身，而是拒絕其過期結果。

`trackPhotoTask` 把每個景點正在處理的 Promise 放入 Set。刪除前先使操作過期，再 `waitForPhotoTasks` 等它們完成或失敗，最後清理資料庫。已開始的寫入不能靠 token 撤銷，所以寫入後再核對；若過期，只刪除 writeId 仍等於自己的照片，避免誤刪別的較新版本。

`getModel()` 在下載確認及卡片生成之後再次讀相片 Map，核對記錄物件仍相同。即使使用者曾同意，照片已替換或清除也不能下載舊內容。

這些保護只在本頁有效，不是跨分頁交易鎖。多分頁仍共享同一 origin 的儲存，不能聲稱另一分頁沒有正在改動資料。

## 取消打卡與清除資料

取消打卡先確認連同照片刪除，再使該景點操作過期、等待照片工作、刪除照片，最後移除打卡及保存。照片刪除失敗會保留打卡並明確警告；不支援 IndexedDB 且本來沒有照片時仍可取消。

「清除所有本機資料」需要兩次獨立確認。通過後啟用重設鎖、使所有舊操作過期、停止相機、等待照片工作；先清 IndexedDB，成功後才移除 localStorage 並換成預設狀態。任何一個步驟失敗都顯示實際情況，不虛報全部成功。這是兩個儲存區之間的順序控制，不是跨儲存區原子交易。

`feedback.js` 的確認以 Promise 排隊，上一個 dialog 關閉後下一個才出現。每個要求各自取得回覆，不會讓一個「確認」同時批准多個動作。標題與訊息用 textContent 放入 DOM。

## 旅程卡生成

`downloadTravelCard` 先顯示私隱確認，取得目前照片、景點與打卡，再交給 `createTravelCard`。卡片的 Canvas 固定 1080×1350；照片按比例中心裁切填滿相框，不拉伸，然後畫嶺南風格裝飾、景點、日期時間及核實標記。

日期用香港時區格式，不依裝置目前時區。輸出是 PNG Blob；核對操作和照片仍有效後，才建立暫時的 a download 連結供本機下載，並稍後釋放 URL。卡片不加學生姓名、班別或座標，但照片、景點與到訪時間仍可能透露身份。已下載、分享或備份的檔案不受 App 的清除功能控制。

## 離線與發布

Service Worker 只處理同源、應用範圍內的 GET。安裝會重新取得精確白名單內的靜態資產，包括全部執行模組、插畫及圖示。啟用新版本時移除本 App 舊版本快取，並接管頁面。

導航優先網絡，失敗時回離線首頁；只用成功的應用 HTML 更新離線 index，不把 404 或別的文件當首頁。其他資產先快取再網絡，只允許精確白名單 URL，不緩存任意 GET 或帶 query 的內容。

照片與清單不放入 Service Worker 快取；它們由 IndexedDB 及 localStorage 自行保存。離線拍照、壓縮與卡片生成仍在本機執行，但第一次需要先在線完整載入；離線不是跨裝置備份，瀏覽器亦可能清理儲存。

新增執行模組必須同時加入 `APP_SHELL` 與 `build-pages.mjs` 白名單，並提高快取版本。目前版本為 v13，發布包包含 25 個檔案，另有根路徑離線預載項。說明、測試、伺服器、通告和個人資料不在網站發布包內；GitHub repository 若公開，其提交的源碼與文件仍可被查看。

hash 路由與相對路徑支援 Pages 子目錄。Service Worker 註冊從 `controller.js` 用 `new URL("../sw.js", import.meta.url)` 解析，仍指向專案根目錄；若日後移動該模組，必須調整此路徑。

## 安全防線與限制

HTML 的 meta CSP 拒絕內嵌程式、eval、資料 API 連線、表單網絡提交及外部資產，允許必要同源模組和本機 Blob；文字跳脫、URL 白名單及照片解碼仍須各自保留。文件 CSP 不等於限制 worker 自身所有網絡能力；worker 仍依精確靜態白名單運作。

沒有後端，所以 App 沒有集中存放全體學生照片或位置；但本機資料沒有由 App 額外加密，裝置及瀏覽器存取權仍很重要。同一 origin 的不同子目錄不構成不同安全租戶。移除 EXIF 不會移除照片像素中的人樣。

本機伺服器只监聽 127.0.0.1，設置安全標頭和路徑邊界；GitHub Pages 不執行這個伺服器，其標頭不會自動套用。相機、GPS 與 Service Worker 正式使用需要 HTTPS。本次未改變這些安全邊界。

## 如何修改功能

改景點文字、行程或清單：先找 `data.js`，保留可靠來源，不重新加入已移除的費用、名額、班別或教職員姓名。若新增景點，需要補地理設定、圖片、資料完整度測試及離線／建置白名單。

改頁面內容：找 `views.js` 對應 render 函數，外觀則改 `styles.css`。動態文字繼續使用 escapeHtml；不要把 inline script、事件屬性或 inline style 加入模板。

改打卡範圍：半徑在 `data.js`，判定規則在 `geo.js`，權限與確認流程在 `check-in.js`。三者分開，不需要去相機模組找 GPS 邏輯。新增邊界及明確太遠測試。

改拍攝操作：找 `camera.js`；改檔案驗證、尺寸或卡片構圖：找 `photos.js`；改刪相與下載條件：找 `photo-actions.js`。任何 await 前後可能被取消的操作都要考慮 token，而不只是成功路徑。

新增按鈕功能：畫面放 data 屬性，控制器事件委派呼叫對應模組。功能模組以明確依賴建立，不反向 import 控制器，不把全部邏輯搬回入口。

## 測試與閱讀次序

本機 `npm test` 使用 Node 內建 test，不需要安裝依賴。測試直接 import 真正模組；`tests/helpers/browser-environment.js` 提供假 DOM、相機、位置、儲存及點擊事件，`modules.test.mjs` 驗證接線和延遲取消。Service Worker 因為是獨立 worker 腳本，用 VM 模擬其事件環境；不是把應用的 import 刪掉來測。

用 `node server.mjs 4174` 啟動另一個本機 origin，再開 `http://127.0.0.1:4174/tests/browser/security.html`，可驗證真正 Canvas、Blob 預覽、IndexedDB、CSP、旅程卡和模組載入。測試產生色塊，不讀個人照片，測試頁不會發布到 Pages。實際手機相機、GPS、HEIF 支援及權限互動仍需真機驗收。

建議閱讀次序：先看短入口及控制器的模組接線，再看一個畫面函數；接着讀一次完整打卡流程，然後看相機到相片服務的交接，最後讀 token 與清除流程。這比從第一行逐行記語法，更容易掌握每個函數在整體中的作用。
