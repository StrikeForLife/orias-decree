import {fail} from './auth.mjs';
import {integer,text,splitIds} from './game.mjs';

const result=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const q=x=>x===null?'NULL':"'"+String(x).replaceAll("'","''")+"'";
const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
const rows=async(db,sql,...args)=>(await statement(db,sql,...args).all()).results;
export const isSiteOwner=async(db,userId)=>!!(await statement(db,'SELECT 1 FROM site_owner WHERE singleton=1 AND user_id=?',userId).first());

/** Only an authoritative, verified Google login can claim an empty owner seat.
 * OWNER_EMAIL is a server-side bootstrap secret, not a browser setting.
 * Once claimed, changing that secret cannot silently transfer ownership.
 */
export async function claimSiteOwner(db,user,claims,email){
 if(email&&claims.email_verified===true&&(claims.email.endsWith('@gmail.com')||claims.hd)&&claims.email.toLowerCase()===email.trim().toLowerCase())
  await statement(db,'INSERT INTO site_owner(singleton,user_id,claimed_at) VALUES(1,?,?) ON CONFLICT(singleton) DO NOTHING',user.id,Date.now()).run();
}

/** Re-check conditions inside the same D1 transaction as writes and audit.
 * The CHECK guard aborts the whole batch on a stale version or changed reference.
 */
async function commit(db,s,conditions,writes,action,target,before,after){
 const id=crypto.randomUUID();
 try{await db.batch([
  statement(db,`INSERT INTO owner_checks(id,ok) SELECT ?,CASE WHEN (EXISTS(SELECT 1 FROM site_owner WHERE user_id=${q(s.user_id)})) AND (${conditions.join(') AND (')||'1'}) THEN 1 ELSE 0 END`,id),
  ...writes,
  statement(db,'INSERT INTO owner_audit(id,actor_id,action,target,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)',id,s.user_id,action,target,before===null?null:JSON.stringify(before),after===null?null:JSON.stringify(after),Date.now()),
  statement(db,'DELETE FROM owner_checks WHERE id=?',id)
 ]);}catch(e){if(/CHECK|UNIQUE|constraint/i.test(e.message))fail(409,'資料或引用已改變，請重新載入後再試');throw e;}
}

const kindNames={class:'職業',school:'法源道',spell:'法術',weapon:'武器',beliefs:'信仰',background:'出身'};
const nameFields={class:'Class Name (Chinese)',school:'School Name (Chinese)',spell:'Spell Name (Chinese)',weapon:'Weapon Name',beliefs:'Name',background:'Name'};
const nameOf=p=>p['Character Name']||p.Name||p['School Name (Chinese)']||p['Class Name (Chinese)']||p['Spell Name (Chinese)']||p['Weapon Name']||p.system_id;

async function catalog(db){return (await rows(db,'SELECT * FROM definitions ORDER BY kind,id')).map(r=>({...r,payload:JSON.parse(r.payload)}));}

/** All references count, including archived definitions and inactive campaigns. */
async function references(db,kind,id){
 const out=[];
 for(const c of await rows(db,'SELECT id,sheet FROM characters')){const p=JSON.parse(c.sheet);const field={class:'Class',school:'School',background:'Background',beliefs:'Beliefs'}[kind];if(field&&splitIds(p[field]).includes(id))out.push('角色：'+nameOf(p));}
 if(kind==='spell'||kind==='weapon')for(const c of await rows(db,`SELECT c.sheet FROM ${kind==='spell'?'character_spells':'character_weapons'} l JOIN characters c ON c.id=l.character_id WHERE l.${kind==='spell'?'spell_id':'weapon_id'}=?`,id))out.push('角色：'+nameOf(JSON.parse(c.sheet)));
 for(const d of await catalog(db)){const p=d.payload;
  if((kind==='class'&&d.kind==='school'&&p.Class===id)||(kind==='school'&&d.kind==='spell'&&p.School===id)||(kind==='beliefs'&&d.kind==='school'&&p.Belief===id)||(kind==='spell'&&d.kind==='school'&&p['Main Spell']===id))out.push(kindNames[d.kind]+'：'+nameOf(p));
 }
 return [...new Set(out)];
}

/** Conditions also protect against a player choosing a record during deletion. */
function unusedConditions(kind,id){
 const value=q(id),conditions=[];
 const field={class:'Class',school:'School',background:'Background'}[kind];
 if(field)conditions.push(`NOT EXISTS(SELECT 1 FROM characters WHERE json_extract(sheet,'$.${field}')=${value})`);
 if(kind==='beliefs')conditions.push(`NOT EXISTS(SELECT 1 FROM characters WHERE instr(','||replace(COALESCE(json_extract(sheet,'$.Beliefs'),''),' ','')||',',','||${value}||',')>0)`);
 if(kind==='spell'||kind==='weapon')conditions.push(`NOT EXISTS(SELECT 1 FROM ${kind==='spell'?'character_spells':'character_weapons'} WHERE ${kind==='spell'?'spell_id':'weapon_id'}=${value})`);
 const related={class:['school','Class'],school:['spell','School'],beliefs:['school','Belief'],spell:['school','Main Spell']}[kind];
 if(related)conditions.push(`NOT EXISTS(SELECT 1 FROM definitions WHERE kind=${q(related[0])} AND json_extract(payload,'$."${related[1]}"')=${value})`);
 return conditions;
}

async function validatePayload(db,kind,id,p){
 if(!kindNames[kind]||!/^[-\w]{1,100}$/.test(id))fail(400,'內容類型或 ID 無效');
 if(!p||typeof p!=='object'||Array.isArray(p)||p.system_id!==id)fail(400,'條目 ID 不一致');
 if(Object.keys(p).length>60||Object.entries(p).some(([k,v])=>k.length>100||!['string','number','boolean'].includes(typeof v)&&v!==null||String(v).length>80000)||JSON.stringify(p).length>120000)fail(400,'內容欄位格式或長度無效');
 if(!String(p[nameFields[kind]]||'').trim())fail(400,'請填寫中文名稱');
 const conditions=[];
 const check=async(k,target,required)=>{if(!target){if(required)fail(400,'缺少必要關聯：'+kindNames[k]);return;}
  const r=await statement(db,'SELECT * FROM definitions WHERE kind=? AND id=? AND archived=0',k,String(target)).first();if(!r)fail(400,'找不到可使用的'+kindNames[k]);
  conditions.push(`EXISTS(SELECT 1 FROM definitions WHERE kind=${q(k)} AND id=${q(target)} AND archived=0 AND version=${r.version})`);return JSON.parse(r.payload);};
 if(kind==='school'){await check('class',p.Class,true);await check('beliefs',p.Belief,false);const spell=await check('spell',p['Main Spell'],false);if(spell&&spell.School!==id)fail(400,'核心法術必須屬於此法源道');}
 if(kind==='spell')await check('school',p.School,true);
 return conditions;
}

/** Guard selected character definitions at commit time, avoiding archive/create races. */
export function selectionGuard(db,refs){
 const checks=refs.map(([kind,id])=>`EXISTS(SELECT 1 FROM definitions WHERE kind=${q(kind)} AND id=${q(id)} AND archived=0)`);
 const id='select:'+crypto.randomUUID();
 return {id,statement:statement(db,`INSERT INTO owner_checks(id,ok) SELECT ?,CASE WHEN (${checks.join(') AND (')||'1'}) THEN 1 ELSE 0 END`,id),cleanup:statement(db,'DELETE FROM owner_checks WHERE id=?',id)};
}

export async function ownerRoutes(req,env,s,path,b){
 const db=env.DB;if(!await isSiteOwner(db,s.user_id))fail(403,'此管理後台只限網站擁有者');
 if(path==='/api/owner/bootstrap'&&req.method==='GET')return result({
  owner:{name:s.name,email:s.email},catalog:await catalog(db),campaigns:await rows(db,'SELECT * FROM campaigns ORDER BY name'),
  members:await rows(db,'SELECT a.id,a.email,a.campaign_id,a.role,a.version,a.user_id IS NOT NULL AS claimed FROM access_grants a ORDER BY campaign_id,role,email'),
  audit:await rows(db,'SELECT * FROM owner_audit ORDER BY created_at DESC,id LIMIT 100')
 });
 if(path==='/api/owner/content'&&req.method==='POST'){
  const kind=text(b.kind,30),id=text(b.id,100),old=await statement(db,'SELECT * FROM definitions WHERE kind=? AND id=?',kind,id).first();
  if(old?.archived)fail(409,'請先從已刪除內容復原此條目');
  if(old?b.version!==old.version:b.version!==null)fail(409,'內容已改變，請重新載入');
  const conditions=await validatePayload(db,kind,id,b.payload);
  if(old){const prev=JSON.parse(old.payload),changed=['Class','School','Belief','Main Spell'].some(k=>(prev[k]||'')!==(b.payload[k]||''));if(changed){const refs=await references(db,kind,id);if(refs.length)fail(409,'此條目已被引用，不能直接更換關聯：'+refs.slice(0,5).join('、'));conditions.push(...unusedConditions(kind,id));}
   conditions.push(`EXISTS(SELECT 1 FROM definitions WHERE kind=${q(kind)} AND id=${q(id)} AND version=${old.version} AND payload=${q(old.payload)} AND archived=0)`);
  }else conditions.push(`NOT EXISTS(SELECT 1 FROM definitions WHERE kind=${q(kind)} AND id=${q(id)})`);
  await commit(db,s,conditions,[old?statement(db,'UPDATE definitions SET payload=?,version=version+1 WHERE kind=? AND id=?',JSON.stringify(b.payload),kind,id):statement(db,'INSERT INTO definitions(kind,id,payload) VALUES(?,?,?)',kind,id,JSON.stringify(b.payload))],old?'content.update':'content.create',kind+':'+id,old?JSON.parse(old.payload):null,b.payload);
  return result({ok:true,id,version:old?old.version+1:0},old?200:201);
 }
 if(path==='/api/owner/content/archive'&&req.method==='POST'){
  const {kind,id}=b,old=await statement(db,'SELECT * FROM definitions WHERE kind=? AND id=?',kind,id).first();
  if(!old)fail(404,'內容不存在');if(old.version!==b.version)fail(409,'內容已改變');if(typeof b.archived!=='boolean')fail(400,'刪除狀態無效');
  if(!!old.archived===b.archived)return result({ok:true,version:old.version});
  const conditions=[`EXISTS(SELECT 1 FROM definitions WHERE kind=${q(kind)} AND id=${q(id)} AND version=${old.version} AND payload=${q(old.payload)} AND archived=${old.archived})`];
  if(b.archived){const refs=await references(db,kind,id);if(refs.length)fail(409,'仍被引用，無法刪除：'+refs.slice(0,8).join('、'));conditions.push(...unusedConditions(kind,id));}
  else conditions.push(...await validatePayload(db,kind,id,JSON.parse(old.payload)));
  await commit(db,s,conditions,[statement(db,'UPDATE definitions SET archived=?,version=version+1 WHERE kind=? AND id=?',b.archived?1:0,kind,id)],b.archived?'content.archive':'content.restore',kind+':'+id,{payload:JSON.parse(old.payload),archived:!!old.archived},{payload:JSON.parse(old.payload),archived:b.archived});
  return result({ok:true,version:old.version+1});
 }
 if(path==='/api/owner/member'&&req.method==='POST'){
  const email=text(b.email,254).trim().toLowerCase(),role=b.role,campaign=b.campaignId;
  if(!/^[^\s@'";]+@[^\s@'";]+\.[^\s@'";]+$/.test(email)||!['reader','player','dm'].includes(role))fail(400,'電郵或權限無效');
  if(!await statement(db,'SELECT 1 FROM campaigns WHERE id=?',campaign).first())fail(404,'戰役不存在');
  const old=await statement(db,'SELECT * FROM access_grants WHERE email=? AND campaign_id=?',email,campaign).first();
  if(old?(old.id!==b.id||old.version!==b.version):b.id!==null||b.version!==null)fail(409,'名單已改變，請重新載入');
  if((old?.role||'reader')===role)return result({ok:true,unchanged:true});
  const where=`email=${q(email)} AND campaign_id=${q(campaign)}`;
  const conditions=[old?`EXISTS(SELECT 1 FROM access_grants WHERE ${where} AND id=${q(old.id)} AND version=${old.version} AND role=${q(old.role)})`:`NOT EXISTS(SELECT 1 FROM access_grants WHERE ${where})`];
  if(old?.role==='dm'&&role!=='dm'){
   const other=await statement(db,"SELECT 1 FROM access_grants a JOIN users u ON u.id=a.user_id WHERE a.campaign_id=? AND a.role='dm' AND a.id<>? AND u.google_sub IS NOT NULL",campaign,old.id).first();
   if(!other)fail(409,'必須保留另一位已登入認領的 DM');
   conditions.push(`EXISTS(SELECT 1 FROM access_grants a JOIN users u ON u.id=a.user_id WHERE a.campaign_id=${q(campaign)} AND a.role='dm' AND a.id<>${q(old.id)} AND u.google_sub IS NOT NULL)`);
  }
  const writes=[statement(db,`DELETE FROM sessions WHERE user_id IN(SELECT id FROM users WHERE lower(email)=? UNION SELECT user_id FROM access_grants WHERE ${where} AND user_id IS NOT NULL)`,email)];
  if(role==='reader')writes.push(statement(db,'DELETE FROM access_grants WHERE email=? AND campaign_id=?',email,campaign));
  else if(old)writes.push(statement(db,'UPDATE access_grants SET role=?,version=version+1 WHERE id=?',role,old.id));
  else writes.push(statement(db,'INSERT INTO access_grants(id,email,campaign_id,role) VALUES(?,?,?,?)',crypto.randomUUID(),email,campaign,role));
  await commit(db,s,conditions,writes,'member.'+role,campaign+':'+email,old?{email,role:old.role,campaignId:campaign}:null,{email,role,campaignId:campaign});
  const self=email===s.email.toLowerCase();return result({ok:true,signInAgain:self});
 }
 if(path==='/api/owner/campaign'&&req.method==='POST'){
  const id=text(b.id,100);if(!/^[-\w]{1,100}$/.test(id))fail(400,'戰役 ID 無效');const old=await statement(db,'SELECT * FROM campaigns WHERE id=?',id).first();
  if(old?old.version!==b.version:b.version!==null)fail(409,'戰役已改變');const name=text(b.name,150).trim(),nameEn=text(b.name_en,200),intro=text(b.intro,50000);if(!name)fail(400,'請填寫戰役名稱');
  const conditions=[old?`EXISTS(SELECT 1 FROM campaigns WHERE id=${q(id)} AND version=${old.version})`:`NOT EXISTS(SELECT 1 FROM campaigns WHERE id=${q(id)})`];
  const writes=[old?statement(db,'UPDATE campaigns SET name=?,name_en=?,intro=?,version=version+1 WHERE id=?',name,nameEn,intro,id):statement(db,'INSERT INTO campaigns(id,name,name_en,intro) VALUES(?,?,?,?)',id,name,nameEn,intro)];
  // Give a new campaign an already claimed DM: the owner creating it.
  if(!old)writes.push(statement(db,"INSERT INTO access_grants(id,email,google_sub,user_id,campaign_id,role) VALUES(?,?,?,?,?,'dm')",crypto.randomUUID(),s.email,s.google_sub,s.user_id,id));
  await commit(db,s,conditions,writes,old?'campaign.update':'campaign.create',id,old||null,{id,name,name_en:nameEn,intro});return result({ok:true,id});
 }
 fail(404,'找不到此管理操作');
}
