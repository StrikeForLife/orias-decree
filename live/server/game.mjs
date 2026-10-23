import {fail} from './auth.mjs';
import {damage} from '../../dist/rules.mjs';
export const splitIds=x=>String(x||'').split(',').map(x=>x.trim()).filter(Boolean);
export const attrs=['Strength','Dexterity','Constitution','Intelligence','Wisdom','Charisma'];
export function integer(value,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)fail(400,'數值超出允許範圍');return value;}
export function text(value,max=30000){if(typeof value!=='string'||value.length>max)fail(400,'文字格式或長度無效');return value;}
export function applyResource(state,sheet,command){const s=structuredClone(state);switch(command.kind){
 case 'damage':{const n=integer(command.amount,1,100000);if(typeof command.exempt!=='boolean')fail(400,'缺少傷口判定設定');const d=damage(s.hp,s.temp,Number(sheet['Max Health']),n,command.exempt);s.hp=d.hp;s.temp=d.temp;if(d.deferred)s.wounds.push(d.deferred);break;}
 case 'temp':s.temp=Math.max(0,s.temp+integer(command.amount,-100000,100000));break;
 case 'pray':if(s.will<1)fail(409,'沒有足夠意志');s.will--;break;
 case 'settle':case 'stop':{const i=integer(command.index,0,s.wounds.length-1),[w]=s.wounds.splice(i,1);if(command.kind==='settle')s.hp-=w;break;}
 case 'stabilize':if(s.hp>0)fail(409,'目前角色沒有昏迷');s.hp=Math.ceil(Number(sheet['Max Health'])/10);break;
 case 'rest':s.will=Number(sheet['Max Willpower']);break;
 default:fail(400,'未知角色操作');
 }if(!Number.isSafeInteger(s.hp)||s.wounds.length>1000)fail(400,'角色狀態超出範圍');return s;}
export function derived(sheet){const level=Number(sheet.Level),con=Number(sheet.Constitution);return {...sheet,'Max Health':String(4+level*8+con*2),'Armor Class':String(12+Number(sheet.Dexterity)+Math.floor(con/2)),'Spell Difficulty':String(9+Math.ceil(level/2)+Number(sheet.Intelligence)),'Max Willpower':String(Math.ceil(level/4)+Math.max(Math.floor(Number(sheet.Charisma)/2),0))};}
export function validateStats(base,growth,level){if(!base||!growth)fail(400,'缺少屬性分配');let cost=0,gained=0,fours=0;for(const key of attrs){const b=integer(base[key],-3,4),g=integer(growth[key],0,4);cost+=b+1;gained+=g;if(b===4)fours++;if(b+g>5)fail(400,'屬性不能超過 +5');}if(cost!==14||fours>1||gained>Math.floor(level/2))fail(400,'屬性點數分配不符合規則');}
export function allowedSpells(classId,schoolId,defs){const school=defs.school.find(x=>x.system_id===schoolId),cl=defs.class.find(x=>x.system_id===classId);if(!school||school.Class!==classId||!cl||cl['Class Name (Chinese)'].includes('未開放')||school['School Name (Chinese)'].includes('未開放'))fail(400,'職業或法源道未開放');const groupA=['游俠','民俗法使','正道使','匠理士'],groupB=['野戰兵','特戰兵','指揮官'];const className=cl['Class Name (Chinese)'];return defs.spell.filter(sp=>{if(sp.School===schoolId)return true;if(sp.Exclusive)return false;const spSchool=defs.school.find(x=>x.system_id===sp.School),spClass=defs.class.find(x=>x.system_id===spSchool?.Class)?.['Class Name (Chinese)'];return groupA.includes(className)?groupA.includes(spClass):groupB.includes(className)?groupB.includes(spClass):className==='法源技士';}).map(x=>x.system_id);}
export function validateSpells(classId,schoolId,spellIds,slots,defs){if(!Array.isArray(spellIds)||new Set(spellIds).size!==spellIds.length||spellIds.length>slots)fail(400,'法術名額或選擇無效');const allowed=allowedSpells(classId,schoolId,defs),core=defs.school.find(x=>x.system_id===schoolId)['Main Spell'];if(!core||!spellIds.includes(core)||spellIds.some(id=>!allowed.includes(id)))fail(400,'必須選擇核心法術，並符合職業候選範圍');}
