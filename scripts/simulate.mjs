import * as R from '../public/js/rules.js';
const cost={GLITCH:1,ERASER:2,VOID:2,PURGE:3};
function greedy(s, side){
  const legal=R.legalPlays(s,side); let c=s.compute[side]; const out=[];
  const pool=[...legal].sort(()=>Math.random()-0.5);
  for(const p of pool){ if(out.length>=4) break; const st=R.cloneState(s);
    if(R.validate(st,side,p.cardId,p.lane)) continue;
    const cc=(R.cardsFor(side)[p.cardId]||{}).cost ?? cost[p.cardId] ?? 9;
    if(cc>c) continue; out.push(p); c-=cc; }
  return out;
}
let tally={hero:0,forgetter:0,draw:0}, turns=[];
for(let i=0;i<300;i++){
  let s=R.createState();
  let guard=0;
  while(!s.over && guard++<50){
    for(const side of ['hero','forgetter']){
      for(const p of greedy(s,side)){ if(!R.validate(s,side,p.cardId,p.lane)) R.applyPlay(s,side,p.cardId,p.lane); }
    }
    R.resolveCombat(s); R.checkOver(s); if(s.over) break; R.endRound(s); R.checkOver(s);
  }
  tally[s.over||'draw']++; turns.push(s.turn);
}
console.log(tally, 'avgTurns', (turns.reduce((a,b)=>a+b,0)/turns.length).toFixed(1));
