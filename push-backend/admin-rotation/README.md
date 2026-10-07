# 老師憑證自動更換與私人領取頁

這是獨立 Worker `bwflc-school-tour-admin-key`，只管理 `bwflc-school-tour-push` 的 `ADMIN_TOKEN`。每小時由 Cron 檢查，距上次成功更換滿 90 天才更新；90 天不是每三個曆月，失敗會在下次排程重試，故實際生效可能較預定時間遲。首次初始化先核對原有憑證，並以初始化時間起計第一個 90 天。

VAPID 公私鑰、學生訂閱、照片及定位不會由此服務讀取或更換。老師電郵白名單和 Cloudflare 管理權限只放私人設定。此版本預設 `ROTATION_ENABLED=false`，尚須完成 Cloudflare Access、API 權限及正式登入驗證才啟用。

## 更新與領取流程

1. Durable Object 先以 AES-GCM 加密及保存待更新的隨機 32-byte 憑證；加密密鑰由另一個 Worker Secret 保存。
2. 固定呼叫 Cloudflare 官方 Secret API，僅設定目標 Worker 的 `ADMIN_TOKEN`，不跟隨 API 轉址。
3. 透過固定 Service Binding，對推送後台做不發送公告的登入核對。只有新憑證通過核對後才記錄為目前憑證。
4. 老師經 Cloudflare Access 登入，再按「領取目前憑證」。Worker 核對 Access 提供的 `ctx.access`、指定 audience 和私人老師電郵白名單，從不信任客戶端自行提供的身份標頭。

在遠端寫入前保存待更新值，所以 API 超時、Worker 重啟或成功更新但本機提交失敗時，可重用同一值核對並重試。更新未完成時，只提供後台已核對仍有效的現有憑證並提示稍後重新領取，不提供未生效的候選值；若待更新值已生效，領取時也可完成本機狀態核對。原有老師頁中的舊憑證會在更換後失效，老師需再次領取；私人本機 `teacher-login.txt` 不會自動更新。

領取回應沒有跨來源權限，以 `no-store` 禁止快取，且只接受同來源 JSON POST；頁面不將憑證寫入網址或瀏覽器儲存，在離頁或 10 分鐘後清除顯示。清除顯示不會清除老師自行複製的剪貼簿內容。服務在 Durable Object 保存加密憑證，目標 Worker 保存目前 Secret，領取 Worker 的 `INITIAL_ADMIN_TOKEN` 保存初始值。網站外的私人 JSON／原有 `teacher-login.txt` 仍是明文檔案，不會自動更新或清除；必須私下保管。不要啟用包含憑證的請求／回應日誌。

## 正式設定

需要已獲授權的 Cloudflare 操作者。所有操作先保持排程停用，完成以下項目才啟用；不要以部署成功代替 Access 登入及領取驗證。

1. 在 Cloudflare Zero Trust 建立 **Self-hosted Access application**，保護 `bwflc-school-tour-admin-key.<自己的 workers.dev 子網域>.workers.dev` 的整個主機。只保護新的領取 Worker，不能把學生使用的推送 Worker 整個設為需登入。用老師指定電郵的 Allow policy，登入方式可用 One-time PIN，登入 session 建議一小時。複製 application 的 audience tag。
2. 建立 Cloudflare API Token，使用目前官方帳戶支援的最窄 Worker Editor／Workers Scripts Write 範圍，目標限於 `bwflc-school-tour-push`（若帳戶權限介面不支援單一 Worker，須先說明權限範圍，不能假稱已限定）。此憑證可更新 Worker Secret，但也可能具修改該 Worker 程式的權限，不是只有改登入密碼的權限。
3. `scripts/setup-admin-rotation.mjs` 從網站目錄外原有正式密鑰檔建立另一份私人設定，僅複製原有 `ADMIN_TOKEN`、產生新儲存加密密鑰並保存老師白名單，不重新生成 VAPID。需要 `ROTATION_ACCOUNT_ID`、`ROTATION_TEACHER_EMAILS` 的本機環境值及原有 JSON 路徑。私人預設位置為網站外 `work/bwflc-admin-rotation-private/rotation-secrets.json`，拒絕覆蓋及網站內路徑。
4. 在私人設定補齊 `CF_API_TOKEN`、`ACCESS_AUD`。將這份檔案以 `wrangler secret bulk <私人檔案路徑> --config admin-rotation/wrangler.jsonc` 上傳至新的 Worker。密鑰和老師電郵不得貼入聊天、GitHub、公開網站或命令列參數。
5. 審核程式、跑 `node --test --test-concurrency=1 tests/admin-rotation*.test.mjs` 及真正 Wrangler dry-run。設定的預設仍為停用；部署新的 Worker，不修改原有推送 Worker 或其 VAPID。
6. 確認 Cloudflare Access 已保護領取主機，將 `ROTATION_ENABLED` 改成 `true` 再部署。首次核對仍使用原有 ADMIN_TOKEN，並不立即更換。請獲准老師實際登入及領取，無權帳戶／未登入應被拒絕；以領取值對正式後台做讀取核對，毋須發送公告。檢查正式 Cron 已設定每小時及下一次更換日期。

排程停用只停止將來的更換，不能恢復過期憑證。不可隨便刪除儲存、變更加密密鑰、回滾至早期的 ADMIN_TOKEN、或重跑原有 VAPID 產生程式。Cloudflare API Token 失效時會停在待更新狀態，操作者需修復權限後讓排程重試。

## 驗證範圍

測試涵蓋 90 天界線、失敗及失去回覆、重啟與併發、加密儲存、初始值不符、身份偽造、audience／電郵白名單、跨來源及轉址拒絕。真正 Wrangler bundle 在 Workerd + SQLite 上檢查 Access context、領取和保存。這些測試攔截所有正式 API 寫入，不能當成已完成正式 Access 或老師實際登入驗證。

官方參考：[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)、[Secret 更新 API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/update/)、[Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)。領取 Worker 自行提供 HTML／JS／CSS，沒有 Static Assets binding，以免內部資產 router 無法傳遞 `ctx.access`。
