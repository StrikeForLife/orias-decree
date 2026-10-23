# 典藏管理室：擁有者後台

這次更新新增網站內的「✺ 典藏管理室」。只有綁定的網站擁有者可使用；DM 權限本身不包含後台權限。

## 升級既有網站（保留正式資料）

1. 先執行 `node scripts/maintain.mjs backup` 保存並驗證目前資料。
2. 將更新包內容合併至原專案。保留你現有的 `live/wrangler.jsonc`、`.env`、`.dev.vars`、`.runtime`；不重跑 seed。
3. 在 `live` 依序執行：

```powershell
npx wrangler@4 d1 migrations apply oria-decree --remote
npx wrangler@4 secret put OWNER_EMAIL
```

第一個指令應只顯示新的 `0002_owner_console.sql`（`0001.sql` 已在首次部署套用）。若 0001 也顯示待執行，先停止，不要重建資料表。

第二個指令會提示輸入值：填入你本人用來登入網站的 Google 電郵，確認字串無誤；不用把值貼到聊天或 GitHub。它是伺服器端的首次擁有者設定。使用 Gmail 或 Google Workspace 電郵；第三方非 Workspace 電郵需另做身分核對。

```powershell
npm test
npm run build
npx wrangler@4 deploy
```

4. 在網站登出，重新以自己的 Google 帳號登入。首次符合 OWNER_EMAIL 的已驗證 Google 登入會在 `site_owner` 綁定固定 user_id，此後以該綁定授權，不採用前端傳來的身份或 DM 角色。
5. 你會看到「✺ 典藏管理室」。用另一位 DM／玩家登入確認沒有按鈕及 API 存取權。第一次先修改一個可回復的描述作驗收，檢查變更紀錄。

後台已被認領後，修改 OWNER_EMAIL 不會轉移擁有權。更換 Google 帳號、轉移網站擁有權或復原帳號需在 Cloudflare 端核對後另行處理，不提供自助「升任擁有者」。

## 四個分頁

- **典籍內容**：法術、法源道、職業、武器、信仰、出身。中文名稱、英文、描述、動作、目標、關聯採用個別表單欄位；固定 ID 保留。可新增、修改、刪除、從已刪除區復原。刪除是可復原的隱藏，不是永久清除。被角色、法術或其他條目引用的內容無法直接刪除；已使用的關聯更換需要指定遷移。效果文字不會自動重算角色數值。
- **玩家與權限**：選擇戰役，新增 Google 電郵授權、切換玩家／DM、撤銷權限。最後一位已登入的 DM 有保護。新增邀請不會寄信，對方需重新登入；Google OAuth 在 Testing 時仍需設定 Test users。撤銷後公開卡唯讀，角色及筆記保留，不是封鎖登入。
- **戰役**：新增戰役、改中英文名稱及介紹。新戰役保持未啟用，會為你建立已綁定的 DM 授權；啟停仍使用 DM 管理。已有戰役沒有直接刪除功能。
- **變更紀錄**：最近 100 次後台操作，保留修改前後內容及時間。典籍匯出只包含設定內容，不是完整角色／筆記備份；完整 D1 備份繼續使用已驗證的維護工具。

## 操作保護

所有擁有者 API 都再次驗證 session、固定擁有權、Origin 及 CSRF。內容／權限變更有版本及資料比較，檢查與寫入／審計在同一 D1 batch 執行；有其他變更時拒絕覆寫。刪除引用檢查也在交易內重查，建角提交同時檢查選用條目仍有效。

程式碼與正式 D1 分開維護。GitHub 保存程式；網站內內容編輯直接寫 D1，不會自動產生 Git commit，不會同步回 Sheets。備份與更新 schema 前仍採用既有維護流程。

## GitHub

使用 `node live/scripts/export-github.mjs <輸出資料夾>` 準備乾淨程式碼快照。它不複製 .git 歷史、Sites 設定、角色快照、原始帳號對照、任何 .runtime／備份／憑證；部署設定中的個人 D1 ID／網站 origin／Google client ID 改為範例值。

GitHub Actions 使用 Node 24 執行測試與正式前端 build，不會部署或存取正式 D1。預設建議 Private repository；若日後公開，仍需你核對自創設定文字、圖樣及授權。推送後可沿用本機 Wrangler 部署，不會自動把 GitHub 接到 Cloudflare。
