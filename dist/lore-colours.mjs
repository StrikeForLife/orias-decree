/** Source swatches from the supplied faction chart. Source hex values are authoritative.
 * Dark-mode accents mix these with their paired light colour; source records remain unchanged.
 */
export const PALETTES={
 radiance:['光明','#40bf6a','#d1fad8'], reality:['現實','#663300','#ebccad'], order:['規律','#33ccb3','#cffaF5'], eternity:['永恆／斯塔羅斯','#7a8fb8','#cceeff'],
 knowledge:['知識','#009999','#cffcfc'], freedom:['自由／厄特彌姆','#ff5500','#ffe6cc'], vitality:['生命／澤塔爾','#1f7a1f','#daf7d4'], ravage:['破敗','#ffaa00','#ffeecc'],
 abundance:['豐饒','#00cc22','#daf7d4'], sovereignty:['主權','#195de6','#ccccff'], strength:['力量','#33ccb3','#cffaf5'], paragon:['天工','#998833','#ffeecc'],
 quintessence:['太初／亞斯托里','#190099','#d5ccff'], abhorrence:['恨惡','#2e3338','#e3e6e8'], caprice:['夢念／普特里尼','#e06ef7','#f1d4f7'], strife:['鬥爭','#990000','#ffd5cc'],
 velarchia:['佩拉紀亞','#330561','#e6ccff'], exoris:['伊索尼斯','#cc0000','#ffcccc'], demidelfia:['德米黛菲亞','#998833','#ffeecc'], surf:['涻納聯合研究院','#003366','#dbe2f0'],
 neutral:['未指定配色','#78858c','#d9e0e2']
};
export const BELIEF_KEYS={'2335050c':'radiance','610a2f51':'reality','167d8e9d':'order','86718b8a':'eternity','368c14c1':'knowledge','fb43faea':'freedom','a92643e5':'vitality','26e6815c':'ravage','22c3b301':'abundance','6c89727e':'sovereignty','ededfe6e':'strength','6eb987d9':'paragon','2c24f411':'quintessence','6cdf7771':'abhorrence','7d7ead1e':'caprice','c0a684e4':'strife'};
export function originKey(branch=''){return [['厄特彌姆','freedom'],['澤塔爾','vitality'],['柯奈斯','vitality'],['斯塔羅斯','eternity'],['亞斯托里','quintessence'],['普特里尼','caprice'],['佩拉紀亞','velarchia'],['伊索尼斯','exoris'],['德米黛菲亞','demidelfia'],['涻納聯合研究院','surf']].find(([name])=>branch.includes(name))?.[1]||'neutral'}
export function mixHex(a,b,weight=.65){const rgb=x=>x.slice(1).match(/../g).map(v=>parseInt(v,16));return '#'+rgb(a).map((v,i)=>Math.round(v*(1-weight)+rgb(b)[i]*weight).toString(16).padStart(2,'0')).join('')}
export function tones(key){const [name,base,light]=PALETTES[key]||PALETTES.neutral;return {name,base,light,accent:mixHex(base,light),fill:mixHex('#172124',base,.18)}}

// Restore the original, single-colour class swatches from the first archive design.
export const CLASS_SWATCHES=['#b99d73','#98bfa2','#c2a1cd','#d19b78','#a6b99b','#91b6c8','#c69e9e','#a9a4ce','#c9ba82'];
CLASS_SWATCHES.forEach((colour,i)=>{PALETTES['class-'+i]=['職業配色',colour,colour]});
