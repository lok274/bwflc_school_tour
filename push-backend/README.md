# 旅程助手推送後台

這是獨立於 GitHub Pages 的真正 Web Push 後台。學生自願啟用通知，老師在後台輸入公告並確認發送。手機關閉網站後，瀏覽器的推送服務仍可喚醒 Service Worker 展示通知。普通 Safari 分頁不能當作 iPhone 推送測試：iPhone 需要 iOS/iPadOS 16.4 或以上、先加入主畫面再從 App 圖示開啟。

正式後台已部署至 `https://bwflc-school-tour-push.bwflc-school-tour-lok274.workers.dev/`，[老師管理頁](https://bwflc-school-tour-push.bwflc-school-tour-lok274.workers.dev/admin)需持有管理密鑰。前台設定使用該後台的精確 HTTPS origin；實際手機收訊仍未完成真機驗證。原有 Pages 網址及本機相片儲存不需要搬遷。

老師管理密鑰是網站目錄外 `work/bwflc-push-private-production/production-secrets.json` 的 `ADMIN_TOKEN`，由操作者自行在本機查看；不要貼到聊天、網址、公告或 GitHub。該檔亦包含 VAPID 私鑰，須私下保存，避免覆蓋原有密鑰。

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

## API 合約

所有 timestamp 是 UTC epoch 毫秒整數。所有錯誤是 `{error:{code,message}}`；不包含供應商原始回應、秘密或訂閱 endpoint。

| 方法與路徑 | 要求／回應 |
| --- | --- |
| `GET /v1/config` | `{enabled,publicKey,keyId,appUrl}`；未完整設定時 `enabled:false`。`keyId` 是公鑰字串 SHA-256 的 64 位 hex。 |
| `POST /v1/subscriptions` | `{subscription,managementToken}`；`subscription` 是標準 endpoint、keys 和 nullable expirationTime。回 `201 {id,keyId,registered:true,expiresAt}`。 |
| `DELETE /v1/subscriptions/:id` | `Authorization: Bearer managementToken`；回 `204`。相同憑證重試具冪等性。 |
| `POST /v1/subscriptions/:id/test` | 相同訂閱管理憑證，固定單裝置測試內容；回 `202` 工作狀態，表示已安排，並非已送達。 |
| `GET /v1/messages` | `{messages:[{id,title,body,route,createdAt}]}`；最新 20 則公開公告，測試通知不列入。 |
| `POST /v1/admin/messages` | 管理 Bearer、UUID `Idempotency-Key`、`{title,body,route}`；回 `202` 工作狀態。相同識別碼與相同內容重試不再次廣播，不同內容回 `409`。 |
| `GET /v1/admin/messages/:jobId` | 管理 Bearer；回工作狀態。 |
| `POST /v1/admin/messages/:jobId/retry` | 管理 Bearer；只重試可恢復的失敗，不重發已接受收件者；最多兩次人工重試，不能突破訊息推送期限。 |

工作狀態為 `{jobId,messageId,status,total,accepted,pending,failed,expired,createdAt,updatedAt}`。`status` 為 `queued/sending/complete/partial/failed/expired`；四類計數相加等於 total，`accepted` 僅代表推送供應商接受，沒有手機送達或閱讀回條。沒有訂閱者時 total=0，公告仍會在公開清單展示。

標題最多 80、內容最多 600 個 Unicode 字元，拒絕不完整 Unicode、控制字元及額外欄位。路由只准 `home/itinerary/attractions/prepare` 及現有五個 `attraction/<id>`，不接受外部 URL 或 HTML。通知和公告是公開活動訊息，不能填學生姓名、班別、相片、GPS 或私人資料。

## 儲存、私隱與可靠性

學生啟用後，只提交推送 endpoint、加密公鑰和 auth、到期資訊，以及裝置生成的管理秘密；後台只保留管理秘密雜湊。endpoint ID 是其原字串的 SHA-256 hex，客戶端須在 POST 前保存 32-byte／43 字元 base64url 管理秘密，以便成功回覆遺失後重試及刪除。服務不收集姓名、照片、位置、打卡或清單。

訂閱最長保留 30 日；後台保存期限到期後，若裝置訂閱及通知權限仍有效，重新開啟 App 會嘗試更新訂閱。裝置訂閱失效時需再次按「開啟手機通知」。取消紀錄只保留 ID／憑證雜湊最長 30 日，用於阻擋逾時舊 POST 在 DELETE 之後復活。公告與發送狀態保留 30 日，但一般通知的供應商遞送期限是 24 小時，單裝置測試是 5 分鐘。每個活躍訂閱版本有獨立版本碼，舊請求的 404/410 不能刪除其後刷新版本。

防濫用使用秘密 HMAC 的連線 IP 識別計數和訂閱 ID 計數，沒有保存原始 IP；這些是可關聯的臨時識別資料，不是匿名資料。限流紀錄在所屬視窗結束到期（最多一日），排程以最早期限清理；簽署密鑰失效亦會執行清理。Cloudflare 實際 alarm 可能延遲或服務停機，清理需待下次正常運作。供應商與託管平台仍可能有自己的運作紀錄。

訂閱網址只接受 HTTPS/default443 的精確 Google/Mozilla 推送主機和 `*.push.apple.com`，不能控制任意後台網絡目標。送出時再驗證，使用 Workerd 支援的 `redirect:manual` 並拒絕所有 3xx，無法轉送到其他位置。JSON body 有 8 KiB 與總讀取 10 秒上限；訂閱及取消紀錄有總量上限。

發送工作、各訂閱狀態、lease 和重試保存在 SQLite。Alarm 用固定 8 個並行批次，單次網絡要求 10 秒，失敗指數重試每輪最多 5 次。404/410 刪除失效版本，429/5xx／網絡錯誤會有限重試；401/403 不把全部訂閱當成失效刪掉，修好配置後可人工重試。Alarm 是至少一次執行，極端的請求成功但回覆／儲存中斷可能重複；固定 topic/message tag 降低重複，不能保證 exactly-once。正在途中的通知不能撤回。

公開 API CORS 只允許精確 App origin（不包含 Pages 子目錄），管理 API 只接受後台同源網頁或持有秘密的命令行要求。CORS 不是身份驗證。管理秘密只留在頁面記憶體，預覽和明確確認後才送出；離開／清除後須重新輸入。最小版本是一組共享管理秘密，沒有個人帳號／老師身份稽核。若日後需要多位老師獨立身份，另行採用驗證的 IdP/Cloudflare Access。

## 主要依據

- [WebKit：iPhone 主畫面 Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Cloudflare：Web Push 實例](https://developers.cloudflare.com/agents/communication-channels/webhooks/push-notifications/)
- [Durable Object SQLite 儲存](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)及[至少一次 Alarm](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Web Push 套件原始碼及 API](https://github.com/web-push-libs/web-push)、[RFC8291 加密](https://www.rfc-editor.org/info/rfc8291/)、[RFC8292 VAPID](https://www.rfc-editor.org/info/rfc8292/)
