'use strict';

/* Castle Combo photo recognizer v3
   - Runs fully in the browser with OpenCV.js.
   - Detects each card as a quadrilateral and perspective-corrects it before ORB matching.
   - Low-confidence crops are retried at several small rotation angles.
   - Recognition results are forced to use unique cards across the 3x3 tableau.
*/

const photoState = {
  cvReady: false,
  features: null,
  img: null,
  objectUrl: null,
  detections: [],
  manualPoints: [],
  manualMode: false,
};

const $p = (s) => document.querySelector(s);
const photoInput = $p('#photoInput');
const photoImg = $p('#photoSource');
const photoCanvas = $p('#photoCanvas');
const photoCtx = photoCanvas.getContext('2d');
const analyzeBtn = $p('#analyzePhotoBtn');
const manualBtn = $p('#manualModeBtn');
const applyBtn = $p('#applyRecognizedBtn');
const photoStatus = $p('#photoStatus');
const recognitionResults = $p('#recognitionResults');

function setPhotoStatus(msg, kind='') {
  photoStatus.textContent = msg;
  photoStatus.className = `photo-status ${kind}`.trim();
}

function onOpenCvReady() {
  const markReady = () => {
    photoState.cvReady = true;
    setPhotoStatus(photoState.features ? '사진을 선택하면 자동 분석할 수 있습니다.' : '카드 특징 데이터를 불러오는 중…');
    analyzeBtn.disabled = !photoState.img || !photoState.features;
  };
  if (typeof cv === 'object' && cv && typeof cv.then === 'function') cv.then(markReady);
  else markReady();
}
window.onOpenCvReady = onOpenCvReady;

async function loadFeatures() {
  try {
    const r = await fetch('data/card-features.json?v=20260809-3');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    photoState.features = await r.json();
    setPhotoStatus(photoState.cvReady ? '카드 90장 인식 데이터 준비 완료.' : 'OpenCV를 불러오는 중…', 'ok');
    analyzeBtn.disabled = !photoState.cvReady || !photoState.img;
  } catch (e) {
    console.error(e);
    setPhotoStatus('카드 특징 데이터를 불러오지 못했습니다. data/card-features.json 위치를 확인해주세요.', 'error');
  }
}

function fitCanvasToImage(img) {
  const maxW = 1100;
  const scale = Math.min(1, maxW / img.naturalWidth);
  photoCanvas.width = Math.round(img.naturalWidth * scale);
  photoCanvas.height = Math.round(img.naturalHeight * scale);
  photoCanvas.dataset.scale = String(scale);
  photoCtx.drawImage(img, 0, 0, photoCanvas.width, photoCanvas.height);
}

photoInput.addEventListener('change', () => {
  const f = photoInput.files && photoInput.files[0];
  if (!f) return;
  if (photoState.objectUrl) URL.revokeObjectURL(photoState.objectUrl);
  photoState.objectUrl = URL.createObjectURL(f);
  photoImg.onload = () => {
    photoState.img = photoImg;
    fitCanvasToImage(photoImg);
    photoState.detections = [];
    photoState.manualPoints = [];
    photoState.manualMode = false;
    manualBtn.classList.remove('active');
    recognitionResults.innerHTML = '';
    applyBtn.hidden = true;
    analyzeBtn.disabled = !photoState.cvReady || !photoState.features;
    setPhotoStatus(photoState.cvReady ? '사진 준비 완료. “자동 분석”을 눌러주세요.' : '사진 준비 완료. OpenCV를 불러오는 중…');
  };
  photoImg.src = photoState.objectUrl;
});

function matFromDisplayedImage() { return cv.imread(photoCanvas); }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function centerOf(points){ return {x:points.reduce((s,p)=>s+p.x,0)/points.length,y:points.reduce((s,p)=>s+p.y,0)/points.length}; }
function boundsOf(points){
  const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
  const x=Math.min(...xs), y=Math.min(...ys), x2=Math.max(...xs), y2=Math.max(...ys);
  return {x,y,width:x2-x,height:y2-y};
}
function boxIoU(a,b){
  const x1=Math.max(a.x,b.x), y1=Math.max(a.y,b.y), x2=Math.min(a.x+a.width,b.x+b.width), y2=Math.min(a.y+a.height,b.y+b.height);
  const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1), union=a.width*a.height+b.width*b.height-inter;
  return union>0?inter/union:0;
}
function orderQuad(points){
  // TL, TR, BR, BL via sums/differences.
  const tl=points.reduce((a,b)=>(a.x+a.y)<(b.x+b.y)?a:b);
  const br=points.reduce((a,b)=>(a.x+a.y)>(b.x+b.y)?a:b);
  const tr=points.reduce((a,b)=>(a.y-a.x)<(b.y-b.x)?a:b);
  const bl=points.reduce((a,b)=>(a.y-a.x)>(b.y-b.x)?a:b);
  return [tl,tr,br,bl];
}

function contourToQuad(cnt, imgArea){
  const peri=cv.arcLength(cnt,true);
  const approx=new cv.Mat();
  try{
    cv.approxPolyDP(cnt,approx,0.025*peri,true);
    if(approx.rows!==4 || !cv.isContourConvex(approx)) return null;
    const a=Math.abs(cv.contourArea(approx));
    if(a<imgArea*0.009 || a>imgArea*0.22) return null;
    const d=approx.data32S, pts=[];
    for(let i=0;i<4;i++) pts.push({x:d[i*2],y:d[i*2+1]});
    const q=orderQuad(pts);
    const w=(dist(q[0],q[1])+dist(q[3],q[2]))/2;
    const h=(dist(q[0],q[3])+dist(q[1],q[2]))/2;
    if(w<20||h<20) return null;
    const ratio=Math.min(w,h)/Math.max(w,h); // card ≈ .70
    if(ratio<0.50 || ratio>0.83) return null;
    const b=boundsOf(q), c=centerOf(q);
    return {...b,quad:q,center:c,area:a,score:a*(1-Math.abs(ratio-0.70))};
  } finally { approx.delete(); }
}

function detectCardQuads(src) {
  const gray=new cv.Mat(), blur=new cv.Mat(), edges=new cv.Mat(), closed=new cv.Mat();
  const contours=new cv.MatVector(), hierarchy=new cv.Mat();
  const kernel=cv.Mat.ones(5,5,cv.CV_8U);
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
    cv.Canny(blur, edges, 35, 115);
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(closed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const imgArea=src.cols*src.rows, cand=[];
    for(let i=0;i<contours.size();i++){
      const cnt=contours.get(i);
      try { const q=contourToQuad(cnt,imgArea); if(q) cand.push(q); }
      finally { cnt.delete(); }
    }
    cand.sort((a,b)=>b.score-a.score);
    const picked=[];
    for(const q of cand){
      if(picked.some(p=>boxIoU(p,q)>0.30 || dist(p.center,q.center)<Math.min(p.height,q.height)*0.35)) continue;
      picked.push(q);
      if(picked.length>=16) break;
    }
    if(picked.length>=9){
      const areas=[...picked].map(x=>x.area).sort((a,b)=>a-b);
      const med=areas[Math.floor(areas.length/2)];
      const similar=picked.filter(x=>x.area>med*0.48&&x.area<med*2.05);
      if(similar.length>=9) return similar.slice(0,9);
    }
    return picked.slice(0,9);
  } finally {
    gray.delete(); blur.delete(); edges.delete(); closed.delete(); contours.delete(); hierarchy.delete(); kernel.delete();
  }
}

function sortGrid(items) {
  if(items.length!==9) return items;
  const sorted=[...items].sort((a,b)=>a.center.y-b.center.y);
  const rows=[sorted.slice(0,3),sorted.slice(3,6),sorted.slice(6,9)];
  rows.forEach(row=>row.sort((a,b)=>a.center.x-b.center.x));
  return rows.flat();
}

function decodeDescriptors(item){
  if(item._mat) return item._mat;
  const bin=atob(item.descriptors), arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  item._mat=cv.matFromArray(item.rows,item.cols,cv.CV_8UC1,arr);
  return item._mat;
}

function getQueryDescriptors(cardMat){
  const gray=new cv.Mat(), kp=new cv.KeyPointVector(), des=new cv.Mat(), mask=new cv.Mat();
  const orb=new cv.ORB();
  try{
    orb.setMaxFeatures(1200);
    cv.cvtColor(cardMat,gray,cv.COLOR_RGBA2GRAY);
    // CLAHE-like normalization without requiring extra modules.
    cv.equalizeHist(gray,gray);
    orb.detectAndCompute(gray,mask,kp,des);
    return des.clone();
  } finally { gray.delete(); kp.delete(); des.delete(); mask.delete(); orb.delete(); }
}

function matchOne(queryDes, refItem, matcher){
  const ref=decodeDescriptors(refItem);
  if(queryDes.rows<2 || ref.rows<2) return 0;
  const matches=new cv.DMatchVectorVector();
  try{
    matcher.knnMatch(queryDes,ref,matches,2);
    let good=0, strong=0;
    for(let i=0;i<matches.size();i++){
      const v=matches.get(i);
      if(v.size()>=2){
        const m=v.get(0), n=v.get(1);
        if(m.distance < 0.78*n.distance){ good++; if(m.distance<48) strong++; }
      }
      v.delete();
    }
    return good + strong*0.30;
  } finally { matches.delete(); }
}

function scoreDescriptors(queryDes){
  const matcher=new cv.BFMatcher(cv.NORM_HAMMING,false), scores=[];
  try{ for(const item of photoState.features.cards) scores.push({item,score:matchOne(queryDes,item,matcher)}); }
  finally { matcher.delete(); }
  return scores;
}

function rotateMat(src,angle){
  const center=new cv.Point(src.cols/2,src.rows/2), M=cv.getRotationMatrix2D(center,angle,1), dst=new cv.Mat();
  try { cv.warpAffine(src,dst,M,new cv.Size(src.cols,src.rows),cv.INTER_LINEAR,cv.BORDER_REPLICATE); return dst; }
  finally { M.delete(); }
}

function recognizeCard(cardMat){
  const bestById=new Map();
  const run=(mat)=>{
    const q=getQueryDescriptors(mat);
    try{
      for(const s of scoreDescriptors(q)){
        const prev=bestById.get(s.item.id);
        if(!prev || s.score>prev.score) bestById.set(s.item.id,s);
      }
    } finally { q.delete(); }
  };
  run(cardMat);
  let scores=[...bestById.values()].sort((a,b)=>b.score-a.score);
  let a=scores[0]?.score||0,b=scores[1]?.score||0,margin=a>0?(a-b)/a:0;
  // Retry low-confidence cards with small rotations. This greatly helps hand-laid crooked cards.
  if(a<14 || margin<0.22){
    for(const angle of [-16,-8,8,16]){
      const rot=rotateMat(cardMat,angle);
      try{run(rot);}finally{rot.delete();}
    }
    scores=[...bestById.values()].sort((x,y)=>y.score-x.score);
    a=scores[0]?.score||0;b=scores[1]?.score||0;margin=a>0?(a-b)/a:0;
  }
  const confidence=Math.max(0,Math.min(99,Math.round(40 + margin*80 + Math.min(a,45)*0.8)));
  return {top:scores.slice(0,8),confidence,needsReview:a<7||margin<0.16};
}

function warpQuadMat(src,item){
  const q=orderQuad(item.quad);
  const srcPts=cv.matFromArray(4,1,cv.CV_32FC2,[q[0].x,q[0].y,q[1].x,q[1].y,q[2].x,q[2].y,q[3].x,q[3].y]);
  const dstPts=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,359,0,359,499,0,499]);
  const M=cv.getPerspectiveTransform(srcPts,dstPts), out=new cv.Mat();
  try { cv.warpPerspective(src,out,M,new cv.Size(360,500),cv.INTER_LINEAR,cv.BORDER_REPLICATE); return out; }
  finally { srcPts.delete(); dstPts.delete(); M.delete(); }
}

function cropCenteredMat(src,item){
  // Manual fallback: use the expected card crop around a clicked center.
  const x=Math.max(0,Math.round(item.x)),y=Math.max(0,Math.round(item.y));
  const x2=Math.min(src.cols,Math.round(item.x+item.width)),y2=Math.min(src.rows,Math.round(item.y+item.height));
  const roi=src.roi(new cv.Rect(x,y,Math.max(1,x2-x),Math.max(1,y2-y))), out=new cv.Mat();
  try{cv.resize(roi,out,new cv.Size(360,500),0,0,cv.INTER_AREA);return out;}finally{roi.delete();}
}
function cardMatFor(src,item){ return item.quad ? warpQuadMat(src,item) : cropCenteredMat(src,item); }

function overlayItems(items){
  fitCanvasToImage(photoState.img);
  photoCtx.save(); photoCtx.lineWidth=3; photoCtx.font='bold 18px system-ui';
  items.forEach((it,i)=>{
    photoCtx.strokeStyle='#23c55e'; photoCtx.fillStyle='rgba(20,20,20,.72)';
    if(it.quad){
      const q=orderQuad(it.quad);photoCtx.beginPath();photoCtx.moveTo(q[0].x,q[0].y);q.slice(1).forEach(p=>photoCtx.lineTo(p.x,p.y));photoCtx.closePath();photoCtx.stroke();
    }else photoCtx.strokeRect(it.x,it.y,it.width,it.height);
    const c=it.center||{x:it.x+it.width/2,y:it.y+it.height/2};
    photoCtx.fillRect(c.x-17,c.y-13,34,26);photoCtx.fillStyle='#fff';photoCtx.fillText(String(i+1),c.x-5,c.y+7);
  });
  photoCtx.restore();
}

function makeUnique(results){
  // Most certain slots claim first; weaker slots take their best remaining candidate.
  const order=results.map((r,i)=>({i,best:r.top[0]?.score||0,margin:(r.top[0]?.score||0)-(r.top[1]?.score||0)}))
    .sort((a,b)=>(b.margin-a.margin)||(b.best-a.best));
  const used=new Set();
  for(const o of order){
    const r=results[o.i];
    const chosen=r.top.find(c=>!used.has(c.item.id))||r.top[0];
    if(chosen){r.top=[chosen,...r.top.filter(c=>c.item.id!==chosen.item.id)];used.add(chosen.item.id);}
  }
  return results;
}

function candidateButton(c,slotIndex){
  const used=new Set(photoState.detections.map((r,i)=>i===slotIndex?null:r.top[0]?.item.id).filter(Boolean));
  const disabled=used.has(c.item.id);
  return `<button type="button" class="candidate" data-slot="${slotIndex}" data-id="${c.item.id}" ${disabled?'disabled':''}>
    <b>${c.item.ko}</b><small>특징점 ${c.score.toFixed(1)}${disabled?' · 다른 칸에서 선택됨':''}</small>
  </button>`;
}

function renderRecognition(results){
  recognitionResults.innerHTML=results.map((r,i)=>{
    const best=r.top[0];
    return `<article class="recognition-card ${r.needsReview?'review':''}" data-index="${i}">
      <div class="recognition-head"><span>${Math.floor(i/3)+1}행 ${i%3+1}열</span><strong>${r.needsReview?'확인 필요':'자동 인식'}</strong></div>
      <h3>${best?.item.ko||'인식 실패'}</h3>
      <div class="confidence"><i style="width:${r.confidence}%"></i></div><small>신뢰도 지표 ${r.confidence}%</small>
      <details ${r.needsReview?'open':''}><summary>후보 변경</summary>${r.top.slice(0,5).map(c=>candidateButton(c,i)).join('')}</details>
    </article>`;
  }).join('');
  recognitionResults.querySelectorAll('.candidate:not([disabled])').forEach(btn=>btn.addEventListener('click',()=>{
    const idx=+btn.dataset.slot, result=photoState.detections[idx];
    const chosen=result.top.find(x=>x.item.id===btn.dataset.id);
    if(!chosen) return;
    result.top=[chosen,...result.top.filter(x=>x.item.id!==chosen.item.id)];
    result.needsReview=false; result.confidence=Math.max(result.confidence,80);
    makeUnique(photoState.detections); renderRecognition(photoState.detections);
  }));
  applyBtn.hidden=false;
}

async function recognizeItems(items){
  const src=matFromDisplayedImage();
  try{
    const results=[];
    for(let i=0;i<items.length;i++){
      setPhotoStatus(`${i+1}/9 카드 인식 중…`, 'working');
      const crop=cardMatFor(src,items[i]);
      try{results.push(recognizeCard(crop));}finally{crop.delete();}
      await new Promise(r=>setTimeout(r,0));
    }
    photoState.detections=makeUnique(results);
    renderRecognition(photoState.detections);
    const reviews=photoState.detections.filter(x=>x.needsReview).length;
    setPhotoStatus(reviews?`9장 인식 완료. ${reviews}장은 후보를 확인해주세요.`:'9장 인식 완료. 결과를 확인한 뒤 배열에 적용하세요.', reviews?'warn':'ok');
  } finally { src.delete(); }
}

analyzeBtn.addEventListener('click',async()=>{
  if(!photoState.cvReady||!photoState.features||!photoState.img)return;
  analyzeBtn.disabled=true;applyBtn.hidden=true;recognitionResults.innerHTML='';
  try{
    setPhotoStatus('기울어진 카드 윤곽과 네 모서리를 찾는 중…','working');
    const src=matFromDisplayedImage();let items;
    try{items=sortGrid(detectCardQuads(src));}finally{src.delete();}
    if(items.length!==9){setPhotoStatus(`자동으로 ${items.length}장만 찾았습니다. “수동 4점 지정”으로 네 모서리 카드의 중심을 눌러주세요.`,'warn');return;}
    overlayItems(items);await recognizeItems(items);
  }catch(e){console.error(e);setPhotoStatus(`분석 중 오류: ${e.message}`,'error');}
  finally{analyzeBtn.disabled=false;}
});

manualBtn.addEventListener('click',()=>{
  if(!photoState.img)return;photoState.manualMode=true;photoState.manualPoints=[];manualBtn.classList.add('active');fitCanvasToImage(photoState.img);
  setPhotoStatus('수동 지정: 왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래 카드의 중심을 차례로 눌러주세요.','warn');
});

photoCanvas.addEventListener('click',async(e)=>{
  if(!photoState.manualMode||!photoState.img)return;
  const r=photoCanvas.getBoundingClientRect();const x=(e.clientX-r.left)*photoCanvas.width/r.width,y=(e.clientY-r.top)*photoCanvas.height/r.height;
  photoState.manualPoints.push({x,y});photoCtx.fillStyle='#ef4444';photoCtx.beginPath();photoCtx.arc(x,y,8,0,Math.PI*2);photoCtx.fill();photoCtx.fillStyle='#fff';photoCtx.font='bold 14px system-ui';photoCtx.fillText(String(photoState.manualPoints.length),x-4,y+5);
  if(photoState.manualPoints.length<4){setPhotoStatus(`수동 지정 ${photoState.manualPoints.length}/4 완료.`,'warn');return;}
  photoState.manualMode=false;manualBtn.classList.remove('active');const[tl,tr,br,bl]=photoState.manualPoints;
  const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}),centers=[];
  for(let rr=0;rr<3;rr++){const left=lerp(tl,bl,rr/2),right=lerp(tr,br,rr/2);for(let cc=0;cc<3;cc++)centers.push(lerp(left,right,cc/2));}
  const hStep=(dist(tr,tl)+dist(br,bl))/4,vStep=(dist(bl,tl)+dist(br,tr))/4,w=hStep*.72,h=vStep*.88;
  const items=centers.map(c=>({x:Math.max(0,c.x-w/2),y:Math.max(0,c.y-h/2),width:w,height:h,center:c}));
  overlayItems(items);try{await recognizeItems(items);}catch(err){console.error(err);setPhotoStatus(`인식 오류: ${err.message}`,'error');}
});

applyBtn.addEventListener('click',()=>{
  if(photoState.detections.length!==9)return;
  const ids=photoState.detections.map(r=>r.top[0]?.item.id).filter(Boolean);
  if(new Set(ids).size!==ids.length){setPhotoStatus('같은 카드가 두 칸 이상 선택되어 있습니다. 후보를 수정해주세요.','error');return;}
  photoState.detections.forEach((r,i)=>{state.slots[i]={cardId:r.top[0].item.id,faceDown:false,purse:0,lockUnused:true};});
  save();render();setPhotoStatus('인식한 9장을 배열에 적용했습니다. 틀린 카드만 눌러 수정할 수 있습니다.','ok');
  $p('.tableau-section').scrollIntoView({behavior:'smooth',block:'start'});
});

loadFeatures();
