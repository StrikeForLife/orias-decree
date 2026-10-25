// Motion never delays an API request or changes gameplay state.
const activeMotions=new WeakMap();
function animateSurface(element,frames,options={}){
 if(!element||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 activeMotions.get(element)?.cancel();
 const animation=element.animate(frames,{duration:300,easing:'cubic-bezier(.2,.7,.3,1)',...options});
 activeMotions.set(element,animation);
}
function animateResourceFeedback(kind){
 if(kind==='damage')animateSurface($('#status .vitality-chamber'),[
  {transform:'translateX(0)',boxShadow:'inset 0 0 0 2px #ef857acc,0 0 22px #b63d4055'},
  {transform:'translateX(-4px)',offset:.18},{transform:'translateX(3px)',offset:.36},
  {transform:'translateX(-2px)',offset:.55},{transform:'translateX(0)',boxShadow:'inset 0 0 0 3px #141e2255'}
 ],{duration:520});
 if(kind==='pray')animateSurface($('#status .will-chamber'),[
  {boxShadow:'inset 0 0 0 1px #c9a5ed55',filter:'brightness(1)'},
  {boxShadow:'inset 0 0 28px #be9ae455,0 0 18px #e3c78c55',filter:'brightness(1.25)',offset:.4},
  {boxShadow:'inset 0 0 0 3px #141e2255',filter:'brightness(1)'}
 ],{duration:720});
}
// Observe content replacement, not form typing or style changes.
new MutationObserver(()=>animateSurface($('#detail'),[
 {opacity:.35,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}
])).observe($('#detail'),{childList:true});
document.querySelector('header nav').addEventListener('click',event=>{
 const button=event.target.closest('[data-page]');if(!button)return;
 animateSurface(button,[{transform:'rotate(0deg)'},{transform:'rotate(-3deg)',offset:.25},
  {transform:'rotate(2deg)',offset:.55},{transform:'rotate(-.7deg)',offset:.8},{transform:'rotate(0deg)'}
 ],{duration:460});
 animateSurface($('#content'),[{opacity:.4,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}]);
});
document.addEventListener('click',event=>{
 if(!event.target.closest('[data-view],[data-archive],#teamStats,#teamBackground,#growthCharacter'))return;
 animateSurface($('#content'),[{opacity:.4,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}]);
});
