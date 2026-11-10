# D1 核心資料正規化：映射、演練與回退

基準：main `8ff5307`（2026-11-03 核對）。不改 UI、API JSON key、玩法、權限或既存數值。不操作正式 D1、不部署。

## 欄位映射（實作前方案）

| 舊來源 | 新儲存 |
|---|---|
| characters 的 ID、戰役、擁有權、version、修改許可 | 原表原欄位不變 |
| sheet 角色名稱、等級、Class、School、Background、故事、六屬性、Max Health / Max Willpower / Armor Class / Spell Difficulty / Available Spell Slots | character_profiles 明確欄位，原值搬移，絕不呼叫 derived |
| sheet._baseStats / _growth | character_base_stats / character_growth；不存在不補值 |
| state.hp / temp / will / general / inventory | character_resources；inventory 單一自由文字欄位 |
| state.wounds | character_wounds，ordinal 保留順序與重複 |
| sheet.Beliefs | character_beliefs，保留原字串於 profile，關聯保留順序 |
| 已有角色法術／武器 | 原 character_spells / character_weapons，ID 不變 |
| definitions payload 六類欄位 | catalog_classes / schools / spells / weapons / beliefs / backgrounds |
| class Level 1–8 Perk | class_perks，每個等級一列 |
| 典籍 Class / School / Belief / Main Spell | 明確 *_id 欄位；有效引用另有外鍵關聯，無效引用仍保留原值並列報 |
| 未知 key 或已知欄位的非預期巢狀值 | 每份文件的 extras_json 原值保留，另列異常；shape_json 僅記錄欄位存在性與 JSON 型別 |
| 舊 sheet/state/payload | 原位保留並繼續同步，供相容寫入與回退；本 PR 不刪除 |

已知欄位也保留原 JSON 型別，避免將 `"1"`、`1`、`true`、`null` 混同；缺失值不補預設。system_id / Campaign 與原主鍵如有差異，原文件值保留並列報，既有 API 覆寫規則維持。

## 階段與回退條件

1. **盤點／備份**：管理者停寫、保存已驗證完整備份及 Worker 版本。先在私人隔離副本檢查 JSON、引用與所有欄位。未知／缺失／無效引用均需檢視，不能直接忽略。JSON 不合法、根節點非 object 或重複 key 時停止，不進行回填；仍維持舊程式和 schema。
2. **新增／回填／同步（0003）**：新增表、檢查視圖、相容寫入觸發器；不重建原表、不改 IDs、不改舊數值或版本、不刪舊 JSON。以原子 migration 套用；任何 guard 或 SQL 失敗回滾整個 migration。成功後舊 Worker 可繼續從舊 JSON 讀寫，新表同步更新。若資料比對失敗，停止切換，保留所有資料供調查；不要刪 migration 紀錄。
3. **切換讀取**：新 Worker 讀正規化相容視圖；API 仍輸出原 JSON 格式。現有寫入經舊欄位及同交易觸發器更新明確欄位，以保留 changes()、CAS、去重、undo、稽核及舊 CLI 的交易行為。比對角色、典籍、所有非核心表與各身份 API；失敗時回退已確認相容的 Worker，資料庫保留 0003。現有發布 workflow 嚴格比對 migration 名稱，因此不能用舊 ref 繞過 schema gate；可用 Cloudflare 已驗證舊 Worker deployment 回退，或建立包含 0003 的相容修復 release。
4. **驗收**：管理者以私人資料副本重跑演練，逐項處理異常，再手動套用正式 migration 及部署。正式登入／D1 限制／真實帳號驗收仍由管理者進行。未驗收不可移除舊欄位或相容觸發器。
5. **日後清理（不在本 PR）**：待驗收後另提 migration，將所有寫入改為直接關聯寫入及反向相容同步，確認無舊 Writer 後才考慮刪 JSON。刪除前需新備份及獨立還原演練；刪除後不能只回退舊 Worker。

保留 JSON 是刻意的可回退階段；本 PR 不宣稱已完成刪除 JSON 或正式環境驗收。

## 演練指令與判讀

先使用 **0003 前、你自己匯出的可信 SQL 備份**。以下工具只在記憶體還原，不連線 Cloudflare、不改來源檔、不執行正式 migration。SQL 內容會在本機執行，請勿使用來歷不明的匯出檔。

```sh
node live/scripts/rehearse-normalization.mjs /private/path/database.sql
# 如有獨立保存的舊版本 checkout，可直接比對原版 Worker：
node live/scripts/rehearse-normalization.mjs /private/path/database.sql /private/previous-checkout/live/server/worker.mjs
```

工具逐列比對所有原表（包括權限、sessions、operations、筆記、稽核），逐份比對 sheet / state / payload 的值及 JSON 型別，並核對原有 schema、quick_check 和 foreign_key_check。它用隔離的臨時測試 session 對每位使用者執行兩個 bootstrap API，檢查成功／403 狀態及完整回應，再回滾測試 session；不需要真實 token，不寫入真實備份。

目前版本會在隔離副本繼續套用 0003 後的 migration（包含 0004），並檢查所有既有欄位與紀錄仍一致。報告會列出 `followupMigrations`；若以 0004 前的 Worker 比較，新增的 `data.info` 與典藏管理室資訊分類會明確列為 `expectedApiAdditions`，其餘回應仍嚴格比對。

預設 `apiBaseline: legacy-storage` 是同一版本 handler 在舊 JSON 儲存與正規化視圖之間比對；提供舊 Worker 路徑時，`apiBaseline: previous-worker` 會實際載入該版本的 handler（連同該 checkout 的依賴）。正式驗收建議提供已保存的相容舊 Worker，而非只依賴預設模式。

- Exit 0：資料／API 比對成功且無列報異常，仍需管理者驗收。
- Exit 2、`REVIEW_REQUIRED`：比對成功，但有未知欄位、缺失必要欄位、非預期結構、ID 不一致、未知典籍類型、無效引用或孤立關聯，需要逐項處理／記錄接受理由。
- Exit 1：SQL、原資料保留、文件、API 或完整性檢查失敗。停止切換；來源備份不變。錯誤輸出不含文件內容或帳號對照。

在私人隔離副本套用 0003 後，可用以下唯讀查詢逐項定位（結果只保存到私人位置）：

```sql
SELECT entity,id,scope,field,reason FROM normalization_issues ORDER BY entity,id,scope,field;
SELECT r.* FROM normalization_references r
WHERE r.target_id IS NOT NULL AND r.target_id<>''
AND NOT EXISTS(SELECT 1 FROM definitions d WHERE d.kind=r.target_kind AND d.id=r.target_id);
```

不要為了讓報告變成綠色而刪掉擴充欄位、移除未知 ID、補猜測數值或偽造典籍。已知欄位為 array/object 時原值放在 extras_json，並列報 unexpected_shape；傷口與 perk 的非預期型別也保留。原 JSON 字串及初始版本分別留在舊表、normalization_legacy_characters / normalization_legacy_definitions。這些表包含私人資料，備份和匯出應沿用現有私隱界線。

SQLite 欄位刻意不設型別 affinity，配合 shape_json 保存原本數字／數字字串差異；新輸入仍由既有 API 驗證。不要直接單獨修改正規化表，否則會破壞與舊 JSON 的相容寫入協議。既有維護工具仍寫舊欄位，觸發器在同一交易更新新表。

## 本次驗證紀錄（全部使用虛構資料）

- 全套 64 項測試、Prettier 檢查及正式前端 build 通過。
- Node 24 SQLite 隔離演練：13 個既有表逐列不變，11 份角色／典籍文件比對通過；8 個未知欄位及 3 個無效引用均保留並列報。
- 四種身份：擁有者、DM、其他玩家、唯讀者；兩個 bootstrap，共 8 個回應與 main `8ff5307` 的原版 Worker 相符，包含成功／403 與私人資料範圍。
- 新增回歸涵蓋所有映射欄位的缺失、null、布林、數字、字串與非預期結構；重複傷口、無法解析／重複 key 的回滾、舊 CLI 同步、perk 更新、引用補回、catalog 順序、CAS、去重及撤銷。
- Wrangler 4.157.0 本機 D1 與 workerd：完整 migration、上述原版 Worker API 比對、受傷／祈禱／重送去重、quick_check 及外鍵檢查通過。沒有使用 remote binding。
- 本機 D1 限制複合 SELECT 最多 5 個分支；產生器分層建立小視圖，使用 OFFSET 防止查詢攤平超限，並有回歸檢查。失敗版本的本機 migration 已確認整批回滾。

沒有取得或匯入真實玩家資料；以上不代表正式 D1、Google 登入或真實帳號端對端驗收完成。正式操作前，請在你的私人副本重跑演練並保存驗收紀錄。

## 完整欄位表

下表與 [映射原始碼](../live/scripts/normalization-schema.mjs) 相對應；SQL 由 `node live/scripts/generate-normalization.mjs` 產生並以測試核對。已套用後不可重新產生／修改 0003，後續變更必須新增 migration。

### character_profiles

來源：`characters.sheet`

| JSON 欄位 | SQL 欄位／關聯表 |
|---|---|
| `system_id` | `source_id` |
| `Campaign` | `source_campaign` |
| `Character Name` | `name` |
| `Level` | `level` |
| `Class` | `class_id` |
| `School` | `school_id` |
| `Background` | `background_id` |
| `Beliefs` | `beliefs` |
| `Background Story` | `story` |
| `Strength` | `strength` |
| `Dexterity` | `dexterity` |
| `Constitution` | `constitution` |
| `Intelligence` | `intelligence` |
| `Wisdom` | `wisdom` |
| `Charisma` | `charisma` |
| `Max Health` | `max_hp` |
| `Max Willpower` | `max_will` |
| `Armor Class` | `armor_class` |
| `Spell Difficulty` | `spell_dc` |
| `Available Spell Slots` | `spell_slots` |
| `Spells` | `source_spells` |
| `Weapons` | `source_weapons` |
| `Inventory` | `source_inventory` |
| `Notes` | `source_notes` |
| `Current Health` | `source_hp` |
| `Current Willpower` | `source_will` |
| `_baseStats` | `character_base_stats` |
| `_growth` | `character_growth` |

### character_base_stats

來源：`characters.sheet._baseStats`

| JSON 欄位 | SQL 欄位／關聯表 |
|---|---|
| `Strength` | `strength` |
| `Dexterity` | `dexterity` |
| `Constitution` | `constitution` |
| `Intelligence` | `intelligence` |
| `Wisdom` | `wisdom` |
| `Charisma` | `charisma` |

### character_growth

來源：`characters.sheet._growth`

| JSON 欄位 | SQL 欄位／關聯表 |
|---|---|
| `Strength` | `strength` |
| `Dexterity` | `dexterity` |
| `Constitution` | `constitution` |
| `Intelligence` | `intelligence` |
| `Wisdom` | `wisdom` |
| `Charisma` | `charisma` |

### character_resources

來源：`characters.state`

| JSON 欄位 | SQL 欄位／關聯表 |
|---|---|
| `hp` | `hp` |
| `temp` | `temp_hp` |
| `will` | `will` |
| `general` | `general` |
| `inventory` | `inventory` |
| `wounds` | `character_wounds` |

### catalog_classes

來源：`definitions[class].payload`

| JSON 欄位 | SQL 欄位／關聯表 |
|---|---|
| `system_id` | `source_id` |
| `Class Name (Chinese)` | `name_zh` |
| `Class Name (English)` | `name_en` |
| `Short Desc` | `summary` |
| `Faction` | `faction` |
| `Speed` | `speed` |
| `Class Desc` | `description` |
| `Level 1 Perk` | `class_perks` |
| `Level 2 Perk` | `class_perks` |
| `Level 3 Perk` | `class_perks` |
| `Level 4 Perk` | `class_perks` |
| `Level 5 Perk` | `class_perks` |
| `Level 6 Perk` | `class_perks` |
| `Level 7 Perk` | `class_perks` |
| `Level 8 Perk` | `class_perks` |

### catalog_schools

來源：`definitions[school].payload`

| JSON 欄位 | SQL 欄位／關聯表 |
|---|---|
| `system_id` | `source_id` |
| `School Name (Chinese)` | `name_zh` |
| `School Name (English)` | `name_en` |
| `Class` | `class_id` |
| `Belief` | `belief_id` |
| `Main Spell` | `main_spell_id` |
| `Title` | `title` |
| `Passive` | `passive` |
| `Desc` | `description` |

### catalog_spells

來源：`definitions[spell].payload`

| JSON 欄位 | SQL 欄位／關聯表 |
|---|---|
| `system_id` | `source_id` |
| `Spell Name (Chinese)` | `name_zh` |
| `Spell Name (English)` | `name_en` |
| `School` | `school_id` |
| `Action Type` | `action_type` |
| `Target` | `target` |
| `Exclusive` | `exclusive` |
| `Spell Desc` | `description` |

### catalog_weapons

來源：`definitions[weapon].payload`

| JSON 欄位 | SQL 欄位／關聯表 |
|---|---|
| `system_id` | `source_id` |
| `Weapon Name` | `name` |
| `Weapon Type` | `weapon_type` |
| `Damage` | `damage` |
| `Effect` | `effect` |
| `Reveal Effect` | `reveal_effect` |
| `Available` | `available` |

### catalog_beliefs

來源：`definitions[beliefs].payload`

| JSON 欄位 | SQL 欄位／關聯表 |
|---|---|
| `system_id` | `source_id` |
| `Name` | `name` |
| `Title` | `title` |
| `Quote` | `quote` |
| `Desc` | `description` |
| `Enable` | `enabled` |
| `Belief Effect 1` | `effect_1` |
| `Belief Effect 2` | `effect_2` |

### catalog_backgrounds

來源：`definitions[background].payload`

| JSON 欄位 | SQL 欄位／關聯表 |
|---|---|
| `system_id` | `source_id` |
| `Name` | `name` |
| `Main Branch` | `main_branch` |
| `Personality` | `personality` |
| `Desc` | `description` |
| `Skill 1` | `skill_1` |
| `Skill 2` | `skill_2` |
