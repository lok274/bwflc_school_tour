## 相簿選取確認（v82，本機修改）

普通相片下載的勾選先留在本站相簿的記憶體草稿，跨分頁及大圖返回保留。按「確定」核對頁面、打卡、讀取狀態及相片版本，才套用本站選取並關閉；× 或相簿層 Escape 取消本次變更，之前已確定的其他站選取不受影響。匯出暫時收起視窗不取消草稿，未確定變更存在時停用「下載已選」。相片版本改動取消未確定變更並提示重新選取；離頁／失敗讀取清理草稿。AI 素材包及手冊選圖維持原流程。回憶頁移除固定最小寬度，讓有傳統捲軸的 320px 視窗仍可完整操作。頁面 model 只提供唯讀 ID、數量及可見預覽，不提供 Set 或 Blob。離線快取 v82，保留前輪恢復的手冊 PDF 下載入口；本輪不提交或部署。

驗證：391 項 Node 測試、14 項相簿及 7 項原有回憶頁瀏覽器整合測試、64 資產發布建置通過。合成相片覆蓋未確定下載阻擋、確認套用、取消回復、跨頁／跨站、暫時匯出返回及資料版本失效。320×740、390×844、768×1024、1280×800 檢查按鈕完整可見，窄畫面沒有橫向溢出；Space／Enter 實際驗證勾選及確認，× 回復之前的選取。尺寸模擬不代表真機測試。

## 恢復手冊 PDF 下載入口（v81，本機修改）

依使用者最新要求，手冊目錄及全部子頁重新提供「下載手冊 PDF」，正式頁及完整行程預演共用原有下載流程。姓名、班別及學號必填，空項確認、文章配圖及本機 PDF 生成規則沿用；自動暫存與簡易備份不變。取消上輪尚未提交的移除修改，離線快取升至 v81，避免本機 v80 快取繼續顯示沒有按鈕的版本。

## 學習手冊自動暫存及簡易備份（v79，本機修改）

手冊上方以交易完成狀態顯示自動暫存，不把佇列建立當成成功。目錄已有內容才提供「繼續填寫」，順序為超限部分、首個未填部分、全部填齊後的文章。普通備份收起於唯一「保存與備份」按鈕，開啟及收起管理焦點；保存目前文字及評分的 .json，檔名加入本機時間，不含身份及相片。選檔只建立私有待還原草稿，model 提供填寫／評分數與超限提示；確認和版本核對後才取代，舊備份最多 10,000 字元可載入待修改，嚴格保存及 PDF 仍只接受 1,000 字元。取消、離頁、收起、清除及過期檔案讀取均失效，儲存格式及版本不變。

控制器在切頁前擷取欄位並等待保存，待存期間其他 model 讀取不能提前完成路由；失敗恢復原 hash 並保留原 DOM，避免丟失游標及输入。超限舊稿需要跨部分縮短，因此只允許在手冊內保留記憶體草稿切頁，離開仍阻擋。背景及 pagehide 盡早擷取目前欄值，beforeunload 僅在 dirty 時提示，取消關閉不清身份；真正 pagehide 才清除身份及取消生成。重新回前景或 pageshow 核對 revision。不能依賴 unload 非同步工作保證突然強制關閉；介面明示最後未存輸入可能遺失。

快取 v79，正式及預演共用流程但資料庫分開。Node 與獨立瀏覽器測試覆蓋備份展開、焦點、背景組字、未存離開提醒、保存失敗阻止切頁、預覽確認、舊稿恢復、衝突和清除。離線 fixture 同步核對 v79 的精確 PDF 程式及字型快取；測試只用隔離 origin 合成資料。本輪不提交、推送或部署。

驗證：387 項 Node 測試、17 項手冊瀏覽器整合及 64 資產發布建置通過。320×740、768×1024、1280×800 的四項導航等寬，手冊只有一個備份入口且沒有橫向溢出；手冊 body 移除固定 320px 最小寬度，適應窄視窗的傳統捲軸。鍵盤 Enter 展開／收起並恢復焦點。停止隔離伺服器後，關閉頁面再新開手冊、讀回答案和六張配圖、修改後重載，以及真正下載文字備份和八頁 A4 PDF 均成功；PDF 有六個圖片物件，備份只有版本、活動、文字及評分，不含身份及選圖。背景事件以合成生命週期驗證，手機／平板是瀏覽器尺寸模擬，不代表真機強制關閉能保存最後輸入。

## 學習手冊文字上限（v78，本機修改，舊備份還原流程由 v79 更新）

每個文字欄改為最多 1,000 字元，`MAX_WORKBOOK_TEXT` 統一控制輸入、提示、新保存、JSON 還原和 PDF 驗證。正文仍以約 600 字為目標，未達目標可下載草稿，不能超過新上限。字元數沿用 HTML maxlength 的 UTF-16 長度；中文組字完成才限制輸入，不能留下截斷的代理字元。

為免舊資料失去存取，讀取及恢復備份限定保留舊版最多 10,000 字元的文字；不改寫或自動截斷。超限欄列出所屬部分與名稱，保留輸入框、備份和清除操作，暫停保存及 PDF，縮短全部超限欄後才保存。恢復備份仍須縮短至 1,000 字元後才可還原，資料格式與版本不變。快取更新至 v78；Node 與獨立瀏覽器測試涵蓋 1,000／1,001 邊界、組字、真正 IndexedDB 舊稿及備份還原。

## 首頁精簡團刊文字（v77，本機修改）

依使用者要求刪除團刊區塊的「隨身團刊」、「行程、課業，一處查閱」及「原版團刊 · 20 頁 · 約 6 MB」三行文字、專用標題樣式及未使用的 `TRIP_BOOKLET.pageCount`／`sizeLabel`。PDF 查看／下載及離線提示保留；刪除標題後以 `aria-label` 提供區塊讀屏名稱。正式及預演首頁共用同一視圖，快取更新至 v77，資產及儲存格式不變。

## 首頁移除課業摘要（v76，本機修改）

依使用者要求刪除首頁「活動課業與反思重點」整個區塊，以及只供這個區塊使用的 `TRIP_DATA.learning`、首頁 model 的 `learning`、渲染和專用樣式。首頁仍可查看／下載整份團刊；課業、日記、反思與作品指引仍在底部「學習手冊」，AI 素材包仍在旅途回憶。正式首頁及共用視圖的行程預演首頁同步生效；資產白名單及儲存格式不變，快取更新至 v76。

## 完整行程預演（2026-10-09，v75）

`device-test.html` 現在預設開啟 `#itinerary`。正式景點、五站必需／學校選填、打卡後拍照、取消確認及刪除本站相片、旅途回憶、AI素材包和學習手冊都共用 `createAppController`；沒有另寫一套打卡流程。`device-rehearsal.js` 注入模擬 geolocation、測試 views 與獨立儲存。模擬點在各站地理圓心，GCJ02先轉WGS84；太遠、600米誤差、拒絕及逾時走正式判定和手動未核實確認，太遠不能繞過。離頁、pagehide和變更定位選項使晚到回覆失效。不要求真實GPS；相機仍使用真實裝置。

打卡鍵 `outdoorLearningDay.rehearsal.v1`、相片庫 `outdoorLearningDay.rehearsal.photos`、草稿庫 `outdoorLearningDay.rehearsal.workbook.v1` 彼此及與正式／舊診斷資料分開。適配器只接受原控制器需要的虛擬打卡鍵，拒絕其他鍵。兩次確認清除只清預演資料，不遷移、改寫或刪除正式資料；格式保持兼容。個人資料仍只留當頁及輸出。通知客戶端在預演停用，不建立訂閱或連接正式後台，CSP的connect-src保持none。

頁首持續顯示「旅程預演／模擬定位」，核實標籤、完成提示、確認、toast及印章均帶測試文字。單張PNG、AI指令和手冊PDF有測試標示，不假稱真正到訪、出席或正式課業。預設正式版文字及輸出不變。`createViews`增加可選testOnly，控制器新增可注入viewsFactory；照片及PDF生成服務新增預設false的testOnly參數。

`?mode=diagnostics` 保留原東院道11號真實GPS、毋須打卡的獨立相機及5／6張測試素材包，原資料不需搬移。下方較早裝置頁章節描述的是這個診斷模式。Service Worker對測試頁的帶查詢導覽，離線仍回傳測試shell，不能回傳正式首頁；帶查詢回應不加入快取。精確白名單新增一個預演模組，共64個批准資產、快取v75。

`tests/rehearsal.test.mjs`測試範圍、儲存、取消、晚到回覆及正式預設；`tests/browser/rehearsal.html`只可在空白測試origin執行，使用合成串流／相片，核對真實DOM、Canvas、IndexedDB、PNG、5／6張ZIP、PDF及正式／舊診斷哨兵。沒有要求真實相機或定位權限，也沒有把合成測試說成真機驗收。本輪不提交、推送或部署。

驗證：378 項 Node 測試、預演 12 項及原診斷 16 項瀏覽器整合通過，64 個資產乾淨發布建置成功。320×740、768×1024、1280×800 中四項導航完整、等寬，頁面沒有橫向溢出；預演 body 在窄桌面視窗有捲軸時不再強制 320px 最小寬度。鍵盤 Enter 可觸發太遠拒絕及範圍內測試打卡，重载保留測試紀錄。停止隔離伺服器後真正重新載入、模擬打卡、保存手冊及下載五頁 A4 PDF 通過；PDF 每頁含測試預演標示，中文正文及合成身份可擷取。帶 diagnostics 查詢的離線重開仍是獨立診斷模式。手機／平板為瀏覽器尺寸模擬，真實硬體權限與鏡頭另需在裝置驗證。
## v74 學習手冊

唯一主入口在四項底部導航最後；`#workbook` 為短目錄，七個子路由同樣高亮手冊。`workbook-data.js` 保存 PDF 順序 14–19 頁原題、進度、格式及備份驗證；日記 7／6／6 欄、反思兩題及八評分，初始空白，未打卡可填。`workbook-storage.js` 獨立版本化 IndexedDB 和串行保存服務，以交易內 revision 核對避免跨分頁舊稿覆蓋。完成交易才報已保存，失敗保留 live draft，衝突先備份再確認載入最新版本。清除留空白版本記錄並停止舊待存工作。

`workbook-controller.js` 只接收相片讀取、預覽、頁面有效性及確認能力，model 經 readonlyCopy 凍結且不含 Blob。表單 input 更新 live draft 和計數，不重畫；compositionstart/end 沿用控制器組字防護；hashchange 先 flush，再切頁。身份只在手冊記憶體，離開該路由家族或 pagehide 清除。JSON 白名單只有文字、自評、活動與版本；還原清選圖。

`workbook-pdf.js` 按需 import 本地 pdf-lib 1.17.1/fontkit 1.1.1/pako 和靜態 Noto Sans HK Regular TTF JS資料，registerFontkit後embedFont subset，A4/頁碼/字元換行及等比例圖。指定fontkit的OTF子集不兼容，靜態TTF由官方Sans2.004 VF在建置前固定weight400（詳見vendor記錄和重建腳本），沒有改用另一款字型或放寬CSP。用characterSet拒絕不支援字元；所有選圖逐張經共用JPEG解碼重繪及釋放。生成前後核對草稿revision、照片writeId/尺寸/SHA256及頁面epoch，過期不下載。

發布及Service Worker加入精確14項新增資產（五個功能模組、依賴、字型、授權及來源記錄），共63個建置資產，快取v74。tests/workbook.test.mjs與原PDF擷取fixture核對原文，測試保存失敗/佇列/版本/清除/備份/PDF；tests/browser/workbook.html以獨立IDB與合成照片驗證整合流程；offline準備頁只能在空白origin執行，不能覆蓋已有旅程。

本輪驗證（2026-10-09）：369 項 Node 測試、手冊 12 項、相簿 13 項及資料隔離 9 項瀏覽器整合通過。核對 320×740、768×1024、1280×800 的四等分導航與無橫向溢出；鍵盤進入／返回手冊分頁後，焦點回到主要內容。修正保存等待後仍為 inert 而不能聚焦的操作順序，加入瀏覽器回歸核對。停止隔離測試伺服器後，可從 v74 快取重開、保存草稿並實際下載 PDF；八頁合成成品有六張完整比例配圖、中文可選取及八項評分。另核對空白五頁與長文十頁的 A4 成品，Poppler 讀取及渲染無字型錯誤。測試全用合成資料，手機／平板為瀏覽器尺寸模擬，不代表 Android／iPhone 真機驗收。本輪只完成本機修改和建置，未提交、推送或部署。

# 戶外學習日 Webapp 程式運作說明

這份導讀以 2026-10-09 的工作目錄程式碼為準，已同步各頁資料分工及離頁取消實作，說明各模組的責任、函數的輸入與輸出，以及打卡、影相、下載和清除資料的完整流程。示例資料只是教學用途，並非真實個人紀錄。

前台是 HTML、CSS、JavaScript ES Modules 組成的靜態 PWA，沒有框架或學生登入。訊息推送另有獨立後台及老師管理憑證；只有通知訂閱資料會傳送到推送後台，旅程相片、位置及打卡仍不會上傳。PWA 的意思是：網站可在支援的瀏覽器安裝到主畫面，並透過 Service Worker 預先保存網站檔案供離線使用。

打卡仍使用 `outdoorLearningDay.v3`，相片資料庫升級至版本 2，保留舊版相片。之前討論的密碼加密及復原碼只有規劃，**目前沒有實作**；不能因為刪除了須知頁，就把資料描述成已加密。

較早日期章節是歷史紀錄，舊拼貼卡及選填姓名規則已由下節「團刊與 AI 素材包」取代。相簿封面、分頁和單張旅程卡保留；正式 AI 素材須五個必需景點各一張，學校選填，三項身份資料必填。出發站沿用共用景點操作頁。

## 團刊其他行程問題（2026-10-09，v73，本機修改）

依使用者要求，按原版團刊 PDF 順序第 13 頁（頁腳 12）「其他行程部分」，以原題取代孫中山故居、倫教糕及沙灣古鎮的「現場觀察／學習提示」。孫中山故居使用第 1 題、倫教糕第 3 題，沙灣古鎮依原順序使用第 2、4 題；填空線、文字及標點保留，不加入答案或作答表單。該頁沒有留耕堂或出發學校的獨立題目，這兩站保留原提示；松山湖未來學校已有四題亦保留。

該三站的 `questions` 為問題全文，`questionNumbers` 指定團刊原題號；移除三站舊 `observe`／`prompt`。`renderAttraction` 使用指定題號，沒有指定時沿用問題順序；題文及題號均經 HTML 跳脫。頁面 model 繼續以唯讀複本提供資料，不增加儲存、上傳或功能模組；打卡、相機及回憶功能不變。來源原文及景點對應保存在獨立 `tests/fixtures/booklet-questions.json`，核對批准 PDF 的 SHA-256、四題分配、題號、填空線與頁面完整文字。離線快取 v73，發布資產仍為 49 個；尚未提交、推送或部署。

驗證：32 項相關回歸及全套 356 項前台自動測試均通過；同步修正舊測試中已不適用的景點簡介要求，保留地理設定檢查。三站在 390×844、768×1024、1280×720 的九組瀏覽器檢查均核對原文與原題號一致、舊提示移除、填空線完整、文字未被裁切且沒有橫向溢出。語法、git diff --check 及 49 個批准資產的乾淨發布建置通過。這是本機瀏覽器驗證，沒有手機真機測試或正式部署。

## 歷史：松山湖未來學校四條問題（2026-10-09，v72，本機修改）

依使用者提供的四條文字，以四張問題卡取代松山湖未來學校詳情頁原有的「現場觀察」及「學習提示」。`ATTRACTIONS` 的該站資料改用 `questions` 陣列，移除該站舊 `observe`／`prompt`。`renderAttraction` 有問題清單時按順序跳脫並顯示問題 1–4，其餘景點沿用原有兩張卡；手機一欄、桌面兩欄，奇偶卡沿用綠／米橙背景。沒有新增作答表單、答案儲存或上傳，打卡、相機及旅途回憶操作不變。離線快取更新至 v72，發布資產仍為 49 個；尚未提交、推送或部署。

驗證：31 項相關自動測試全部通過；本機瀏覽器核對四條問題的文字及順序與使用者原文一致，舊兩張提示卡已移除。390×844、768×1024 為一欄，1280×720 為兩欄，文字完整顯示且沒有橫向溢出。這是本機瀏覽器驗證，未進行手機真機測試。

## 歷史：移除全部景點簡介（2026-10-09，v71，本機修改）

依使用者要求，刪除行程內各景點詳情頁的「景點簡介」區塊，移除五個景點的 `intro` 欄位、`renderAttraction` 中簡介渲染邏輯及僅用於簡介的 `lead-paragraph` 樣式。出發學校原本已沒有簡介，六站詳情均不再顯示該區塊。獨立 `#introduction` 頁的七個介紹、原文及十張團刊圖片保留；現場觀察、學習提示、來源連結、打卡、拍攝及回憶功能保留，照片與打卡儲存格式不變。離線快取更新至 v71，發布包仍為 49 個批准資產；尚未提交、推送或部署。 驗證：31 項相關自動測試全部通過；逐一開啟六站本機詳情頁，均沒有景點簡介區塊或標籤，打卡控制保持可用。原文及圖片回歸測試確認獨立行程介紹頁仍完整保留。

## 歷史：團刊原有圖片加入行程介紹（2026-10-09，v70，本機修改）

依使用者要求，從原 PDF 順序第 8–11 頁擷取十張內容圖片，放到對應的七個介紹。使用 PDF 的原有 JPEG／PNG 圖片物件，保留完整比例及原始像素，沒有改用整頁截圖或生成圖片；學校三張活動照片依原稿由左至右排列，不複製原稿的傾斜相框。原 PDF 未修改，正文、單一「行程介紹」主標題及不顯示頁碼的要求保留。

`src/data.js` 的 `introductionImage` 提供同源相對路徑、替代文字及原始寬高，各介紹用 `image` 指定主圖，學校另有三張 `gallery` 照片。`renderIntroduction` 以獨立 img 元素呈現，正文仍是可選取 HTML；替代文字及圖片網址正確跳脫。主圖在較大螢幕置於文字右側，手機置於正文前；活動照片桌面三欄、手機單欄。圖片保留比例、不裁切，使用明確尺寸及 lazy loading。

圖片位於 `public/images/introduction/`，十個精確路徑加入 APP_SHELL，快取 v70；發布資產由 39 增至 49。來源物件、原始尺寸及擷取檔案 SHA-256 記錄在 `tests/fixtures/booklet-introduction-images.json`，測試核對圖片所屬介紹、實際資產及離線白名單。原有儲存格式、照片資料庫、PDF 查看／下載和其他功能不變；尚未提交、推送或部署。

驗證：355 項前台自動測試全部通過，乾淨發布建置為 49 個批准資產。瀏覽器核對十張圖片均成功載入、自然尺寸與抽取結果一致、顯示比例正確；七個介紹及二十段正文保持原文，主標題仍只有一個，沒有頁碼。390×844、768×1024、1280×720 圖片未溢出畫面，活動照片手機一欄、平板及桌面三欄。停止本機伺服器後重新載入並逐張查看，十張圖片全部仍可顯示。這是本機瀏覽器驗證，沒有宣稱已完成真機測試。

| 對應介紹 | PDF 順序頁 | 原有圖片檔案／物件 |
| --- | --- | --- |
| 東莞市 | 8 | `dongguan-map.png`／`X4.png` |
| 中山市 | 8 | `zhongshan-statue.jpg`／`X9.jpg` |
| 孫中山故居 | 9 | `sun-yat-sen-residence.jpg`／`X7.jpg` |
| 留耕堂 | 9 | `liugeng-hall.png`／`X8.png` |
| 沙灣古鎮 | 10 | `shawan-town.jpg`／`X7.jpg` |
| 倫教糕博物館 | 10 | `lunjiao-cake.jpg`／`X8.jpg` |
| 松山湖未來學校 | 11 | `future-school-logo.png`／`X5.png` |
| 松山湖未來學校 | 11 | `future-school-group.jpg`／`X28.jpg` |
| 松山湖未來學校 | 11 | `future-school-visit.jpg`／`X23.jpg` |
| 松山湖未來學校 | 11 | `future-school-craft.jpg`／`X9.jpg` |

## 歷史：只保留一個行程介紹標題（2026-10-09，v69，本機修改）

依使用者要求，移除第二、第三個介紹區塊重複的「行程介紹」標題及其執行用資料。頁首主標題保留一個；「姊妹學校介紹」、七個介紹名稱及二十段正文保留。沒有頁首標題的區塊直接以景點名稱作 h2，文章的 aria-labelledby 指向第一個景點標題，保持有效的閱讀順序與無障礙標籤。原文測試排除頁碼及重複主標題，仍核對全部正文。離線快取更新至 v69；尚未提交、推送或部署。 驗證：15 項相關自動測試通過；本機瀏覽器的「行程介紹」標題為一個、「姊妹學校介紹」為一個，七個介紹及二十段正文完整保留，四個文章的無障礙標籤均有效。

## 歷史：移除行程介紹全部頁碼（2026-10-09，v68，本機修改）

依使用者最新要求，移除行程介紹的全部頁腳號碼 7、8、9、10；介紹標題及二十段正文保留。刪除執行用 `printedPage` 欄位、頁碼 footer 渲染及專用 CSS。原版 PDF 和獨立原文測試基準不改寫；文字比對排除原稿末尾的頁碼，仍逐頁核對標題與完整正文。離線快取更新至 v68；尚未提交、推送或部署。 驗證：15 項相關自動測試全部通過；本機瀏覽器更新後頁碼元素為零，二十段正文及標題逐頁與原稿（排除頁碼）完全一致。

## 歷史：團刊行程介紹文字版（2026-10-09，v67，本機修改）

依使用者確認，來源為原版 PDF 順序第 8–11 頁，並非頁腳第 8–11 頁。獨立 `#introduction` 頁呈現東莞市、中山市、孫中山故居、留耕堂、沙灣古鎮、倫教糕博物館及松山湖未來學校，共七個介紹、二十段正文；原有頁首及頁腳 7–10 同樣保留。行程頁入口改為「行程介紹」，可返回行程，底部導航仍歸屬行程。

`TRIP_DATA.itineraryIntroduction.pages` 按原頁保存頁首、介紹標題、正文段落和頁腳。行程 model 只提供入口的 `introductionTitle`，介紹 model 只提供 `view` 及 `introduction`。`renderIntroduction` 逐項跳脫為標題、段落及頁腳，第一個頁首為 h1，其餘頁首為 h2，各介紹標題低一級。內容是可選取、可複製的 HTML 文字，沒有 PDF 整頁圖片、iframe、object 或 canvas；頁面只加返回連結，沒有在原文區插入說明、摘要或新連結。

以 PDF 文字層抽取並逐頁視覺核對。移除字型抽取造成的空白和版面硬換行，但保留所有文字、原有標點及年份，包括「順谷區」、「遊行者」、「旅遊景区」、「當更」和「點選即可開啟側邊面板」等來源用語；不把後者視作新增功能指令，也不將歷史年份改成目前數字。第 11 頁的文字層將「松山湖未來學校」放在首段之後，顯示時按可見原稿順序放回段首；字元數量不變。

`tests/fixtures/booklet-introduction.json` 保存獨立來源字串及原檔 SHA-256。回歸測試逐頁比對完整渲染文字，僅忽略排版空白，並核對原版 PDF 雜湊及沒有整頁圖片／嵌入閱讀器；路由測試核對直接開啟與返回後仍保留打卡及相片。

驗證：354 項前台自動測試全部通過；發布建置在新的空目錄產生 39 個批准資產。瀏覽器逐頁比對 773／759／714／601 個非排版字元均與原稿一致，七個介紹及二十段正文保留；390×844、768×1024、1280×720 沒有橫向溢出，返回及鍵盤 Enter 入口可用。停止本機伺服器後，重新載入仍保留四頁完整文字。這是本機瀏覽器驗證，沒有宣稱已完成真機測試。

沿用原有儲存格式及 39 個發布資產白名單，離線快取更新至 v67。接續下節移除酒店資料的本機修改，尚未提交、推送或部署。

## 移除酒店資料區塊（2026-10-09，v65，本機修改）

依使用者截圖移除行程頁整個「酒店資料」區塊，包括兩間酒店的名稱、地址、電話、`TRIP_DATA.hotels`、行程 model 的 `hotels`、`renderHotels` 及酒店專用樣式。三日行程中的「酒店」路線節點、原版團刊 PDF 查看／下載和活動課業保留。資料儲存格式及發布資產白名單不變；離線快取更新至 v65。下方 v64／v62 章節是當時版本的歷史紀錄。

驗證：352 項前台自動測試全部通過；本機瀏覽器重新載入後顯示三個行程日，酒店資料區塊為零個。原始碼已沒有酒店資料欄位、渲染 helper 或專用樣式。本輪修改尚未提交、推送或部署。

## 歷史：移除全站團刊頁碼連結（2026-10-09，v64）

使用者確認刪除全站所有指定頁碼的團刊連結，保留整份 PDF 查看及下載。首頁五個章節捷徑及課業／反思頁碼連結、行程／住宿頁碼連結、景點學習頁碼連結和裝置 AI 課業頁碼連結均移除。刪除 `TRIP_BOOKLET.sections`、景點 `bookletPage`、頁碼連結生成 helper 及專用 CSS；行程及景點 model 不再傳入沒有用途的 booklet metadata。首頁原版 PDF 查看／下載、裝置頁整份 PDF 下載、課業文字、酒店資料及其他景點來源連結保留。

驗證：前台全部 352 項自動測試及裝置相片／AI 的 10 項瀏覽器整合通過。本機首頁展開課業後仍沒有頁碼連結，PDF 查看／下載保留；行程及六個景點各自核對為零個團刊頁碼連結，酒店資料保留。原始碼內已沒有頁碼 fragment、頁碼 helper、bookletPage 或專用頁碼連結樣式。

離線快取更新至 v64，發布白名單及儲存格式不變。使用者已授權提交、推送及部署；交付前須確認本次提交的 GitHub Actions build／deploy 成功，並核對線上 v64 及修改資產與提交一致。下節 v62 是此前團刊與 AI 素材包版本的歷史紀錄。

## 團刊與 AI 素材包（2026-10-09，v62）

最新資料來自使用者提供的 20 頁團刊，活動日期為 2026 年 11 月 5 至 7 日。`TRIP_BOOKLET` 提供受凍結的 PDF metadata 及章節連結，`TRIP_DATA` 加入兩間酒店、四項課業和反思重點；原有景點 ID、位置及儲存格式不變。首頁顯示日期、PDF 查看／下載及可展開的課業，行程頁提供酒店，景點頁提供 PDF 對應頁。沒有補寫集合時間、住宿日或把歷年交流活動當成今次安排。

`public/documents/trip-booklet-2026.pdf` 是使用者批准公開的原檔副本，包含原有老師姓名、電話及 metadata，未改寫檔案；不把私人聯絡資料抄錄到其他程式／測試。建置僅准許這一份 PDF，其他 PDF 仍會拒絕。APP_SHELL 增至 39 個精確資產，快取 v62；PDF 導覽另查本版 PDF 快取，失敗不拿 HTML 首頁冒充 PDF。查詢參數、範圍外及非 GET 不加入離線快取。本機伺服器回傳 application/pdf；僅原版團刊回應允許自身 PDF object，網站 HTML CSP 不放寬，PDF 用另開分頁及下載，不嵌入 iframe。

多景點拼貼卡改為 `createTripAIKit`：五個必需景點完成且每站各選一張不同照片，學校可額外加入第六張。`summaryCard` 是沿用的內部 model 名稱，畫面顯示 AI 融合圖片素材包，只提供預覽及文字，沒有 Blob。姓名 40 字、班別 20 字、學號 20 字均必填，空白／控制字整理後仍須有內容，學號保持字串以保留開頭的零。三項資料只留在目前頁面及 ZIP 內生成指令，不寫入 localStorage／IndexedDB、不傳到後台、不加入檔名。輸入時只更新字數、提示及下載按鈕，保留焦點、游標和中文組字；關閉視窗保留草稿，離頁或重載清除。

素材包逐張解碼、重繪及釋放，包含 5／6 張 JPEG 和 UTF-8 中文生成指令，全部成功才輸出 ZIP。指令按團刊提供角色、背景、任務、限制及輸出格式，要求特色自然融合成單一畫面及核對中文字；網站不再生成多格 PNG，也沒有連接 AI 服務或自動上傳／提交。確認前及生成期間持續核對頁面、視窗、打卡、相片版本及 writeId；取消或資料失效後不下載舊結果。單張旅程卡及 80 字選填感想繼續可用。

`device-test.html` 使用 `createDeviceAIKit`，共用相同 JPEG／ZIP／指令流程，但只接受獨立測試點的 5 或 6 張不同照片，不依賴 GPS，也不假稱是五個正式景點。使用現有測試相片勾選，保留原 GPS、相機、一般下載及重設功能；姓名、班別、學號同樣必填、僅留當頁。準備期間停用勾選，離頁、重設或相片替換使工作失效；ZIP 及文字明確標示測試用途。

本輪驗證：前台 352 項及後台 38 項自動測試通過，Worker 實際部署組態／bundle dry-run 通過，乾淨發布建置為 39 個批准資產。瀏覽器整合 89 項通過：AI 素材 14、相簿 13、裝置相片與 AI 10、回憶 7、JPEG／ZIP 匯出 11、五站完成 9、資料隔離 9、裝置 GPS／相機 16。相簿首次與多組 Canvas 測試同時執行時出現 15 秒測試逾時及後續狀態連帶失敗，重跑後 13 項全部通過，沒有放寬等待期限或更改匯出實作。

實際裝置頁以六張標示 SYNTHETIC 的相片下載 ZIP，另在停止本機伺服器後下載正式五站素材及裝置五張素材；以獨立 ZIP／JPEG 讀取核對內容、照片數、完整尺寸和學號開頭的零。離線重新載入裝置頁保留照片、清除三項身份草稿及勾選。390×844、768×1024、1280×800 沒有橫向溢出，鍵盤 Tab 按姓名、班別順序移動。這是本機合成資料驗證，不代表真機分享、相簿儲存位置或外部 AI 已完成測試。

瀏覽器實際下載的原版 PDF SHA-256 與來源一致；內置瀏覽器的原生 PDF 畫面未顯示，因此保留下載後使用 PDF 閱讀器的入口，不宣稱所有瀏覽器均已驗證內嵌閱讀。網站並沒有嵌入 PDF iframe。下方 v58／v57 及較早驗證是當時版本的歷史資料，不能當成目前 AI 流程的驗證結果。

使用者已授權提交、推送及部署此輪團刊、正式 AI 素材包及裝置測試頁修改。發布只更新 GitHub Pages 前台，推送後台沒有程式修改或部署；交付前須確認本次提交的 GitHub Actions build／deploy 成功，並核對線上 v62、AI 執行模組及原版 PDF 與提交一致。已安裝的 PWA 關閉後重開以載入更新，毋須清除旅程資料。

## 歷史：v58 相簿版驗證（2026-10-08，本機未發布）

前台 344 項及推送後台 38 項自動測試全部通過。瀏覽器整合共 132 項通過：相簿視窗 13、合成卡 14、回憶頁 7、相片匯出 11、學校詳情 14、正式 Android 下載提示 14、多相片 7、裝置相片 8、資料隔離 9、五景點完成 9、提示計時 2、安裝指引 8、裝置相機 16。新增相簿測試涵蓋 0／1／12／13／120 張、六張封面上限、分頁及跨景點勾選、本站全選／清除、JPEG／ZIP、取消與重試、中文組字、草稿、五張／六張 PNG、讀取失敗及過期工作。相機測試以完整 Canvas 畫面持續產生合成串流；平台、GPS、相機及分享均為模擬。

120 張合成照片在 390×844、768×1024、1280×800 下分別顯示兩／三／三欄，沒有橫向溢出；相簿第二頁為八張，Escape 關閉後焦點回原封面。停掉本機伺服器後，v58 應用入口仍能重新載入相簿及預覽，已實際下載一張 JPEG，完成二十張 ZIP 準備及五張／六張合成卡生成。網頁仍只宣告下載已開始，不能保證任何手機已存入相簿。手機實際檔案位置、原生分享及真實相機須另行實測。

乾淨發布建置包含 38 個批准資產，測試頁不進發布包；儲存格式不變。新增 `tests/browser/memory-albums.html` 及 `tests/helpers/memory-controls.js`，使用本機合成資料。一般整合測試採用隔離資料庫；`?preview=offline` 只可在空白本機 origin 建立 120 張合成照片，再由網站入口測試離線。本輪沒有提交、推送或部署。

## v58 發布範圍（2026-10-08）

依使用者「提交、推送及部署」授權，本次合併發布旅途回憶頁、五個必需景點加選填學校的旅程合成卡，以及相簿封面、分頁縮圖與集中下載。保留原有照片及打卡格式，不需要清除或搬移本機資料。離線快取為 v58，網站發布包仍為 38 個批准資產；測試、通告及個人資料不進發布包。

GitHub Actions 在推送的 main 提交上執行前台與推送後台測試、Worker bundle 檢查及 Pages 建置，通過後部署 GitHub Pages。交付時另核對該提交的 build／deploy 結果及線上資產。手機真實分享、相簿位置及相機的限制沿用上述驗證说明；PWA 更新後關閉並重新開啟即可讀取新版本，不應清除瀏覽器資料。

## 目前功能與已刪除內容

| 位置 | 現有內容 | 對應函數 |
| --- | --- | --- |
| 首頁 | 日期、團刊與課業、旅程介紹、原生安裝或 iPhone／iPad 安裝方法、私隱提示、清除所有本機資料 | `renderHome(model)` |
| 行程 | 介紹入口、三日行程、各站連結、打卡狀態及五景點完成提示 | `renderItinerary(model)` |
| 行程介紹 | 團刊 PDF 第 8–11 頁的七個介紹、原文正文、十張原有圖片、返回行程連結；一個主標題，不顯示頁碼 | `renderIntroduction(model)` |
| 景點詳情（包括學校出發站） | 松山湖未來學校四題及團刊其他行程四題／留耕堂、出發學校的觀察與學習提示、來源、打卡、五景點完成提示、相機及回憶入口；不顯示景點簡介 | `renderAttraction(model)` |
| 旅途回憶 | 六站本機相片、選填感想、單張旅程卡、跨站多選下載、五個必需景點加選填學校的 AI 素材包 | `renderMemories(model)` |

相片匯出另提供「一鍵下載全部」：一張下載 JPEG，多張由 `src/photo-archive.js` 在裝置內打包成一個 ZIP，不連續觸發多個下載。每張旅程卡可選填最多 80 字感想；草稿只留在目前頁面，`src/card-reflection.js` 整理空白並按卡片寬度換行，留空沿用原版面。詳見 [一鍵下載](ONE_CLICK_DOWNLOAD.md)及[旅程卡感想](TRAVEL_CARD_REFLECTION.md)。

佛教黃鳳翎中學詳情頁使用附作者、年份及授權連結的本地校舍照片，圖片加入 Service Worker 的精確離線白名單。詳見[圖片來源及授權](SCHOOL_BACKGROUND.md)。

底部導航為「首頁、行程、旅途回憶」。整個「景點護照」列表頁、卡片及相關樣式已刪除；個別景點詳情從行程頁的景點連結進入，返回連結亦回到行程。首頁的出發倒數卡片、四個重要時刻、兩張進度卡片及景點預覽區塊已刪除；整個準備頁、清單、提醒與進度環均已刪除。須知頁、`renderInfo()`、相關路由、資料及樣式均已移除。

`#prepare` 及 `#info` 現在屬未知路由，會顯示首頁；程式沒有把網址 hash 改寫成 `#home`。清除資料入口位於首頁底部。


## 相簿封面與回憶視窗（2026-10-08，v58）

相片增加時，主頁的相簿卡仍最多六張。`albums` 只含景點資料、相片數、已選數及最新封面，`selectedPhotoIds` 保存全旅程勾選，`memoryOverlay` 只含目前分頁（每頁 12 張）、大圖或合成卡所需預覽；不提供 Blob。所有照片仍在保存層／IndexedDB，不因分頁而搬移。

控制器用 `memoryFrames` 記住相簿、大圖、合成卡及選圖模式的上一層、分頁、焦點和捲動；`memoryEpoch` 在切換／關閉時使舊工作失效。返回及 Escape 回上一層，關閉回主頁；確認或匯出暫時收起回憶 dialog，取消後恢復原模式，避免多層 dialog 同時打開。姓名、班別、感想和選取在關閉視窗後保留，離開回憶路由或重載清除。中文組字期間不重建輸入欄，完成後再限長及恢復焦點。

`renderMemoryOverlay` 共用一個回憶 dialog：相簿及選圖顯示最新至最舊的十二張縮圖；相片勾選與打開大圖是獨立控制。大圖下載當張 JPEG，按製卡才展開感想。合成卡只有五個必需景點及選填學校共六個位置，按位置再開本站分頁縮圖；回憶主頁只保留進度、缺照及補拍入口，零相片時仍可找到指引。

正式 App 的 `renderPhotoExport(model, options)` 使用精簡版：先顯示逐張處理進度，全部成功後突出 JPEG／ZIP 按鈕，手機分享在其次；更多選項按十二個檔名分頁。失敗可重新準備，取消不清除照片或勾選，下載後保留實際檔名及平台位置提示，多張提醒先解壓。獨立裝置測試頁不傳 options，沿用原版匯出畫面。

只建立正在顯示的預覽網址，render 收集仍需使用的 photoId，釋放其餘網址。合成卡和單張卡另核對頁面代數、視窗代數、打卡及相片版本，關閉、換相片、離頁或資料失效後不下載過期結果。沒有新增上傳、匯入、逐張刪除或資料遷移。

新增 `tests/memory-albums.test.mjs` 和 `tests/browser/memory-albums.html` 以 0、1、12、13、120 張合成照片驗證主頁上限、分頁、勾選、網址釋放、模式返回、下載及失效路徑；其他回憶／匯出／合成卡測試也使用相簿及選圖控制項。資料仍沿用 localStorage v3 及 IndexedDB v2，APP_SHELL 精確白名單不變，離線快取 v58。

## 初學者需要的詞彙

目前多站作品使用 `createTripAIKit` 下載素材包，規則及資料生命週期見上方最新章節；`createTripSummaryCard` 已移除。`createTravelCard` 仍在本機產生單張 1080×1350 PNG，感想最多 80 字。

| 詞彙 | 在本專案的意思 |
| --- | --- |
| DOM | 瀏覽器把 HTML 轉成的元素物件；程式用它取得按鈕、修改內容 |
| state／model | state 是保存層內部紀錄；頁面 model 是按需要複製及凍結的快照 |
| 同步 | 呼叫時直接回傳結果，例如產生 HTML 或保存打卡 |
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
| `src/formatting.js` | HTML 跳脫、景點查找、香港時間及下載位置指引 | `escapeHtml`、`getAttraction`、`formatDateTime`、`getDownloadLocationHint` |
| `src/data.js` | 靜態活動、景點與地理設定 | `TRIP_DATA`、`ATTRACTIONS`、`DEPARTURE_LOCATION`、`CHECK_IN_LOCATIONS` |
| `src/state.js` | 打卡正規化及本機保存 | `loadState`、`saveState`、`normalizeState` |
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

`createAppController` 先取得 DOM 元素，建立保存層，由保存層透過 `loadState(localStorage)` 讀回打卡，再建立各模組及事件處理器。照片讀回後放入保存層的私有 Map，只為目前回憶畫面的相簿封面、分頁縮圖、大圖或選取位置建立 Blob URL，畫面切換後釋放不用的網址。工廠每個 document 只呼叫一次，否則會重複安裝事件。除了入口，功能模組只定義功能，import 本身不會開相機或要求定位。

`start()` 更新連線提示，只註冊一次現有 Service Worker，等待 `refreshPhotos()` 讀 IndexedDB，然後 `render()` 顯示目前路由，再初始化通知狀態。初始化不要求通知權限，只有使用者按下開啟按鈕才要求。相片資料庫不支援或讀取失敗時，網站仍可顯示行程；離線註冊失敗則顯示提示。

## 保存層、頁面快照與操作權限

資料擁有人是 `createDataStore({ storage, onSaveError })`。state 和照片 Map 留在保存層閉包內，不提供整份可修改的引用。控制器負責核對現在是哪個頁面，再把明確的讀取或修改函數交給功能模組。

`createViews()` 不接收共用 getter；`renderAttraction(model)` 等函數只讀傳入資料。`createPageModels` 整理所需欄位，`readonlyCopy` 遞迴複製普通物件及陣列，再凍結每一層，因此修改快照不能修改原紀錄。Blob 內容不可變，但仍不傳入畫面快照。

| 頁面 | 快照欄位 | 允許操作 |
| --- | --- | --- |
| 首頁 | view、trip.title、canInstall、install 模式及指引開關、push 通知狀態 | 安裝、通知訂閱／取消、兩次確認後清除旅程資料 |
| 行程 | view、days、checkIns 核實摘要、allCheckInsComplete | 導航至各站詳情 |
| 景點詳情 | view、當站 attraction、checkIn、照片列表 photos、最新照片 photo 及 allCheckInsComplete | 只操作當站的打卡及相機，後續相片操作在回憶頁 |

行程摘要只含 verified，不包含照片或完整打卡時間。詳情只提供當前景點；首頁不取得個人紀錄，清除全部資料是明確允許的跨功能操作。移除列表頁不會刪除已保存的打卡或相片。

保存層提供以下操作；只有可信任的控制器及必要模組取得它們，頁面快照沒有這些方法：

| 操作 | 輸入及結果 |
| --- | --- |
| `recordCheckIn(id, record)` | 有效且尚未打卡的景點；回 `{ accepted, saved }` |
| `removeCheckIn(id)` | 控制器完成已獲確認的刪除後移除紀錄，回保存是否成功 |
| `clearProgress()` | 先移除指定 localStorage 鍵，再改預設 state；失敗拋錯 |
| `replacePhotos(records)` | 更新私有相片 Map 及各站版本，不寫資料庫 |

打卡回傳 saved，區分永久保存與目前頁面的暫存。寫入失敗由 onSaveError 警告，重開頁面以實際保存的資料為準。

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

`currentRoute()` 讀網址的 hash，例如 `#itinerary` 或 `#attraction/future-school`。一般頁面只接受 home、itinerary、memories；景點 ID 必須存在於六站 `CHECK_IN_LOCATIONS`，包括 `departure-school`；每站只可在自己的詳情操作打卡及相片。舊的 `#attractions` 連結及不存在的景點顯示行程頁，其餘未知頁面回首頁。舊連結的 hash 不會改寫，讓已發出的通知及書籤繼續有效。

| 網址片段 | 畫面結果 | 注意事項 |
| --- | --- | --- |
| 無 hash、`#home` | 首頁 | 包含清除資料入口 |
| `#itinerary` | 三日行程 | 路線文字會嘗試與景點名稱配對，建立詳情連結 |
| `#attractions` | 三日行程 | 相容舊書籤及通知連結，不生成景點護照 |
| `#attraction/future-school` | 對應景點詳情 | ID 由資料檔白名單核對 |
| `#attraction/不存在的ID` | 三日行程 | 不產生不存在景點的詳情 |
| `#prepare` | 首頁 | 舊連結相容，不生成已移除的準備頁 |
| `#info` 或其他未知名稱 | 首頁 | 顯示首頁，但不改寫 hash |

`render()` 先同步路由生命週期，取得專用頁面 model，再呼叫對應的畫面函數，把回傳字串放進 `app.innerHTML`，並更新底部導航的 `aria-current`。畫面模組只讀資料與建立字串，不寫 DOM、不保存、不要求相機或 GPS。首頁顯示旅程介紹及本機私隱提示；收到原生安裝事件時顯示安裝按鈕，iPhone／iPad 沒有事件時改提供安裝方法，從主畫面啟動則隱藏入口；行程可從底部導航進入，景點詳情從行程連結進入。清除所有本機資料的入口位於首頁。

切換實際頁面或景點時，先更新頁面代數，停止相機、關閉拍攝及確認 dialog、取消相簿請求並釋放照片預覽，再重畫、移動主內容焦點和捲回頂部。同頁重畫不更新頁面代數。勾選相片等同頁重畫則根據 input 的 data 屬性找回新的對應元素，避免鍵盤焦點消失。

文字跳脫由 `escapeHtml` 把 `& < > " '` 換成 HTML entity。例如提醒 `<script>test</script>` 會作為文字顯示，而非插入真正 script。照片尺寸等由本機資料庫讀回的動態文字亦跳脫。靜態連結及圖像設定來自受控資料檔；若日後允許使用者輸入 URL，需要另外驗證 URL，不能只靠文字跳脫。

`photoPanel(model)` 未打卡顯示鎖定提示；已打卡時顯示相片數、拍攝按鈕及回憶頁入口，不顯示相片列表或下載表單。畫面上的「鎖定」只是功能條件，不是密碼鎖或加密。

行程使用 `checkInBadge()` 顯示各站打卡摘要。準備頁的 render 函數和進度環已移除。

`formatting.js` 的 `getAttraction(id)` 回傳資料陣列中對應的物件，找不到為 undefined；`formatDateTime(iso)` 顯示香港時區的月、日、時、分；`escapeHtml(value)` 先轉字串再跳脫。日期函數假設輸入有效日期，不能拿它替代 `normalizeState` 的驗證。

樣式集中在 `styles.css`：`.hero-section` 是首頁介紹、`.itinerary-list` 和 `.day-panel` 是行程、`.bottom-nav` 是底部導航。響應式排版由 media query 控制，`[hidden]` 強制隱藏元素，焦點及減少動畫規則也在此檔。畫面 class 和 CSS 必須一起核對；不要為了刪一處卡片而移除其他頁面仍共用的樣式。

## 靜態資料與個人紀錄

這裡要分清三種資料：資料檔中的景點介紹、使用者的打卡、使用者的照片。三者保存位置和生命週期不同。

### 靜態資料：`src/data.js`

| 物件 | 主要欄位／用途 | 修改後影響 |
| --- | --- | --- |
| `TRIP_DATA` | `title`、`shortTitle`、日期欄位、`duration`、三日 `itinerary` | 旅程介紹、行程及旅程卡標題 |
| `ATTRACTIONS` | 原有五個景點的完整導覽及地理資料 | 原有景點資料保持原順序 |
| `DEPARTURE_LOCATION` | 學校出發站的導覽、地址、地圖及 WGS84 設定 | 學校共用詳情頁 |
| `CHECK_IN_LOCATIONS` | 學校加原有五景點的六站資料 | 詳情路由、打卡與相片白名單、定位及旅程卡 |
| `REQUIRED_CHECK_IN_LOCATIONS` | 原有五個必需景點，不包括學校 | 完成判斷、合成卡必需選取及補拍提示 |

目前活動資料仍保留 `startAt`、`endAt`、`dateLabel`、`duration` 等欄位，但執行模組沒有再用它們計算倒數；保留欄位不代表倒數功能仍存在。須知專用的 `cities`、`participants`、`leaders`、`notices` 已移除。

`Object.freeze()` 防止頂層屬性被直接換掉，但不會遞迴凍結巢狀物件與陣列。不要把它當成整份資料無法被修改的保證。

圖片網址由 `new URL("../public/images/attractions/...", import.meta.url).href` 解析。它相對於資料模組的位置，所以在 GitHub Pages 的 repository 子目錄也能找到圖片。

### 打卡：localStorage

沿用儲存鍵 `outdoorLearningDay.v3`，預設 state 只有 version、checkIns 及 updatedAt：

```javascript
{
  version: 3,
  checkIns: {},
  updatedAt: "1970-01-01T00:00:00.000Z"
}
```

`loadState(storage)` 讀指定鍵、解析 JSON，再由 `normalizeState(raw)` 只保留有效打卡及時間。舊 checklist 和 customItems 不再進入記憶體；載入時不改寫原 JSON，下次 `saveState` 才寫回現行欄位。儲存鍵不變，既有打卡能繼續讀取，也不影響 IndexedDB 相片。

打卡必須使用已知景點 ID、有效時間、gps 或 manual 方式，verified 須與方式一致。額外欄位及原始 GPS 不保存。`saveState` 更新時間及正規化後寫入；寫入失敗向外拋錯。`createDefaultState` 每次回傳新的空打卡紀錄。

### 相片：IndexedDB 與頁面記憶體

| 位置／名稱 | 內容 | 重開頁面後 |
| --- | --- | --- |
| IndexedDB：`outdoorLearningDay.photos`，版本 2，store `photoEntries` | 每張一筆 PhotoRecord，以 `photoId` 作 key，`attractionId` 索引分組 | 瀏覽器尚未清理時可讀回 |
| 保存層私有 photos Map | 本次載入的不可修改 PhotoRecord | 重新查資料庫建立，不傳入畫面 |
| 控制器 preview | 當前景點的 ID、版本及一個 Blob URL | 詳情需要時建立；離頁或重讀便釋放 |
| 私有 photoVersions | 每個景點的照片版本計數 | 本次 document 的計數，替換或移除時更新 |
| `pendingCapture` | 相機剛拍到、尚未按「使用照片」的 Blob | 不在資料庫，關閉或重拍會釋放引用 |

每筆 PhotoRecord 有 `photoId`、`attractionId`、`blob`、`mime`、`width`、`height`、`createdAt`、`version: 1`，應用操作層再加 `writeId`。日期是 ISO 字串；照片是 Blob，不是放在 JSON 裡的 Base64 字串。

頁面重新整理只會失去記憶體內的 Map 和暫存照片，不等於清除已保存資料。反過來，關閉網頁也不是備份；瀏覽器清理、裝置故障或更換 origin 都可能令資料不可讀。

## 點擊與相片選取

控制器使用事件委派：在 document 安裝一次 click 監聽器，用 `event.target.closest("button, a")` 找按鈕，再根據 `data-checkin`、`data-camera-open` 等屬性呼叫對應模組。重畫會換掉按鈕，但 document 的監聽器仍在，不用逐一重新綁定。操作前核對控制項仍在目前主內容中，並檢查頁面及景點 ID；相機控制項另核對當站及 dialog 狀態。已移除的舊按鈕不能沿用。

| HTML 屬性／事件 | 處理函數 | 效果 |
| --- | --- | --- |
| `data-checkin` | `startCheckIn` | 請求一次位置或提供手動確認 |
| `data-checkin-undo` | `undoCheckIn` | 確認後取消打卡及相關照片 |
| `data-camera-open`、`data-native-camera-open` | `openCamera`、`openNativeCamera` | 開啟網頁相機或手機拍攝介面 |
| `data-camera-capture`、`data-camera-retake`、`data-camera-save` | 相機對應操作 | 快門、重拍、使用照片 |
| `data-camera-close`、dialog `close` | `stopCamera` | 停止串流及移除暫存預覽 |
| `data-photo-export-selected`、`data-card-download` | `preparePhotoExport`、`downloadTravelCard` | 匯出已選相片或確認後生成旅程卡 |
| `data-reset-all` | `resetAllData` | 首頁的兩次確認清除流程 |
| `native-camera-input` 的 `change` | `processPhoto` | 核對手機拍攝請求及 token 後保存相片 |
| `install-button` | 控制器安裝處理器 | 原生模式即時呼叫安裝提示並只消耗一次事件；iOS 模式展開／收起 Safari 手動安裝步驟 |

`beforeinstallprompt` 只在瀏覽器有提供時保存事件並顯示原生安裝按鈕。iPhone／iPad 沒有此事件時提供手動指引；不是呼叫系統分享或自動安裝。`appinstalled`、`navigator.standalone` 及 `display-mode: standalone` 都會隱藏安裝入口。

相片 checkbox 透過 `data-photo-select` 修改控制器記憶體內的選取集合；先核對當前景點及 photoId，離頁清除，不寫進旅程紀錄。

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
2. 在共用 `decodeImage` 入口先走訪靜態 JPEG／PNG／WebP 的完整有界結構，核對來源寬高不超過 8192px、總像素不超過 5000 萬。拒絕不能核對、多影像、動畫或矛盾尺寸；HEIC／HEIF 暫不直接匯入，提示先轉 JPEG。通過後才用 `createImageBitmap` 解碼及方向處理，不支援時改用 Image。
3. 計算 `scale = Math.min(1, 1600 / Math.max(width, height))`。例如 4000×3000 會變成 1600×1200，小圖不放大。
4. 在新 Canvas 重畫像素，再要求約 0.82 品質的 WebP。瀏覽器若實際回傳 PNG，保存真實 MIME；拒絕未知輸出。
5. 回傳 `PhotoRecord`，不是原檔。Canvas 重新編碼不帶原始 EXIF、相機型號與 GPS 中繼資料，但畫面中的人樣仍在。

20 MiB 是輸入檔案大小上限，不能代替來源像素上限。解碼前先核對來源尺寸，解碼後仍核對實際尺寸；這能拒絕特製大尺寸輸入，不能保證所有裝置不會缺記憶體或修復瀏覽器解碼器本身的漏洞。檔頭一致亦不保證完整檔案有效，仍須成功解碼。透明圖片會先在不透明 Canvas 鋪上米白背景，再畫像素。

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

| 結果 | 照片 | 打卡 | 畫面處理 |
| --- | --- | --- | --- |
| 任一次確認取消 | 不清除 | 不清除 | 結束流程 |
| 相片資料庫清空失敗 | 不能確認全部已清除 | 不移除 localStorage | 解除重設鎖、重讀、警告 |
| 相片清空成功，localStorage 刪除失敗 | 已清空 | 原紀錄仍保留 | 解除重設鎖、重讀、說明部分完成 |
| 全部成功 | 清空 photos store | 移除指定鍵，記憶體改為預設 | 重畫目前頁面、顯示成功 |

這個按鈕只處理本 App 的旅程紀錄，不清除 Service Worker 靜態快取、整個 origin 的其他資料、裝置相簿或已下載旅程卡。成功後仍可以離線開網站。

`feedback.js` 的確認以 Promise 排隊，上一個 dialog 關閉後下一個才出現。每個要求各自取得回覆，不會讓一個「確認」同時批准多個動作。標題與訊息用 textContent 放入 DOM。

`askConfirmation(options)` 回傳 Promise<boolean>，只有確認才為 true；支援時用 dialog，否則用 window.confirm。離頁呼叫 cancelConfirmations()，關閉已顯示的 dialog，讓排隊舊要求失效，並移除舊提示和印章。原生 confirm 無法由 App 強制關閉，但回覆仍須通過 token 核對。`isRelevant` 可在輪到該要求時略過已過期的確認。`showToast(message, tone, durationMs = 4200)` 預設顯示約 4.2 秒後淡出；旅程卡的下載檔名及位置指引保留 15 秒供閱讀。`celebrateStamp(attraction)` 顯示短暫印章。提示不是永久保存的操作日誌。

提示的顯示計時器和 220 毫秒淡出計時器分開管理；出現新提示或離頁時會一併取消，避免舊提示隱藏新提示。`tests/feedback.test.mjs` 核對完整顯示時間，`tests/browser/feedback.html` 以實際 DOM、計時器及樣式驗證可見性。離線瀏覽器測試從目前啟用的應用快取讀取資產，不寫死版本名稱。

## 旅程卡生成

`downloadTravelCard` 先讀目前照片、景點與打卡，取得 token，再顯示私隱確認。確認後重新核對資料 token、頁面 token 和照片版本，才交給 createTravelCard。卡片的 Canvas 固定 1080×1350；照片按比例中心裁切填滿相框，不拉伸，然後畫嶺南風格裝飾、景點、日期時間及核實標記。

日期用香港時區格式，不依裝置目前時區。輸出是 PNG Blob；核對操作和照片仍有效後，才建立暫時的 a download 連結供本機下載，約一秒後釋放 URL。程式觸發連結點擊就顯示「下載已開始」，沒有取得作業系統確認檔案已落盤的回覆。單張卡片不加學生姓名、班別或座標；多站 AI 素材包依最新使用者要求例外使用必填姓名、班別、學號，只放入本機指令文字。照片、景點與到訪時間仍可能透露身份。已下載、分享或備份的檔案不受 App 的清除功能控制。

## 離線與發布

Service Worker 只處理同源、應用範圍內的 GET。安裝會重新取得精確白名單內的靜態資產，包括全部執行模組、插畫及圖示。啟用新版本時移除本 App 舊版本快取，並接管頁面。

導航優先網絡，fetch 拋錯時回離線首頁；HTTP 404 仍是已收到回應，不會自動改成首頁。只用成功的應用 HTML 更新離線 index，不把 404 或別的文件當首頁。其他資產先快取再網絡，只允許精確白名單 URL，不緩存任意 GET 或帶 query 的內容。

照片與打卡不放入 Service Worker 快取；它們由 IndexedDB 及 localStorage 自行保存。離線拍照、壓縮與卡片生成仍在本機執行，但第一次需要先在線完整載入；離線不是跨裝置備份，瀏覽器亦可能清理儲存。

新增執行模組必須同時加入 `APP_SHELL` 與 `build-pages.mjs` 白名單，並提高快取版本。目前版本為 v47，發布包包含 35 個檔案，另有根路徑離線預載項。說明、測試、伺服器、通告和個人資料不在網站發布包內；GitHub repository 若公開，其提交的源碼與文件仍可被查看。

`skipWaiting()` 和 `clients.claim()` 使新 worker 接管請求，但不會自動重新執行已開啟頁面的 JavaScript；更新後仍可能需要重新整理。頂部「已連線」只依 `navigator.onLine`，沒有測試遠端網站是否真的可達。

hash 路由與相對路徑支援 Pages 子目錄。Service Worker 註冊從 `controller.js` 用 `new URL("../sw.js", import.meta.url)` 解析，仍指向專案根目錄；若日後移動該模組，必須調整此路徑。

`buildPages(destination)` 回傳實際複製的相對路徑陣列。預設目錄是 `_site`；目錄已有任何檔案便拒絕建置，不會先刪舊檔。`public` 遞迴收集 PNG、WebP、SVG，拒絕符號連結及其他格式；執行用 JS 則逐一列出，不會自動發布整個 `src`。

GitHub workflow 使用 Node 22，先 `npm test` 再 `npm run build`。pull request 只做檢查，其他事件也只有預設分支才上傳 Pages 產物和部署。推送成功不等於網站已部署成功，仍須看 Actions 結果及 repository 的 Pages 設定。

## 安全防線與限制

HTML 的 meta CSP 拒絕內嵌程式、eval、表單網絡提交及外部資產；未設定推送後台時拒絕所有資料連線，設定後只允許推送後台的精確 origin，允許必要同源模組和本機 Blob；文字跳脫、URL 白名單及照片解碼仍須各自保留。文件 CSP 不等於限制 worker 自身所有網絡能力；worker 仍依精確靜態白名單運作。

推送後台只存裝置訂閱與公開公告，App 沒有集中存放學生照片或位置；但本機資料沒有由 App 額外加密，裝置及瀏覽器存取權仍很重要。同一 origin 的不同子目錄不構成不同安全租戶。移除 EXIF 不會移除照片像素中的人樣。

本機伺服器只監聽 127.0.0.1，設置安全標頭和路徑邊界；GitHub Pages 不執行這個伺服器，其標頭不會自動套用。相機、GPS 與 Service Worker 正式使用需要 HTTPS。

`server.mjs` 是開發工具，會按專案根目錄提供檔案，沒有登入或發布資產白名單。`build-pages.mjs` 的 35 檔白名單只限制建置產物，沒有反過來限制本機伺服器。部署時使用 `_site`，不要直接把整份 repository 當作公開靜態目錄。

## 如何修改功能

改景點文字或行程：先找 `data.js`，保留可靠來源，不重新加入已移除的費用、名額、班別或教職員姓名。若新增景點，需要補地理設定、圖片、資料完整度測試及離線／建置白名單。

改頁面內容：找 `views.js` 對應 render 函數，外觀則改 `styles.css`。動態文字繼續使用 escapeHtml；不要把 inline script、事件屬性或 inline style 加入模板。

改打卡範圍：半徑在 `data.js`，判定規則在 `geo.js`，權限與確認流程在 `check-in.js`。三者分開，不需要去相機模組找 GPS 邏輯。新增邊界及明確太遠測試。

改拍攝操作：找 `camera.js`；改檔案驗證、尺寸或卡片構圖：找 `photos.js`；改刪相與下載條件：找 `photo-actions.js`。任何 await 前後可能被取消的操作都要考慮 token，而不只是成功路徑。

新增按鈕功能：畫面放 data 屬性，控制器事件委派核對頁面及景點權限，再呼叫對應模組；需要新畫面資料時修改 page-models 的專用快照，不回傳整份 state。功能模組以明確依賴建立，不反向 import 控制器，不把全部邏輯搬回入口。

### 例一：移動清除資料入口

在目標 render 函數加入以下 HTML，並從原頁 render 移除原入口：

```html
<button class="button button-danger" data-reset-all>清除所有本機資料</button>
```

控制器已監聽 `data-reset-all`，不需要另寫第二份刪除流程。但目前只允許首頁執行重設：日後若搬到另一頁，必須同步修改控制器的頁面權限及測試，不能只搬 HTML。保存位置及兩次確認不需改動。這次已搬到 `renderHome(model)`；回歸測試會檢查首頁有入口、行程頁沒有入口。

### 例二：新增或刪除頁面

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
| HEIC／HEIF 不能加入 | 安全匯入限制 | 為避免無法核對的分塊／碼流尺寸，先在手機轉成 JPEG 再加入 |
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
| `device-test-controller.js` | 真實功能接線、測試打卡完成預覽、GPS／相片各自 token、當頁生命週期、兩次確認重設 |
| `device-test-views.js` | 只讀不可修改快照；不接收 Blob 或操作儲存 |

`check-in.js` 和 `camera.js` 增加可選的 `lookupAttraction` 與診斷 callback，預設仍使用正式景點。GPS callback 只回傳距離、精確度或錯誤原因，相機 callback 只回傳開啟結果，不把位置或串流傳入畫面。

`photos.js` 的 `createPhotoRepository({ databaseName })` 令每個 repository 固定自己的資料庫名稱。原有 exports 使用 `outdoorLearningDay.photos`、版本 2、`photoEntries` store；測試頁使用 `outdoorLearningDay.deviceTest.photos`，格式相同。`compressPhoto` 仍是正式功能的同一實作。測試相機毋須先打卡，不會因此建立假打卡；相片保存與定位操作使用不同失效 token。

重設只清除測試資料，等待相片工作，須兩次確認。正式 App 的清除功能不會清除這裡的測試資料；清除測試相片失敗時保留測試打卡，清除進度失敗時回報部分完成。這仍不是安全隔離或加密：兩個頁面共用網站 origin，其他同源程式可存取相同瀏覽器儲存。

離頁使 GPS、相簿與壓縮回覆失效，停止相機、釋放預覽、關閉確認。相片寫入前再核對 token；已開始的交易在單純離頁後保留相片，重設則等待並清理過期工作。返回 BFCache 時重新讀取照片。畫面中的 GPS／相機診斷只存在當頁，不保存原始座標。

### 手機現場操作

1. 手機用 Safari 或 Chrome 開啟部署後的 HTTPS `device-test.html`。手機上的 localhost 指手機本身，不能當成電腦的本機網址；一般 HTTP 區域網絡 IP 亦不能可靠使用相機及 GPS。新增頁面未推送時，GitHub Pages 不會有這個更新。
2. 到東院道 11 號附近，按「測試 GPS 打卡」，允許位置權限。查看距離、誤差與「GPS 已核實」；在其他地方或室內不保證成功。手動記錄只測試替代流程，不能證明 GPS 成功。
3. 按「測試相機」，允許相機，拍照、重拍、使用照片。相片保存後顯示讀回的預覽、尺寸及格式。從相簿保存成功不等於即時相機成功。
4. 重新載入測試頁，確認測試打卡及相片仍存在；關閉相機／返回首頁，確認系統相機使用指示停止。
5. 按「清除測試打卡與相片」，確認兩次；回正式 App 檢查景點打卡及相片不受影響。

發布及離線白名單包含此 HTML 與五個 JS 模組，共 35 個網站資產，目前快取版本 v47。Service Worker 離線導覽測試頁時取回自己的 HTML；它不覆蓋正式離線首頁。`tests/` 自動驗證頁仍不在發布包內。

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

## 24. 多張紀念相片（2026-10-06）

每次拍攝新增獨立相片，不再覆蓋同站舊相片。相簿輸入有 `multiple`，控制器先複製完整 FileList 再清空輸入，逐張驗證及壓縮，避免同時解碼大量相片。個別失敗不移除其他已儲存相片；換頁、刪相或清除資料後，未完成的工作受既有 token 控制。

IndexedDB 版本 2 建立 `photoEntries`，以 `photoId` 為主鍵、`attractionId` 為索引。在同一升級交易中把舊 `photos` 每站一張相片搬入，再刪除舊 store；交易失敗時整個升級回復，保留舊資料。清單及打卡儲存鍵不變。舊相片用景點 ID 作 photoId，新相片用獨立 writeId 作 photoId。

保存層提供 `getPhotos(attractionId)` 及 `getPhoto(attractionId, photoId)`，詳情快照只含當站各相片的 ID、預覽網址及尺寸，不含 Blob。`photo` 保留為最新相片的相容欄位。控制器管理多個 Blob URL，刷新、離頁及清除時全部釋放。

每張相片的刪除／下載按鈕帶 `data-photo-id`。刪除指定 ID 只影響該相片；取消打卡不提供 photoId，因此刪除該站全部相片；清除全部資料清空整個相片 store。旅程卡使用選定的相片並沿用私隱確認與版本核對。

相片數量沒有固定上限，但仍受裝置及瀏覽器儲存容量限制；每個輸入檔案仍限制 20 MiB，最長邊 1600px，不上傳相片。正式頁及裝置測試頁都累積多張相片，相簿可一次多選；測試資料仍使用獨立資料庫。瀏覽器整合驗證入口為 `tests/browser/multi-photo.html` 及 `tests/browser/device-photo.html`；真機權限與原生相機仍需另外實測。

## 25. 手機相片匯出（2026-10-06）

App 內相片儲存與手機相簿是兩個位置。網頁不能保證直接存入相簿；它只能在使用者按鈕後交出圖片給手機分享選單，或開始下載。使用者自行選擇儲存位置。相簿儲存選項及下載資料夾由裝置、瀏覽器及系統決定，安裝 PWA 亦不等於取得原生相簿寫入能力。

### 操作及程式分工

逐張可按「儲存到手機」。多張可勾選相片或按「選取全部」，再按「匯出已選相片」；未選取時匯出按鈕停用。「取消選取」清空選取。控制器使用 Set 保存當頁的 photoId，詳情 model 只增加每張的 `selected` 布林欄位，沒有提供 Blob、File 或可修改 Set。離頁時清空；刪照後剔除不存在的 ID。

`createPhotoExport(record, filename)` 是相片服務新增介面，回傳 Promise<File>。輸入是已保存 PhotoRecord；核對 Blob 格式後解碼，以 Canvas 重繪所有像素，輸出品質 0.92 的 JPEG File。尺寸沿用已保存像素，不放大；拒絕無效或大於 1600px 的已保存尺寸，核對實際輸出 MIME。解碼物件在 finally 釋放。輸出沒有旅程卡文字，沒有複製原檔、EXIF 或 GPS。檔名包含景點、當次序號及獨立相片 ID，移除不適用於檔名的字元。

相片操作模組負責 `preparePhotoExport(attractionId, photoIds)`、`sharePhotoExport()`、`downloadPhotoExport(index)`、`cancelPhotoExport()` 與 `validatePhotoExport()`。它保留 File 的私有引用，只提供 `getPhotoExportModel()` 的文字、數量、狀態、分享能力與檔名/index 快照。控制器用該 model 呼叫純畫面函數 `renderPhotoExport`，更新有標題、原生取消及鍵盤焦點的 dialog。

準備狀態依次為 preparing → ready → sharing → ready；轉換錯誤則為 error。逐張轉換可避免同時解碼大量圖片，但整組已準備的 JPEG 仍佔用記憶體，沒有無限容量保證。任一張失敗即清空整組 File，提示第幾張失敗；關閉視窗後重新選取，不能悄悄下載部分照片。

### 分享、下載及取消

準備完成後，使用者再按「開啟手機分享選單」。按鈕操作同步檢查 `navigator.canShare({files})` 並立即呼叫 `navigator.share({files})`，中途不 await，保留這次點擊的 transient user activation。分享前已完成 JPEG 轉換；沒有以原有確認 Promise 延後分享。視窗中的私隱說明讓使用者在最終按鈕前確認內容，分享目標由使用者自行選擇。

sharing 期間停用分享與下載，避免重複交出同組檔案。AbortError 提示取消，其他錯誤提示重試或下載；均保留準備結果，不自動下載，不刪 App 副本。share Promise 完成只表示系統已處理請求，不能確認使用者選了哪個目標或已存入相簿，因此提示使用者自行確認。

不支援檔案分享時，每個 File 有獨立下載按鈕。每次點擊只建立一個 Blob URL 及 download 連結；10 秒後釋放網址，關閉或失效時亦釋放。下載開始不代表相簿儲存成功。App 刪照、取消打卡及清除資料提示已更新：這些操作只刪 App 內副本，不能刪除已匯出、下載或分享的檔案。

準備及最終分享／下載都核對頁面 token、景點操作 token、打卡、相片版本及各張 writeId。關閉、原生取消、離頁、pagehide、刪照、取消打卡、重設及讀回相片版本變更時，清空準備結果，過期 Promise 不恢復視窗。同源其他分頁的變更仍不具即時跨分頁鎖保證；沿用現有頁面內取消模型。已交給系統的檔案不能撤回。

### 自動驗證與真機驗收

117 項 Node 測試通過，包括新增 10 項匯出案例。瀏覽器 fixture 由正式 index.html 的控制項生成，`tests/browser/photo-export.html` 在手機 390×844、平板 768×1024、桌面 1280×900 各 8 項通過，涵蓋選取、純 JPEG 的檔頭與尺寸、實際下載及重新解碼、真實最終點擊的 user activation、分享成功／取消／錯誤、部分轉換失敗、原生關閉、離頁及準備中刪照。測試使用獨立資料庫、記憶體進度及合成影像；分享 API 是模擬，沒有分享個人檔案到其他 App。

真機狀態：iPhone Safari、Android Chrome 及兩者已安裝 PWA 均尚未驗證。驗收時使用非敏感測試照，逐張及多選匯出；確認系統選單是否提供相簿儲存目標及實際儲存位置，取消後沒有新增副本，成功後 JPEG 的方向及尺寸正確，下載後備能從檔案移至相簿，App 原照保留，清除 App 不影響已匯出檔。檢查系統返回、背景切換、離線使用及多張分享容量限制，記錄手機、作業系統及瀏覽器版本。未完成這些步驟前，不聲稱已完成手機相簿真機驗證。

原有多相片 8 項、資料隔離 9 項、照片／CSP 11 項、裝置頁 16 項回歸驗證通過。原有資料隔離測試將待驗證的預覽切至 eager 並 decode，避免新增選取列後，畫面外的 lazy 圖片尚未載入而造成測試誤判。正式頁在獨立瀏覽器 origin 以 v29 快取離線重載，再讀回 IndexedDB 相片、製作 JPEG 及下載亦通過。

IndexedDB 維持版本 2，沒有資料遷移。離線快取升至 v29；沒有新增執行模組，發布白名單仍為 33 個資產。此功能的本機實作尚未提交、推送或部署。

## 26. 解碼前的來源像素限制

來源檔案大小、來源像素及儲存後像素是三個不同限制。小型壓縮檔亦可表示極大的圖片；現在每次 `decodeImage` 必須先通過 `validatePhotoInput`，才可進入原生 bitmap 或 Image 後備。來源寬高最多 8192px、總像素最多 5000 萬，可容納普通 8000×6000 相片；輸出最長邊仍為 1600px，不放大。

預檢走訪整個最多 20 MiB 的 JPEG marker／PNG chunk／WebP RIFF 結構，最多 4096 個結構項；核對所有可達尺寸，不只讀首個檔頭。JPEG 保留普通 sequential／progressive 與 EXIF 方向，拒絕不能可靠核對的多影像、DNL／hierarchical 或截斷結構；PNG 與 WebP 拒絕動畫，WebP canvas 與 coded-image 尺寸須一致。解碼後仍檢查實際尺寸，超限時關閉 bitmap，不改用其他解碼器重試。

HEIC／HEIF 的容器宣告不能代表所有分塊及 HEVC 碼流的資源需求。依使用者同意，暫停直接匯入，明確提示先在手機轉 JPEG；不嘗試解碼。手機原生拍攝若回傳 HEIC，亦會得到同一提示；可用 JPEG 或網頁相機。App 已保存的是重新編碼的 WebP／PNG，毋須資料遷移或刪照。

新增 `tests/image-budget.test.mjs` 與 `tests/helpers/image-fixtures.js`。修補前兩項安全觸發測試失敗，確認原生解碼入口可被觸及；修補後所有 125 項 Node 案例通過。瀏覽器安全測試新增真正不足 100KB 的 16384×16384 壓縮 PNG，攔截 bitmap／Image 並確認呼叫數為零；亦測試超長 JPEG、超大 WebP、EXIF 方向與正常 Image 後備。14 項安全、8 項多相片、9 項隔離、16 項裝置及三種視窗尺寸各 8 項匯出測試通過；正式頁 v30 離線讀回及 JPEG 下載通過。建置仍含 33 個白名單資產。

這是來源像素資源控制，不是瀏覽器原生 codec 的安全保證，也不保證所有低記憶體裝置均能匯入上限內圖片；真機相機、分享選單及相簿位置仍未在本次驗證。相片預覽仍以正常重新編碼的已保存 Blob 顯示，同源程式篡改 IndexedDB 不是這次新匯入漏洞的威脅模型。此修補及第 25 節的相片匯出一併發布；推送 main 後由 GitHub Actions 重新測試、建置及部署 GitHub Pages。


## 訊息推送（已部署；Android 測試收訊已確認）

首頁提供自願開啟及關閉手機通知；依使用者要求，已移除「發送一則測試通知給自己」按鈕及控制器的測試通知點擊處理，舊控制項也不再觸發發送。App 不再讀取、保存或顯示公告歷史，亦移除「重新整理公告」按鈕；焦點、可見及重新連線事件只更新通知訂閱狀態。手機系統的通知仍由系統管理，後台原有公告及發送工作保存期限維持不變。網頁關閉後仍能收到訊息，依靠的是瀏覽器的推送服務和既有 Service Worker；普通頁面計時器不能代替這種推送。iPhone 須將 App 加入主畫面，並由使用者按鈕要求通知權限。

`src/push-client.js` 擁有通知訂閱及管理憑證，使用獨立的 `outdoorLearningDay.push.v1` 儲存。向後台登記訂閱前先保存隨機管理憑證，遇到回應遺失時用相同訂閱及憑證重試；取消先停止原生訂閱，再刪後台副本。後台無法連線時保存待清理工作，下一次連線重試。換頁不取消訂閱，清除旅程資料也不會偷偷關閉通知；使用上方關閉通知按鈕另行管理。

`push-backend/` 使用 Cloudflare Worker 與 SQLite Durable Object。後台只保存通知地址、加密金鑰、管理憑證雜湊、公開公告、傳送狀態及防濫用所需的短期限流代碼；絕不能傳送相片、GPS、打卡、清單或學生身份。老師管理憑證只留在管理頁記憶體。通知地址只接受已知推送服務，發送時拒絕重新導向。公開公告使用冪等請求與持久化工作，失敗重試不重發已獲推送服務接受的接收者；服務接受不代表裝置已收到。

`src/push-config.js` 已設定正式 Cloudflare 後台網址，並同步更新 CSP 精確連線來源；移除設定時通知暫不開放。正式服務使用 VAPID 金鑰與老師管理憑證。秘密只能保存在靜態專案目錄以外的私人位置及後台 secret bindings；`.gitignore` 不能阻止本機靜態伺服器讀取專案內的秘密。

建置仍只發布前台 35 個白名單資產，不包含後台、管理頁、秘密、測試或個人紀錄。Service Worker 快取升至 v37，push 和 notificationclick 路徑不會把後台 API 回應放進離線快取。`npm test` 執行前台測試，`npm run test:push` 執行後台測試。後台設定與操作說明見 `push-backend/README.md`。

本機加密、模擬推送與瀏覽器測試不能代替 iPhone Safari／已安裝 PWA、Android Chrome 的真機驗證。真機驗收應逐項記錄實際後台、授權自己的測試裝置、離開 App 後收到通知、點擊進入正確頁面及取消後不再收到的結果。收到通知只證明該裝置的收訊路徑，不能據此聲稱所有平台及操作均已完成真機驗證。

限流代碼是以後台秘密計算的連線 IP HMAC-SHA256，供阻止密集訂閱及刪除要求；不保存原始 IP，但不能描述成匿名身份。計數視操作而設 1 分鐘、5 分鐘、1 小時或 1 日到期時間，最長 24 小時，排程在到期時清除；即使簽署設定失效亦保留清理排程。基礎服務中斷可能延後實際清除，詳細安排見後台 README。使用推送也涉及瀏覽器推送服務及 Cloudflare 的基礎服務處理，不應把通知地址描述成不具識別作用。

本次本機驗證：前台 180 項、後台 18 項自動測試通過。後台以真正 Wrangler 部署 bundle、Workerd、SQLite 及 alarm 驗證加密發送、獨立解密、VAPID 簽署、取消競態及重啟保存；推送供應商由測試替身接收。管理頁通過實際 Wrangler 本機資產載入，Worker 的空秘密 dry-run 建置亦通過。Chrome 使用空白測試儲存、合成影像及模擬通知 API，在 390×844、768×1024、1280×900 驗證通知介面共 27 個場景。老師管理頁另有 8 個真實 DOM 場景，涵蓋預覽、公開確認、回覆遺失後同一識別碼查核及記憶體憑證清除。原有隔離 9 項、照片／CSP 14 項、裝置 16 項均通過；v34 真正離線重載包含新模組，旅程資料沒有遷移。這些通知與供應商均為模擬，不能當作手機收訊證據。

2026-10-07 正式設定後，Cloudflare Worker 已部署。實際 HTTPS 查詢確認公開設定、公鑰與本機金鑰一致、公告清單及管理頁均回應 200；未授權管理要求回應 401、非允許來源回應 403，管理頁尾斜線只轉址一次。老師管理憑證的只讀核對亦通過；沒有由開發代理發送真實公告。正式前台快取為 v35，線上 Chrome 在手機、平板及桌面尺寸正常讀取正式後台，並通過真正離線重載。

同日使用者選擇 Android，按網站自己的測試通知流程操作後回報「收到通知」，確認 Android 裝置實際收訊。這是使用者回報的驗收結果，沒有取得手機型號、系統或 Chrome 版本；iPhone、手機點擊通知及取消訂閱尚未取得真機回報。點擊路由、訂閱取消、老師公告發送及重試已有自動化與本機瀏覽器驗證，不把這些結果描述為全平台真機驗證。

## 老師憑證每 90 天自動更換（已啟用；老師登入待驗證）

依使用者選擇，只更換老師 `ADMIN_TOKEN`，VAPID 保持固定，以保留學生的通知訂閱。`push-backend/admin-rotation/` 是獨立的 Cloudflare Worker，老師經 Access 登入才可領取憑證；指定老師電郵及更新 API 權限只存在網站外私人設定，不加入原始碼或 Git。領取頁保護自己的整個 Worker，不把學生使用的原有推送 Worker 設為需登入。

排程每小時檢查，從首次核對原有憑證並初始化起算 90 天，之後由每次成功更換起算。Durable Object 先保存加密待更新值，再呼叫固定 Secret API；確認推送後台接受新憑證後才提供領取。API 回覆遺失及重啟使用同一待更新值恢復，未完成更換時只提供後台核對仍有效的現有憑證，不提供未生效的候選值；若新值已生效，領取時亦可完成狀態核對。領取回應不快取，頁面不寫入 localStorage、sessionStorage 或網址，離頁及 10 分鐘後清除顯示；原有本機私人檔案及老師自行複製的剪貼簿不會跟着更新。

2026-10-07 已核對正式 Access 登入重導向與私人 audience 一致，並確認 Cloudflare API Token 有效及能以原值更新目標 `ADMIN_TOKEN`。私人設定已上傳至獨立服務，正式部署設定為 `ROTATION_ENABLED=true`。領取頁為 `https://bwflc-school-tour-admin-key.bwflc-school-tour-lok274.workers.dev/`；未登入及偽造身份標頭的要求均被 Access 重導向至登入頁。原有老師憑證的正式讀取核對仍通過，公開 VAPID 公鑰不變。Token 無權讀取自身政策，故未驗證其完整授權範圍，不能聲稱只限單一 Worker；Access 政策的完整白名單和獲准老師的正式登入／領取仍須實際確認，部署不代表已完成這些驗證。

啟用設定後完整後台 32 項及網站 180 項自動測試通過，乾淨建置輸出 35 個批准資產；後台包含 14 項新增更換／領取及私人設定案例。真正 Wrangler bundle、Workerd 與 SQLite 驗證 Access context、跨來源拒絕及重啟保存。獨立 Chrome 在 390、768、1280px 通過領取頁、遮蔽、顯示清除、到期、失敗及離頁後晚到回覆；剪貼簿由模擬介面截取，沒有寫入系統剪貼簿或使用正式憑證。這些結果不代表已驗證正式 Access 登入。設定、權限及復原限制見 `push-backend/admin-rotation/README.md`。


## 多張測試相片與手機匯出（2026-10-08）

正式頁已有多照流程；裝置測試頁改為從獨立測試資料庫讀回所有當站相片，以新的 photoId 追加保存，保留舊照。兩頁相簿輸入皆帶 multiple，不帶 capture；手機拍攝可重複新增。每次多選逐張壓縮，不同時解碼整組，離頁或清除後停止尚未保存的相片；已成功保存的其他相片不會因一張失敗而被刪除。來源格式、解碼前尺寸檢查、1600px 輸出及 HEIC／HEIF 拒絕規則不變。

測試頁維持相機毋須 GPS 打卡，不建立假打卡。相片 model 只含 ID、預覽網址、尺寸、格式及選取布林值，不含 Blob。匯出重用 photo-actions.js 及 views.js 的現有流程，以 lookupAttraction 注入測試位置名稱，並以頁面 token、相片版本與 photoId／writeId 核對有效性。全選、取消、逐張及多選都只處理測試頁的相片；JPEG 為已保存像素的 92% 重繪，毋須遷移 IndexedDB。最終分享按鈕同步呼叫 share；分享取消不下載，失敗可重試，沒有檔案分享時逐張下載。

離頁、刪相及清除取消匯出並釋放預覽和下載網址；選取及 JPEG 準備結果只在記憶體。刪除及清除提示說明已匯出的檔案不會被刪除。匯出視窗內層寬度跟隨 dialog，避免手機直向的橫向捲動。離線快取為 v38，發布白名單仍有 35 個資產，新增的測試 fixture 不公開發布。新增 Node 驗證在 tests/device-photo.test.mjs；瀏覽器合成資料驗證在 tests/browser/device-photo.html，原有裝置相機整合 fixture 保持與正式控制項同步。Android／iPhone 真實相機、相簿多選及實際儲存位置仍需使用者真機測試。

本次驗證：189 項 Node 測試全部通過，瀏覽器整合共 40 項通過（測試頁多照／匯出 8、測試相機 16、正式匯出 8、正式多照 8）。實際下載 JPEG 的檔頭及 640×480 像素已核對；最終分享的真正按鈕點擊保留 user activation。匯出視窗在 390、768、1280px 無橫向溢出，鍵盤 Enter 可啟動準備。乾淨建置成功輸出 35 個資產。分享目標為模擬，這些結果不代表已存入手機相簿。
停止本機伺服器後，實際 device-test.html 仍可由 v38 快取載入，新的多選相簿控制項正常顯示；這是資產離線後備驗證，沒有要求真實 GPS 或相機權限。


## 單一多選儲存按鈕（2026-10-08）

依最新要求，正式景點頁及裝置測試頁各只提供一個「儲存到手機」按鈕。可勾選一張或多張，也可全選或取消選取；沒有選取時按鈕停用。逐張儲存、逐張刪除、相簿加入按鈕及其事件處理均已移除。

兩頁的 photo-input 已移除，camera.js 不再提供 openGallery；網頁相機不支援或失敗時只提示另按手機拍攝，沒有自動開啟相簿。保留 capture=environment 的 native-camera-input，回覆再核對當頁請求及操作 token。瀏覽器或作業系統仍可能自行顯示檔案選擇器，網站不能保證系統介面只提供拍攝。可重複拍攝追加獨立 photoId，不會覆蓋舊照或改動 IndexedDB 格式。

photo-actions.js 的 removePhoto 及測試頁 deletePhoto 已刪除。repository 的刪除介面仍用於取消打卡、清除資料及過期寫入清理，不能移除，否則這些操作會留下相片。正式頁仍可下載旅程卡；既有相片及打卡保留。

多選匯出沿用 JPEG 92%、逐張準備、最終使用者點擊開系統分享及逐張下載後備。分享取消不下載、不刪照；離頁、取消打卡、資料版本變更及清除會使匯出結果失效。離線快取更新為 v40。瀏覽器整合 fixture 已改用合成的手機拍攝回覆驗證，實際手機相簿儲存仍須真機確認。

本次驗證：190 項 Node 測試通過；瀏覽器整合共 39 項通過（測試多照及匯出 8、正式匯出 8、相機及離線快取 16、正式多照 7）。兩頁在 390px 手機尺寸及正式頁 1280px 桌面尺寸沒有橫向溢出；合成相片的最終分享點擊保留 user activation。乾淨建置包含 35 個白名單資產。發布流程在推送 main 後由 GitHub Actions 執行測試、建置及 GitHub Pages 部署。

## 移除整個準備頁（2026-10-08）

依使用者要求刪除底部準備入口、renderPrepare、頁面 model、內建清單、個人提醒、進度計算／SVG，以及專用 CSS、事件及保存層操作。選單只保留首頁及行程。舊 `#prepare` 使用未知路由的首頁後備，不改寫 hash。推送後台選項及路由白名單也移除 prepare；既有通知如仍帶 prepare，由 Service Worker 開啟首頁。

保留 `outdoorLearningDay.v3` 及相片資料庫版本 2。載入舊 JSON 時忽略清單和提醒，只保留有效打卡；不因載入就寫入或清除儲存。下次保存打卡才移除舊 JSON 中不再使用的欄位。刪除畫面和支援程式碼不會清除既有打卡或相片。

離頁相機、匯出及非同步 token 核對繼續使用。原有測試中的換頁目的地改用仍存在的行程頁，另驗證舊準備網址返回首頁及現有資料保留。離線快取更新至 v41。此版本使用既有發布流程：提交及推送到 main，由 GitHub Actions 執行應用測試、後台測試、Worker bundle 檢查及 GitHub Pages 部署；推送後台另以 Cloudflare Wrangler 發布。

本次驗證：應用 Node 測試 189 項、後台測試 32 項、瀏覽器路由／資料及匯出測試 17 項全部通過；手機 390px、平板 768px、桌面 1280px 沒有橫向溢出，鍵盤選單可用。建置仍為 35 個批准資產。沒有重做真機相機、GPS 或相簿儲存驗證。

另已停止本機伺服器後重新載入 `#prepare`：Service Worker 從 v41 快取載入首頁，仍只顯示兩個選單入口。

### 本次發布與核對

正式 App：<https://lok274.github.io/bwflc_school_tour/>。老師公告管理頁：<https://bwflc-school-tour-push.bwflc-school-tour-lok274.workers.dev/admin>。前後台均移除準備頁選項；現有 ADMIN_TOKEN、VAPID 密鑰、通知訂閱、打卡及相片資料不需重新建立。

發布前已有 221 項 Node 測試、17 項瀏覽器測試及 35 個批准資產的建置結果；另已通過真正 Wrangler dry-run。Pages 工作流程會在推送後重新驗證。發布完成須核對該工作流程的提交 SHA 與成功結果，再比對線上 index.html、執行模組及 v41 Service Worker，確認選單只有首頁與行程、舊 #prepare 開啟首頁。

已安裝的 PWA 或開着的舊分頁可能暫用舊快取；完成更新後關閉並重新開啟 App。如有需要重新整理即可，不需清除瀏覽器資料，避免刪掉本機打卡和相片。

Cloudflare 後台已於本次發布更新，版本 `0d17d394-5086-4cdf-9325-e2c8ae138b9a`。正式 `/v1/config` 回應 200 且 enabled=true；`/admin` 和 `/admin.js` 與本次來源一致，已沒有準備頁選項。核對只讀取公開設定及資產，沒有發送公告。

## 完成所有打卡行程（2026-10-08）

此節記錄上一輪五站修改；最新六站規則及測試見下一節「學校出發站打卡」。

五個正式景點全部有有效打卡紀錄時，行程頁和景點詳情顯示「已完成所有打卡行程」。GPS 和手動打卡都計入；手動紀錄仍標示未核實，提示只代表這部裝置上的個人紀錄，不作校方出席證明。不要求相片、額外權限或老師確認，也不發送通知。

保存層的 `hasCompletedAllCheckIns()` 核對正式景點白名單的每個 ID，而不是計算紀錄總數；未知、無效及裝置測試打卡不計入。頁面 model 只新增不可修改的 `allCheckInsComplete` 布林值，不把其他站的完整紀錄或保存層方法提供給詳情畫面。首頁 model 不變。

行程提示位於標題說明後、三日行程前；詳情提示位於打卡區後、相片區前。使用現有成功配色和 role=status，沒有新增頁面、按鈕、進度環或彈出視窗。完成最後一站後，既有 render 流程會立即更新提示。

取消任何一站或清除資料成功後提示消失；取消確認或刪除失敗時保留原狀。重新打卡後重新計算。已有五站紀錄的使用者重開 App 即可看到提示；沒有另外保存完成旗標，因此不需遷移 localStorage 或 IndexedDB。儲存失敗沿用既有警告，目前頁面可顯示暫存結果，重開後以實際已保存的紀錄為準。

離線快取提高至 v42，發布白名單維持 35 個資產；新增測試 fixture 不公開發布。本功能與學校出發站打卡、測試頁預覽一併經本次使用者授權發布；最新版本及驗證見下文。
### 本次驗證

- `npm test`：205 項應用測試通過；新增 16 項完成狀態測試，涵蓋零站、部分、五站、GPS／手動混合、未知與損壞紀錄、裝置測試隔離、取消確認、刪除／清除失敗、儲存失敗及重開。
- `tests/browser/check-in-completion.html`：8 項瀏覽器整合測試通過；從前四站手動紀錄完成第五站模擬 GPS，確認當前頁立即顯示、兩頁位置正確、未核實標示保留，以及取消／重新打卡／刪除失敗／清除後的提示。
- `tests/browser/isolation.html`：既有 9 項瀏覽器測試通過，涵蓋 Canvas、真實 IndexedDB、多張拍攝回覆、離頁取消、旅程卡、兩次確認清除及 v42 快取。
- 在 390×844、768×1024、1280×900 的瀏覽器視窗檢查完成提示，沒有橫向溢出；鍵盤可切換首頁及行程，景點頁提示不增加焦點停靠點。文字對比約 6.73:1，白色勾號對比約 7.32:1；不只靠顏色表達完成。
- 用獨立 localhost origin 的虛構五站紀錄開啟正式入口，再停止本機伺服器後重新載入，提示仍顯示。離線清除虛構資料並重載後提示消失。頂部連線字樣仍依系統 onLine，不能用來判斷本機伺服器是否可達。
- 乾淨建置輸出仍為 35 個資產；測試、文件及私人資料不進入發布包。此輪只驗證功能；三項打卡修改的發布範圍見下文。

上述是桌面瀏覽器及尺寸模擬驗證，不是 Android／iPhone 真機驗證；GPS 使用測試座標，相機回覆使用生成圖片，沒有要求實際權限或發送手機推送。既有通知的單元測試已通過，實際手機通知行為沒有在本次重新測試。完成提示代表這部裝置的紀錄，不能用作校方出席證明。

## 學校出發站打卡（2026-10-08）

此節記錄首次加入學校打卡的 v43 版本；校名入口、相片及操作範圍已由下文「學校共用景點操作頁」更新。

DAY 1 的第一個路線節點改為「佛教黃鳳翎中學」，校名在新視窗開啟使用者提供的 Google Maps 網址。DAY 1 說明亦改為由學校出發；DAY 3 的香港終點維持原狀，沒有新增時間或集合安排。校方官方頁確認地址為香港銅鑼灣東院道 11 號：https://www.bwflc.edu.hk/index/customIndex.aspx 。

行程頁直接提供學校的「到埗打卡」，完成後變成「取消打卡」，並顯示 GPS 已核實或未核實手動記錄。學校沿用已有的 WGS84 地址點 22.27579、114.19044，半徑 100 米；該點於 2026-10-06 以政府地址查詢服務核對，也是獨立裝置測試點的實際地址。本次只重新核對校名及地址，地址查詢服務未能連接，沒有聲稱重新核對地理點。地圖網址的 @22.2775222,114.1844574 是畫面中心，不用作打卡圓心。GPS 仍只在按下打卡後讀取一次，座標不保存或上傳；權限被拒可確認手動記錄，明確距離過遠不提供手動繞過。

資料中的 `DEPARTURE_LOCATION` 使用獨立正式 ID `departure-school`；`CHECK_IN_LOCATIONS` 是學校加原有五個景點的六站白名單。`ATTRACTIONS` 仍只含原有五景點，照片的可操作範圍不擴大，學校沒有相片流程或新增詳情頁。保存層及正規化只接納六站的有效紀錄；完成狀態逐一核對六個 ID。裝置測試 ID 和儲存鍵仍獨立，不會拿測試打卡當作正式學校打卡。

模型只在 DAY 1 出發節點增加 checkInId 及 mapUrl；行程的打卡摘要仍只含 verified，不提供完整時間或儲存物件。控制器只允許在行程頁操作學校打卡；五個景點仍只可在各自詳情操作。學校打卡使用獨立的頁面／資料 token 判斷，離頁、背景或清除後的過期定位回覆不會寫入。取消學校打卡不刪除五站相片，清除全部資料沿用兩次確認。

依使用者選擇，「已完成所有打卡行程」現在需要學校加五個景點全部完成；GPS 與手動均計算，仍是這部裝置上的個人紀錄。已有五站紀錄及相片保留，補做學校打卡後才顯示完成。儲存鍵仍是 `outdoorLearningDay.v3`，相片資料庫及版本不變，不需遷移或清除舊資料。離線快取提高至 v43，發布白名單仍是 35 個資產。

學校打卡與完成提示、裝置測試預覽一併提交並透過現有 GitHub Pages 流程發布。

### 最新驗證

- `npm test`：217 項通過，包括新增 11 項學校打卡測試，以及更新為六站的 17 項完成狀態測試。涵蓋舊五站資料保留、學校 WGS84 範圍、地圖中心不冒充地址點、GPS／手動／拒絕／距離過遠、離頁及背景回覆、取消、儲存失敗、操作範圍及學校不能拍照或刪其他站相片。
- 完成／學校瀏覽器整合 9 項、既有相機／相片／下載／清除整合 9 項全部通過；以虛構紀錄操作真實 DOM、確認框、Canvas 及 IndexedDB，沒有發送通知或要求真實 GPS／相機權限。
- 在 390×844、768×1024、1280×900 視窗驗證學校校名、徽章及打卡按鈕，沒有橫向溢出。手機按鈕高度至少 44px；鍵盤可導覽，取消後焦點返回新的到埗打卡按鈕。
- 從獨立 localhost origin 開啟正式入口，六站虛構紀錄重開後仍顯示完成；停止本機伺服器後仍可由 v43 快取重新載入。離線取消學校打卡後完成提示立即消失、按鈕恢復到埗打卡。
- 乾淨建置為 35 個發布資產，語法及 diff 空白檢查通過；此輪只驗證功能；最新發布範圍見下文。

手機與平板是桌面瀏覽器的尺寸模擬，並非真機。學校的實際 GPS 精確度和現場打卡位置仍需在手機確認；此個人紀錄不作校方出席證明。

## 裝置測試頁完成提示預覽（2026-10-08）

依使用者選擇，完成獨立測試點的 GPS 或經確認的手動打卡後，測試頁立即顯示「已完成所有打卡行程」。提示放在實際打卡區內，下方清楚標明「測試預覽：只代表此測試點打卡完成，不代表正式六站行程已完成。」手動記錄保留未核實標示；測試相機保存相片不會建立打卡或觸發完成提示。沒有增加頁面、按鈕或通知。

控制器從已正規化的測試打卡紀錄即時計算 allCheckInsComplete，快照只增加布林值，不讀取正式旅程的完成狀態。views.js 的純函式 renderCheckInCompletion 共用正式提示的文字、成功配色和 role=status／aria-live=polite；測試說明由 device-test-views.js 加上。正式六站規則保持不變，獨立測試點不能補足正式打卡。

有效測試紀錄重開後仍顯示預覽；無效、損壞或錯誤 ID 的紀錄不計入。取消手動確認而沒有舊紀錄時不顯示；已有有效紀錄時，定位失敗或取消重試會保留原來的提示。取消任一清除確認、清除相片失敗或未能移除測試儲存鍵時保留打卡及提示；兩次確認成功清除後立即消失，重開亦不再顯示。保存失敗沿用既有警告：目前頁面可顯示記憶體內的暫存預覽，重新開啟後以實際已保存的有效紀錄為準。

沿用 outdoorLearningDay.deviceTest.v1、正式 outdoorLearningDay.v3 及原有相片資料庫，不保存完成旗標、不需遷移。離線快取提高至 v44；發布白名單仍是 35 個資產。本次依使用者授權提交、推送及發布。

### 最新驗證

- npm test：225 項應用測試全部通過。新增 tests/device-completion-preview.test.mjs 的 8 項案例，涵蓋正式六站與測試隔離、GPS、手動及取消、範圍外、有效與損壞紀錄重開、清除取消／失敗／成功及保存失敗。
- tests/browser/device-lab.integration.html：16 項通過，已加入完成提示、測試說明、輔助閱讀狀態、手動未核實、取消清除和成功清除的核對；正式紀錄與相片哨兵保留。相機使用合成 Canvas 串流、真實 DOM、IndexedDB 及原生對話框。
- tests/browser/check-in-completion.html：9 項正式六站回歸測試通過，共用提示函式沒有影響正式規則、位置或清除流程。
- 在空白獨立 localhost origin 使用 device-lab.integration.html?preview=1 建立單一合成測試紀錄，再開啟實際 device-test.html，確認重新載入保留提示；停止伺服器後仍可由 v44 快取離線重新載入。透過實際測試頁的兩次確認清除，提示立即消失，離線重開仍不顯示。測試資料已清理，沒有改動正式網站資料。
- 390×844、768×1024、1280×900 的瀏覽器視窗沒有橫向溢出，完成提示維持在 GPS 面板內；乾淨建置輸出 35 個批准資產，測試 fixture 不進入發布包。語法與 diff 空白檢查通過。

以上是桌面瀏覽器與尺寸模擬，未重新驗證 Android／iPhone 真機 GPS、相機、相簿或推送。測試預覽只供檢查畫面；它不能證明正式六站完成或校方出席。

### 本次發布範圍（2026-10-08）

依使用者授權，正式六站完成提示、DAY 1 佛教黃鳳翎中學出發站打卡，以及獨立測試頁的完成提示預覽，同一批提交及推送至 main。沿用 GitHub Actions 的 Test and deploy GitHub Pages 流程：重新執行應用與推送後台測試、Worker bundle 核對，再建置及部署 GitHub Pages。本次執行用變更在前端；通知後台及私人設定沿用目前版本。

正式 App 為 <https://lok274.github.io/bwflc_school_tour/>，裝置測試頁為 <https://lok274.github.io/bwflc_school_tour/device-test.html>。發布完成須確認此提交的 build 與 deploy 工作全部成功，再核對線上 v44 Service Worker 及學校、完成提示、測試預覽的執行模組與提交版本相符。

已安裝 PWA 或開着的舊分頁可能仍暫用舊快取。收到更新後關閉並重新開啟 App，必要時重新整理；不需清除瀏覽器資料，避免刪除本機打卡與相片。GPS、相機及推送真機測試界線依上文，不把部署成功當成已完成真機驗證。

## iPhone／iPad 手動安裝指引（2026-10-08）

Safari 不提供網站按鈕直接叫出 beforeinstallprompt 安裝提示的功能；這是瀏覽器能力限制，不能靠改按鈕文字變成一鍵安裝。首頁在 iPhone／iPad 未從主畫面開啟而又沒有原生事件時，顯示「iPhone／iPad 安裝方法」。按下後在同一區展開 Safari 的分享、加至主畫面、如有「開啟為網頁 App」選項保持開啟、加入及從主畫面開啟步驟。指引亦說明從 WhatsApp 等 App 開啟時可先把網址複製到 Safari，以及在分享列表的「編輯動作」加入缺少的選項。步驟依 Apple 香港官方說明：<https://support.apple.com/zh-hk/guide/iphone/iphea86e5236/ios>；WebKit 的原生安裝提示要求：<https://bugs.webkit.org/show_bug.cgi?id=193959>。

平台判斷只在控制器讀取 userAgent、platform 及 maxTouchPoints，不保存或傳送；支援 iPad 桌面模式的 MacIntel 加多點觸控判斷。真正原生安裝事件優先於平台判斷，因此未來瀏覽器提供事件時仍可使用。普通 Mac／Android 沒有事件時不顯示 iOS 步驟；navigator.standalone、display-mode: standalone 或本頁收到 appinstalled 時隱藏入口。只知道目前是否從主畫面啟動，不能保證在 Safari 分頁得知另一個主畫面圖示已存在。

首頁 model 保留 canInstall，另有凍結的 install.mode（none、native、ios）與 install.helpOpen；不把事件、user agent 或瀏覽器物件提供給畫面。iOS 指引開關只留在記憶體，離開首頁或 pagehide 收起；aria-expanded、aria-controls 及具名稱的說明區讓輔助閱讀工具識別展開狀態。重畫保留原有按鈕焦點，沒有增加頁面、彈窗或額外通知權限。

原生模式仍於使用者 click 內直接呼叫 prompt，先消耗當次事件，等待期間防止重複按下；接受、取消或失敗後不重用舊事件。prompt 或 userChoice 拒絕時顯示失敗提示；等待期間到來的新事件不會被舊回覆清除。安裝方法不呼叫 navigator.share、不寫 localStorage、不修改打卡或相片，也不代表已經安裝成功。

此輪實作的離線快取更新至 v45，沒有新增執行模組，建置仍為 35 個資產；既有打卡及相片儲存格式不變。安裝指引與下述學校操作頁及下載提示合併發布，最新發布版本與範圍見本文末。

### 本次驗證

- npm test：249 項全部通過，包括新增 tests/install.test.mjs 的 24 項案例；涵蓋 Apple 裝置與 iPad 桌面模式、非 Apple 沒有事件、已安裝狀態、唯讀 model、手動指引、離頁、操作範圍、原生同步呼叫、連按、接受／取消／失敗、晚到回覆及 appinstalled。
- tests/browser/install.html：8 項通過，使用真正 DOM、CSS、控制器、路由及鍵盤焦點，平台及原生安裝事件是模擬。沒有真的安裝 App、要求位置／相機權限或發送通知。
- 既有六站完成瀏覽器整合 9 項通過，並確認 v45 離線白名單完整；新增安裝測試 fixture 不進入發布快取或建置包。
- 390×844、768×1024、1280×900 視窗中，安裝步驟可展開／收起且沒有橫向溢出；乾淨建置為 35 個批准資產，語法及 diff 空白檢查通過。

目前沒有 iPhone／iPad 真機可以操作系統分享選單，不能把上述模擬測試描述成真機已完成安裝。驗收須在 Safari 按分享、加至主畫面、加入，然後從新圖示開啟；再確認安裝入口隱藏。其他 iOS 瀏覽器或 App 內瀏覽器的選單可能不同，指引以 Safari 為準。

## 學校共用景點操作頁（2026-10-08）

DAY 1 的「佛教黃鳳翎中學」現在開啟 #attraction/departure-school，與其他五站共用 renderAttraction。地圖改在詳情內的「在 Google Maps 查看地點」開啟。共用頁有 GPS／手動打卡、取消打卡、手機及網頁相機、多張紀念照、相片勾選、單一「儲存到手機」多選 JPEG 匯出及旅程卡。手動記錄在詳情及行程均標示「未核實手動記錄」。學校沒有加入未經核對的照片或插畫；共用標題在沒有圖片時顯示綠色漸層背景。

ATTRACTIONS 保留原有五景點；DEPARTURE_LOCATION 補齊共用頁資料，CHECK_IN_LOCATIONS 的六站同時作詳情路由與照片白名單。getAttraction(id) 改從六站查找。行程 model 的學校節點與其他景點一樣只用 attractionId 作內頁連結，不再有 checkInId／mapUrl 特例；行程頁的直接打卡按鈕及專用樣式移除。畫面仍只收到本站打卡、相片 ID、預覽和選取結果，不取得 Blob、儲存物件或其他站完整資料。

學校與其他站共用 canUseAttraction、頁面 token、generation 及相片版本核對：只有目前詳情可操作本站。取消打卡前確認，先停止待匯出結果並等待進行中的相片工作，再整站刪除本站相片。刪照失敗保留打卡並提示重試；原有五站相片不受影響。離頁、背景、清除或取消後的過期 GPS／相機／壓縮／JPEG 回覆沿用既有失效控制。已移除的相簿加入及逐張刪照入口沒有恢復。

既有 departure-school 打卡讀回後可直接使用共用頁。「已完成所有打卡行程」仍逐一核對學校加原有五站；照片不影響完成判斷。學校的 WGS84 點、100 米範圍及來源保持原設定；本輪沒有重新核對實地 GPS。沿用 outdoorLearningDay.v3 及 IndexedDB 版本 2，不需遷移。此輪實作的離線快取由 v45 更新至 v46，建置仍只包含 35 個批准資產。學校操作頁與安裝指引及下載提示合併發布，最新發布版本與範圍見本文末。

### 本輪驗證

- npm test：259 項全部通過。更新 11 項出發站測試並新增 10 項學校詳情案例，涵蓋舊紀錄、六站判斷、GPS／手動、操作範圍、多張照片與版本、JPEG／旅程卡、刪除失敗、進行中的相片工作及離頁晚回覆。
- tests/browser/school-detail.html：14 項全部通過。使用真正 DOM、Canvas、IndexedDB、JPEG 與 1080 × 1350 PNG；GPS、相機回覆、分享與下載為模擬，沒有要求實際權限、傳送相片或發送通知。
- tests/browser/check-in-completion.html：9 項六站回歸通過，包括從行程進學校詳情、取消只刪學校相片及 v46 快取；tests/browser/install.html 的 8 項安裝指引回歸也通過。
- 390×844、768×1024、1280×900 的詳情視窗没有橫向溢出。用合成相片和六站虛構紀錄開啟真正網站入口，按 DAY 1 校名進詳情；停止本機伺服器後仍可由 v46 快取重新載入學校、完成提示及兩張相片。
- 乾淨建置輸出 35 個批准資產，沒有包含 tests 或私人資料；語法及 git diff --check 通過。只讀覆核未發現本輪學校流程的可修回歸。

手機和平板僅為桌面瀏覽器尺寸模擬。沒有重新驗證 Android／iPhone 真機 GPS、相機、手機分享選單或相簿儲存位置；上述結果不能代替真機確認。

## 正式頁與測試頁的下載位置提示（2026-10-08）

逐張按下載後，現有相片匯出視窗持續顯示「已開始下載第 N 張相片」及當次檔名、尋找位置指引；兩頁共用同一 photo-actions 與 renderPhotoExport。網頁不能得知瀏覽器是否取消、封鎖或完成下載，也不能讀取實際檔案路徑，因此不把開始下載寫成「相片已完成下載」或「已存入相簿」。即使檔名也可能由瀏覽器調整，提示提供的是本 App 建議的檔名；實際檔案請在下載列表確認。

getDownloadLocationHint(navigator) 只回傳文字：iPhone／iPad（包括桌面模式 iPad）提示查看「檔案」→「瀏覽」→「下載項目」，可能在 iCloud Drive、我的 iPhone／iPad 或另設位置；Android 提示查看「檔案／我的檔案」→「下載」，使用 Chrome 可查看選單的下載列表；其他裝置提示瀏覽器下載列表及設定位置。不保存或傳送平台資訊，不讀取檔案系統，也不推斷手機品牌的實際路徑。

指引來源： [Apple 尋找下載項目](https://support.apple.com/zh-hk/102440)、[Apple 選擇 Safari 下載位置](https://support.apple.com/zh-hk/guide/iphone/iphb3100d149/ios)、[Chrome Android 下載說明](https://support.google.com/chrome/answer/95759?co=GENIE.Platform%3DAndroid&hl=zh-HK)。download 屬性的限制見 [MDN HTMLAnchorElement.download](https://developer.mozilla.org/en-US/docs/Web/API/HTMLAnchorElement/download)。

私有匯出 session 增加 delivery，getPhotoExportModel 回傳凍結的文字快照：下載為 kind=download、filename、locationHint；系統分享成功為 kind=share、locationHint，不帶檔名、Blob、File、平台物件或路徑。分享結束只說已交由系統處理，按選取的儲存影像、儲存到檔案或其他 App 提供查找指引；不認定已保存。開始新的下載或分享會清除上一個提示；啟動失敗或取消分享不顯示該次儲存成功提示，JPEG 準備結果可重試。

renderPhotoExport 的下載與儲存位置區跳脫檔名及指引，用 aria-describedby 連到狀態文字。兩個控制器於真正下載／分享按鈕操作後，把焦點移到可聚焦的狀態文字，讓手機對話框捲回結果；關閉後沿用原有對話框焦點返回。相片視窗內的提示保留到下一次操作或離頁，不另存公告或操作歷史。旅程卡仍先做私隱確認，下載開始後的 toast 顯示 PNG 檔名及位置指引，保留 15 秒供閱讀。

離頁、關閉匯出、取消打卡、清除或相片版本改變沿用 token 及版本失效，delivery 一併釋放；不改保存照片、打卡或資料庫格式。沒有新增頁面、按鈕、通知或執行模組。離線快取從 v46 升至 v47；網站資產白名單仍是 35 個檔案。下載提示與上述學校操作頁及 iPhone 安裝指引合併發布，發布範圍見本文末。

### 本輪下載提示驗證

- npm test：268 項全部通過；本輪新增 9 項回歸，既有測試保留。下載流程及兩頁 controller 的 28 項針對測試亦全部通過，涵蓋平台、檔名、凍結模型、HTML 跳脫、分享取消／失敗／成功、下載啟動失敗、重試與離頁失效。
- tests/browser/download-notice.html：正式頁 iPhone 指引 14 項、測試頁 Android 指引 14 項全部通過。使用真實 DOM、Canvas JPEG、獨立隨機 IndexedDB 及記憶體進度；分享、平台及失敗為模擬。另驗證不先聚焦按鈕的點擊，提示仍取得焦點，避免依賴 Safari 觸控的按鈕焦點差異。
- 在正式頁預覽按真正的下載按鈕，瀏覽器確實輸出合成 JPEG（12657 bytes），核對 JPEG 檔頭／檔尾及建議檔名。這是桌面瀏覽器下載測試，App 本身仍不能據此判斷任何使用者的手機下載已完成。
- 390×844、768×1024、1280×900 的下載視窗與頁面沒有橫向溢出；手機視窗在操作後顯示狀態、檔名及位置指引，沒有增加控制項。
- 乾淨建置產生 35 個批准資產；測試 fixture 不進發布包。語法及 git diff --check 通過。既有 iPhone 安裝及學校詳情修改一併保留並納入本次發布。

本輪沒有 Android／iPhone 真機可操作檔案 App 或分享目標，所以沒有驗證真機下載完成或實際相簿位置。系統分享選擇、手機設定、App 名稱及瀏覽器版本可能不同，提示提供查找指引，不保證保存位置。

## v47 合併發布（2026-10-08）

依使用者「commit、push 及部署」授權，將 iPhone／iPad 安裝指引、佛教黃鳳翎中學共用景點操作頁，以及正式頁與測試頁的相片下載位置提示，一併提交及推送至 main。離線快取使用 v47；原有打卡儲存鍵、相片資料庫及六站完成規則沿用，無需資料遷移。

沿用 GitHub Actions 的 Test and deploy GitHub Pages 流程，在此提交上執行應用測試、推送後台測試、Worker bundle 檢查及網站建置，再部署 GitHub Pages。發布完成須確認此提交的 build 與 deploy 工作都成功，並核對線上 35 個網站資產與本次建置相符。測試檔案及私人設定不包含在網站發布包內。

正式 App：<https://lok274.github.io/bwflc_school_tour/>；學校操作頁：<https://lok274.github.io/bwflc_school_tour/#attraction/departure-school>；裝置測試頁：<https://lok274.github.io/bwflc_school_tour/device-test.html>。

已安裝的 PWA 或原有分頁可能暫用舊快取，收到更新後關閉並重新開啟 App，必要時重新整理。毋須清除瀏覽器資料，以保留本機相片與打卡。發布與桌面瀏覽器驗證不能代替上述 iPhone／Android 真機安裝、GPS、相機、分享及實際儲存位置驗收。

## 旅途回憶集中相片頁（2026-10-08）

正式 App 新增 #memories，底部導航為首頁、行程及旅途回憶。景點詳情保留打卡、取消打卡與拍攝，保存後提示到旅途回憶查看；相片預覽、多選儲存、手機分享、一鍵 JPEG／ZIP 下載、感想與旅程卡均集中在旅途回憶。相片按六站行程順序分組，組內按建立時間排列，顯示景點及打卡時間。空頁引導到行程；讀取失敗顯示重試，不能誤稱未有相片。

沿用 outdoorLearningDay.v3 及原有 IndexedDB 版本 2，不搬動、複製或上傳相片，既有相片（包括遷移保留的舊照）直接讀回。Blob 只在 store／photo-actions 內使用；memories model 只提供凍結的景點摘要、打卡、照片 ID、預覽 URL、尺寸及草稿。景點 model 不再建立 Blob 預覽。清除資料及取消打卡的規則不變：取消一站會刪除該站所有 App 內相片。

controller 將打卡與相機的景點權限，以及回憶頁的相片操作權限分開。回憶頁不能要求位置或啟動相機；景點頁不能借舊控制項匯出或下載旅程卡。跨景點選取使用獨立 photoId；整組匯出核對每站的 generation token、版本、有效打卡及每張 writeId。一張轉換失敗、相片被替換、取消或離頁會使整組失效，不保留部分下載。單張直接下載 JPEG，多張在裝置打包 ZIP。最終分享按鈕仍同步呼叫系統 share。

每張最多 80 字的感想草稿繼續只留在目前回憶頁記憶體，重畫保留、離頁或重新載入清除；依 photoId 和 writeId 分辨照片。跨景點的 aria-describedby 提示 ID 包含景點 ID，避免重複。導航保留焦點、aria-current、舊 #prepare 回首頁及離頁停止相機等生命週期控制。離線快取提升至 v55，未增加執行模組及公開建置資產。

新增 tests/memories.test.mjs 與 tests/browser/memories.html：核對六站舊照、權限邊界、跨站選取與 ZIP、單張 JPEG、失敗／取消／替換／離頁、清除及讀取失敗重試。瀏覽器 fixture 使用合成相片、獨立資料庫及模擬分享／下載，不要求實際相機、GPS 或通知。preview 只允許在空白本機測試 origin 使用合成資料，測試檔案不進公開建置。

本輪驗證：npm test 296 項通過；針對拍攝、匯出及回憶頁的 53 項回歸通過（與全套重疊）。瀏覽器共 46 項通過：回憶頁 7、相片匯出 11、正式 Android 下載提示 14、學校詳情 14。使用真實 DOM、Canvas、IndexedDB、JPEG、ZIP 及 1080×1350 PNG；位置、相機回覆、分享與下載觸發為模擬。390×844、768×1024、1280×900 均沒有橫向溢出。停止本機伺服器後由網站入口重新載入回憶頁，三張合成相片可從 IndexedDB 讀回及解碼。乾淨發布包仍為 38 個白名單資產，語法及 diff 空白檢查通過。本輪只修改本機專案，未提交、推送或部署；未驗證 Android／iPhone 真機相機及系統分享選單。

## 旅程合成卡與選填學校站（2026-10-08，本機未發布）

最新規則以五個必需景點為準。REQUIRED_CHECK_IN_LOCATIONS 沿用 ATTRACTIONS 的五個 ID；CHECK_IN_LOCATIONS 仍保留包括學校的六站詳情、打卡及相片白名單。完成判斷逐一核對五個必需 ID，不用打卡總數，學校不能取代缺少的景點。舊打卡、相片及儲存格式不變。

完成五景點後，行程及詳情保留完成提示，提供前往旅途回憶製卡入口。回憶頁即使沒有相片也顯示製作區；補拍數量、未選原因及 5／5 計數只包括必需景點。學校明確標示選填，沒有打卡或相片不會阻止下載；已有相片亦不自動加入，可選一張成為第六張，或以「不加入學校相片」撤回。普通相片匯出、感想及單張旅程卡維持獨立操作。

生成入口只接受五個必需景點各一張，加上零或一張已打卡學校相片。輸出依行程順序，1080×1350 PNG、兩欄三排、完整保留相片比例；五張時最後一格是回憶寄語，六張時學校排列首格。圖片印有活動標題、日期、每站名稱、打卡時間與核實狀態，以及使用者選填的姓名和班別。草稿只留在目前頁面，不寫入儲存、網絡或檔名，離頁清除；下載確認取消則保留。每張圖片逐一解碼及釋放；只核對已選站點的相片版本與打卡狀態，已加入的學校相片失效會停止舊卡，未加入學校的相片更新不會阻止五張卡。離線快取 v57，沒有資料遷移。

驗證：330 項 Node 自動測試全部通過；37 項瀏覽器整合通過（合成卡 14、五景點完成 9、學校詳情 14）。實際 Canvas 驗證五張及六張的順序、尺寸、比例、失敗與過期結果；學校選填可用鍵盤方向鍵加入及撤回，焦點保留。390×844、768×1024、1280×900 沒有橫向溢出。停止本機伺服器後，正式入口由 v57 快取重新載入，只持有五景點虛構打卡及五張合成相片，仍能離線生成並實際下載 PNG。乾淨發布建置為 38 個白名單資產；未測 Android／iPhone 真機相機或系統分享。本輪未提交、推送或部署。


## 共用設定與硬編碼整理（v83，本機未發布）

新增 src/app-settings.js，集中 PHOTO_PAGE_SIZE=12、學生身份上限 40／20／20、文章配圖上限 6。回憶控制器、頁面模型、縮圖編號、匯出更多選項及手冊選圖共用分頁設定；正式／預演／診斷 AI 與手冊身份規則共用凍結設定，保留原有匯出名稱相容性。手冊備份預覽的文字／評分總數由 WORKBOOK_FIELDS、WORKBOOK_RATINGS 提供。必需景點數及診斷 AI 可選張數依景點列表推導，完成提示、補拍提示、選圖要求及生成錯誤同步。

活動開始／結束日期集中在 src/data.js；首頁年份、日期標示及團刊／手冊下載檔名前綴由本機日期字串推導，獨立於裝置時區與當前年份，支援跨月跨年。現有顯示與檔名保持相同。團刊原文、地理座標、固定備份活動 ID、儲存格式、批准 PDF 資產檔名、固定依賴及安全上限維持原樣；新活動仍須另外核對原始文件及活動識別，不能只改日期便重用舊資料。

憑證 Worker 的目標與管理頁網址移到其公開 Wrangler vars，程式驗證 Worker 名稱及 HTTPS /admin 網址，頁面連結另做 HTML 屬性編碼。configure-admin-rotation.mjs 可從主 Worker name 及網站 PUSH_CONFIG 同步 vars／Service Binding；check 必須核對三者一致，再 dry-run 建置兩個 Worker。不讀正式秘密、不連正式服務、不修改 Cloudflare。現有 AES-GCM AAD 原文及目標值相同，已加密紀錄相容；不同目標不能解密沿用舊憑證，測試有拒絕案例。

驗證：394 項網站、41 項後台自動測試通過；真實 DOM 相簿 14 項及手冊 17 項整合通過，原文及 PDF 回歸保留。390px 相簿核對第一頁 12 張、第二頁第 13–20 張、跨頁待確認勾選、鍵盤 Space／Enter；320／768／1280px 主頁仍為六張封面，沒有橫向溢出。空白隔離 origin 載入 v83 合成資料後停止伺服器，重載手冊及離線下載 PDF 成功，解析下載檔為 8 張 A4 頁及 6 幅圖片。新設定模組加入精確發布與離線白名單，發布共 65 個批准資產。資料使用合成身份、相片及答案，後台 API 使用替身，沒有驗證正式老師登入、GPS 或真機儲存。本輪未提交、推送或部署。

## AI 成品署名（v84）

素材 ZIP 入口不再接收身份；五站選圖及學校選填保持原樣。photos.js 新增 prepareAIArtwork（本機成品驗證與解碼）及 createSignedAIArtwork（完整圖片加下方署名條）。成品不能寫入照片資料庫。ai-artwork-controller.js 持有私有成品／身份／生成 token，共用三種頁面；關閉保留草稿並釋放網址，離頁與清除清空。局部更新計數和按鈕，中文組字不重畫；下載確認收起原視窗，取消返回。

local-font.js 將原 PDF 字型載入／字元核對共用，FontFace 使用既有同源靜態字型資料。PDF 規則及身份用途維持。署名 PNG 寬 1080px、圖片區最高 1350px，完整比例置中，文字換行加高署名條。正式完成五站才可署名，五站全 GPS 顯示已核實；混合手動則明示未核實，不假稱校方出席驗證。測試輸出有預演／診斷標示。

新增模組須在 build-pages.mjs 與 sw.js 精確名單，v84 共 67 個批准資產。tests/ai-artwork.test.mjs、tests/browser/ai-artwork.html 覆蓋比例、中文字、前置零、錯誤、不依賴原照、草稿／token 生命週期。既有 ZIP、相簿、診斷及預演回歸測試改為無身份素材包。

署名響應式 fixture 可用 node tests/browser/serve-ai-artwork-responsive.mjs 42597 啟動，再開 /tests/browser/ai-artwork-responsive.html。這個只監聽 127.0.0.1 的獨立合成預覽，僅提供 JS、CSS 和指定測試文件，允許本身測試頁內嵌；正式 server.mjs 與發布網站仍禁止 iframe，CSP 不變。視窗寬度 320／390／768／1280，檢查最新視窗結構及水平溢出。

驗證：415 項網站及 41 項後台自動測試通過；78 項瀏覽器整合通過（署名 10、相簿 14、五站素材 14、診斷 10、手冊 17、完整預演 13）。320／390／768／1280px 合成資料視窗無水平溢出，鍵盤焦點及取消確認保持草稿。隔離 origin 載入 v84 合成資料後停止伺服器，從快取重載正式入口並實際下載 1080×1292 PNG；中文字、學號 007、完整圖片及未核實手動紀錄均正確。乾淨白名單建置 67 個資產，兩個後台 Worker 僅作 dry-run。測試沒有使用真實學生資料，也未測 Android／iPhone 真機或正式 GPS。本輪未提交、推送或部署。

## 五站打卡紀錄卡（v85）

正式及完整預演都只在「旅途回憶」上方提供製作按鈕。行程及詳情完成提示只有文字指引。check-in-card.js 驗證五站不可重複、學校不可替代、日期與 method／verified 一致，按行程排序；不讀相片資料庫，零相片及相片讀取失敗均可使用。PNG 寬 1080px、高度依量度文字增加；上方活動／身份／完成摘要，下方縱向五卡，每站有完整香港日期時間與 GPS／手動標示。測試模式只印模擬／測試，不能聲稱正式核實。

check-in-card-controller.js 私有身份及結果，唯讀 model 無 Blob。共用 app-settings 的身份驗證及 local-font 的同源 Noto 字型，前置零保留，長字換行，缺字明確指出欄位。關閉保留草稿、釋放網址；離頁、pagehide 或清除時停止舊工作並清空。生成與下載前後比較五站快照、身份版本及頁面 token；下載確認與原視窗互斥，確認期間紀錄改動停止下載並恢復草稿，不留下收起的視窗。身份不寫入儲存、網絡或檔名，原 AI 及手冊規則不改。

新增兩個模組加入精確發布與離線名單，v85 共 69 個資產，毋須遷移資料。tests/check-in-card.test.mjs 有 19 項服務與生命週期測試；tests/browser/check-in-card.html 有 9 項真正 DOM／Canvas 整合。尺寸 fixture 可用既有本機專用伺服器，開 ai-artwork-responsive.html?card=1；正式網站 CSP 不放寬。check-in-card-offline.html 只在空白隔離 origin 準備合成五站、零相片，遇到已有旅程或手冊則停止。

驗證：434 項網站及 41 項後台自動測試通過；88 項瀏覽器整合通過（五站卡 9、AI 署名 10、相簿 14、素材 14、診斷 10、手冊 17、完整預演 14）。320／390／768／1280px 沒有水平溢出；鍵盤 Enter、Escape 與焦點還原可用。停止最終本機伺服器後，由 v85 快取重載正式入口、生成五站手動紀錄 PNG，取得檔案核對 1080×2217、344885 bytes，完整中文、五站順序／日期／未核實狀態及學號 007 正確。下載介面只表示開始，不宣稱裝置已存妥。乾淨發布建置 69 個資產；所有身份／紀錄／照片均為合成測試，未測 Android／iPhone 真機及正式 GPS。本輪未提交、推送或部署。