# 旅程助手推送後台

這是獨立於 GitHub Pages 的真正 Web Push 後台。學生自願啟用通知，老師在後台輸入公告並確認發送。手機關閉網站後，瀏覽器的推送服務仍可喚醒 Service Worker 展示通知。普通 Safari 分頁不能當作 iPhone 推送測試：iPhone 需要 iOS/iPadOS 16.4 或以上、先加入主畫面再從 App 圖示開啟。

正式後台已部署至 `https://bwflc-school-tour-push.bwflc-school-tour-lok274.workers.dev/`，[老師管理頁](https://bwflc-school-tour-push.bwflc-school-tour-lok274.workers.dev/admin)需持有管理密鑰。前台設定使用該後台的精確 HTTPS origin。2026-10-07 使用者已確認 Android 手機收到自己的測試通知；手機型號及版本沒有提供，iPhone 尚未實測。原有 Pages 網址及本機相片儲存不需要搬遷。

老師管理密鑰是網站目錄外 `work/bwflc-push-private-production/production-secrets.json` 的 `ADMIN_TOKEN`，由操作者自行在本機查看；不要貼到聊天、網址、公告或 GitHub。該檔亦包含 VAPID 私鑰，須私下保存，避免覆蓋原有密鑰。

本次發布另備網站目錄外的 `work/bwflc-push-private-production/teacher-login.txt`，只包含老師管理密鑰，可複製內容至管理頁「憑證」欄，不需複製整份秘密 JSON。這個私人檔案不在 Git 或網站發布包內。

## 本機驗證

需要 Node 22 或以上。在專案根目錄執行：

```powershell
npm ci --prefix push-backend --ignore-scripts
npm --prefix push-backend test
npm --prefix push-backend run check
```

測試會用動態產生的本機測試憑證，獨立解密實際 `aes128gcm` 內容和核對 VAPID 簽署，並在真正 Workerd + SQLite 上檢查發送工作、重啟及取消競態。所有供應商網絡請求都被截取，沒有真正通知收件者。另一項測試啟動 loopback Wrangler，檢查真實 ASSETS 的 `/admin`、JS、CSS 和單次 `/admin/` 轉址。

`check` 呼叫 Wrangler 的 `deploy --dry-run`，驗證正式 bundle、Durable Object/migration 及資產設定，然後刪除網站以外的臨時 bundle。它不部署、不使用 API 憑證或正式密鑰。Windows 沙盒如禁止 loopback 或工具設定目錄，須以允許本機測試的執行環境重試；不能把這類測試略過而報成功。`--ignore-scripts` 已在本機驗證可使用 workerd/esbuild。

若要手動預覽後台，在 `push-backend` 執行：

```powershell
npm run setup:local -- ../../bwflc-push-private http://localhost:4193/
npm run dev -- --env-file ../../bwflc-push-private/local-secrets.env --port 8787
```

`setup:local` 預設寫至網站外的 `work/bwflc-push-private/local-secrets.env`，拒絕網站內路徑、符號連結及覆蓋已有密鑰。上述 `../../bwflc-push-private` 是相對於 `push-backend`；亦可省略輸出參數使用安全預設，或使用明確的網站外絕對路徑。App URL 要配合實際 loopback 前端；只有 `ENVIRONMENT=local` 接受精確 loopback HTTP。管理頁為 `http://localhost:8787/admin`。管理憑證只從私人檔案自行查看，不放在網址或聊天室。

## 正式服務設定與發布

以下是正式設定與發布流程；須獲明確發布授權才部署後台及前台，並在真機驗證後才確認手機推送可用。本機密鑰生成及登入成功均不代表服務已上線。

1. 建立 Cloudflare 帳戶，確認可使用 Worker、SQLite Durable Object 和所需額度。在 `push-backend` 執行 `npx wrangler login`。
2. 在 `push-backend` 執行 `npm run setup:production`。它在網站以外的 `work/bwflc-push-private-production/production-secrets.json` 產生一次 VAPID 公私鑰及 32-byte 管理秘密，拒絕覆蓋，亦不印出值。此檔不是公開網站資產，須私下保管；Windows 權限沿用目前使用者的目錄權限，沒有由 App 額外加密。
3. 在 `push-backend` 執行 `npx wrangler secret bulk ../../bwflc-push-private-production/production-secrets.json`，把三個秘密設至 Cloudflare。若有變更實際位置，使用該私人檔案的正確絕對路徑。`APP_ORIGIN`、`APP_URL` 和 VAPID 聯絡 URI 在 `wrangler.jsonc`；正式版本只接受 HTTPS App scope，不使用本機 `ENVIRONMENT=local`。
4. 測試及 `npm run check` 通過後，依明確發布授權執行 `npm run deploy`，記下實際 Worker HTTPS 根網址。管理頁為該網址的 `/admin`；只有老師持有的管理秘密才能發送公告。
5. 回到專案根目錄，執行 `node scripts/configure-push.mjs https://實際後台hostname/`。此工具同步更新公開後台網址與精確 CSP；只有 VAPID 公鑰可公開，私鑰和管理秘密不能放入 `src/push-config.js`。更新離線快取、通過主網站測試及建置後，再按授權部署 Pages。若要停用前端連線，使用該工具傳入空字串。
6. 在 iPhone 主畫面 PWA、Android Chrome／已安裝 PWA 實測訂閱、關閉 App、老師發送、鎖屏接收、點擊返回正確頁面及關閉通知。供應商接受請求不代表手機已收到；網絡、通知權限或系統設定會影響接收。

不要每次部署重新生成 VAPID。換 VAPID key 會令舊訂閱不相容，使用者須重新開啟 App 並重建訂閱；不能假裝舊訂閱可繼續使用。只輪替管理秘密不會改變 VAPID，但原有臨時限流識別會在期限後清理。`assets.html_handling` 固定 `none`，Worker 自行把 `/admin` 對應到 `admin.html`，避免 `.html` 正規化造成轉址循環。

老師憑證可另用 [90 天自動更換與私人領取頁](admin-rotation/README.md)。它是獨立服務，正式部署設定已啟用；新環境須先停用排程並完成 Cloudflare Access 及 API 權限設定。普通 Pages 網站部署不會部署此服務，也不會更換 VAPID。

## API 合約

所有 timestamp 是 UTC epoch 毫秒整數。所有錯誤是 `{error:{code,message}}`；不包含供應商原始回應、秘密或訂閱 endpoint。

| 方法與路徑 | 要求／回應 |
| --- | --- |
| `GET /v1/config` | `{enabled,publicKey,keyId,appUrl,registrationProofRequired:true}`；未完整設定時 `enabled:false`。`keyId` 是公鑰字串 SHA-256 的 64 位 hex。 |
| `POST /v1/subscriptions` | `{subscription,managementToken,registrationProof?}`。新裝置先回 `202 {id,keyId,registered:false,verificationRequired:true}`，不佔訂閱名額；只有加密推送包含短期證明，裝置保存後以同一資料及證明再 POST，才回 `201 {id,keyId,registered:true,expiresAt}`。已確認且金鑰不變的現存擁有人可直接續期。 |
| `DELETE /v1/subscriptions/:id` | `Authorization: Bearer managementToken`；可加 JSON `{registrationProof}`，回 `204`。現存訂閱按擁有人憑證刪除；未知 ID 無有效接收證明時不建立紀錄。確認前取消須攜帶已保存的證明，阻擋晚到確認。 |
| `POST /v1/subscriptions/:id/test` | 相同訂閱管理憑證，固定單裝置測試內容；回 `202` 工作狀態，表示已安排，並非已送達。 |
| `GET /v1/messages` | `{messages:[{id,title,body,route,createdAt}]}`；最新 20 則公開公告，測試通知不列入。 |
| `POST /v1/admin/messages` | 管理 Bearer、UUID `Idempotency-Key`、`{title,body,route}`；回 `202` 工作狀態。相同識別碼與相同內容重試不再次廣播，不同內容回 `409`。 |
| `GET /v1/admin/messages/:jobId` | 管理 Bearer；回工作狀態。 |
| `POST /v1/admin/messages/:jobId/retry` | 管理 Bearer；只重試可恢復的失敗，不重發已接受收件者；最多兩次人工重試，不能突破訊息推送期限。 |

工作狀態為 `{jobId,messageId,status,total,accepted,pending,failed,expired,createdAt,updatedAt}`。`status` 為 `queued/sending/complete/partial/failed/expired`；四類計數相加等於 total，`accepted` 僅代表推送供應商接受，沒有手機送達或閱讀回條。沒有訂閱者時 total=0，公告仍會在公開清單展示。

標題最多 80、內容最多 600 個 Unicode 字元，拒絕不完整 Unicode、控制字元及額外欄位。路由只准 `home/itinerary/attractions` 及現有五個 `attraction/<id>`，不接受外部 URL 或 HTML。通知和公告是公開活動訊息，不能填學生姓名、班別、相片、GPS 或私人資料。

## 儲存、私隱與可靠性

學生啟用後，只提交推送 endpoint、加密公鑰和 auth、到期資訊，以及裝置生成的管理秘密；後台只保留管理秘密雜湊。endpoint ID 是其原字串的 SHA-256 hex，客戶端須在 POST 前保存 32-byte／43 字元 base64url 管理秘密，以便成功回覆遺失後重試及刪除。服務不收集姓名、照片、位置、打卡或清單。

訂閱最長保留 30 日；後台保存期限到期後，若裝置訂閱及通知權限仍有效，重新開啟 App 會嘗試更新訂閱。裝置訂閱失效時需再次按「開啟手機通知」。新接收證明與取消紀錄最長 5 分鐘；證明綁定訂閱 ID、擁有人、加密金鑰、VAPID 版本及持久化確認 epoch，HTTP 回應不提供證明。取消表達到 10,000 筆時，同一交易更換 epoch、回收舊紀錄再刪除；所有舊證明隨即失效，不能靠已清除的取消紀錄復活。尚未確認的裝置需重試，現存擁有人清除不被滿表阻擋。升級前的 30 日取消紀錄保留至到期或 epoch 回收；未知 ID 的無證明重試不延長紀錄。

舊訂閱預設未確認，不能無限續期；更新 App 會用既有同意及訂閱做一次可見通知確認，不重建金鑰或要求學生登入。升級前最多 2,000 筆舊訂閱保留原到期日及待送工作，另以 2,000 筆已確認訂閱計算新加入額度；舊資料不能新增或無證明續期，也不會擠走已確認裝置。遷移期間最多 4,000 筆，舊資料最遲在原有 30 日期限內到期，之後回到 2,000 筆上限。舊裝置完成確認時也須有已確認額度。發布時先更新 App／Service Worker，再更新後台；App 對舊後台取得成功時不會標記新協定已完成，後台更新後仍會進行確認。舊 App 不能完成新協定，未獲確認時不會被描述為啟用成功。本機測試不代表真手機確認到達；延遲或離線可按啟用重試。

公告與發送狀態保留 30 日，但一般通知的供應商遞送期限是 24 小時，單裝置測試是 5 分鐘。每個活躍訂閱版本有獨立版本碼，舊請求的 404/410 不能刪除其後刷新版本。確認通知本身不寫入公告或送達回條資料庫；證明只保存於裝置管理資料，供確認前取消使用，不包含旅程、相片、位置或身份資料。

防濫用使用秘密 HMAC 的連線 IP 識別計數和訂閱 ID 計數，沒有保存原始 IP；這些是可關聯的臨時識別資料，不是匿名資料。限流紀錄在所屬視窗結束到期（最多一日），排程以最早期限清理；簽署密鑰失效亦會執行清理。Cloudflare 實際 alarm 可能延遲或服務停機，清理需待下次正常運作。供應商與託管平台仍可能有自己的運作紀錄。

驗證、授權或限流失敗時，如流程已可能寫入限流資料，亦會安排到期清理；新增排程只可提前已有 alarm，不會延後既定通知或清理。真正 Worker／SQLite 回歸測試核對 HTTP 400、415、401、404、429 的清理排程及到期刪除，不呼叫正式推送供應商。

訂閱網址只接受 HTTPS/default443 的精確 Google/Mozilla 推送主機和 `*.push.apple.com`，不能控制任意後台網絡目標。送出時再驗證，使用 Workerd 支援的 `redirect:manual` 並拒絕所有 3xx，無法轉送到其他位置。JSON body 有 8 KiB 與總讀取 10 秒上限；訂閱及取消紀錄有總量上限。

發送工作、各訂閱狀態、lease 和重試保存在 SQLite。Alarm 用固定 8 個並行批次，單次網絡要求 10 秒，失敗指數重試每輪最多 5 次。404/410 刪除失效版本，429/5xx／網絡錯誤會有限重試；401/403 不把全部訂閱當成失效刪掉，修好配置後可人工重試。Alarm 是至少一次執行，極端的請求成功但回覆／儲存中斷可能重複；固定 topic/message tag 降低重複，不能保證 exactly-once。正在途中的通知不能撤回。

公開 API CORS 只允許精確 App origin（不包含 Pages 子目錄），管理 API 只接受後台同源網頁或持有秘密的命令行要求。CORS 不是身份驗證。管理秘密只留在頁面記憶體，預覽和明確確認後才送出；離開／清除後須重新輸入。最小版本是一組共享管理秘密，沒有個人帳號／老師身份稽核。若日後需要多位老師獨立身份，另行採用驗證的 IdP/Cloudflare Access。

## 主要依據

- [WebKit：iPhone 主畫面 Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Cloudflare：Web Push 實例](https://developers.cloudflare.com/agents/communication-channels/webhooks/push-notifications/)
- [Durable Object SQLite 儲存](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)及[至少一次 Alarm](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Web Push 套件原始碼及 API](https://github.com/web-push-libs/web-push)、[RFC8291 加密](https://www.rfc-editor.org/info/rfc8291/)、[RFC8292 VAPID](https://www.rfc-editor.org/info/rfc8292/)
