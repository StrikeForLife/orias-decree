/** Visual QA only: synthetic, in-memory data; never mounted by the Worker. */
import http from 'node:http';
import fs from 'node:fs/promises';
const html=`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>典藏管理室 · 視覺測試</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/owner-console.css"><body><button id="open">✺ 典藏管理室</button><script type="module" src="/fixture.js"></script></body></html>`;
const fixture=`import {openOwnerConsole} from '/owner-console.js';
const data={owner:{name:'網站擁有者',email:'keeper@example.invalid'},catalog:[],campaigns:[{id:'campaign-demo',name:'法源律令：破門律',name_en:'Oria’s Decree',intro:'同一世界，萬千意志。',active:1,version:0}],members:[{id:'dm',email:'keeper@example.invalid',campaign_id:'campaign-demo',role:'dm',version:0,claimed:1},{id:'player',email:'player@example.invalid',campaign_id:'campaign-demo',role:'player',version:0,claimed:1}],audit:[]};
function add(kind,id,payload){data.catalog.push({kind,id,payload:{system_id:id,...payload},version:0,archived:0});}
add('class','ranger',{'Class Name (Chinese)':'游俠','Class Name (English)':'Ranger','Class Desc':'穿梭戰場，窮追猛打。'});
add('school','wind',{'School Name (Chinese)':'詠劍道','School Name (English)':'Wuthering Bladesong',Class:'ranger',Belief:'freedom','Main Spell':'spell-0',Title:'與武器共舞'});
add('beliefs','freedom',{Name:'自由 Freedom',Title:'無常之翼 Impermanent Wings',Desc:'從風的萬變之中尋找自己的道路。'});
add('weapon','blade',{'Weapon Name':'佩刀','Weapon Type':'主武器 Main Weapon',Damage:'1d8',Effect:'銳利且輕巧的佩刀。'});
add('background','origin',{Name:'臨海花園 – 利福斯 Liphos','Main Branch':'伊索尼斯聯邦',Desc:'繁榮的海港城市。'});
const names=['流風發散','順風而行','舞風','靈木槌擊','嫁接回春','盤根錯節','寂靜極星','披星引路','天星奇襲','晨風打擊','風壓拳','領風術'];
names.forEach((name,i)=>add('spell','spell-'+i,{'Spell Name (Chinese)':name,'Spell Name (English)':i?'Wind Technique':'Flow Dispersion',School:'wind','Action Type':'Action',Target:'自身（半徑 10 呎的錐形或弧形）',Exclusive:i?'':'Exclusive','Spell Desc':'你揮動已共鳴的武器，劃出一道銳利的風壓弧線。\\n\\n對範圍內你選擇的至多三個可見生物，分別進行一次近戰武器攻擊檢定。'}));
async function api(path,{body}={}){if(path.endsWith('bootstrap'))return structuredClone(data);const before=JSON.stringify(body);
if(path.endsWith('/content')){let item=data.catalog.find(x=>x.kind===body.kind&&x.id===body.id);if(item){item.payload=body.payload;item.version++;}else data.catalog.push({...body,archived:0,version:0});}
if(path.endsWith('/archive')){const item=data.catalog.find(x=>x.kind===body.kind&&x.id===body.id);item.archived=body.archived?1:0;item.version++;}
if(path.endsWith('/member')){const old=data.members.find(x=>x.id===body.id);if(body.role==='reader')data.members=data.members.filter(x=>x!==old);else if(old){old.role=body.role;old.version++;}else data.members.push({id:'member-'+Date.now(),email:body.email,campaign_id:body.campaignId,role:body.role,version:0,claimed:0});}
data.audit.unshift({id:String(Date.now()),action:path.endsWith('/member')?'member.'+body.role:path.endsWith('/archive')?(body.archived?'content.archive':'content.restore'):'content.update',target:body.id||body.email,before_json:null,after_json:before,created_at:Date.now()});return {ok:true};}
document.querySelector('#open').onclick=()=>openOwnerConsole({api});await openOwnerConsole({api});`;
const sources={'/':()=>new Response(html,{'headers':{'Content-Type':'text/html'}}),'/fixture.js':()=>new Response(fixture,{headers:{'Content-Type':'text/javascript'}})};
http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;let r;if(sources[pathname])r=sources[pathname]();else{const file={'/owner-console.js':'../frontend/owner-console.js','/owner-console.css':'../frontend/owner-console.css','/style.css':'../../dist/style.css'}[pathname];r=file?new Response(await fs.readFile(new URL(file,import.meta.url)),{headers:{'Content-Type':pathname.endsWith('.css')?'text/css':'text/javascript'}}):new Response('Not found',{status:404});}res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));}catch{res.writeHead(500);res.end('Preview error');}}).listen(4173,'0.0.0.0',()=>console.log('Synthetic owner console visual preview'));
