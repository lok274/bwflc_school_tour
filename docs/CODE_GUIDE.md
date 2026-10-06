# 戶外學習日 Webapp 程式運作說明

這份導讀以 2026-10-06 的工作目錄程式碼為準，已同步各頁資料分工及離頁取消實作，說明各模組的責任、函數的輸入與輸出，以及打卡、影相、清單、下載和清除資料的完整流程。示例資料只是教學用途，並非真實個人紀錄。

目前是 HTML、CSS、JavaScript ES Modules 組成的靜態 PWA，沒有框架、第三方執行套件、登入、後端或資料上傳。PWA 的意思是：網站可在支援的瀏覽器安裝到主畫面，並透過 Service Worker 預先保存網站檔案供離線使用。

清單與打卡仍使用 `outdoorLearningDay.v3`，相片資料庫仍為版本 1。之前討論的密碼加密及復原碼只有規劃，**目前沒有實作**；不能因為刪除了須知頁，就把資料描述成已加密。

## 目前功能與已刪除內容

| 位置 | 現有內容 | 對應函數 |
| --- | --- | --- |
| 首頁 | 旅程介紹、可用時的安裝按鈕、私隱提示、清除所有本機資料 | `renderHome(model)` |
| 行程 | 三日行程、各站連結及打卡狀態 | `renderItinerary(model)` |
| 景點 | 五個景點卡片及完成數量 | `renderAttractions(model)` |
| 景點詳情 | 簡介、觀察與學習提示、來源、打卡、相機與相簿、紀念相片及旅程卡 | `renderAttraction(model)` |
| 準備 | 六項內建清單、完成進度、自訂提醒 | `renderPrepare(model)` |

底部導航只有「首頁、行程、景點、準備」。首頁的出發倒數卡片、四個重要時刻、兩張進度卡片及景點預覽區塊已刪除；準備頁的「出發前」三項清單也已刪除。須知頁、`renderInfo()`、相關路由、資料及樣式均已移除。景點頁仍使用景點卡片，並非整個 App 都沒有卡片。

`#info` 現在屬未知路由，會顯示首頁；程式沒有把網址 hash 改寫成 `#home`。清除資料入口位於首頁底部，準備頁沒有第二個入口。

## 初學者需要的詞彙

| 詞彙 | 在本專案的意思 |
| --- | --- |
| DOM | 瀏覽器把 HTML 轉成的元素物件；程式用它取得按鈕、修改內容 |
| state／model | state 是保存層內部紀錄；頁面 model 是按需要複製及凍結的快照 |
| 同步 | 呼叫時直接回傳結果，例如產生 HTML 或保存清單 |
| Promise／await | 代表稍後才完成的工作，例如相機權限、圖片處理或資料庫交易 |
| Blob | 圖片等二進位資料物件；不是網址，也不等於上傳檔案 |
| Map／Set | Map 以景點 ID 找紀錄；Set 保存不重複的工作或分組 |
| token／generation | 開始工作時記住的計數，用來判斷回覆是否已過期；不是登入憑證 |
| origin | 網址的協定、主機及連接埠組合；不同子目錄不會形成新的 origin |

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
| `src/controller.js` | 接線、路由權限、頁面生命週期、焦點及跨儲存區清除 | `createAppController`、`getPageSnapshot` |
| `src/store.js` | 私有 state、相片紀錄及版本、指定資料操作 | `createDataStore`、`readonlyCopy` |
| `src/page-models.js` | 按頁複製及凍結所需資料，不提供 Blob 或 Map | `createPageModels` |
| `src/views.js` | 接收專用 model，回傳各頁 HTML 字串 | `createViews()`、`renderHome(model)` 等 |
| `src/formatting.js` | HTML 跳脫、景點查找、香港時間格式 | `escapeHtml`、`getAttraction`、`formatDateTime` |
| `src/data.js` | 靜態活動、景點、清單與地理設定 | `TRIP_DATA`、`ATTRACTIONS`、`BUILTIN_CHECKLIST` |
| `src/state.js` | 清單與打卡正規化、本機保存及進度計算 | `loadState`、`saveState`、`normalizeState`、`checklistProgress` |
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
| `manifest.webmanifest` | 安裝名稱、圖示、起始網址與顯示方式 | `start_url: "./#home"`、`scope: "./"` |
| `.github/workflows/pages.yml` | 執行測試、建立發布包、部署預設分支 | GitHub Actions workflow |
| `tests/` | Node 測試、模擬瀏覽器環境及真正瀏覽器測試頁 | `npm test`、`tests/browser/security.html` |

依賴方向如下。相機不直接寫資料庫；畫面不直接要求 GPS；地理模組也不知道按鈕或 HTML 是甚麼。

```text
index.html → app.js → controller.js
                       ├─ store.js → state.js、data.js
                       ├─ page-models.js → store.js、data.js、formatting.js
                       ├─ views.js → formatting.js
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

`createAppController` 先取得 DOM 元素，建立保存層，由保存層透過 `loadState(localStorage)` 讀回清單與打卡，再建立各模組及事件處理器。照片讀回後放入保存層的私有 Map，只有當前景點詳情需要預覽時才建立 Blob URL。工廠每個 document 只呼叫一次，否則會重複安裝事件。除了入口，功能模組只定義功能，import 本身不會開相機或要求定位。

`start()` 更新連線提示，等待 `refreshPhotos()` 讀 IndexedDB，然後 `render()` 顯示目前路由。最後嘗試註冊 Service Worker。相片資料庫不支援或讀取失敗時，網站仍可顯示行程與清單；離線註冊失敗則顯示提示。

## 保存層、頁面快照與操作權限

資料擁有人是 `createDataStore({ storage, onSaveError })`。state 和照片 Map 留在保存層閉包內，不提供整份可修改的引用。控制器負責核對現在是哪個頁面，再把明確的讀取或修改函數交給功能模組。

`createViews()` 不接收共用 getter；`renderPrepare(model)` 等函數只讀傳入資料。`createPageModels` 整理所需欄位，`readonlyCopy` 遞迴複製普通物件及陣列，再凍結每一層，因此修改快照不能修改原紀錄。Blob 內容不可變，但仍不傳入畫面快照。

| 頁面 | 快照欄位 | 允許操作 |
| --- | --- | --- |
| 首頁 | view、trip.title、canInstall | 安裝、兩次確認後清除全部資料 |
| 行程 | view、days、checkIns 核實摘要 | 導航 |
| 景點列表 | view、卡片所需 attractions、checkIns 摘要、photoIds | 導航 |
| 景點詳情 | view、當站 attraction、checkIn、照片網址與尺寸 photo | 只操作當站的打卡、相機、照片及下載 |
| 準備 | view、items、checklist、customItems、progress | 勾選、新增及刪除提醒 |

行程摘要只含 verified，不包含照片或完整打卡時間。景點列表只知道哪些站有照片，不取得 Blob URL、Blob 或照片尺寸。詳情只提供當前景點；首頁不取得個人紀錄，清除全部資料是明確允許的跨功能操作。

保存層提供以下操作；只有可信任的控制器及必要模組取得它們，頁面快照沒有這些方法：

| 操作 | 輸入及結果 |
| --- | --- |
| `setBuiltinDone(id, done)` | 已知內建 ID、完成值；未知 ID 拒絕 |
| `setCustomDone(id, done)` | 已有提醒 ID、完成值；不存在拒絕 |
| `addReminder(label)`、`removeReminder(id)` | 新標籤／已有 ID；更新後保存 |
| `recordCheckIn(id, record)` | 有效且尚未打卡的景點；回 `{ accepted, saved }` |
| `removeCheckIn(id)` | 控制器完成已獲確認的刪除後移除紀錄，回保存是否成功 |
| `clearProgress()` | 先移除指定 localStorage 鍵，再改預設 state；失敗拋錯 |
| `replacePhotos(records)` | 更新私有相片 Map 及各站版本，不寫資料庫 |

清單操作回傳 true 表示接受了記憶體變更，不保證保存成功；寫入失敗仍由 onSaveError 警告，重開頁面以實際保存的資料為準。打卡另回傳 saved，區分永久保存與目前頁面的暫存。

控制器對外只回傳四個介面：

| 介面 | 用法與結果 |
| --- | --- |
| `start()` | Promise；讀相片、初次畫面、嘗試註冊離線功能 |
| `render({ moveFocus = false } = {})` | 同步重畫目前路由；不代表保存資料 |
| `currentRoute()` | 回傳 `{ view }` 或 `{ view: "attraction", attractionId }` |
| `getPageSnapshot()` | 當前頁不可修改的快照；沒有完整 state 或 Map |

舊 getSnapshot() 已移除，不能再用它改內部資料。測試先在模擬 localStorage 或相片服務放入初始紀錄，再建立應用；照片替換及儲存錯誤也由服務模擬，不從快照回寫。

createAppController 仍可注入 environment、photoService 和 feedbackService，控制測試權限、延遲與失敗。refreshPhotos() 回傳讀回是否成功；失敗時清空記憶體中的照片索引及預覽，沒有刪除資料庫。因此沒有預覽不等於照片已刪除。

這是程式分工及防止誤操作，不是安全沙盒。相同 origin 的其他程式仍在同一瀏覽器儲存邊界，不能靠凍結物件、拆模組或拆欄位抵擋惡意同源程式。

## 路由與畫面

`currentRoute()` 讀網址的 hash，例如 `#prepare` 或 `#attraction/future-school`。一般頁面只接受 home、itinerary、attractions、prepare；景點 ID 必須存在於 `ATTRACTIONS`。不存在的景點返回景點列表，其餘未知頁面回首頁。

| 網址片段 | 畫面結果 | 注意事項 |
| --- | --- | --- |
| 無 hash、`#home` | 首頁 | 包含清除資料入口 |
| `#itinerary` | 三日行程 | 路線文字會嘗試與景點名稱配對，建立詳情連結 |
| `#attractions` | 景點列表 | 讀當前打卡數及相片 Map |
| `#attraction/future-school` | 對應景點詳情 | ID 由資料檔白名單核對 |
| `#attraction/不存在的ID` | 景點列表 | 不產生不存在景點的詳情 |
| `#prepare` | 準備清單 | 六項內建清單加自訂提醒 |
| `#info` 或其他未知名稱 | 首頁 | 顯示首頁，但不改寫 hash |

`render()` 先同步路由生命週期，取得專用頁面 model，再呼叫對應的畫面函數，把回傳字串放進 `app.innerHTML`，並更新底部導航的 `aria-current`。畫面模組只讀資料與建立字串，不寫 DOM、不保存、不要求相機或 GPS。首頁顯示旅程介紹及本機私隱提示，可安裝時才顯示安裝按鈕；行程與景點可從底部導航進入。清除所有本機資料的入口位於首頁。

切換實際頁面或景點時，先更新頁面代數，停止相機、關閉拍攝及確認 dialog、取消相簿請求並釋放照片預覽，再重畫、移動主內容焦點和捲回頂部。同頁重畫不更新頁面代數。勾選清單等同頁重畫則根據 input 的 data 屬性找回新的對應元素，避免鍵盤焦點消失。

文字跳脫由 `escapeHtml` 把 `& < > " '` 換成 HTML entity。例如提醒 `<script>test</script>` 會作為文字顯示，而非插入真正 script。照片尺寸等由本機資料庫讀回的動態文字亦跳脫。靜態連結及圖像設定來自受控資料檔；若日後允許使用者輸入 URL，需要另外驗證 URL，不能只靠文字跳脫。

`photoPanel(model)` 有三種畫面：未打卡顯示鎖定提示；已打卡但缺相片或 Blob URL 顯示加入照片按鈕；兩者都有才顯示紀念照、換相、刪相及下載旅程卡。畫面上的「鎖定」只是功能條件，不是密碼鎖或加密。

`renderPrepare(model)` 從頁面快照 `items` 的 group 值建立分組，不是把每張清單卡片寫死。刪掉某組全部資料，該組卡片就不會生成。首頁刪掉景點預覽後，`attractionCard()` 仍被景點列表使用，所以不能把這個共用函數一併刪除。

`progressRing(percent, label)` 以 SVG 圓周長 `2 × π × 42` 及 `stroke-dashoffset` 表示進度，百分比來自 `checklistProgress`。目前只有準備頁使用，並沒有因首頁進度卡刪除而一併移除。

`formatting.js` 的 `getAttraction(id)` 回傳資料陣列中對應的物件，找不到為 undefined；`formatDateTime(iso)` 顯示香港時區的月、日、時、分；`escapeHtml(value)` 先轉字串再跳脫。日期函數假設輸入有效日期，不能拿它替代 `normalizeState` 的驗證。

樣式集中在 `styles.css`：`.hero-section` 是首頁介紹、`.attraction-grid` 和 `.attraction-card` 是景點列表、`.checklist-*` 是準備清單、`.bottom-nav` 是底部導航。響應式排版由 media query 控制，`[hidden]` 強制隱藏元素，焦點及減少動畫規則也在此檔。畫面 class 和 CSS 必須一起核對；不要為了刪一處卡片而移除其他頁面仍共用的樣式。

## 靜態資料與個人紀錄

這裡要分清三種資料：資料檔中的景點介紹、使用者的清單與打卡、使用者的照片。三者保存位置和生命週期不同。

### 靜態資料：`src/data.js`

| 物件 | 主要欄位／用途 | 修改後影響 |
| --- | --- | --- |
| `TRIP_DATA` | `title`、`shortTitle`、日期欄位、`duration`、三日 `itinerary` | 旅程介紹、行程及旅程卡標題 |
| `ATTRACTIONS` | `id`、`day`、`name`、`city`、圖片、簡介、提示、地址、來源、`geo` | 景點畫面、打卡白名單、定位中心及旅程卡 |
| `BUILTIN_CHECKLIST` | 每項的 `id`、`group`、`label` | 預設 state、準備分組及完成總數 |

目前活動資料仍保留 `startAt`、`endAt`、`dateLabel`、`duration` 等欄位，但執行模組沒有再用它們計算倒數；保留欄位不代表倒數功能仍存在。須知專用的 `cities`、`participants`、`leaders`、`notices` 已移除。

`Object.freeze()` 防止頂層屬性被直接換掉，但不會遞迴凍結巢狀物件與陣列。不要把它當成整份資料無法被修改的保證。

圖片網址由 `new URL("../public/images/attractions/...", import.meta.url).href` 解析。它相對於資料模組的位置，所以在 GitHub Pages 的 repository 子目錄也能找到圖片。

### 清單與打卡：localStorage

`state.js` 的預設結構如下，所有六項清單鍵都由 `BUILTIN_CHECKLIST` 自動建立：

```javascript
{
  version: 3,
  checklist: {
    "documents-valid": false,
    "documents-pack": false,
    health: false,
    insurance: false,
    camera: false,
    reflection: false
  },
  customItems: [],
  checkIns: {},
  updatedAt: "1970-01-01T00:00:00.000Z"
}
```

`localStorage` 只接收字串，程式以 `JSON.stringify` 保存、`JSON.parse` 讀回。`updatedAt` 是最近保存時間，不是最後定位時間。

| 函數 | 輸入 | 回傳／失敗行為 |
| --- | --- | --- |
| `createDefaultState()` | 無 | 新的預設物件，各項未完成、無提醒或打卡 |
| `normalizeState(raw)` | 待檢查的物件 | 按已知欄位重建 v3 state；無效資料不直接沿用 |
| `loadState(storage)` | 預設為 localStorage，可注入測試替身 | 讀指定鍵、解析及正規化；讀取或 JSON 失敗回預設 state |
| `saveState(state, storage)` | 要保存的 state 及儲存介面 | 更新時間、正規化、寫入，回傳新物件；實際寫入失敗向外拋錯 |
| `checklistProgress(state)` | 已正規化的 state | `{ done, total, percent }`，百分比四捨五入，空清單為 0 |

正規化會重新使用當前內建清單的鍵，所以舊 `copies`、`workshop`、`briefing` 不再計入進度。這是讀取後的欄位整理，不是升級資料庫；不會因為載入就立即改寫磁碟上的舊 JSON，下一次保存才寫回整理後的紀錄。

自訂提醒只接受字串 ID 和標籤；ID 截到 80、標籤去除前後空白並截到 120，移除空標籤，最多保留 30 項。這些上限按 JavaScript 字串長度計算，不保證等於肉眼看到的字數。UI 沒有逐項加入前的 30 項限制提示；保存時由正規化限制。

打卡要求物件的 `attractionId` 與外層鍵相同、ID 在景點白名單、日期有效、方式為 `gps` 或 `manual`，而且 `verified` 與方式一致。額外欄位不會保存，因此原始定位資料不會跟着寫入。

### 相片：IndexedDB 與頁面記憶體

| 位置／名稱 | 內容 | 重開頁面後 |
| --- | --- | --- |
| IndexedDB：`outdoorLearningDay.photos`，版本 1，store `photos` | 每景點一筆 PhotoRecord，以 `attractionId` 作 key | 瀏覽器尚未清理時可讀回 |
| 保存層私有 photos Map | 本次載入的不可修改 PhotoRecord | 重新查資料庫建立，不傳入畫面 |
| 控制器 preview | 當前景點的 ID、版本及一個 Blob URL | 詳情需要時建立；離頁或重讀便釋放 |
| 私有 photoVersions | 每個景點的照片版本計數 | 本次 document 的計數，替換或移除時更新 |
| `pendingCapture` | 相機剛拍到、尚未按「使用照片」的 Blob | 不在資料庫，關閉或重拍會釋放引用 |

每筆 PhotoRecord 有 `attractionId`、`blob`、`mime`、`width`、`height`、`createdAt`、`version: 1`，應用操作層再加 `writeId`。日期是 ISO 字串；照片是 Blob，不是放在 JSON 裡的 Base64 字串。

頁面重新整理只會失去記憶體內的 Map 和暫存照片，不等於清除已保存資料。反過來，關閉網頁也不是備份；瀏覽器清理、裝置故障或更換 origin 都可能令資料不可讀。

## 點擊與清單更新

控制器使用事件委派：在 document 安裝一次 click 監聽器，用 `event.target.closest("button, a")` 找按鈕，再根據 `data-checkin`、`data-camera-open` 等屬性呼叫對應模組。重畫會換掉按鈕，但 document 的監聽器仍在，不用逐一重新綁定。操作前核對控制項仍在目前主內容中，並檢查頁面及景點 ID；相機控制項另核對當站及 dialog 狀態。已移除的舊按鈕不能沿用。

| HTML 屬性／事件 | 處理函數 | 效果 |
| --- | --- | --- |
| `data-checkin` | `startCheckIn` | 請求一次位置或提供手動確認 |
| `data-checkin-undo` | `undoCheckIn` | 確認後取消打卡及相關照片 |
| `data-camera-open`、`data-gallery-open` | `openCamera`、`openGallery` | 開啟相機或檔案選擇器 |
| `data-camera-capture`、`data-camera-retake`、`data-camera-save` | 相機對應操作 | 快門、重拍、使用照片 |
| `data-camera-close`、dialog `close` | `stopCamera` | 停止串流及移除暫存預覽 |
| `data-photo-delete`、`data-card-download` | `removePhoto`、`downloadTravelCard` | 刪相或確認後生成下載卡片 |
| `data-reset-all` | `resetAllData` | 首頁的兩次確認清除流程 |
| input `change` 的 `data-check-item`、`data-custom-check` | 控制器 change 處理器與保存層清單操作 | 更新內建或自訂項目完成狀態 |
| `custom-item-form` 的 `submit`、`data-custom-delete` | 控制器提交／點擊處理器 | 新增或刪除個人提醒 |
| `photo-input` 的 `change` | `processPhoto` | 讀第一個檔案，使用相同照片驗證流程 |
| `install-button` | 控制器安裝處理器 | 觸發瀏覽器提供的安裝提示，等待選擇後移除暫存提示 |

`beforeinstallprompt` 只在瀏覽器有提供時保存事件並顯示安裝按鈕。按鈕不是對所有瀏覽器或已安裝裝置都保證出現。

清單勾選只在準備頁有效，呼叫保存層的 setBuiltinDone 或 setCustomDone，由保存層更新及保存，最後 render()。新增提醒會去除前後空白並截到 120 字；`normalizeState` 另限制可接受的 ID、數量與內容。刪除提醒經 removeReminder(id) 篩走該項。新增、刪除及勾選都不再直接寫整份共用 state。

`saveState` 在保存前正規化資料並更新時間。儲存失敗時顯示警告，畫面上的暫存變更不等於已永久寫入裝置。重新開頁以實際保存的資料為準。

## GPS 打卡流程

點擊「到埗打卡」後，`startCheckIn(attractionId, button)` 核對當前詳情的景點及現有紀錄，取得包含資料與頁面版本的操作 token，再停用按鈕顯示忙碌狀態。它只呼叫一次 `getCurrentPosition`，不使用背景 `watchPosition`；要求高精確度，逾時 10 秒，允許最多 60 秒的位置快取。

位置成功後，`evaluateGeofence` 把地理設定中的 GCJ-02 中心近似轉為 WGS84，再用 Haversine 算球面距離。兩種座標系統不能直接混用，否則會產生明顯偏差。

有效誤差非負且不超過 200 米，並且距離不超過「景點半徑＋回報誤差」，才回傳 verified。若位置明確超出這個範圍，先判 too-far，不因精確度較低而提供手動繞過。誤差不足以可靠核實但未明確太遠，或權限被拒、逾時、不支援，才提供未核實手動確認。

| `geo.js` 函數 | 輸入 | 回傳 |
| --- | --- | --- |
| `haversineDistance(a, b)` | 兩個 `{ lat, lng }`，角度單位 | 距離，單位米，地球半徑取 6,371,000 米 |
| `gcj02ToWgs84(point)` | `{ lat, lng }` | 近似 WGS84 座標；超出程式設定的轉換區域則原值回傳 |
| `evaluateGeofence(position, geo)` | `latitude`、`longitude`、`accuracy`；景點中心、座標系、半徑 | `{ status, accuracy, distance, allowedDistance, centre }` |
| `formatDistance(distance)` | 米數 | 米或一位小數公里；非有限數值為「未知距離」 |

假設半徑 250 米、GPS 誤差 20 米，距離 260 米仍屬 verified，300 米則 too-far。如果誤差 250 米、距離 300 米，雖在容許範圍 500 米內，仍因誤差超過 200 米而為 inaccurate。這個規則是 App 接受定位的條件，不能解讀成裝置一定就在景點內。

經緯度不能轉為有限數字時，回傳 inaccurate，距離為 null。`startCheckIn()` 雖然是 async，GPS 成功／失敗仍由 callback 接收；它回傳的 Promise 不表示定位 callback 已完成。日後若要讓呼叫端等待整次打卡完成，需要把 callback 流程包成 Promise。

確認後打卡模組核對 token，建立以下資料並交給 commitCheckIn；控制器再核對路由及 token，由保存層 recordCheckIn 保存，然後重畫和顯示印章：

```javascript
{
  attractionId: "future-school",
  checkedInAt: "2026-11-05T04:00:00.000Z",
  method: "gps",       // 手動時為 "manual"
  verified: true      // 手動時必須 false
}
```

這是結構示例，不是某人的真實打卡。沒有保存 latitude、longitude 或原始 accuracy。它只是個人紀念，不是校方出席證明，也不能防止裝置擁有人改寫本機資料。

離開詳情會使頁面 token 過期；即使返回同一景點，舊 GPS 成功或錯誤回覆也不會打卡、開手動確認或顯示舊提示。這是忽略過期 callback，不代表瀏覽器提供取消 getCurrentPosition 的介面。

## 相機與相簿流程

`openCamera` 在正式 App 只有位於該景點詳情且已打卡才可開啟。它要求 `video.facingMode.ideal = "environment"`、`width.ideal = 1920`、`height.ideal = 1080` 並關閉音訊；ideal 是優先目標，不保證一定選中後鏡或取得這個尺寸。較低規格相機仍可使用。沒有 API 或權限失敗便改用相簿選擇器。

相機模組持有 `cameraStream`。當權限 Promise 回覆時，會核對請求代數、dialog 是否仍開着、景點與操作 token；使用者已離開便立即停止剛取得的 tracks，而不接到 video。

按快門後，`captureCameraFrame` 把 video 當前像素畫上隱藏 Canvas，產生暫存 JPEG Blob，顯示 Blob URL 預覽。重拍會移除這個暫存 Blob 與 URL，返回預覽；不會寫入 IndexedDB。Canvas 非同步回覆亦核對捕捉代數，避免取消後出現舊畫面。

選「使用照片」先取出待確認 Blob，再停止相機、關閉 dialog，將 Blob 交給 `processPhoto`。手機拍攝或相簿開啟時記住來源、景點、頁面及資料 token，兩個獨立 file input 的 change 先核對來源及請求才交給相同處理流程。cancel 清除對應請求，錯來源事件不消耗另一個入口的請求。換頁使請求失效，延遲回覆不能保存到新頁或返回後的舊景點。三個入口都有相同驗證和壓縮。取消、關閉、換路由、pagehide 與離開頁面都停止網頁串流；手機拍攝介面由作業系統管理。

## 相片驗證與儲存

`photos.js` 提供較低層的圖像與資料庫操作；`photo-actions.js` 負責「目前是否仍容許這個操作」及畫面提示。這樣相片格式處理不用知道按鈕，而非同步取消也不用塞進圖片解碼器。

| `photos.js` 介面 | 輸入 | Promise 完成結果 |
| --- | --- | --- |
| `validatePhotoInput(input)` | Blob／File | 檔頭判斷出的 MIME；不支援、太大或不一致時拋錯 |
| `compressPhoto(input, attractionId)` | Blob 及景點 ID | 重新編碼的 PhotoRecord；本身不保存 |
| `getAllPhotoRecords()` | 無 | 資料庫紀錄陣列 |
| `getPhotoRecord(id)` | 景點 ID | 一筆紀錄，未找到為 undefined |
| `savePhotoRecord(record, { canBegin } = {})` | PhotoRecord、可選的同步開始條件 | 成功為景點 ID；交易開始前取消為 null；失敗拋錯 |
| `deletePhotoRecord(id)` | 景點 ID | 刪除交易完成，無資料值 |
| `clearPhotoRecords()` | 無 | 清空 photos store 的交易完成；不刪整個資料庫 |
| `createTravelCard(options)` | 照片、景點、打卡、旅程標題 | PNG Blob；本身不下載 |

`compressPhoto(input, attractionId)` 的次序是：

1. 確認是非空 Blob、不超過 20 MiB；MIME 與首 512 bytes 的支援格式檔頭須一致。拒絕 SVG、未知格式與假冒資料，無 MIME 可用檔頭辨認。
2. 用 `createImageBitmap` 解碼及方向處理，不支援時改用 Image。HEIC／HEIF 是否真正可解碼仍取決於瀏覽器。
3. 計算 `scale = Math.min(1, 1600 / Math.max(width, height))`。例如 4000×3000 會變成 1600×1200，小圖不放大。
4. 在新 Canvas 重畫像素，再要求約 0.82 品質的 WebP。瀏覽器若實際回傳 PNG，保存真實 MIME；拒絕未知輸出。
5. 回傳 `PhotoRecord`，不是原檔。Canvas 重新編碼不帶原始 EXIF、相機型號與 GPS 中繼資料，但畫面中的人樣仍在。

20 MiB 是輸入檔案大小上限，不是解碼後的記憶體上限；尺寸檢查在解碼之後。檔頭一致也不保證完整檔案有效，仍須成功解碼。透明圖片會先在不透明 Canvas 鋪上米白背景，再畫像素。

`PhotoRecord` 包括 attractionId、blob、mime、width、height、createdAt、version。相片操作層另加 `writeId`，用於分辨自己寫入的版本。IndexedDB 的 object store 以 attractionId 作 key，`put` 會取代同景點記錄，所以每站只保存一張。

資料庫交易等到 `transaction.oncomplete` 才回報完成，而不是只看到單一 request 成功便視為全筆保存完成。讀取用 readonly、寫入及刪除用 readwrite，完成或失敗都關閉資料庫連線。

已儲存 Blob 以 `URL.createObjectURL` 供 img 顯示。`refreshPhotos` 更新保存層紀錄並釋放舊 URL；當前詳情重新 render 時才建立需要的 URL，頁面離開也會釋放。Blob URL 是目前頁面的本機引用，不是相片上傳網址。儲存空間不足或解碼失敗只影響相片，不取消已完成的打卡。

完整保存鏈是 `processPhoto → compressPhoto → 加 writeId → savePhotoRecord → refreshPhotos → render`。壓縮前後及開啟 IndexedDB 後、開始寫入交易前都核對當前頁、打卡及資料 token；條件不符便不寫入。交易已開始後不因單純換頁刪掉結果；成功後更新保存層和目前頁面，但不顯示舊頁成功提示。若寫入成功但讀回失敗，會明確提示已保存但未能讀回預覽。

## 非同步取消為何需要代數

壓縮、相機權限、資料庫寫入、GPS 和確認都不是立即完成。假設相片正在壓縮，使用者已取消打卡；若壓縮完成後無條件保存，就會恢復已刪照片。

`operations.js` 對整體資料和每個景點分別計數。`operationToken(id)` 記錄開始時的兩個代數，`isCurrentOperation(id, token)` 核對現在代數及重設鎖。取消某站令該站代數增加；清除所有資料令整體代數增加。這不是取消瀏覽器工作本身，而是拒絕其過期結果。

`trackPhotoTask` 把每個景點正在處理的 Promise 放入 Set。刪除前先使操作過期，再 `waitForPhotoTasks` 等它們完成或失敗，最後清理資料庫。已開始的寫入不能靠 token 撤銷，所以寫入後再核對；若過期，只刪除 writeId 仍等於自己的照片，避免誤刪別的較新版本。

下載確認及卡片生成後都核對每景點照片版本、資料 token 和頁面 token；照片已替換、移除或離頁便不下載。不能比較新生成的畫面快照引用，因為每次快照本來就是不同物件。

資料 token、照片版本及頁面 token 都只在本次 document 有效，不是跨分頁交易鎖。多分頁仍共享同一 origin 的儲存，不能聲稱另一分頁沒有正在改動資料。

例如開始壓縮時 token 是「整體 0、景點 0」，取消該站後景點代數變 1，舊工作便不能沿用 token 保存。控制器另有頁面代數，切換頁面／景點或 pagehide 便更新，同頁重畫不變。相機還有請求代數及快門代數，關閉 dialog 或重拍也需要拒絕舊結果。單純換頁不增加資料代數，所以已開始的寫入仍可完成；取消打卡或重設則仍會清理過期寫入。

`waitForPhotoTasks(id)` 使用 `Promise.allSettled` 等當下追蹤的相片工作，不會把某個失敗變成成功，也不等待所有種類的瀏覽器操作。旅程卡生成不在這個追蹤集合內，而是靠生成前後的 token 和照片版本核對阻止過期下載。

## 取消打卡與清除資料

取消打卡先確認連同照片刪除，再使該景點操作過期、等待照片工作、刪除照片，最後移除打卡及保存。照片刪除失敗會保留打卡並明確警告；不支援 IndexedDB 且本來沒有照片時仍可取消。

「清除所有本機資料」需要兩次獨立確認。通過後啟用重設鎖、使所有舊操作過期、停止相機、等待照片工作；先清 IndexedDB，成功後才移除 localStorage 並換成預設狀態。任何一個步驟失敗都顯示實際情況，不虛報全部成功。這是兩個儲存區之間的順序控制，不是跨儲存區原子交易。

| 結果 | 照片 | 清單、提醒、打卡 | 畫面處理 |
| --- | --- | --- | --- |
| 任一次確認取消 | 不清除 | 不清除 | 結束流程 |
| 相片資料庫清空失敗 | 不能確認全部已清除 | 不移除 localStorage | 解除重設鎖、重讀、警告 |
| 相片清空成功，localStorage 刪除失敗 | 已清空 | 原紀錄仍保留 | 解除重設鎖、重讀、說明部分完成 |
| 全部成功 | 清空 photos store | 移除指定鍵，記憶體改為預設 | 重畫目前頁面、顯示成功 |

這個按鈕只處理本 App 的旅程紀錄，不清除 Service Worker 靜態快取、整個 origin 的其他資料、裝置相簿或已下載旅程卡。成功後仍可以離線開網站。

`feedback.js` 的確認以 Promise 排隊，上一個 dialog 關閉後下一個才出現。每個要求各自取得回覆，不會讓一個「確認」同時批准多個動作。標題與訊息用 textContent 放入 DOM。

`askConfirmation(options)` 回傳 Promise<boolean>，只有確認才為 true；支援時用 dialog，否則用 window.confirm。離頁呼叫 cancelConfirmations()，關閉已顯示的 dialog，讓排隊舊要求失效，並移除舊提示和印章。原生 confirm 無法由 App 強制關閉，但回覆仍須通過 token 核對。`isRelevant` 可在輪到該要求時略過已過期的確認。`showToast(message, tone)` 顯示約 4.2 秒後淡出；`celebrateStamp(attraction)` 顯示短暫印章。提示不是永久保存的操作日誌。

## 旅程卡生成

`downloadTravelCard` 先讀目前照片、景點與打卡，取得 token，再顯示私隱確認。確認後重新核對資料 token、頁面 token 和照片版本，才交給 createTravelCard。卡片的 Canvas 固定 1080×1350；照片按比例中心裁切填滿相框，不拉伸，然後畫嶺南風格裝飾、景點、日期時間及核實標記。

日期用香港時區格式，不依裝置目前時區。輸出是 PNG Blob；核對操作和照片仍有效後，才建立暫時的 a download 連結供本機下載，約一秒後釋放 URL。程式觸發連結點擊就顯示「下載已開始」，沒有取得作業系統確認檔案已落盤的回覆。卡片不加學生姓名、班別或座標，但照片、景點與到訪時間仍可能透露身份。已下載、分享或備份的檔案不受 App 的清除功能控制。

## 離線與發布

Service Worker 只處理同源、應用範圍內的 GET。安裝會重新取得精確白名單內的靜態資產，包括全部執行模組、插畫及圖示。啟用新版本時移除本 App 舊版本快取，並接管頁面。

導航優先網絡，fetch 拋錯時回離線首頁；HTTP 404 仍是已收到回應，不會自動改成首頁。只用成功的應用 HTML 更新離線 index，不把 404 或別的文件當首頁。其他資產先快取再網絡，只允許精確白名單 URL，不緩存任意 GET 或帶 query 的內容。

照片與清單不放入 Service Worker 快取；它們由 IndexedDB 及 localStorage 自行保存。離線拍照、壓縮與卡片生成仍在本機執行，但第一次需要先在線完整載入；離線不是跨裝置備份，瀏覽器亦可能清理儲存。

新增執行模組必須同時加入 `APP_SHELL` 與 `build-pages.mjs` 白名單，並提高快取版本。目前版本為 v27，發布包包含 33 個檔案，另有根路徑離線預載項。說明、測試、伺服器、通告和個人資料不在網站發布包內；GitHub repository 若公開，其提交的源碼與文件仍可被查看。

`skipWaiting()` 和 `clients.claim()` 使新 worker 接管請求，但不會自動重新執行已開啟頁面的 JavaScript；更新後仍可能需要重新整理。頂部「已連線」只依 `navigator.onLine`，沒有測試遠端網站是否真的可達。

hash 路由與相對路徑支援 Pages 子目錄。Service Worker 註冊從 `controller.js` 用 `new URL("../sw.js", import.meta.url)` 解析，仍指向專案根目錄；若日後移動該模組，必須調整此路徑。

`buildPages(destination)` 回傳實際複製的相對路徑陣列。預設目錄是 `_site`；目錄已有任何檔案便拒絕建置，不會先刪舊檔。`public` 遞迴收集 PNG、WebP、SVG，拒絕符號連結及其他格式；執行用 JS 則逐一列出，不會自動發布整個 `src`。

GitHub workflow 使用 Node 22，先 `npm test` 再 `npm run build`。pull request 只做檢查，其他事件也只有預設分支才上傳 Pages 產物和部署。推送成功不等於網站已部署成功，仍須看 Actions 結果及 repository 的 Pages 設定。

## 安全防線與限制

HTML 的 meta CSP 拒絕內嵌程式、eval、資料 API 連線、表單網絡提交及外部資產，允許必要同源模組和本機 Blob；文字跳脫、URL 白名單及照片解碼仍須各自保留。文件 CSP 不等於限制 worker 自身所有網絡能力；worker 仍依精確靜態白名單運作。

沒有後端，所以 App 沒有集中存放全體學生照片或位置；但本機資料沒有由 App 額外加密，裝置及瀏覽器存取權仍很重要。同一 origin 的不同子目錄不構成不同安全租戶。移除 EXIF 不會移除照片像素中的人樣。

本機伺服器只監聽 127.0.0.1，設置安全標頭和路徑邊界；GitHub Pages 不執行這個伺服器，其標頭不會自動套用。相機、GPS 與 Service Worker 正式使用需要 HTTPS。

`server.mjs` 是開發工具，會按專案根目錄提供檔案，沒有登入或發布資產白名單。`build-pages.mjs` 的 33 檔白名單只限制建置產物，沒有反過來限制本機伺服器。部署時使用 `_site`，不要直接把整份 repository 當作公開靜態目錄。

## 如何修改功能

改景點文字、行程或清單：先找 `data.js`，保留可靠來源，不重新加入已移除的費用、名額、班別或教職員姓名。若新增景點，需要補地理設定、圖片、資料完整度測試及離線／建置白名單。

改頁面內容：找 `views.js` 對應 render 函數，外觀則改 `styles.css`。動態文字繼續使用 escapeHtml；不要把 inline script、事件屬性或 inline style 加入模板。

改打卡範圍：半徑在 `data.js`，判定規則在 `geo.js`，權限與確認流程在 `check-in.js`。三者分開，不需要去相機模組找 GPS 邏輯。新增邊界及明確太遠測試。

改拍攝操作：找 `camera.js`；改檔案驗證、尺寸或卡片構圖：找 `photos.js`；改刪相與下載條件：找 `photo-actions.js`。任何 await 前後可能被取消的操作都要考慮 token，而不只是成功路徑。

新增按鈕功能：畫面放 data 屬性，控制器事件委派核對頁面及景點權限，再呼叫對應模組；需要新畫面資料時修改 page-models 的專用快照，不回傳整份 state。功能模組以明確依賴建立，不反向 import 控制器，不把全部邏輯搬回入口。

### 例一：改準備清單文字

在 `src/data.js` 找 `id: "camera"` 的項目，只改 label：

```javascript
{ id: "camera", group: "學習任務", label: "準備拍攝裝置、充電器及足夠儲存空間" }
```

這是修改示例，未套用到活動內容。保留 ID，原有勾選可繼續對上同一項；若改 ID，正規化會把它當成新項目，原勾選不會自動轉移。不要只改某段生成後的 HTML，重新 render 時仍會回到資料檔的文字。

### 例二：移動清除資料入口

在目標 render 函數加入以下 HTML，並從原頁 render 移除原入口：

```html
<button class="button button-danger" data-reset-all>清除所有本機資料</button>
```

控制器已監聽 `data-reset-all`，不需要另寫第二份刪除流程。但目前只允許首頁執行重設：日後若搬到另一頁，必須同步修改控制器的頁面權限及測試，不能只搬 HTML。保存位置及兩次確認不需改動。這次已搬到 `renderHome(model)`；回歸測試會檢查首頁有入口、準備頁沒有入口。

### 例三：新增或刪除頁面

頁面牽涉 `index.html` 的導航、`controller.js` 的路由白名單、render 分派及操作權限、`page-models.js` 的快照欄位、`views.js` 的畫面函數，以及相關資料與 CSS。刪除畫面而留下導航會產生失效入口；只隱藏按鈕則舊函數及資料仍在原始碼。

再核對測試和說明中的舊頁引用。若新增獨立執行模組，補上離線及建置白名單；若修改已快取的 HTML、JS 或 CSS，提高 `sw.js` 版本。只改 README 或本說明不用提高快取版本，因為兩者不在發布包及離線清單。

## 測試與閱讀次序

本機 `npm test` 使用 Node 內建 test，不需要安裝依賴。測試直接 import 真正模組；`tests/helpers/browser-environment.js` 提供假 DOM、相機、位置、儲存及點擊事件，`modules.test.mjs` 驗證接線和延遲取消。Service Worker 因為是獨立 worker 腳本，用 VM 模擬其事件環境；不是把應用的 import 刪掉來測。

在專案根目錄執行，Windows PowerShell 如限制 `npm.ps1` 可用 `npm.cmd`：

```powershell
npm.cmd start
# 瀏覽器開 http://localhost:4173；此指令持續運行，Ctrl+C 停止
```

另開一個終端機做檢查：

```powershell
npm.cmd test
node --test tests/regressions.test.mjs
node --check src/controller.js
npm.cmd run build
```

`node --check` 只驗證語法；測試通過也不代表手機權限、實際 GPS 或 HEIF 解碼已驗證。建置若因 `_site` 非空失敗，先查看並移走舊產物，不要把發布腳本改成直接覆蓋未知檔案。

| 測試檔 | 驗證重點 |
| --- | --- |
| `app.test.mjs` | 靜態資料、距離／座標、範圍判定、state 正規化與進度 |
| `modules.test.mjs` | token、延遲相機權限、一次定位、取消與相片寫入、清除失敗 |
| `isolation.test.mjs` | 頁面快照、錯頁／舊控制項、離頁 GPS／相簿／確認／下載、交易開始前後、重設鎖及部分清除 |
| `regressions.test.mjs` | 已移除內容、未知路由、首頁清除入口、文字跳脫、下載確認、焦點及離線首頁 |
| `security.test.mjs` | CSP、MIME／檔頭、重新編碼與輸出格式、精確快取白名單 |
| `pages.test.mjs` | 發布檔案及拒絕舊產物、Pages 子目錄相容 |

截至本次文件更新，現有 Node 測試共 102 項；這是當前版本的數量，新增或刪除測試後以實際執行結果為準。`camera-resolution.test.mjs` 有四項，涵蓋高清要求、直向影格及低解像診斷；`native-camera.test.mjs` 新增 11 項，涵蓋兩頁手機拍攝、原照保留、來源區分、操作權限、取消及離頁回覆；`camera-orientation.test.mjs` 有三項，涵蓋兩頁轉向及瀏覽器驗證 HTML 與正式頁一致。

用 `node server.mjs 4174` 啟動另一個本機 origin，再開 `http://127.0.0.1:4174/tests/browser/security.html`，可驗證真正 Canvas、Blob 預覽、IndexedDB、CSP、旅程卡和模組載入。測試產生色塊，不讀個人照片，測試頁不會發布到 Pages。實際手機相機、GPS、HEIF 支援及權限互動仍需真機驗收。

## 常見問題從哪裡查

| 現象 | 先核對 | 判斷方式 |
| --- | --- | --- |
| 修改後仍看到舊畫面 | `sw.js` 版本、頁面是否重載 | worker 接管不會重跑既有 JS；確認來源和快取版本 |
| `#info` 顯示首頁 | `currentRoute()` | 須知頁已刪除，這是目前的未知路由處理 |
| 勾選後重開消失 | `persist()` 提示、localStorage | 畫面先變更，保存可能失敗；也要核對網址 origin |
| 已打卡卻沒有照片 | `photoPanel()`、`refreshPhotos()`、IndexedDB | 打卡與相片分開保存；缺預覽不等於刪除成功 |
| 相機改成相簿 | `openCamera()`、權限、HTTPS | 相機不支援或開啟失敗時的既有後備流程 |
| HEIC 被辨識但不能加入 | 解碼器支援 | 檔頭合法不代表瀏覽器會解碼，改用 JPEG／PNG／WebP |
| 遠處不能手動打卡 | `evaluateGeofence()` | 有效定位且明確超出半徑加誤差時，故意拒絕手動繞過 |
| 清除後旅程卡檔案仍在 | 下載資料夾 | 已下載檔案不在 App 儲存區，須在裝置自行管理 |
| 本機有照片，Pages 沒有 | 網址的協定、主機、連接埠 | 不同 origin 不會共用紀錄，也沒有雲端同步 |
| push 成功但網站未更新 | GitHub Actions 及 Pages 設定 | push、測試、建置、部署是不同階段 |

新增 tests/browser/isolation.html 及 isolation.js，在空白的獨立測試 origin 驗證真實 DOM、localStorage、手動確認、Canvas、IndexedDB、Blob 預覽、離頁取消、已開始的交易、旅程卡 PNG 和新版離線快取。開頭若發現原有旅程紀錄便停止，不清除它們；只在原本空白的測試 origin 生成及清理色塊紀錄。下載測試攔截生成連結的點擊並驗證 PNG，不聲稱驗證了作業系統落盤。

2026-10-06 頁面分工版本的 Node 51 項、隔離瀏覽器 8 項及既有瀏覽器 11 項全通過，當時建置包含 27 個檔案。另以獨立測試伺服器停止後重載，確認離線首頁、準備及景點頁可用。真機 GPS、相機權限及 HEIF 支援未由這次測試驗證。

建議閱讀次序：先看短入口及控制器的接線，再看保存層、頁面模型及一個畫面函數；接着讀一次完整打卡流程，然後看相機到相片服務的交接，最後讀 token 與清除流程。每次先回答「輸入是甚麼、何時完成、資料寫去哪裡、失敗時保留甚麼」，再看語法，會更容易掌握整體運作。

## 19. 東院道實機測試頁（2026-10-06）

此頁網址為 `device-test.html`。本機啟動後可開 `http://localhost:4173/device-test.html`，不把它加入五個正式景點，也不新增首頁卡片。它是用真實裝置測試的手動頁面；自動測試使用另外的合成資料頁。

測試位置是香港銅鑼灣東院道 11 號。政府地址搜尋服務於 2026-10-06 返回 WGS84 緯度 22.27579、經度 114.19044；中學及小學同一地址返回相同座標。來源：[ALS 地址紀錄](https://www.als.gov.hk/lookup?q=11%20Eastern%20Hospital%20Road&n=10)，[WGS84 欄位定義](https://www.als.gov.hk/docs/Data_Dictionary_for_ALS_EN.pdf)。使用者 Google Maps 搜尋網址中的 @22.2798431,114.176307 是地圖視角中心，不直接作為地址座標。

基本半徑 100 米是本頁設定的測試門檻，不是地址來源規定。GPS 仍共用 `evaluateGeofence`：誤差不超過 200 米、距離不超過「100 米 + 定位誤差」才核實；明確太遠拒絕，定位誤差過大或權限拒絕只可另作未核實手動記錄。畫面顯示距離與誤差，原始裝置座標不保存。

### 模組與保存

| 模組 | 責任 |
| --- | --- |
| `device-lab.js` | 先更新離線 shell，再動態載入控制器，避免舊快取缺少新介面；不要求裝置權限 |
| `device-test-data.js` | 測試位置、來源及獨立儲存名稱 |
| `device-test-store.js` | 只讀寫 `outdoorLearningDay.deviceTest.v1`，正規化及凍結打卡紀錄 |
| `device-test-controller.js` | 真實功能接線、GPS／相片各自 token、當頁生命週期、兩次確認重設 |
| `device-test-views.js` | 只讀不可修改快照；不接收 Blob 或操作儲存 |

`check-in.js` 和 `camera.js` 增加可選的 `lookupAttraction` 與診斷 callback，預設仍使用正式景點。GPS callback 只回傳距離、精確度或錯誤原因，相機 callback 只回傳開啟結果，不把位置或串流傳入畫面。

`photos.js` 的 `createPhotoRepository({ databaseName })` 令每個 repository 固定自己的資料庫名稱。原有 exports 使用 `outdoorLearningDay.photos`、版本 1、`photos` store；測試頁使用 `outdoorLearningDay.deviceTest.photos`，格式相同。`compressPhoto` 仍是正式功能的同一實作。測試相機毋須先打卡，不會因此建立假打卡；相片保存與定位操作使用不同失效 token。

重設只清除測試資料，等待相片工作，須兩次確認。正式 App 的清除功能不會清除這裡的測試資料；清除測試相片失敗時保留測試打卡，清除進度失敗時回報部分完成。這仍不是安全隔離或加密：兩個頁面共用網站 origin，其他同源程式可存取相同瀏覽器儲存。

離頁使 GPS、相簿與壓縮回覆失效，停止相機、釋放預覽、關閉確認。相片寫入前再核對 token；已開始的交易在單純離頁後保留相片，重設則等待並清理過期工作。返回 BFCache 時重新讀取照片。畫面中的 GPS／相機診斷只存在當頁，不保存原始座標。

### 手機現場操作

1. 手機用 Safari 或 Chrome 開啟部署後的 HTTPS `device-test.html`。手機上的 localhost 指手機本身，不能當成電腦的本機網址；一般 HTTP 區域網絡 IP 亦不能可靠使用相機及 GPS。新增頁面未推送時，GitHub Pages 不會有這個更新。
2. 到東院道 11 號附近，按「測試 GPS 打卡」，允許位置權限。查看距離、誤差與「GPS 已核實」；在其他地方或室內不保證成功。手動記錄只測試替代流程，不能證明 GPS 成功。
3. 按「測試相機」，允許相機，拍照、重拍、使用照片。相片保存後顯示讀回的預覽、尺寸及格式。從相簿保存成功不等於即時相機成功。
4. 重新載入測試頁，確認測試打卡及相片仍存在；關閉相機／返回首頁，確認系統相機使用指示停止。
5. 按「清除測試打卡與相片」，確認兩次；回正式 App 檢查景點及準備清單不受影響。

發布及離線白名單包含此 HTML 與五個 JS 模組，共 33 個網站資產，目前快取版本 v27。Service Worker 離線導覽測試頁時取回自己的 HTML；它不覆蓋正式離線首頁。`tests/` 自動驗證頁仍不在發布包內。

### 驗證結果與界線

`tests/device-test.test.mjs` 有 15 個案例，加上返回鍵回歸案例後全部 Node 共 84 項。裝置頁案例涵蓋 WGS84／錯誤地圖中心、獨立儲存、範圍外／誤差／權限、相機獨立啟動、離頁與過期回覆、相片交易開始前後、清除等待及失敗、離線文件邊界。

`tests/browser/device-lab.integration.html` 與 `device-lab.integration.js` 提供 16 項瀏覽器驗證，須以空白獨立 origin（例如 `node server.mjs 4177`）執行。GPS、相機串流及手機拍攝回覆是模擬／Canvas 生成，DOM、影像重繪、IndexedDB、對話框及離線快取使用真正瀏覽器。若已有正式或測試紀錄便停止；只清理它自己生成的正式命名空間哨兵。

2026-10-06 返回鍵版本已執行裝置頁整合 13 項、資料隔離 8 項及既有瀏覽器 11 項，全部通過；另驗證原生 Esc 關閉、上一頁／前進，以及停止測試伺服器後的離線文件重載與返回。真機 GPS／相機、Android 返回鍵／手勢、相機指示燈及 HEIF 支援仍待實測。桌面原生關閉請求不能代替 Android 真機結果。

## 20. Android 返回鍵（2026-10-06）

### 使用者會看到甚麼

| 當前狀態 | 按返回鍵的預期行為 |
| --- | --- |
| 相機拍攝視窗開啟 | 先關閉相機，留在原頁；未保存照片丟棄，原有照片保留 |
| 刪相、手動打卡、下載或清除確認開啟 | 視為取消，留在原頁，不執行確認中的操作 |
| 沒有視窗 | 返回瀏覽紀錄中的上一頁 |
| 直接開啟測試頁，沒有 App 前一頁 | 依瀏覽器原本行為返回或離開，不自行插入首頁 |

### 原生事件與程式分工

`index.html` 與 `device-test.html` 的兩個 modal dialog 明確設定 `closedby="closerequest"`，仍使用 `showModal()` 開啟。支援的瀏覽器會先向目前視窗送出 `cancel`，再按預設動作關閉並送出 `close`；頁面網址及瀏覽歷史不需要改動。Chrome 已把 Android 返回手勢納入原生關閉請求，參考 [Chrome 126 官方說明](https://developer.chrome.com/blog/new-in-chrome-126)。不另建立 `CloseWatcher`，避免與 dialog 自己的 watcher 重複處理一次返回。

`camera.js` 在工廠建立時安裝一次 `cancel` 監聽，立即呼叫 `stopCamera()`：停止所有 tracks、清空 video 的串流、增加權限及拍攝代數、清除尚未保存的 Blob、釋放其預覽網址。處理器不呼叫 `preventDefault()`，由瀏覽器完成關閉；控制器原有 `close` 清理仍保留，但只在 dialog 當下仍關閉時執行。原生 close 事件是排隊送達的；若視窗已重新開啟，便忽略舊 close，避免停止新串流。重複清理不會重新保存或刪除原照。晚到的 `getUserMedia` 成功回覆立即停止所得串流，晚到的失敗回覆不再改開相簿，Canvas 回覆亦不能重建拍攝預覽。

`feedback.js` 的 `cancel` 監聽增加確認代數並把 `returnValue` 設為 `cancel`。目前顯示的確認仍由一次性的 `close` 監聽回傳 false；已在排隊的確認因代數不符也回傳 false，不會接着彈出。之後新按鈕建立的新確認使用新代數，可以正常確認。系統取消不觸發離頁，也不把清單或打卡當成已刪除。

`controller.js` 的原有 `hashchange` 處理仍負責主 App 的上一頁及前進；跨 HTML 文件由瀏覽器導航，`pagehide` 會執行離頁清理。測試頁在返回／前進的 `pageshow` 重新讀回照片。沒有加入 `pushState()`、`replaceState()`、`popstate` 攔截或首頁保護迴圈；不修改公開函數介面、資料鍵、資料庫格式或路由。

相片處理的既有規則保留：離頁前未開始的寫入不開始，已開始交易允許完成；明確取消打卡、刪相或清除資料才使資料失效並等待相片工作。返回取消清除的第一或第二次確認，均不啟動重設。

### 如何驗收與相容界線

新增 `tests/back-navigation.test.mjs` 共 18 項回歸案例。共用假 DOM 增加 `requestClose()`，模擬先 cancel 後預設 close；`close()` 不傳值時保留 returnValue，以配合真實 dialog。測試透過儲存初始紀錄及模擬服務建立資料，不改頁面快照。

裝置頁瀏覽器整合增加原生取消手動打卡、丟棄拍攝預覽、延遲相機權限、兩階段重設取消及排隊刪相取消。測試 Canvas 定時產生影格，避免重開 video 時只依賴已錯過的初始影格。使用真實 `requestClose()`、DOM、Canvas、IndexedDB 與 v24 快取；相機影像是合成串流，不要求真實權限。84 項 Node 測試及 32 項瀏覽器整合均通過，發布白名單仍是 33 個網站資產。測試頁不發布，沒有新增執行模組。

桌面瀏覽器另實際操作了首頁→景點列表→詳情的返回及前進、主 App／測試頁的 Esc 取消、首頁與測試頁的跨文件返回。停止獨立本機伺服器後，測試頁可重載，主 App 的景點及詳情仍可返回和前進，兩個文件亦能互相返回。這驗證了資產無法從該伺服器取得時的離線後備；「已連線」仍只看 navigator.onLine，不代表測試伺服器可達。

真機驗收須用支援原生關閉請求的 Android Chrome：在即時預覽、已拍未保存、等待權限及每個確認階段按系統返回鍵／手勢，確認先關閉視窗、未保存照片消失、原照保留及相機指示燈停止；再按返回才離頁。系統權限面板及相簿由 Android／瀏覽器管理，網頁不能接管其按鍵。其他瀏覽器版本保留關閉按鈕及離頁清理，不保證原生返回次序相同。

本次同步 README、詳細說明及交付 ZIP，快取從 v23 升到 v24。本機提交不會更新線上網站；須另行推送及部署，公開 GitHub Pages 才會取得新處理。

## 21. 相機解像度修正（2026-10-06）

### 原因與修改

使用者提供的測試頁截圖顯示，從資料庫讀回的相片是 480×640 WebP。原本相機只要求後置鏡頭，沒有提出尺寸目標；保存流程不放大小圖，因此低解像影格會保留原尺寸。增加 CSS 顯示大小不能補回照片細節。

共用 `camera.js` 改為優先要求 1920×1080，不設 exact 或 min。依 [W3C 相機規格](https://w3c.github.io/mediacapture-main/#dom-mediadevices-getusermedia)，ideal 是偏好，裝置可以提供其他尺寸。兩個頁面共用這個設定；直向尺寸可能是 1080×1920，不能把要求值當成實際取得值。相機就緒 callback 回傳 video 的 width、height，測試頁只顯示這些數字，不取得串流或 Blob。最長邊不足 1280 時提示可先用手機相機拍攝，再從相簿保存；這是提示門檻，不是保證高於門檻就清晰。

快門仍讀取當時的 `videoWidth`／`videoHeight`，使用相同比例及實際像素建立暫存 JPEG。原有 `compressPhoto` 不變：最長邊 1600、目標約 82% WebP、不放大小圖、不保存原始 EXIF。1080×1920 會保存為 900×1600；1920×1080 為 1600×900；480×640 仍是 480×640。舊照片不會自動變清晰，需重拍或從相簿換相。儲存名稱、格式、每站一張、資料隔離及返回取消流程不變。

### 驗證與交付

新增四項 Node 回歸測試，修正前有三項失敗，修正後全部 88 項通過。裝置頁 14 項瀏覽器測試使用真實 Canvas、Blob、解碼與 IndexedDB，以 1080×1920 合成串流拍攝及重拍，保存後再解碼確認檔案確為 900×1600；也驗證低解像串流仍可開啟，並保留既有高清相片。資料隔離 8 項及既有 Canvas／儲存／旅程卡 11 項均通過，共 33 項瀏覽器整合。發布白名單仍是 33 個網站資產，快取升至 v25。

合成串流驗證保存尺寸，不能證明某部手機會提供高清相機串流。部署新版後，手機須關閉並重開頁面，再拍一張新照片，核對相機實際尺寸與資料庫讀回尺寸；實際清晰度亦受鏡頭、對焦及光線影響。本機修改不會更新正式網站，須另行推送及部署。

## 22. 手機原生拍攝入口與完整預覽（2026-10-06）

### 比例與系統拍攝

使用者後續截圖顯示網頁相機 1080×1920、保存 900×1600，兩者都是 9:16，沒有因保存而拉伸。原有網頁預覽用 `object-fit: cover` 把直向影像裁切至 4:3 框，容易令預覽與保存結果不一致；改為 contain，正式照片預覽亦顯示完整影像。照片像素保持原比例，旅程卡保留既有相框構圖。

正式詳情及測試頁主要按鈕改為「用手機相機拍攝」，另保留網頁相機及相簿。新增獨立 `<input id="native-camera-input" type="file" accept="image/*" capture="environment" hidden>`，由同步的使用者點擊開啟。依 [W3C HTML Media Capture](https://www.w3.org/TR/html-media-capture/)，這是要求系統提供拍攝控制，不提供網頁對系統相機的詳細設定控制。手機可能開相機或先提供選擇器，桌面可能只選檔案；不能保證完整的獨立相機 App 或每個比例選項。要用 4:3，可在系統相機有此選項時選擇，亦可先用手機相機拍好再從相簿加入。

### 接線及資料生命週期

`camera.js.openNativeCamera(id)` 核對當頁及拍攝資格，透過 `beginPhotoSelection(id, "native")` 記住請求，停止可能仍在等待的網頁相機、關閉其 dialog，再同步 click 原生輸入。這個入口不呼叫 getUserMedia。相簿用獨立 `photo-input`，不帶 capture；`beginPhotoSelection` 回傳 false 時不開選擇器。

兩個控制器私有 `photoSelection` 增加 source，只容許 native 或 gallery。每個 input 的 change／cancel 僅處理自己的請求，舊相簿事件不能消耗正在等候的手機回覆。取消清除請求及輸入值；離頁、重設與刪相沿用既有代數及工作等待。真正回傳 File 後再次核對路由、景點 ID 及資料 token，交給原有 processPhoto。正式頁仍須當站打卡；裝置頁仍可獨立拍攝且不建立假打卡。

照片仍在本機檢查 20 MiB、MIME／檔頭、真正解碼並 Canvas 重編碼，不保存原檔或 EXIF，不上傳。`image/*` 是選擇器提示，不放寬檔案驗證；SVG 或不支援格式仍拒絕。2000×1500 回覆保存為 1600×1200；9:16 輸入保持 9:16。儲存名稱及格式不變。系統相機介面、返回及是否有相簿副本由手機控制，App 清除只處理自己保存的資料。

### 本次驗證

新增 11 項 Node 回歸測試，全部 99 項通過。裝置頁 16 項、正式頁隔離 9 項、既有照片與旅程卡 11 項瀏覽器整合全部通過，共 36 項。以生成的 4:3 File 回覆驗證保存及解碼尺寸為 1600×1200、取消保留原照、完整預覽與既有返回取消。桌面另實際點擊主要入口，透過真正檔案選擇器選入專案公開插畫，保存後讀回 1200×800；停止該測試伺服器後，v26 離線頁面仍重載並讀回相片。

自動測試不會啟動手機作業系統相機。原生手機介面、比例設定、拍攝確認、返回取消、方向、HEIF 支援及系統相簿副本仍須真機驗收。未新增執行模組，發布白名單仍為 33 個網站資產，快取升至 v26。README、程式導讀及交付 ZIP 同步更新；本機修改須另行提交、推送及部署才會在線上生效。

## 23. 網頁相機框隨螢幕轉向（2026-10-06）

### 截圖反映的問題與修正

使用者新截圖中的視窗是網頁相機 dialog。原生手機相機的版面由系統管理，網站不能直接改它的相機框。原網頁框固定為 4:3，標題、影像、說明及按鈕上下排列；橫向螢幕很矮時，影像佔去過多高度，拍攝按鈕需要捲動才能找到。這是顯示版面的問題，不代表照片像素被拉伸。

共用 `styles.css` 把相機視窗限制在可見高度內，使用 `100dvh`，另保留 `100vh` 後備。Grid 固定保留標題、關閉、說明及操作所需位置，預覽只佔餘下空間；影像絕對定位在框內，避免它的原始尺寸把 grid 撐大。直向相機框以 3:4 作版面偏好，受可用寬高限制；照片仍按自己的比例完整顯示。橫向且可見高度不超過 600px 時，預覽放左方，拍攝／重拍／使用照片放右方，說明放右下方。平板與桌面亦按可用畫面適應。

方向使用 CSS 的 viewport orientation，不要求感應器權限，不新增裝置角度紀錄或螢幕鎖定。依 [W3C Media Queries](https://www.w3.org/TR/mediaqueries-4/#orientation)，這個方向指可用畫面的寬高關係；手機須開啟自動旋轉，網頁不會強制解除系統方向鎖。瀏覽器網址列顯示／收起造成的高度變更由動態 viewport 單位處理，詳見 [W3C CSS Values](https://www.w3.org/TR/css-values-4/#viewport-relative-lengths)。

### 影像及照片方向

video 與已拍預覽繼續使用 `object-fit: contain`，保留完整影像。相機提供的比例與框不相同時會留空邊；不以拉伸或裁切去填滿。`camera.js` 在建立時安裝一次 video `resize` 監聽，串流、頁面、景點及資料 token 仍有效時更新測試頁的實際尺寸，關閉後的 resize 不回報舊頁成功。初次開啟也使用同一個尺寸回報函數。

CSS 只調整框，不旋轉 Canvas 像素。快門仍直接使用當時的 `videoWidth`／`videoHeight`。照片拍好後，即使轉向，暫存 Canvas 及 Blob 保持拍攝時的尺寸；重拍清除暫存後才使用新影格。取消、返回、離頁、停止 tracks 及保存流程保持原有規則，儲存名稱和格式不變，沒有新增上傳。

### 驗證與交付

新增三項 Node 測試，全部 102 項通過。兩頁各驗證直向轉橫向、已拍照片不改尺寸、重拍使用新尺寸及關閉後忽略 resize；另一項逐字核對瀏覽器 fixture 的兩頁相機 HTML 與正式 HTML，避免測試控制項偏離實作。

`tests/browser/camera-orientation.html?page=app` 或 `?page=device` 使用正式視窗模板、共用相機模組及 Canvas 合成串流。已在兩種模板的 390×844、844×390、320×568、568×320、740×280、768×1024、1366×768 驗證即時與已拍狀態：框方向正確，標題、關閉及操作按鈕均可見，視窗不需捲動，完整預覽比例保持正確。橫向拍好後轉直向保存為 1600×900，直向拍好後轉橫向保存為 900×1600；這兩次在記憶體驗證壓縮，沒有寫入個人資料。

原有裝置頁 16 項、正式資料隔離 9 項及照片／CSP 11 項瀏覽器整合全部通過，涵蓋真實 Canvas、IndexedDB、原生取消及 v27 快取。旅程卡 PNG 的 1080×1350 生成與下載連結觸發通過；本次瀏覽器工具兩次未收到下載事件，未確認另一次手動點擊是否落到磁碟，不把它說成成功下載。停止本機測試伺服器後，正式 device-test.html 仍從 v27 快取重載並載入新版相機 grid 樣式；已載入的轉向 fixture 在伺服器停止後仍通過直向即時、橫向已拍及關閉驗證。

這些尺寸與串流是桌面瀏覽器模擬，沒有按過 Android 真機返回鍵或實際旋轉鏡頭。手機橫直轉向、網址列縮放、系統方向鎖、原生相機、GPS、指示燈及相機回傳尺寸仍需真機驗證。未新增執行模組，網站白名單仍為 33 個資產；快取升至 v27，README、導讀及交付 ZIP 同步。本次本機修改尚須提交、推送及部署才會在線上生效。
