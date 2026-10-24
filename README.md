# 法源律令 · Oria’s Decree

繁體中文 TRPG 角色控制台：Google 登入、Cloudflare Workers + D1、角色資源、場次筆記及擁有者圖形管理室。

## 開發與檢查

需要 Node.js 24，沒有應用程式 npm 套件依賴。

```sh
npm test
npm run build:live
cd live
# 複製 .env.example 為 .env 並填入自己的 Google 登入設定
npm run dev
```

本機會建立空白 SQLite 資料庫及套用 schema。首次 Google 登入符合伺服器 OWNER_EMAIL 才能認領擁有者；之後可用典藏管理室建立戰役及內容。

## 部署

1. 在 live/wrangler.jsonc 設定自己的 D1 ID、網站 origin、Google Web Client ID。
2. 用 Wrangler 登入自己的 Cloudflare 帳號並執行 D1 migrations。
3. 用 `npx wrangler@4 secret put OWNER_EMAIL` 設定首次擁有者 Google 電郵。
4. build 後 deploy；將實際 HTTPS origin 加到 Google OAuth 的 JavaScript origins。
5. 以本人 Google 帳號登入，建立擁有者綁定。

詳細說明：[擁有者後台](live/OWNER-CONSOLE.md)、[維護手冊](live/MAINTENANCE.md)、[技術說明](live/README.md)。

## 資料界線

Repository 不包含真實角色、私人筆記、帳號對照、備份或憑證，也不包含先前私人版本的 Git history。測試使用虛構資料。正式資料保存在 D1，網站內編輯不會自動回寫 Git 或 Google Sheets。

舊資料 seed 工具需由管理者另提供私人來源快照，不是重新部署必要步驟；已有 D1 不要重跑 seed。GitHub Actions 在 push／PR 時檢查測試與 build；正式站透過獨立的手動 workflow 發布。詳見 [發布流程](docs/RELEASING.md)。
