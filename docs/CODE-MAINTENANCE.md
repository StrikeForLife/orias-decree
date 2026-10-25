# 程式碼與工具盤點

本次整理以閱讀性為主，不調整角色規則、授權、UI 設計或資料庫 schema。JS／MJS、CSS、HTML、JSON／JSONC 及 YAML 統一用固定版本 Prettier 排版；SQL migrations 保持原始位元組，不重寫已套用的歷史。

## 開發方式

```sh
npm ci --ignore-scripts
npm run format
npm run format:check
npm test
npm run build:live
```

Prettier 只有開發依賴，不會打包進 Worker。`npm test` 與 build 仍只用 Node.js 內建模組；手動發布 workflow 不需要安裝格式工具。一般 CI 安裝 lockfile 的版本並先檢查排版。

忽略產物 `live/public/`、本機 `.runtime/`、憑證設定、備份與私人匯入資料。`.prettierrc.json` 定義排版規則。動態 HTML 的 template literal 仍保留既有內容，避免整理時引入顯示文字／空白差異；本次主要展開函式、條件、物件與 CSS 規則。

## 從哪裡閱讀

| 範圍 | 入口與用途 |
|---|---|
| API 與角色權限 | `live/server/worker.mjs`：路由、bootstrap 過濾、角色操作及 DM 權限 |
| 登入 | `live/server/auth.mjs`：Google token、session、Origin、CSRF |
| 規則 | `live/server/game.mjs`、`dist/rules.mjs`：屬性、法術候選與資源計算 |
| 擁有者管理 | `live/server/owner-admin.mjs`、`live/frontend/owner-console.js` |
| UI | `dist/app.js`、`dist/index.html`、`dist/style.css`：雖名為 dist，仍是來源 |
| 正式連線層 | `live/frontend/`：API、狀態、筆記、建角／成長表單與動畫 |
| Build | `live/scripts/build.mjs`：讀取來源、組合與靜態資產白名單 |
| 組合規則 | `live/scripts/frontend-build.mjs`：具名區段與登入 HTML 轉換 |
| 日常維護 | `live/scripts/maintain.mjs`、`live/MAINTENANCE.md` |
| 發布 | `.github/workflows/`、`.github/scripts/production.mjs`、`docs/RELEASING.md` |

## Build 為什麼需要小幅調整

舊 build 會尋找壓縮形式的函式字串，例如 `mutate(s=>s.will--)`。將來源排版後，替換可能悄悄失效，使正式 UI 操作沒有 command 或仍使用離線儲存。

現在 `dist/app.js` 用 `@live-state:start/end`、`@live-notes:start/end` 明確標出離線區段；build 以正式連線層替換它們，資源 command 直接寫在共用操作中。離線層忽略 command 並維持原有本機行為。缺少、重複、反向的區段或登入 HTML 錨點都會停止 build，不再依賴函式縮排及空白。

本次以整理前 build 的 10 個 JS／CSS／HTML 資產作基準。相同 Prettier 規則正規化後，整理後各檔內容完全相同；此為本次本機比對結果，基準檔留在被 Git 忽略的 `.runtime/`，不是新增的正式快照。另有 build 測試保護登入隱藏、離線資料移除、各項 command 與標記錯誤。

## 初始化檔案的保留／移除判斷

| 檔案 | 判斷 | 理由與使用限制 |
|---|---|---|
| `live/migrations/0001.sql`、`0002_owner_console.sql` | 必須保留，不能重寫 | 空白環境、測試、本機遷移及發布時的 schema 清單核對都需要。正式庫已套用不代表可以刪除檔案。 |
| `live/scripts/migrate-local.mjs` | 保留 | 本機 dev 啟動與測試仍使用，依紀錄套用尚未執行的本機 migration。 |
| `live/scripts/sqlite-adapter.mjs`、`dev.mjs` | 保留 | 本機伺服器與使用 SQLite 的測試仍依賴。 |
| `live/scripts/import-data.mjs` | 保留為選用舊資料匯入工具 | `api.test.mjs` 使用虛構資料驗證交易匯入與拒絕覆寫；新環境仍可能需要明確審核的舊快照匯入。不是日常發布步驟。 |
| `live/scripts/seed-local.mjs` | 保留為本機／全新庫工具 | 仍由 `live/package.json` 的 seed 指令引用，先套用本機 migrations，再呼叫匯入器。乾淨 clone 沒有私人快照，不應為啟動而取得正式資料。 |
| `live/scripts/export-seed.mjs` | 保留為選用新庫 SQL 匯出工具 | 文件仍有新庫移轉用途；只輸出本機私人 SQL，不執行正式寫入。依賴另行提供的快照及帳號映射，已有正式庫不得重跑。 |
| `.env.example`、`wrangler.jsonc` | 保留 | 新開發者或隔離環境需要的範例，不是目前正式庫設定。 |
| `live/scripts/maintain.mjs` | 保留 | 備份驗證、內容與權限計畫、筆記復原是持續維護能力。 |
| `live/test/preview-owner.mjs`、`fixtures/seed-fixture.mjs` | 保留 | 分別供虛構資料視覺驗收與測試；不是舊正式資料。 |
| `tools/install-owner-update.mjs` | 移除 | 屬於早期獨立更新包的安裝器，依賴 repo 不存在的 manifest／payload，沒有套件、CI 或應用程式引用。Git 分支／PR 已取代這條更新路徑；格式改動還會讓其舊的路由字串檢查失效。 |
| `live/scripts/export-github.mjs` | 移除 | 用於首次製作乾淨 GitHub 快照，會重寫成過時 README／CI，遺漏目前 `docs/`、`deploy/`、手動發布 workflow、發布 helper 與格式設定。現有 repo 應直接 clone／分支／PR，不再輸出另一份不完整副本。 |

移除的工具可從 Git 歷史還原，不影響正式 Worker、D1 或 secrets。本次不移動保留的 seed 檔案，避免改動既有操作路徑。若未來確定不再支援舊快照匯入，可另開 PR 一併移除三個匯入工具、seed 指令、相關文件與匯入測試。

`OWNER_EMAIL` 的首次認領邏輯仍須保留：空白環境會使用，而既有正式站依固定 `site_owner` 綁定授權。不能因已完成首次設定而刪除此安全邊界或重跑正式認領。
