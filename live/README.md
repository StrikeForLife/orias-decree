# 法源律令正式版：Google 身分驗證與後端

這是獨立部署至 Cloudflare Workers + D1 的版本，沿用已確認 UI。正式網站已由擁有者部署至 https://oria-decree.lochunfaisamson.workers.dev ，Google 登入、資料及 11 篇場次筆記匯入已由 DM／玩家初步實測。現有 ChatGPT 私人試玩站繼續運作。正式資料以 D1 為準，不會自動同步 Sheets。

擁有者專用圖形後台已實作，升級方式請閱讀 [OWNER-CONSOLE.md](OWNER-CONSOLE.md)。它尚需在正式 D1 套用新 migration、設定 OWNER_EMAIL 並由擁有者首次登入認領。

持續維護請閱讀 [MAINTENANCE.md](MAINTENANCE.md)，並使用 `node scripts/maintain.mjs help` 查看備份、權限、筆記復原及內容更新工具。

## 已實作

- Google 登入：RSA 簽章、issuer、audience、期限、nonce、verified email 驗證，以 Google `sub` 作永久帳號識別。
- 8 小時伺服器 session、Secure／HttpOnly／SameSite cookie、後端角色授權及 CSRF。
- 啟用戰役限定角色可見範圍；未列名帳號只讀；DM 可讀所有私人資料。
- 傷害、臨時生命、傷口、祈禱、止傷、操作紀錄及有條件撤銷。操作 ID 防重複、版本鎖防覆寫，同時扣血依最新值重算。
- 背包／一般筆記版本檢查；場次筆記只由角色擁有者管理，DM 只讀，刪除可於資料庫還原。
- 建角 14 點屬性檢查、核心法術、候選範圍及名額限制。
- DM 啟停戰役、升級、屬性及法術名額調整、一次性修改許可、全隊恢復意志。
- 新角色可分配 2／4／6／8 級成長點。未解鎖 Perk 不傳送到玩家瀏覽器。

## 結構

`server/auth.mjs` 處理 Google 與 session；`server/game.mjs` 保存遊戲規則；`server/worker.mjs` 提供 API、授權及交易。`migrations/0001.sql` 定義 D1／SQLite schema，法術與武器使用關聯表。`frontend/` 是正式版連線層及管理表單。`scripts/build.mjs` 從既有 UI 產生 `public/`，排除角色快照、擁有者 email 對照和 SQL。

## 本機執行（Node 24）

```bash
cd live
npm test
npm run build
npm run seed
npm run dev
```

首次 seed 建立本機資料庫並匯入 10 個角色快照；非空資料庫拒絕再次匯入。`.runtime/` 不提交 git。

複製 `.env.example` 至 `.env`，填入 Google Web Client ID。Google Auth Platform 應授權 `http://localhost:8787` 作 JavaScript origin。沒有設定時登入顯示尚未啟用，不會略過驗證。

## Cloudflare 正式部署

1. 在自己的電腦執行 `npx wrangler@4 login`，不用在聊天貼 API token。
2. 執行 `npx wrangler@4 d1 create oria-decree`，將回傳 database_id 填入 `wrangler.jsonc`。
3. 執行 `npm run build` 和 `npx wrangler@4 d1 migrations apply oria-decree --remote`。
4. 核對下方匯入限制，執行 `node scripts/export-seed.mjs`，只在**全新資料庫**執行 `npx wrangler@4 d1 execute oria-decree --remote --file .runtime/import.sql`。此檔含私人資料，不可成為網站資產；不要重複匯入非空資料庫。
5. `npx wrangler@4 deploy` 取得 workers.dev 網址。此時若未設定 OAuth，登入保持關閉，API 拒絕未登入讀取。
6. Google Auth Platform 建立 **Web application** OAuth client，將正式網址的 origin（scheme＋hostname，不含路徑）加入 **Authorised JavaScript origins**。本版使用 GIS callback，不需要 client secret，也不要求 Drive／Sheets／Gmail 存取權。
7. 將正式 origin 和 Client ID 分別填入 `wrangler.jsonc` 的 APP_ORIGIN 及 GOOGLE_CLIENT_ID，重新部署。Client ID 是公開識別值；不要填 client secret。
8. 先以 DM 和一位玩家帳號實測登入及私人資料，再邀請其餘玩家。

## 開團前仍需完成

- **擁有權核對**：初次匯入對照已由擁有者確認。後續名單以 D1 為準，使用維護工具更新，不重跑 seed。
- **資料更新**：目前是試玩時讀取的快照，正式切換前應核對最新來源，不是持續 Sheets 同步。
- **舊場次筆記**：已另外匯入 11 篇，附帶首次登入接續筆記作者的資料庫 trigger；不要重跑原始角色 seed。
- **舊屬性分配**：舊角色未拆分建角與成長點，不猜測來源；其成長分配暫停，待 DM 核對 `_baseStats`／`_growth`。
- 舊 AC／生命等先保留；公式只在新建、升級或 DM 提交屬性時執行。裝備／信仰修正尚未完整自動化。
- 非 Gmail 且無 Workspace hd 的 Google 帳號可只讀登入，但不只靠 email 自動領取權限，需另核對 sub。
- 玩家名單目前由維護工具產生受控更新計畫，未提供網站內名單管理介面。
- 死亡判定進一步自動化、額外信仰資格選擇、完整建角草稿與斷線草稿恢復尚未完成。

## 驗證

`npm test` 使用實際 schema 和同一份 Worker handler；以測試 RSA key 驗證偽造 token、權限、私隱、建角、核心法術、重選鎖、版本衝突和並行操作。這不代表已完成真實 Google 帳號或 Cloudflare D1 端對端測試，這兩項要待外部設定完成後實測。

正式版不會自動將試玩站 localStorage 內容合併進資料庫。
