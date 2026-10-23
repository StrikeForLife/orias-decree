/** Google identity validation and opaque server sessions. No client-supplied role is trusted. */
export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export const fail=(status,message)=>{throw new HttpError(status,message)};
const enc=new TextEncoder();
export const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
export const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export function cookieNames(env){const secure=env.APP_ORIGIN?.startsWith('https://');return {secure,session:secure?'__Host-oria_session':'oria_session',nonce:secure?'__Host-oria_nonce':'oria_nonce'};}
export function cookies(req){return Object.fromEntries((req.headers.get('Cookie')||'').split(';').map(x=>x.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2));}
export function setCookie(name,value,seconds,env){return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${cookieNames(env).secure?'; Secure':''}`;}
export function originCheck(req,env){if(!env.APP_ORIGIN||req.headers.get('Origin')!==env.APP_ORIGIN)fail(403,'請由正式網站提交操作');}
let keyCache=null;
export async function googleKeys(force=false){if(!force&&keyCache&&keyCache.expires>Date.now())return keyCache.keys;const r=await fetch('https://www.googleapis.com/oauth2/v3/certs');if(!r.ok)fail(503,'Google 驗證服務暫時未能連接');const body=await r.json();if(!Array.isArray(body.keys))fail(503,'Google 公鑰格式無效');keyCache={keys:body.keys,expires:Date.now()+Math.min(86400,Number(r.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1]||3600))*1000};return body.keys;}
/** Injectable key provider is for deterministic signature tests, never controlled by HTTP input. */
export async function verifyGoogleToken(token,clientId,nonce,keyProvider=googleKeys,now=Math.floor(Date.now()/1000)){
 try{if(typeof token!=='string'||token.length>16000||!clientId||!nonce)fail(401,'登入資料無效');const parts=token.split('.');if(parts.length!==3)fail(401,'登入資料無效');const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
 if(header.alg!=='RS256'||typeof header.kid!=='string')fail(401,'登入簽章無效');let keys=await keyProvider();let jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA');if(!jwk){keys=await keyProvider(true);jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA')}if(!jwk)fail(401,'Google 登入公鑰已變更，請重新登入');const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),enc.encode(parts[0]+'.'+parts[1]));
 if(!ok||!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||claims.aud!==clientId||(claims.azp&&claims.azp!==clientId)||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+60||claims.iat<now-7200||claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub||claims.email_verified!==true||typeof claims.email!=='string')fail(401,'Google 登入驗證失敗，請重新登入');return {...claims,email:claims.email.toLowerCase()};
 }catch(e){if(e instanceof HttpError)throw e;fail(401,'Google 登入資料無效');}
}
export async function session(req,env){const token=cookies(req)[cookieNames(env).session];if(!token||!/^[a-f0-9]{64}$/.test(token))fail(401,'請先使用 Google 登入');const row=await env.DB.prepare('SELECT s.*,u.email,u.name,u.google_sub FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>?').bind(await hash(token),Date.now()).first();if(!row)fail(401,'登入已過期，請重新登入');return row;}
export function csrfCheck(req,s,env){originCheck(req,env);if(req.headers.get('X-CSRF-Token')!==s.csrf)fail(403,'操作驗證已過期，請重新整理');}
