# 手動發布正式站

日常流程：feature/fix 分支 → PR → 測試及 build → 合併 main → 手動 Run workflow。

推送／合併不會觸發此部署流程。此工作流程不套用 migration、不匯入資料、不重設 Worker secrets。正式 Worker 請保持其他 Git 自動部署流程關閉，避免繞過這個發布入口。

## 一次性設定

在 GitHub repository 的 Settings → Secrets and variables → Actions：

| 類別 | 名稱 | 值 |
|---|---|---|
| Repository secret | CLOUDFLARE_API_TOKEN | 你的 Cloudflare 部署 API Token |
| Repository variable | CLOUDFLARE_ACCOUNT_ID | ba5b27d643a5de8014bf21e121fb1f69 |

不要把 Token 貼到聊天、commit 或工作流程檔。OWNER_EMAIL 保留在現有 Cloudflare Worker secret，不用複製到 GitHub。

建立 Cloudflare Token 時，選擇此網站所在帳號，使用 Custom token，授予：

- Account → Workers Scripts → Edit（或 UI 提供的對應 Worker Editor 權限）。如可選 Worker 資源，限制到 oria-decree。
- Account → Account Settings → Read。
- Account → D1 → Read，供 SELECT-only migration 檢查；不需要 D1 Write。

帳號資源限制到上述單一帳號。這個 workflow 不管理 Zone routes、KV 或 R2。可從官方 Edit Cloudflare Workers template 開始調整所需權限，不使用 Global API Key。

正式目標的非機密設定在 `deploy/production.json`：Worker 名稱、D1 ID、origin、Google Web Client ID。這些是公開識別值，不包含玩家資料或憑證。修改需經 PR 審核。

`live/wrangler.jsonc` 雖使用 `.jsonc` 副檔名，發布與維護工具仍以嚴格 JSON 讀取；請勿加入註解或尾隨逗號。Prettier 已對此檔停用尾隨逗號，測試會實際執行 `prepare` 核對設定產生流程。

## 每次發布

1. 合併已通過檢查的 PR 到 main。建議建立版本 tag，例如 v0.3.0。
2. 在你保存正式部署設定的本機專案，執行既有備份工具，確認成功，再將備份複製至私人儲存位置。workflow 的勾選項只是你的確認，不會代為建立／驗證備份。
3. 若 release 有新 migration，先備份並核對 migration，另行手動套用。注意舊 Worker 與新 schema 的相容性，必要時安排維護時段。部署 workflow 僅檢查 schema，不套用 SQL。
4. GitHub → Actions → **Deploy production (manual)** → Run workflow。
5. 工作流程分支選 **main**；`release_ref` 填 tag、完整 commit SHA 或 main。勾選最近備份及 schema 核對確認，按 Run workflow。
6. 流程將 main／tag 解析為固定 SHA，要求該 commit 屬於 main 歷史；執行該版本的測試及 build。production 設定與發布 helper 來自 workflow 的 main 版本。
7. 唯讀檢查已套用 migration 名稱與選定版本的 migration 檔完全相符，並確認正式庫已有綁定的網站擁有者。若有待套用或未知的 migration 就停止，避免不相容回退。
8. 檢查成功才部署既有 oria-decree Worker；同時間不允許兩個正式發布作業執行。Wrangler 使用 4.x，執行紀錄會顯示當次工具版本。
9. 成功後 Run Summary 記錄發布 SHA、Worker 及網址。用 DM＋玩家帳號做登入、資源、筆記及私隱驗收，再記錄當次 tag／SHA、Cloudflare Deployment ID 及備份路徑。

首次合併後，workflow 才會出現在 default branch 的手動發布選單。此 PR 不會自行發起正式部署。

## 本機手動部署與 migration

GitHub repo 的 `live/wrangler.jsonc` 是開發範例，含預留值。不要以它直接操作正式庫。你可以保留一份本機 `live/wrangler.production.local.jsonc`（已被 .gitignore 排除）填入正式設定，並明確指定：

```powershell
# 先列出並核對待套用的 migration；只有需要時才執行 apply
npx wrangler@4 d1 migrations list oria-decree --config wrangler.production.local.jsonc --remote
npx wrangler@4 d1 migrations apply oria-decree --config wrangler.production.local.jsonc --remote
```

若沿用原本已部署成功的本機專案及有效 wrangler.jsonc，既有備份流程也可繼續使用。不要把含私人資料的舊目錄整個推送至 repo。

## 失敗與回退

- **測試／build 失敗**：不會部署；在新分支修正，再走 PR。
- **缺少帳號／Token 或 HTTP 403**：核對 GitHub Secret／Variable 及 Cloudflare Token 的帳號與 D1 Read 權限，不在 log 印出 Token。
- **Schema mismatch**：先核對資料庫及 migration 記錄；不要刪 migration 記錄或停用檢查。新 migration 要獨立審核及套用。
- **部署後程式出錯**：可重跑已知可用 tag／SHA，前提是它仍與目前 schema 相符。或在 Cloudflare 依已核對的相容性回退 Worker 版本。D1 不隨程式回退。
- **資料損壞**：使用已演練的備份／還原流程，與程式發布分開。

目前沒有設定 Staging、自動備份、GitHub Release 自動建立或資料庫自動遷移。此流程的初次 Cloudflare 真實發布仍需在設定 Token 後由擁有者手動驗證。

## 官方參考

- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://github.com/cloudflare/wrangler-action
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
