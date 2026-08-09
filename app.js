'use strict';

const S={noble:'귀족',faith:'신앙',scholar:'학문',craft:'장인',peasant:'농민',military:'군사'};
const C=(name,ko,place,cost,shields,formula,score,opts={})=>({id:name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),name,ko,place,cost,shields,formula,score,...opts});

// score 객체의 type을 calculateCardScore()가 해석합니다.
const cards=[
C('Alchemist','연금술사','castle',6,['scholar'],'할인 배너 1개당 4점',{type:'discounts',per:4}, {effect:'이후 모든 카드 비용 -1'}),
C('Apothecary','약제사','castle',3,['scholar'],'같은 열의 학문 방패당 3점',{type:'lineShield',axis:'col',shield:'scholar',per:3},{effect:'이후 성 카드 비용 -1'}),
C('Architect','건축가','castle',4,['scholar'],'서로 다른 방패 종류당 2점',{type:'distinctAll',per:2},{effect:'이후 마을 카드 비용 -1'}),
C('Armorer','무기상','village',3,['craft'],'같은 행 또는 열의 군사 방패당 3점',{type:'crossShield',shield:'military',per:3},{effect:'이후 모든 카드 비용 -1'}),
C('Astronomer','천문학자','castle',5,['scholar','scholar'],'왼쪽 열이면 8점',{type:'position',positions:['left'],points:8},{effect:'이후 성 카드 비용 -1'}),
C('Baker','제빵사','village',0,['peasant'],'모서리가 아닌 가장자리 칸이면 3점',{type:'position',positions:['edge'],points:3},{effect:'농민 방패당 금 1, 마을 카드당 열쇠 1'}),
C('Banker','금융업자','castle',7,['craft'],'모든 지갑에 저장된 금 1개당 1점',{type:'allPurses',per:1},{effect:'각 지갑에 금 2 또는 열쇠 3'}),
C('Barbarian','이방인','village',2,['military'],'학문 방패가 없으면 10점',{type:'missingShield',shield:'scholar',points:10}),
C('Baron','남작','castle',3,['noble'],'농민 방패가 없으면 10점',{type:'missingShield',shield:'peasant',points:10},{effect:'이후 모든 카드 비용 -1'}),
C('Beekeeper','양봉인','village',2,['peasant'],'이 지갑의 금 1개당 2점',{type:'purse',per:2},{purse:9,effect:'각 지갑에 금 2'}),
C('Beggar','거지','village',0,['peasant'],'같은 행 또는 열의 신앙 방패당 2점',{type:'crossShield',shield:'faith',per:2}),
C('Blacksmith','대장장이','village',5,['military','craft'],'방패가 2개인 카드당 2점',{type:'doubleShieldCards',per:2}),
C('Bombardier','포병','village',2,['military'],'같은 열의 군사 방패당 3점',{type:'lineShield',axis:'col',shield:'military',per:3}),
C('Brigand','도적','village',7,['peasant'],'마을 카드 3장 세트당 7점',{type:'setsPlace',place:'village',size:3,per:7}),
C('Captain','지휘관','castle',5,['military','military'],'오른쪽 열이면 8점',{type:'position',positions:['right'],points:8},{effect:'이후 마을 카드 비용 -1'}),
C('Cardinal','추기경','castle',4,['faith'],'같은 행의 신앙 방패당 3점',{type:'lineShield',axis:'row',shield:'faith',per:3}),
C('Carpenter','목수','village',0,['craft'],'뒷면 카드가 1장 이상이면 8점',{type:'hasFaceDown',points:8}),
C('Chancellor','재상','castle',6,['noble','scholar'],'성 카드당 2점',{type:'placeCards',place:'castle',per:2}),
C('Chaplain','사제','castle',5,['faith'],'마을 카드당 2점',{type:'placeCards',place:'village',per:2}),
C('Chatelaine','여주인','castle',2,['noble','craft'],'같은 행의 서로 다른 방패 종류당 2점',{type:'distinctLine',axis:'row',per:2},{effect:'이후 성 카드 비용 -1'}),
C('Clockmaker','시계공','village',3,['craft'],'같은 행의 장인 방패당 3점',{type:'lineShield',axis:'row',shield:'craft',per:3}),
C('Devout','독실한 자','castle',4,['faith'],'장인 방패가 없으면 10점',{type:'missingShield',shield:'craft',points:10}),
C('Doctor','의사','village',5,['scholar','peasant'],'학문+농민 방패 세트당 4점',{type:'shieldSet',shields:['scholar','peasant'],per:4}),
C('Duchess','공작부인','castle',5,['noble','noble'],'맨 위 행이면 8점',{type:'position',positions:['top'],points:8}),
C('Executioner','처형인','village',0,['military'],'성 카드당 1점',{type:'placeCards',place:'castle',per:1}),
C('Farmer','농부','village',5,['peasant','peasant'],'맨 아래 행이면 7점',{type:'position',positions:['bottom'],points:7}),
C('Farmhand','농장 일꾼','village',0,['peasant'],'이 지갑의 금 1개당 2점',{type:'purse',per:2},{purse:5,effect:'이후 마을 카드 비용 -1'}),
C('Fisherman','어부','village',2,['peasant','peasant'],'모서리 칸이면 4점',{type:'position',positions:['corner'],points:4},{effect:'이후 성 카드 비용 -1'}),
C('General','장군','castle',7,['military'],'같은 방패 3개 세트당 6점',{type:'identicalShieldSets',size:3,per:6}),
C('Glassblower','유리 공예가','castle',5,['faith','craft'],'신앙+장인 방패 세트당 4점',{type:'shieldSet',shields:['faith','craft'],per:4}),
C('Goldsmith','금세공사','castle',4,['scholar','craft'],'왼쪽 열이면 6점',{type:'position',positions:['left'],points:6}),
C('Gravedigger','묘지 관리자','castle',4,['faith','scholar'],'이 지갑의 금 1개당 2점',{type:'purse',per:2},{purse:8}),
C('Guildmaster','조합장','castle',5,['craft','craft'],'맨 아래 행이면 5점',{type:'position',positions:['bottom'],points:5}),
C('Her Majesty','왕비 폐하','castle',7,['noble','noble'],'귀족+학문+장인 방패 세트당 10점',{type:'shieldSet',shields:['noble','scholar','craft'],per:10}),
C('His Holiness','교황 성하','castle',7,['faith'],'없는 방패 종류당 6점',{type:'missingTypes',per:6}),
C('His Majesty','국왕 폐하','castle',6,['noble','faith'],'같은 열의 귀족 방패당 4점',{type:'lineShield',axis:'col',shield:'noble',per:4}),
C('Innkeeper','여관 주인','village',0,['craft'],'이 지갑의 금 1개당 2점',{type:'purse',per:2},{purse:6}),
C('Inventor','발명가','village',2,['scholar','scholar'],'마을 카드당 1점',{type:'placeCards',place:'village',per:1}),
C('Jester','광대','castle',3,['noble'],'같은 행 또는 열의 귀족 방패당 2점',{type:'crossShield',shield:'noble',per:2}),
C('Judge','재판관','castle',4,['scholar'],'성+마을 카드 쌍당 3점',{type:'placePair',per:3}),
C('Knight','기사','castle',5,['military'],'같은 행 또는 열의 귀족 방패당 3점',{type:'crossShield',shield:'noble',per:3}),
C('Locksmith','열쇠공','village',4,['craft','peasant'],'보유 열쇠 1개당 추가 1점',{type:'keys',per:1},{effect:'장인 방패당 열쇠 1'}),
C('Lookout','감시병','castle',6,['military','military'],'같은 열의 서로 다른 방패 종류당 4점',{type:'distinctLine',axis:'col',per:4}),
C('Master-at-Arms','훈련 교관','village',2,['military','military'],'이 지갑의 금 1개당 2점',{type:'purse',per:2},{purse:4}),
C('Mercenary','용병','village',6,['military','peasant'],'신앙+군사+농민 방패 세트당 7점',{type:'shieldSet',shields:['faith','military','peasant'],per:7}),
C('Militiaman','민병대원','village',2,['military'],'같은 행의 군사 방패당 3점',{type:'lineShield',axis:'row',shield:'military',per:3}),
C('Miraculously Cured','기적으로 치유된 자','village',2,['faith','faith'],'이 지갑의 금 1개당 2점',{type:'purse',per:2},{purse:4}),
C('Monk','수도자','village',4,['peasant','faith'],'같은 행 또는 열의 농민 방패당 2점',{type:'crossShield',shield:'peasant',per:2}),
C('Mother Superior','수녀원장','castle',5,['faith','faith'],'맨 위 행이면 5점',{type:'position',positions:['top'],points:5}),
C('Nun','수녀','castle',3,['faith'],'같은 열의 신앙 방패당 3점',{type:'lineShield',axis:'col',shield:'faith',per:3}),
C('Officer','장교','castle',5,['noble','military'],'귀족+군사 방패 세트당 4점',{type:'shieldSet',shields:['noble','military'],per:4}),
C('Patron','후원자','castle',7,['scholar'],'인쇄 비용 5 이상 카드당 5점',{type:'costAtLeast',cost:5,per:5}),
C('Pawnbroker','전당업자','castle',4,['craft'],'인쇄 비용 4인 카드당 3점',{type:'costExact',cost:4,per:3}),
C('Philosopher','철학자','village',2,['scholar'],'군사 방패가 없으면 10점',{type:'missingShield',shield:'military',points:10},{effect:'이후 성 카드 비용 -1'}),
C('Pilgrim','순례자','castle',6,['faith'],'같은 행의 서로 다른 방패 종류당 4점',{type:'distinctLine',axis:'row',per:4},{effect:'이후 마을 카드 비용 -1'}),
C('Potter','도예가','village',2,['craft','craft'],'이 지갑의 금 1개당 2점',{type:'purse',per:2},{purse:4}),
C('Prince','왕자','castle',6,['noble'],'같은 행의 귀족 방패당 4점',{type:'lineShield',axis:'row',shield:'noble',per:4}),
C('Princess','공주','castle',3,['noble'],'같은 행의 귀족 방패당 3점',{type:'lineShield',axis:'row',shield:'noble',per:3},{effect:'이후 성 카드 비용 -1'}),
C('Professor','교수','castle',4,['scholar'],'같은 행의 학문 방패당 3점',{type:'lineShield',axis:'row',shield:'scholar',per:3}),
C('Queen Mother','모후','castle',3,['noble','noble'],'이 지갑의 금 1개당 2점',{type:'purse',per:2},{purse:5}),
C('Revolutionary','혁명가','village',4,['peasant'],'귀족 방패가 없으면 9점',{type:'missingShield',shield:'noble',points:9}),
C('Royal Guard','근위병','castle',4,['noble','military'],'같은 열의 귀족 방패당 3점',{type:'lineShield',axis:'col',shield:'noble',per:3}),
C('Scribe','필경사','castle',4,['faith'],'같은 행 또는 열의 학문 방패당 3점',{type:'crossShield',shield:'scholar',per:3}),
C('Sculptor','조각가','village',3,['faith','craft'],'이 지갑의 금 1개당 2점',{type:'purse',per:2},{purse:7}),
C('Shepherd','양치기','village',5,['peasant'],'같은 행의 농민 방패당 3점',{type:'lineShield',axis:'row',shield:'peasant',per:3}),
C('Spice Merchant','향신료 상인','village',0,['craft'],'가운데 행이면 5점',{type:'position',positions:['middleRow'],points:5}),
C('Spy','첩자','village',4,['scholar','military'],'가운데 열이면 6점',{type:'position',positions:['middleCol'],points:6}),
C('Squire','종자','village',0,['military'],'같은 행 또는 열의 장인 방패당 2점',{type:'crossShield',shield:'craft',per:2},{effect:'이후 모든 카드 비용 -1'}),
C('Stable Boy','마구간 소년','village',4,['noble','peasant'],'같은 열의 농민 방패당 3점',{type:'lineShield',axis:'col',shield:'peasant',per:3}),
C('Steward','시종','castle',0,['noble'],'이 지갑의 금 1개당 2점',{type:'purse',per:2},{purse:3}),
C('Stonemason','석공','village',3,['craft'],'같은 열의 장인 방패당 3점',{type:'lineShield',axis:'col',shield:'craft',per:3},{effect:'이후 마을 카드 비용 -1'}),
C('Templar','기사단원','castle',5,['faith','military'],'보유 열쇠 1개당 추가 1점',{type:'keys',per:1}),
C('Traveler','여행자','village',0,['peasant'],'인쇄 비용 0인 카드당 2점',{type:'costExact',cost:0,per:2}),
C('Usurper','찬탈자','village',5,['peasant'],'성 카드당 2점',{type:'placeCards',place:'castle',per:2}),
C('Vicar','교구 성직자','village',0,['faith'],'이 지갑의 금 1개당 2점',{type:'purse',per:2},{purse:5}),
C('Winemaker','와인 양조사','village',2,['scholar','peasant'],'같은 열의 서로 다른 방패 종류당 2점',{type:'distinctLine',axis:'col',per:2}),
C('Witch','마녀','village',4,['peasant'],'신앙 방패가 없으면 9점',{type:'missingShield',shield:'faith',points:9}),
C('Woodcutter','나무꾼','village',0,['peasant'],'오른쪽 열이면 5점',{type:'position',positions:['right'],points:5}),

// Out of the Oubliette expansion (12 cards). English labels follow the rulebook examples
// where available; the Dutch card names visible on the supplied cards are included for search.
C('Slimeball','아첨꾼','castle',7,['noble'],'같은 행 3장의 인쇄 비용 합계',{type:'rowCostSum'},{expansion:true,dutch:'Slijmbal',lock:true}),
C('Printer','인쇄업자','castle',0,['craft'],'같은 열에 학문 방패가 1개 이상이면 5점',{type:'lineHasShield',axis:'col',shield:'scholar',points:5},{expansion:true,dutch:'Drukker',lock:true}),
C('Peddler','행상인','village',7,['craft'],'같은 열 3장의 인쇄 비용 합계',{type:'colCostSum'},{expansion:true,dutch:'Marskramer',lock:true}),
C('Prince of Thieves','도적 왕자','village',4,['peasant'],'잠금 능력 카드 1장당 4점',{type:'lockCards',per:4},{expansion:true,dutch:'Prins der dieven',lock:true}),
C('Dreamer with the Iron Mask','철가면을 쓴 여인','castle',8,['noble','faith','scholar'],'서로 다른 인쇄 비용 종류당 3점',{type:'distinctCosts',per:3},{expansion:true,dutch:'Dromer met het ijzeren masker',lock:true}),
C('Actor','극작가','castle',3,['scholar'],'성 카드 1장당 2점',{type:'placeCards',place:'castle',per:2},{expansion:true,dutch:'Toneelspeler',lock:true}),
C('Art Forger','예술품 위조범','village',4,['scholar'],'같은 행에 군사 방패가 1개 이상이면 7점',{type:'lineHasShield',axis:'row',shield:'military',points:7},{expansion:true,dutch:'Kunstvervalser',lock:true}),
C('King of Beggars','거지왕','village',5,['military','craft','peasant'],'뒷면 카드가 없으면 12점',{type:'noFaceDown',points:12},{expansion:true,dutch:'Koning der bedelaars',lock:true}),
C('Conspirator','공모 가담자','castle',1,['faith'],'할인 능력 카드가 없으면 8점',{type:'noDiscounts',points:8},{expansion:true,dutch:'Samenzweerder',lock:true}),
C("Queen's Confidante",'추기경의 하수인','castle',0,['military'],'같은 행에 신앙 방패가 1개 이상이면 5점',{type:'lineHasShield',axis:'row',shield:'faith',points:5},{expansion:true,dutch:'Vertrouweling van de koningin',lock:true}),
C('Pickpocket','소매치기','village',3,['military'],'지갑 점수 카드가 없으면 10점',{type:'noPurseCards',points:10},{expansion:true,dutch:'Zakkenroller',lock:true}),
C('Fortune Teller','점쟁이','village',1,['peasant','peasant'],'같은 열에 귀족 방패가 1개 이상이면 3점',{type:'lineHasShield',axis:'col',shield:'noble',points:3},{expansion:true,dutch:'Waarzegster',lock:true}),
];

const BASE_CARD_COUNT=cards.filter(c=>!c.expansion).length;
const EXPANSION_CARD_COUNT=cards.filter(c=>c.expansion).length;

const discountIds=new Set(['alchemist','apothecary','architect','armorer','astronomer','baron','captain','chatelaine','farmhand','fisherman','philosopher','pilgrim','princess','squire','stonemason']);
const state={slots:Array.from({length:9},()=>({cardId:null,faceDown:false,purse:0,lockUnused:true})),keys:0};
let activeSlot=0,filter='all';
const $=s=>document.querySelector(s);
const tableau=$('#tableau'),dialog=$('#cardDialog'),cardList=$('#cardList'),search=$('#search');

function init(){
  const tpl=$('#slotTemplate');
  for(let i=0;i<9;i++){
    const node=tpl.content.firstElementChild.cloneNode(true); node.dataset.index=i;
    node.querySelector('.position').textContent=`${Math.floor(i/3)+1}행 ${i%3+1}열`;
    node.querySelector('.select-card').addEventListener('click',()=>openDialog(i));
    node.querySelector('.face-down').addEventListener('change',e=>{state.slots[i].faceDown=e.target.checked;save();render();});
    node.querySelector('.purse').addEventListener('input',e=>{state.slots[i].purse=Math.max(0,+e.target.value||0);save();renderScores();});
    node.querySelector('.lock-unused').addEventListener('change',e=>{state.slots[i].lockUnused=e.target.checked;save();renderScores();});
    tableau.appendChild(node);
  }
  $('#keys').addEventListener('input',e=>{state.keys=Math.max(0,+e.target.value||0);save();renderScores();});
  $('#resetBtn').addEventListener('click',()=>{if(confirm('모든 입력을 초기화할까요?')){state.slots=Array.from({length:9},()=>({cardId:null,faceDown:false,purse:0,lockUnused:true}));state.keys=0;save();render();}});
  $('#clearSlotBtn').addEventListener('click',e=>{e.preventDefault();e.stopPropagation();clearSlot(activeSlot);dialog.close();});
  search.addEventListener('input',renderCardList);
  document.querySelectorAll('.filters button').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('active',x===b));renderCardList();}));
  load();const countEl=document.querySelector('#cardCountInfo');if(countEl)countEl.textContent=`기본판 ${BASE_CARD_COUNT}장 + 확장팩 ${EXPANSION_CARD_COUNT}장 = 총 ${cards.length}장`;render();
}
function load(){try{const x=JSON.parse(localStorage.getItem('castleComboScore'));if(x&&Array.isArray(x.slots)){state.slots=x.slots.map(v=>({lockUnused:true,...v}));state.keys=x.keys||0;}}catch(_){} $('#keys').value=state.keys;}
function save(){localStorage.setItem('castleComboScore',JSON.stringify(state));}
function getCard(slot){return cards.find(c=>c.id===slot.cardId)||null;}
function isCardUsed(cardId,exceptIndex=-1){return state.slots.some((s,i)=>i!==exceptIndex&&s.cardId===cardId);}
function clearSlot(i){state.slots[i]={cardId:null,faceDown:false,backType:null,purse:0,lockUnused:true};save();render();}
function chooseCard(i,cardId){
  if(isCardUsed(cardId,i)){alert('이미 다른 칸에서 선택한 카드입니다. 같은 카드는 중복해서 선택할 수 없습니다.');return false;}
  state.slots[i]={cardId,faceDown:false,backType:null,purse:0,lockUnused:true};save();render();return true;
}
function activeCards(){return state.slots.map((s,i)=>({slot:s,card:getCard(s),i})).filter(x=>x.card&&!x.slot.faceDown);}
function shieldCounts(indices=null){const out=Object.fromEntries(Object.keys(S).map(k=>[k,0]));activeCards().filter(x=>!indices||indices.includes(x.i)).forEach(x=>x.card.shields.forEach(s=>out[s]++));return out;}
function rowIndices(i){const r=Math.floor(i/3);return [r*3,r*3+1,r*3+2]}
function colIndices(i){const c=i%3;return [c,c+3,c+6]}
function crossIndices(i){return [...new Set([...rowIndices(i),...colIndices(i)])]}
function countPlace(place){return activeCards().filter(x=>x.card.place===place).length}
function unusedLockKeys(){return activeCards().filter(x=>x.card.lock&&x.slot.lockUnused!==false).length}
function totalKeys(){return state.keys+unusedLockKeys()}
function totalPurse(){return activeCards().reduce((n,x)=>n+(x.card.purse?Math.min(x.slot.purse,x.card.purse):0),0)}
function posTags(i){const r=Math.floor(i/3),c=i%3,t=[];if(c===0)t.push('left');if(c===2)t.push('right');if(r===0)t.push('top');if(r===2)t.push('bottom');if(r===1)t.push('middleRow');if(c===1)t.push('middleCol');if((r===0||r===2)&&(c===0||c===2))t.push('corner');if(((r===0||r===2)&&c===1)||(r===1&&(c===0||c===2)))t.push('edge');return t}
function minSet(counts,shields){return Math.min(...shields.map(s=>counts[s]||0))}
function calculateCardScore(card,i,slot){const q=card.score,all=shieldCounts();switch(q.type){
case'discounts':return activeCards().filter(x=>discountIds.has(x.card.id)).length*q.per;
case'lineShield':{const idx=q.axis==='row'?rowIndices(i):colIndices(i);return shieldCounts(idx)[q.shield]*q.per}
case'crossShield':return shieldCounts(crossIndices(i))[q.shield]*q.per;
case'distinctAll':return Object.values(all).filter(Boolean).length*q.per;
case'distinctLine':{const idx=q.axis==='row'?rowIndices(i):colIndices(i);return Object.values(shieldCounts(idx)).filter(Boolean).length*q.per}
case'position':return q.positions.some(p=>posTags(i).includes(p))?q.points:0;
case'allPurses':return totalPurse()*q.per;
case'purse':return Math.min(slot.purse,card.purse||999)*q.per;
case'missingShield':return all[q.shield]===0?q.points:0;
case'missingTypes':return (6-Object.values(all).filter(Boolean).length)*q.per;
case'doubleShieldCards':return activeCards().filter(x=>x.card.shields.length===2).length*q.per;
case'setsPlace':return Math.floor(countPlace(q.place)/q.size)*q.per;
case'placeCards':return countPlace(q.place)*q.per;
case'placePair':return Math.min(countPlace('castle'),countPlace('village'))*q.per;
case'shieldSet':return minSet(all,q.shields)*q.per;
case'identicalShieldSets':return Object.values(all).reduce((n,v)=>n+Math.floor(v/q.size),0)*q.per;
case'hasFaceDown':return state.slots.some(s=>s.faceDown)?q.points:0;
case'keys':return totalKeys()*q.per;
case'rowCostSum':return rowIndices(i).reduce((n,j)=>{const s=state.slots[j],c=getCard(s);return n+(c&&!s.faceDown?c.cost:0)},0);
case'colCostSum':return colIndices(i).reduce((n,j)=>{const s=state.slots[j],c=getCard(s);return n+(c&&!s.faceDown?c.cost:0)},0);
case'lineHasShield':{const idx=q.axis==='row'?rowIndices(i):colIndices(i);return shieldCounts(idx)[q.shield]>0?q.points:0}
case'lockCards':return activeCards().filter(x=>x.card.lock).length*q.per;
case'distinctCosts':return new Set(activeCards().map(x=>x.card.cost)).size*q.per;
case'noFaceDown':return state.slots.some(s=>s.faceDown)?0:q.points;
case'noDiscounts':return activeCards().some(x=>discountIds.has(x.card.id))?0:q.points;
case'noPurseCards':return activeCards().some(x=>x.card.purse)?0:q.points;
case'costAtLeast':return activeCards().filter(x=>x.card.cost>=q.cost).length*q.per;
case'costExact':return activeCards().filter(x=>x.card.cost===q.cost).length*q.per;
default:return 0}}
function render(){
  state.slots.forEach((s,i)=>{
    const el=tableau.children[i],card=getCard(s),backOnly=!card&&s.faceDown&&s.backType;
    el.classList.toggle('face-down-card',!!s.faceDown);
    const empty=el.querySelector('.empty-text'),selected=el.querySelector('.selected-content'),controls=el.querySelector('.slot-controls');
    empty.hidden=!!card||!!backOnly;selected.hidden=!card&&!backOnly;controls.hidden=!card;
    if(backOnly){
      const place=el.querySelector('.place');place.textContent=s.backType==='castle'?'성':'마을';place.className=`place ${s.backType}`;
      el.querySelector('.card-name').textContent=s.backType==='castle'?'성 카드 뒷면':'마을 카드 뒷면';
      el.querySelector('.card-ko').textContent='사진에서 뒷면으로 인식됨';el.querySelector('.shields').innerHTML='';el.querySelector('.formula').textContent='카드 정보·방패·비용·자체 점수 무효';
      el.querySelector('.face-down').checked=true;el.querySelector('.lock-label').hidden=true;el.querySelector('.purse-label').hidden=true;el.querySelector('.slot-score').textContent='0점';
      return;
    }
    if(!card){
      el.querySelector('.card-name').textContent='';el.querySelector('.card-ko').textContent='';el.querySelector('.shields').innerHTML='';el.querySelector('.formula').textContent='';
      el.querySelector('.face-down').checked=false;el.querySelector('.lock-label').hidden=true;el.querySelector('.purse-label').hidden=true;el.querySelector('.slot-score').textContent='0점';
      return;
    }
    const place=el.querySelector('.place');place.textContent=card.place==='castle'?'성':'마을';place.className=`place ${card.place}`;
    el.querySelector('.card-name').textContent=card.ko;el.querySelector('.card-ko').textContent=`${card.expansion?'확장팩':'기본판'} · 비용 ${card.cost}`;
    el.querySelector('.shields').innerHTML=card.shields.map(x=>`<span class="shield ${x}">${S[x]}</span>`).join('');el.querySelector('.formula').textContent=card.formula;
    el.querySelector('.face-down').checked=!!s.faceDown;
    const ll=el.querySelector('.lock-label'),li=el.querySelector('.lock-unused');ll.hidden=!card.lock||s.faceDown;li.checked=s.lockUnused!==false;
    const pl=el.querySelector('.purse-label'),inp=el.querySelector('.purse');pl.hidden=!card.purse;
    if(card.purse){inp.max=card.purse;inp.value=Math.min(s.purse||0,card.purse);pl.firstChild.textContent=`지갑 금(최대 ${card.purse}) `;}else{inp.value=0;}
  });
  $('#keys').value=state.keys;renderScores();
}
function renderScores(){let total=0,rows=[];state.slots.forEach((s,i)=>{const card=getCard(s);let score=0;if(card&&!s.faceDown)score=calculateCardScore(card,i,s);total+=score;tableau.children[i].querySelector('.slot-score').textContent=`${score}점`;if(card)rows.push({i,name:card.ko,desc:s.faceDown?'뒷면 카드: 자체 점수 0점':card.formula,score});else if(s.faceDown&&s.backType)rows.push({i,name:s.backType==='castle'?'성 카드 뒷면':'마을 카드 뒷면',desc:'뒷면 카드: 카드 정보·방패·비용·자체 점수 무효',score:0});});const looseKeys=state.keys,lockKeys=unusedLockKeys(),keyScore=looseKeys+lockKeys;$('#cardScore').textContent=total;$('#keyScore').textContent=keyScore;$('#totalScore').textContent=total+keyScore;const b=$('#breakdown');if(!rows.length){b.className='breakdown empty';b.textContent='카드를 선택하면 계산 내역이 표시됩니다.';return}b.className='breakdown';b.innerHTML=rows.map(x=>`<div class="breakdown-row"><span class="num">${x.i+1}</span><div><b>${x.name}</b><small>${x.desc}</small></div><strong>${x.score}점</strong></div>`).join('')+`<div class="breakdown-row"><span class="num">🔑</span><div><b>남은 열쇠</b><small>일반 ${looseKeys}개 + 미사용 잠금 열쇠 ${lockKeys}개</small></div><strong>${keyScore}점</strong></div>`}
function openDialog(i){activeSlot=i;$('#slotLabel').textContent=`${Math.floor(i/3)+1}행 ${i%3+1}열`;search.value='';filter='all';document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('active',x.dataset.filter==='all'));renderCardList();dialog.showModal();setTimeout(()=>search.focus(),50)}
function renderCardList(){const q=search.value.trim().toLowerCase();const used=new Set(state.slots.filter((_,i)=>i!==activeSlot).map(s=>s.cardId).filter(Boolean));const list=cards.filter(c=>(filter==='all'||(filter==='base'?!c.expansion:(filter==='expansion'?c.expansion:c.place===filter)))&&(!q||c.ko.toLowerCase().includes(q)));cardList.innerHTML=list.map(c=>`<button type="button" class="card-option" data-id="${c.id}" ${used.has(c.id)?'disabled':''}><strong>${c.ko}</strong><small>${c.expansion?'확장팩':'기본판'} · ${c.place==='castle'?'성':'마을'} / 비용 ${c.cost} · ${c.formula}${used.has(c.id)?' · 이미 선택됨':''}</small><div class="mini-shields">${c.shields.map(x=>`<span class="shield ${x}">${S[x]}</span>`).join('')}</div></button>`).join('');cardList.querySelectorAll('.card-option:not([disabled])').forEach(b=>b.addEventListener('click',()=>{if(chooseCard(activeSlot,b.dataset.id))dialog.close();}))}
init();
