# 法源律令：日常維護手冊

適用網站：https://oria-decree.lochunfaisamson.workers.dev
資料庫：oria-decree（0e229d59-ccb3-4fc7-afc7-227a02488630）。更新日期：2026-10-24。

這套工具在你的電腦以 Cloudflare Wrangler 管理正式資料，沿用現有登入，不要求在聊天提供 Token。指令在 `live` 資料夾執行，需 Node.js 24。

## 安裝與責任分工

把維護更新包內 `live/scripts/maintain.mjs` 複製至你專案的相同位置，並閱讀本手冊。不要用另一份 wrangler 設定覆蓋電腦上已部署成功的設定。網站不用重新部署；工具不是網站內的管理頁面。

- 你：保管原始碼、Cloudflare 帳號、備份及管理工具。
- DM：網站內管理戰役啟停、角色等級／數值、法術重選許可、意志長休。
- 玩家：自己角色資源與筆記；其他角色唯讀。
- Google Cloud 的 Test users 是登入測試名單；D1 的 access_grants 才是遊戲 DM／玩家權限。兩者不同。
- Google Sheets 現在是歷史來源，不是同步後台。修改它不會更新網站。

`node scripts/maintain.mjs help` 可查看工具指令。除 `backup` 會讀取／匯出 Cloudflare，其餘指令只檢查本機備份、產生更新計畫，**不會直接修改正式資料庫**。套用是你執行最後一行 Wrangler 指令。

## 固定維護節奏

| 時機 | 操作 |
|---|---|
| 每次開團結束 | 匯出並驗證一份備份；記錄日期、戰役、是否有問題 |
| 改權限、內容、程式或 schema 之前 | 全隊離線後備份，記錄本次變更 |
| 每月 | 將一份備份還原至獨立測試 D1，核對資料量與關聯 |
| 保留策略 | 至少保留最近 8 次場次，以及最近 3 個月每月 1 份；調整前先確定備份正常 |

以上是建議的手動工作流程，目前沒有替你設定排程或雲端自動備份。將同一份備份另外複製至你控制的私人儲存位置；不要只留在專案資料夾或同一部電腦。

## 1. 備份

在無人遊玩時執行：

```powershell
node scripts/maintain.mjs backup
```

工具會匯出正式 D1 至 `.runtime/backups/<UTC時間>/database.sql`，在記憶體中用 SQLite 實際匯入，檢查完整性與外鍵，並保存：

- database.sql：全部 schema／資料，包括私人筆記、權限、登入 session 記錄。
- manifest.json：SHA-256、資料量、來源 D1 ID、網站 origin、驗證結果。
- bookmark.txt：匯出後取得的 D1 Time Travel bookmark（不是匯出檔完全同一瞬間）。
- wrangler.jsonc：當次部署設定。

若驗證或 bookmark 步驟失敗，工具不會顯示完成的「Verified backup」結果；先處理錯誤，不要將不完整輸出當作已驗證備份。

可再次驗證你複製到另一位置的備份：

```powershell
node scripts/maintain.mjs verify "D:\PrivateBackups\oria\某次備份\database.sql"
```

路徑按你的實際位置填寫。SQL 只可使用你自己匯出的可信備份；本機驗證會執行檔內 SQL。

另外保留當次完整原始碼版本（`dist/`、`live/`、設定及 migration），例如以日期命名的私人 ZIP 或私人 Git。資料庫備份不包含網站程式。備份、原始 SQL、.env、.dev.vars 不放入 `public/`，也不提交公開 repo。

Cloudflare D1 Time Travel 自動啟用；Free 保留 7 天、Paid 保留 30 天，因此不能取代長期匯出。SQL 匯出執行期間會阻塞其他資料庫請求，宜在非遊戲時間進行。[官方 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) · [方案限制](https://developers.cloudflare.com/d1/platform/limits/) · [匯出說明](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

## 2. 還原：先判斷影響範圍

| 狀況 | 處理 |
|---|---|
| 剛輸入錯傷害，尚無後續操作 | 優先用網站的撤銷；不要整庫倒退 |
| 一篇場次筆記誤改或誤刪 | 從備份產生單篇復原計畫 |
| 程式更新後畫面／API 壞掉 | Workers Deployment 回退；D1 不會隨程式回退 |
| 大量資料誤改、壞 migration | 停止使用、先保存現況，再考慮 D1 Time Travel |
| 超過 Time Travel 範圍 | 將 SQL 匯出還原到新 D1，驗證後另行切換 binding |

目前沒有強制維護模式，維護前請全隊離線並停止其他管理作業。若無法停止寫入，先不要進行整庫還原或批量修改。

### 單篇筆記復原

先做一份最新備份，並準備誤改前的備份。列出筆記 ID：

```powershell
node scripts/maintain.mjs notes "最新備份路徑\database.sql"
node scripts/maintain.mjs note-recover "最新備份路徑\database.sql" "誤改前備份路徑\database.sql" "筆記ID"
```

若只是軟刪除，兩個路徑可以使用同一份最新備份，恢復 deleted 標記及原有內容。工具會檢查角色、作者及當前版本，再產生 `.runtime/maintenance/plan-<時間>.sql`。所有權不相符或正式筆記已有新變更會停止；不可刪除保護條件強行執行。

檢查計畫檔後，執行工具列出的 `npx wrangler@4 d1 execute ... --file ...`。其他筆記及角色不會修改。

### 程式版本回退

Cloudflare Dashboard → Workers & Pages → oria-decree → Deployments → 選擇已確認可用且 schema 相容的版本 → Rollback。保留目前原始碼，記錄退回的版本 ID。**這只還原程式，不還原 D1 的內容或 schema**。[官方說明](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

### 整庫 Time Travel（事故時才做，不要當演練）

1. 讓全隊離線，記錄事故時間及時區。
2. `node scripts/maintain.mjs backup` 保存事故後現況，另記錄當前 bookmark。
3. 用含時區的時間查詢還原點，例如香港時間 `2026-10-24T20:30:00+08:00`：

```powershell
npx wrangler@4 d1 time-travel info oria-decree --timestamp="2026-10-24T20:30:00+08:00"
```

4. 核對還原點確實在事故之前、且可接受之後的正常操作也被倒退。記錄要保留的後續筆記／改動，再用真正 bookmark 執行：

```powershell
npx wrangler@4 d1 time-travel restore oria-decree --bookmark="把已核對的bookmark填在這裡"
```

這會覆寫整個正式資料庫，包括玩家資源、筆記與權限，取消進行中的請求。不要直接使用手冊的示範時間。

5. 還原可能讓舊 session／舊權限重新出現；立即清除全部登入 session，並核對 DM／玩家權限：

```powershell
npx wrangler@4 d1 execute oria-decree --remote --command "DELETE FROM sessions;"
```

6. 檢查角色、筆記數量、schema 與程式相容性；以 DM＋一位玩家重新登入測試，再恢復開團。必要時手動補回事故後有效變更。

### 每月還原演練／超出 Time Travel 的 SQL 復原

此流程只對**新建、未接到網站的 D1**執行：

```powershell
npx wrangler@4 d1 create oria-decree-recovery
```

複製你的 `wrangler.jsonc` 成 `wrangler.recovery.jsonc`，在副本內將 D1 的 `database_name` 改為 `oria-decree-recovery`，`database_id` 改成新資料庫 ID。原設定不改。對這個新庫匯入完整備份；**不用先跑 schema migration**：

```powershell
npx wrangler@4 d1 execute oria-decree-recovery --config wrangler.recovery.jsonc --remote --file "備份路徑\database.sql"
npx wrangler@4 d1 execute oria-decree-recovery --config wrangler.recovery.jsonc --remote --command "PRAGMA foreign_key_check; SELECT COUNT(*) AS characters FROM characters; SELECT COUNT(*) AS notes FROM session_notes; SELECT name FROM sqlite_schema WHERE type='trigger';"
```

對照 manifest 數量；確認筆記匯入的 `oria_imported_notes_claim_v1` trigger（如曾安裝）也保留。不要 deploy recovery 設定，不要將測試庫設成正式 binding。新庫仍含私人資料，保留在你的帳號內。

若用作真正事故復原，驗證新庫後清除新庫 sessions、核對權限，再在原正式 wrangler 設定內更換 D1 ID 並部署。保留原庫及原設定供回退；這個切換需逐步核對，不能把匯出 SQL 直接疊加進已有資料的正式庫。

## 3. 玩家與 DM 權限

每次先做最新備份。在 PowerShell 設定一個方便使用的變數，填入工具剛輸出的真實路徑：

```powershell
$oriaBackup = "C:\你的專案\live\.runtime\backups\某次UTC時間\database.sql"
node scripts/maintain.mjs members $oriaBackup
```

先看戰役表的 `id` 和 `active`，再看名單。權限**每個戰役獨立**；DM 也不自動取得其他戰役的編輯權。下一節 `<戰役ID>` 必須替換成目標 ID。

| 需求 | 角色 |
|---|---|
| 新增玩家／恢復玩家 | player |
| 升任 DM | dm |
| 移除玩家／降為只讀 | reader |

先產生計畫：

```powershell
node scripts/maintain.mjs role $oriaBackup "player@gmail.com" player "<戰役ID>"
node scripts/maintain.mjs role $oriaBackup "second-dm@gmail.com" dm "<戰役ID>"
node scripts/maintain.mjs role $oriaBackup "leaving-player@gmail.com" reader "<戰役ID>"
```

以上是三個獨立例子，按需要執行一個，不是要求把三個全跑。工具會列出原／新權限，以及 SQL 路徑；檢查後執行它輸出的 Wrangler 指令。改完做新備份並再次 `members` 核對，請該玩家重新登入，測試自己的編輯權與其他人的私隱。

- 不准移除最後一位 DM；替換現任已認領 DM 前，另一位 DM 必須已登入認領。
- 新增帳號不會寄邀請信。自行把網站網址告訴該玩家；若 Google OAuth 仍在 Testing，另檢查 Google Test users。
- 變更會清除該帳號已知的登入 sessions；其他戰役權限保留，對方重新登入即可。
- 新玩家可自行建角，擁有權自動給建立者。不要以修改角色 owner_email 來搬移角色，這牽涉私人筆記及作者權限，應另做專門轉移。
- 移除是撤銷該戰役的 DM／玩家資格，保留角色及筆記，不刪除 Google 帳號。按目前設計，任何可登入但未列名帳號仍可唯讀查看啟用戰役公開卡；**這不是封鎖登入或資料刪除**。
- 非 Gmail、非 Google Workspace 的第三方電郵不只靠 email 自動取得授權；需核對登入後的 Google sub，工具不會放寬這項保護。
- 修改 `import-mapping.json` 後再跑最初 seed **不會更新正式名單**。不要重跑 `.runtime/import.sql`。

## 4. 更新內容

| 類型 | 更新位置 |
|---|---|
| 等級、屬性、名額、重選許可、長休 | 現有網站 DM 管理 |
| 法術／職業／法源道／信仰／武器／出身的設定文字，以及新增條目 | 下方內容工具 |
| 血量公式、傷口規則、法術選取資格、UI／顏色／圖樣 | 原始碼更新＋測試＋部署 |
| 戰役名稱／介紹／新增戰役、角色所有權轉移 | 另做指定 migration；目前工具不提供編輯 |

### 更新典籍內容

先做最新備份，匯出可編輯 JSON：

```powershell
node scripts/maintain.mjs content-export $oriaBackup content-edit.json
```

用 VS Code 等編輯器修改 `items` 中對應項目的 `payload`。例如 `Spell Desc`、`Target`、`Action Type`、`Class Desc`、`Level 2 Perk`、`Desc`、武器 `Damage`／`Effect`。遵守 JSON 格式，內文換行使用 `\n`。

- 保留 `kind`、`id`、`system_id`。已有 ID 改名會破壞角色關聯。
- 新增條目：複製同類型項目，換成新的穩定 ID（例如 `spell_new_20261024`），`payload.system_id` 也設為相同 ID，再修改內容及參照。
- `kind` 可為 class、school、spell、weapon、beliefs、background。ID 只用英數字、底線或連字號。
- 不刪除舊項目。既有 Class／School／Belief／Main Spell 關聯修改或核心法術更換需要另外審核 migration；不會自動替玩家重選法術。
- 新職業／新機制可能需要同步修改程式中的選取資格；新增 JSON 條目不代表新機制已支援。
- 效果文字更新不等於自動重算 AC／HP／傷害。公式在程式中，現有角色數值不會被內容工具改動。

產生與檢查更新計畫：

```powershell
node scripts/maintain.mjs content-plan $oriaBackup content-edit.json
```

工具列出新增／修改條目，檢查參照、核心法術及原始 payload。按它輸出的指令套用 SQL，然後重新整理網站看典籍。若顯示 CHECK constraint failed，代表計畫過期或保護條件不符：做新備份，從新版本重新產生，不要刪掉 guard。

`content-edit.json` 已存在時工具拒絕覆寫；請另取新檔名，保存前後版本供比較。整個匯出含未解鎖 Perk，只留給管理員，不提供玩家。

### 程式更新

保存當前原始碼版本 → 全隊離線 → 資料備份 → 改程式 → 測試／build → 部署 → DM 與玩家驗收：

```powershell
npm test
npm run build
npx wrangler@4 deploy
```

只有 schema 改動時才按新 migration 的說明跑 `d1 migrations apply ... --remote`；一般文字更新不用 deploy、不要重跑 seed。新 schema 與舊 Worker 不一定相容，發布說明要記錄可回退範圍。

每次驗收：Google 登入、自己的資源修改、其他角色不可改、私人筆記不可被其他玩家閱讀、重新整理後保存、核心法術及 Perk 顯示。變更日期、目的、備份路徑、套用計畫與部署版本寫進自己的維護紀錄。

## 工具驗證與目前界限

維護工具已用相同 SQLite schema 測試：完整性／外鍵檢查、最後 DM 保護、舊計畫拒絕、筆記單篇復原、保留角色筆記、內容中文／引號／換行、參照檢查。尚未在你的 Cloudflare 帳號執行工具的首次備份或還原演練，需在本機照流程驗證。

本工具沒有設定定時備份，沒有網站內名單／典籍編輯 UI，沒有完整封鎖名單，也不會替你操作或刪除 Cloudflare 資源。需要這些功能時可以沿用同一權限及資料模型擴充。
