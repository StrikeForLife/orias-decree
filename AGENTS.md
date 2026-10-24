# Codex 開發指引：Oria’s Decree

## 專案與工作方式

這是已上線、已有玩家資料的繁體中文 TRPG 角色管理網站。Repository：StrikeForLife/orias-decree。正式站使用 Cloudflare Workers、D1 及 Google 登入。

- 預設以繁體中文溝通；解釋修改原因、驗證結果及剩餘限制。
- 使用者熟悉 Git，會在 VS Code 管理 Git 操作；避免重複基礎教學。
- 開始工作先查看 git status，保留使用者尚未提交的修改，不任意 reset、clean 或覆寫。
- 先閱讀本檔、根 README.md、docs/RELEASING.md，以及任務涉及的程式與測試。
- 使用功能分支和 PR。完成可審查的變更；除非使用者授權，不合併 main、不發布正式站、不修改正式資料庫或 secrets。
- 任務範圍內的本機修改、檢查及修復可直接進行，不需要逐步詢問。
- 註解說明不直觀的規則、限制或安全理由，避免只重述程式碼。

## 程式結構與原始檔

| 路徑 | 用途 |
|---|---|
| dist/index.html、dist/app.js、dist/style.css | 目前沿用的 UI 原始輸入；雖名為 dist，仍是正式 build 的來源，勿當作可隨意刪除的產物 |
| dist/rules.mjs、dist/lore-colours.mjs、dist/patterns/ | 共用規則、配色及背景圖樣 |
| live/frontend/ | 正式站連線層、狀態、筆記、擁有者介面及額外樣式 |
| live/server/auth.mjs | Google 驗證及 session |
| live/server/game.mjs | 遊戲規則 |
| live/server/worker.mjs | API、授權及遊戲交易 |
| live/server/owner-admin.mjs | 網站擁有者管理 API |
| live/migrations/ | D1 / SQLite schema migration |
| live/scripts/build.mjs | 組合 UI 與正式連線層的 build |
| live/public/ | 產生的正式靜態資產；不要只修改這裡 |
| live/test/ | Node 測試，使用虛構資料 |
| deploy/production.json | 正式目標的非機密識別設定 |
| .github/workflows/ | CI 及手動發布流程 |

Build 目前使用字串切片及替換組合 UI。修改 dist/app.js 的函式名稱、初始化或資源操作時，必須檢查 live/scripts/build.mjs 的替換仍有效，並檢視產生的 live/public/app.js。不要讓 UI 改動意外繞過正式 API。

## 本機開發與驗證

需要 Node.js 24；目前沒有應用程式 npm 套件依賴。從 repository 根目錄執行：

```sh
npm test
npm run build:live
```

啟動本機伺服器：

```sh
cd live
npm run dev
```

- 本機登入設定參考 live/.env.example；Google OAuth 需授權所用的 localhost origin。
- 不略過 Google 驗證來方便開發；測試身份僅限測試環境。
- 不假設乾淨 clone 含原始角色快照、帳號對照或私人資料。首次本機資料庫可保持空白；不要為了啟動而從正式庫匯入私人資料。
- 根 npm run dev 含 POSIX 環境變數語法；Windows 原生 shell 可用上述分開 build / 啟動的方式。
- 行為、權限、規則或資料變更需新增或更新有意義的測試；純文件變更不需為此添加測試。
- UI 變更除 build 外應實際檢視相關頁面；若無法做瀏覽器驗證，明確說明。
- 不把本機測試通過描述成 Google / Cloudflare 正式環境端對端驗證通過。

## 身份、授權與私隱

- Google sub 是永久身份識別。保持 token 簽章、issuer、audience、期限、nonce 和 verified email 驗證。
- Session、Origin、CSRF、角色與擁有權必須在後端驗證；前端隱藏按鈕不是授權。
- 網站擁有者與 DM 是不同權限。典藏管理室只供 site_owner 綁定的使用者使用，不能因 DM 角色或請求 header 升任。
- OWNER_EMAIL 僅供首次符合條件的 Google 登入建立固定 owner 綁定；修改它不能轉移既有擁有權。
- 玩家可操作自己的角色，查看同行者公開卡；DM 可管理戰役內角色、升級及修改許可。
- 未列名帳號是唯讀者，不可建立角色。撤銷授權保留角色與筆記並撤銷相關 session；不等同封鎖登入。
- 玩家及唯讀者只能看到啟用戰役的角色；全站同時最多一個啟用戰役。
- 背包與私人筆記不得出現在其他玩家的公開角色卡。現行後端允許 DM 讀取私人資料，場次筆記只由擁有者修改；保留現行測試涵蓋的界線，若要改為連 DM 也不可讀，先確認需求並同步改後端與測試。
- 保持版本衝突檢查、操作去重、交易內驗證、稽核與軟刪除；不要為消除錯誤而移除保護。
- 不在靜態資產、Git、log 或回覆中包含 Token、session、私人筆記、真實帳號對照、資料庫備份或原始角色快照。

## 遊戲規則

修改規則前閱讀 game.mjs、共用 rules.mjs 及測試；不要用一般 D&D 假設替代此 homebrew。

- 臨時生命可疊加，受傷先扣臨時生命；傷口依實際生命傷害計算，臨時生命吸收部分不計入。
- 生命可為負值。保留待結算傷口、止傷及條件式撤銷。傷口門檻的比較、進位與豁免須以目前程式和測試逐項核對；有矛盾時提出具體案例，不默默調整。
- 意志在長休恢復；DM 可全隊恢復。祈禱消耗 1 意志，魅力 DC 9，失敗亦消耗。
- 六屬性起始 -1、建角 14 點；可降低屬性換點。建角下限 -3，通常上限 +3，至多一項 +4；後續總上限 +5。
- 最高等級 8；成長點在 2 / 4 / 6 / 8 級，升級由 DM 管理。
- 未達等級的職業 perk 不應傳送給玩家，再由前端隱藏。
- 基本法術位 4，DM 可調整；核心法術佔一個法術位。
- 變更職業或重選法術需 DM 許可。法術候選範圍沿用現有職業群組、法源道與 exclusive 規則，不能放寬成全法術清單。
- 舊角色未必有可重建的建角 / 成長點來源；不猜測、不批次重算既有數值。

## UI 與內容風格

- 桌面優先，以繁體中文為主；列表只顯示中文，詳情可附英文。
- 保留使用者已接受的深色、帶色彩的奇幻典藏風格、Orian Archive 標題及不同主題的背景圖樣。
- 避免改回單色現代卡片風，也不要無故加入過度裝飾；沿用既有元件與視覺語言。
- 保留各職業原有固定色系；勢力、出身、信仰使用現有 lore 配色映射，不任意混入多種職業色。
- AC / DC 與六項屬性需容易區分；六屬性也需能辨識。
- 法術與武器採可點選標籤，在詳情區閱讀，不恢復 hover 說明泡泡。
- 法術明確分開職業、法源道、動作類型、目標及描述，突出核心法術；武器保留四種類別的區別。
- 出身、信仰與故事分區；出身及信仰摘要可點選後顯示詳情。神祇詳情避免重複名稱，突出名稱與尊稱。
- 保留整合的冒險資訊及獨立場次筆記入口，避免不必要的導覽。

## 正式資料、維護與發布

- D1 是正式資料來源。網站內內容修改直接寫 D1，不會自動回寫 GitHub 或 Google Sheets。
- 已有正式角色、授權及場次筆記；不要重跑 seed、初次匯入或 owner 初始化。
- 不提交 .runtime、.env、.dev.vars、備份或本機正式設定。不要把舊私人部署資料夾整個推入 repo。
- live/wrangler.jsonc 是開發範例，勿直接拿它操作正式庫。正式綁定與操作依 docs/RELEASING.md 核對。
- 正式發布使用 Deploy production (manual)，推送與合併不應自動部署。
- 發布流程執行測試、build、唯讀 D1 schema 核對，然後部署；不建立備份、不套用 migration、不匯入資料、不更新 Worker secrets。
- Migration 需獨立審查、備份與手動套用；已套用檔案不可修改，新增下一個 migration。考慮新舊 Worker 相容性。
- 不停用 schema 檢查、不刪 migration 記錄來強行發布。程式回退不會回退 D1。
- 維護流程參考 live/MAINTENANCE.md 與 maintain.mjs help。遠端 D1 檢查使用 quick_check；不要假設允許 integrity_check。
- 部署或正式資料操作只有在使用者明確授權後進行，並先完成相關檢查。

## 文件可信度

部分 live/README.md 和 OWNER-CONSOLE.md 段落仍保留初次部署時的操作或狀態。不要因此重新初始化已有的系統。
現有使用者已確認 Google 登入、擁有者管理室及手動發布運作。需要確認當前 schema、設定或部署狀態時，檢查實際環境，不能只依歷史描述宣稱成功。
若文件與程式矛盾，指出差異並依本次任務核對；發布方式以 docs/RELEASING.md 和實際 workflow 為準。
