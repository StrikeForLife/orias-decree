import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const destination=path.resolve(process.argv[2]||'oria-github-source');
if(destination===root||destination.startsWith(root+path.sep))throw Error('Export outside the source checkout');
try{await fs.access(destination);throw Error('Destination already exists; choose a new empty path');}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.mkdir(destination,{recursive:true});
async function copy(relative){const target=path.join(destination,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,relative),target);}
async function walk(relative){for(const item of await fs.readdir(path.join(root,relative),{withFileTypes:true})){const f=relative+'/'+item.name;if(item.isDirectory())await walk(f);else if(/\.(?:mjs|js|css|html|svg|sql|md|txt)$/.test(item.name))await copy(f);}}
for(const dir of ['live/server','live/frontend','live/migrations','live/scripts','live/test','dist/patterns'])await walk(dir);
for(const f of ['package.json','live/package.json','live/README.md','live/MAINTENANCE.md','live/OWNER-CONSOLE.md','dist/index.html','dist/app.js','dist/style.css','dist/lore-colours.mjs','dist/rules.mjs'])await copy(f);
const config=JSON.parse(await fs.readFile(path.join(root,'live/wrangler.jsonc'),'utf8'));config.d1_databases[0].database_id='REPLACE_WITH_CREATED_D1_DATABASE_ID';config.vars.APP_ORIGIN='https://REPLACE_WITH_WORKER_HOST';config.vars.GOOGLE_CLIENT_ID='';
await fs.writeFile(path.join(destination,'live/wrangler.jsonc'),JSON.stringify(config,null,2)+'\n');
await fs.writeFile(path.join(destination,'live/.env.example'),'GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com\nAPP_ORIGIN=http://localhost:8787\nOWNER_EMAIL=your-google-account@gmail.com\nORIA_DB_PATH=.runtime/oria.sqlite\n');
await fs.writeFile(path.join(destination,'.gitignore'),'node_modules/\n**/.runtime/\n**/.wrangler/\nlive/public/\n**/backups/\n.env\n.env.*\n!.env.example\n.dev.vars\n.dev.vars.*\n**/.env\n**/.env.*\n!**/.env.example\n**/.dev.vars\n**/.dev.vars.*\n*.backup.sql\ncontent-edit.json\n**/import-mapping.json\ndist/data.json\ndist/background.json\nwrangler.recovery.jsonc\n');
await fs.mkdir(path.join(destination,'.github/workflows'),{recursive:true});
await fs.writeFile(path.join(destination,'.github/workflows/checks.yml'),`name: Application checks\non: [push, pull_request]\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - uses: actions/setup-node@v7\n        with:\n          node-version: '24'\n          package-manager-cache: false\n      - run: npm test\n      - run: npm run build:live\n`);
await fs.writeFile(path.join(destination,'README.md'),`# 法源律令 · Oria’s Decree\n\n繁體中文 TRPG 角色控制台：Google 登入、Cloudflare Workers + D1、角色資源、場次筆記及擁有者圖形管理室。\n\n## 開發與檢查\n\n需要 Node.js 24，沒有應用程式 npm 套件依賴。\n\n\`\`\`sh\nnpm test\nnpm run build:live\ncd live\n# 複製 .env.example 為 .env 並填入自己的 Google 登入設定\nnpm run dev\n\`\`\`\n\n本機會建立空白 SQLite 資料庫及套用 schema。首次 Google 登入符合伺服器 OWNER_EMAIL 才能認領擁有者；之後可用典藏管理室建立戰役及內容。\n\n## 部署\n\n1. 在 live/wrangler.jsonc 設定自己的 D1 ID、網站 origin、Google Web Client ID。\n2. 用 Wrangler 登入自己的 Cloudflare 帳號並執行 D1 migrations。\n3. 用 \`npx wrangler@4 secret put OWNER_EMAIL\` 設定首次擁有者 Google 電郵。\n4. build 後 deploy；將實際 HTTPS origin 加到 Google OAuth 的 JavaScript origins。\n5. 以本人 Google 帳號登入，建立擁有者綁定。\n\n詳細說明：[擁有者後台](live/OWNER-CONSOLE.md)、[維護手冊](live/MAINTENANCE.md)、[技術說明](live/README.md)。\n\n## 資料界線\n\nRepository 不包含真實角色、私人筆記、帳號對照、備份或憑證，也不包含先前私人版本的 Git history。測試使用虛構資料。正式資料保存在 D1，網站內編輯不會自動回寫 Git 或 Google Sheets。\n\n舊資料 seed 工具需由管理者另提供私人來源快照，不是重新部署必要步驟；已有 D1 不要重跑 seed。GitHub Actions 只檢查測試與 build，不部署至正式環境。\n`);
console.log('Sanitized GitHub source: '+destination);
