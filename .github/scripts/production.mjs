/** Release helpers. Generate explicit production bindings and perform SELECT-only
 * schema checks; never apply migrations, import data, or write Worker secrets.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function productionConfig(base,settings,account){
 if(!/^[a-f\d]{32}$/i.test(account||''))throw Error('Set repository variable CLOUDFLARE_ACCOUNT_ID to the 32-character account ID.');
 if(settings.workerName!=='oria-decree'||settings.databaseName!=='oria-decree'||!/^[-a-f\d]{36}$/i.test(settings.databaseId||''))throw Error('Invalid production Worker/D1 settings.');
 const origin=new URL(settings.origin);if(origin.protocol!=='https:'||origin.origin!==settings.origin)throw Error('Production origin must be an HTTPS origin without a path or trailing slash.');
 if(!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(settings.googleClientId||''))throw Error('Invalid Google Web Client ID.');
 if(base.main!=='server/worker.mjs'||base.assets?.directory!=='./public')throw Error('Selected release has an incompatible application layout.');
 return {...base,name:settings.workerName,account_id:account,
  d1_databases:[{binding:'DB',database_name:settings.databaseName,database_id:settings.databaseId,migrations_dir:'migrations'}],
  vars:{...base.vars,APP_ORIGIN:settings.origin,GOOGLE_CLIENT_ID:settings.googleClientId}};
}

export function checkMigrations(applied,expected){
 const current=new Set(applied),local=new Set(expected);
 const pending=expected.filter(name=>!current.has(name)),unknown=applied.filter(name=>!local.has(name));
 if(pending.length||unknown.length)throw Error('Schema mismatch. Apply reviewed migrations separately before deploying, or select a compatible release. Pending: '+(pending.join(', ')||'none')+'. Unknown applied: '+(unknown.join(', ')||'none')+'.');
 return [...local].sort();
}

export async function preflight(config,migrations,token,fetcher=fetch){
 if(!token)throw Error('Add repository secret CLOUDFLARE_API_TOKEN before running production deployment.');
 const account=config.account_id,database=config.d1_databases?.[0]?.database_id;
 if(!/^[a-f\d]{32}$/i.test(account||'')||!/^[-a-f\d]{36}$/i.test(database||''))throw Error('Invalid generated production configuration.');
 const query=async sql=>{
  const r=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql,params:[]}),signal:AbortSignal.timeout(20000)
  });
  if(!r.ok)throw Error('Cloudflare schema check failed (HTTP '+r.status+'). Check account ID, D1 ID and D1 Read permission.');
  const b=await r.json();if(!b.success||!b.result?.[0]?.success||!Array.isArray(b.result[0].results))throw Error('Cloudflare schema check was rejected. Check migration history and token permissions.');
  return b.result[0].results;
 };
 const applied=await query('SELECT name FROM d1_migrations ORDER BY name');
 const verified=checkMigrations(applied.map(x=>x.name),migrations);
 const owners=await query('SELECT COUNT(*) AS total FROM site_owner');
 if(Number(owners[0]?.total)!==1)throw Error('Expected an established website owner in production. Check the database target before deploying.');
 return {migrations:verified,ownerBindingPresent:true};
}

async function main(){
 const [command,settingsFile]=process.argv.slice(2);
 if(command==='prepare'){
  const base=JSON.parse(await fs.readFile('live/wrangler.jsonc','utf8'));
  const settings=JSON.parse(await fs.readFile(settingsFile,'utf8'));
  const config=productionConfig(base,settings,process.env.CLOUDFLARE_ACCOUNT_ID);
  await fs.writeFile('live/wrangler.actions.jsonc',JSON.stringify(config,null,2)+'\n');
  console.log('Prepared explicit production configuration for '+config.name);return;
 }
 if(command==='preflight'){
  const config=JSON.parse(await fs.readFile('live/wrangler.actions.jsonc','utf8'));
  const migrations=(await fs.readdir('live/migrations')).filter(x=>x.endsWith('.sql')).sort();
  const verified=await preflight(config,migrations,process.env.CLOUDFLARE_API_TOKEN);
  console.log('Production schema verified: '+verified.migrations.join(', '));return;
 }
 throw Error('Use prepare <trusted-production-settings.json> or preflight.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
