'use strict';

/* Castle Combo photo recognizer v1
   - OpenCV.js runs entirely in the browser.
   - Scanned card images are NOT included. Only ORB descriptor data is shipped.
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
  // Some builds expose a Promise-like cv object first.
  const markReady = () => {
    photoState.cvReady = true;
    setPhotoStatus(photoState.features ? '사진을 선택하면 자동 분석할 수 있습니다.' : '카드 특징 데이터를 불러오는 중…');
    analyzeBtn.disabled = !photoState.img || !photoState.features;
  };
  if (typeof cv === 'object' && cv && typeof cv.then === 'function') {
    cv.then(() => markReady());
  } else {
    markReady();
  }
}
window.onOpenCvReady = onOpenCvReady;

async function loadFeatures() {
  try {
    const r = await fetch('data/card-features.json?v=20260809-1');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    photoState.features = await r.json();
    setPhotoStatus(photoState.cvReady ? `카드 90장 인식 데이터 준비 완료.` : 'OpenCV를 불러오는 중…', 'ok');
    analyzeBtn.disabled = !photoState.cvReady || !photoState.img;
  } catch (e) {
    console.error(e);
    setPhotoStatus('카드 특징 데이터를 불러오지 못했습니다. GitHub Pages에서 실행 중인지 확인해주세요.', 'error');
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

function matFromDisplayedImage() {
  // Analyze exactly the displayed canvas so contour coordinates and overlay stay aligned.
  return cv.imread(photoCanvas);
}

function boxIoU(a,b){
  const x1=Math.max(a.x,b.x), y1=Math.max(a.y,b.y);
  const x2=Math.min(a.x+a.width,b.x+b.width), y2=Math.min(a.y+a.height,b.y+b.height);
  const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1);
  const union=a.width*a.height+b.width*b.height-inter;
  return union>0?inter/union:0;
}

function detectCardRects(src) {
  const gray=new cv.Mat(), blur=new cv.Mat(), edges=new cv.Mat(), closed=new cv.Mat();
  const contours=new cv.MatVector(), hierarchy=new cv.Mat();
  const kernel=cv.Mat.ones(5,5,cv.CV_8U);
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
    cv.Canny(blur, edges, 45, 135);
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(closed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const imgArea=src.cols*src.rows;
    const cand=[];
    for(let i=0;i<contours.size();i++){
      const cnt=contours.get(i);
      const area=Math.abs(cv.contourArea(cnt));
      if(area < imgArea*0.012 || area > imgArea*0.19){ cnt.delete(); continue; }
      const r=cv.boundingRect(cnt);
      cnt.delete();
      if(r.height<=0 || r.width<=0) continue;
      const ratio=r.width/r.height;
      if(ratio<0.45 || ratio>1.05) continue;
      const fill=area/(r.width*r.height);
      if(fill<0.32) continue;
      cand.push({...r,area,score:area*fill});
    }
    cand.sort((a,b)=>b.score-a.score);
    const picked=[];
    for(const r of cand){
      if(picked.some(p=>boxIoU(p,r)>0.38)) continue;
      picked.push(r);
      if(picked.length>=18) break;
    }
    // Prefer nine similarly-sized, spatially separated cards.
    if(picked.length>=9){
      const med=[...picked].sort((a,b)=>a.area-b.area)[Math.floor(picked.length/2)].area;
      let similar=picked.filter(r=>r.area>med*0.48 && r.area<med*2.1);
      if(similar.length>=9) picked.splice(0,picked.length,...similar.slice(0,12));
    }
    return picked.slice(0,9);
  } finally {
    gray.delete(); blur.delete(); edges.delete(); closed.delete(); contours.delete(); hierarchy.delete(); kernel.delete();
  }
}

function sortGrid(rects) {
  if(rects.length!==9) return rects;
  const sorted=[...rects].sort((a,b)=>(a.y+a.height/2)-(b.y+b.height/2));
  const rows=[sorted.slice(0,3),sorted.slice(3,6),sorted.slice(6,9)];
  rows.forEach(row=>row.sort((a,b)=>(a.x+a.width/2)-(b.x+b.width/2)));
  return rows.flat();
}

function padRect(r,src){
  const px=r.width*0.035, py=r.height*0.025;
  const x=Math.max(0,Math.round(r.x-px)), y=Math.max(0,Math.round(r.y-py));
  const x2=Math.min(src.cols,Math.round(r.x+r.width+px)), y2=Math.min(src.rows,Math.round(r.y+r.height+py));
  return new cv.Rect(x,y,Math.max(1,x2-x),Math.max(1,y2-y));
}

function decodeDescriptors(item){
  if(item._mat) return item._mat;
  const bin=atob(item.descriptors);
  const arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  item._mat=cv.matFromArray(item.rows,item.cols,cv.CV_8UC1,arr);
  return item._mat;
}

function getQueryDescriptors(cardMat){
  const gray=new cv.Mat(), kp=new cv.KeyPointVector(), des=new cv.Mat(), mask=new cv.Mat();
  const orb=new cv.ORB();
  try{
    orb.setMaxFeatures(1000);
    cv.cvtColor(cardMat,gray,cv.COLOR_RGBA2GRAY);
    orb.detectAndCompute(gray,mask,kp,des);
    return des.clone();
  } finally {
    gray.delete(); kp.delete(); des.delete(); mask.delete(); orb.delete();
  }
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
        if(m.distance < 0.75*n.distance){ good++; if(m.distance<45) strong++; }
      }
      v.delete();
    }
    return good + strong*0.25;
  } finally { matches.delete(); }
}

function recognizeCard(cardMat){
  const query=getQueryDescriptors(cardMat);
  const matcher=new cv.BFMatcher(cv.NORM_HAMMING,false);
  const scores=[];
  try{
    for(const item of photoState.features.cards){
      scores.push({item,score:matchOne(query,item,matcher)});
    }
  } finally { query.delete(); matcher.delete(); }
  scores.sort((a,b)=>b.score-a.score);
  const top=scores.slice(0,3);
  const a=top[0]?.score||0, b=top[1]?.score||0;
  // Heuristic, not a calibrated probability.
  const margin=a>0?(a-b)/a:0;
  const confidence=Math.max(0,Math.min(99,Math.round(45 + margin*70 + Math.min(a,40)*0.7)));
  return {top,confidence,needsReview: a<7 || margin<0.18};
}

function cropRectMat(src,r){
  const rr=padRect(r,src);
  const roi=src.roi(rr);
  const out=new cv.Mat();
  cv.resize(roi,out,new cv.Size(360,500),0,0,cv.INTER_AREA);
  roi.delete();
  return out;
}

function overlayRects(rects){
  fitCanvasToImage(photoState.img);
  photoCtx.save();
  photoCtx.lineWidth=3;
  photoCtx.font='bold 18px system-ui';
  rects.forEach((r,i)=>{
    photoCtx.strokeStyle='#23c55e';
    photoCtx.fillStyle='rgba(20,20,20,.72)';
    photoCtx.strokeRect(r.x,r.y,r.width,r.height);
    photoCtx.fillRect(r.x+4,r.y+4,34,26);
    photoCtx.fillStyle='#fff';
    photoCtx.fillText(String(i+1),r.x+14,r.y+24);
  });
  photoCtx.restore();
}

function candidateButton(c,slotIndex){
  return `<button type="button" class="candidate" data-slot="${slotIndex}" data-id="${c.item.id}">
    <b>${c.item.ko}</b><small>${c.item.name} · 특징점 ${c.score.toFixed(1)}</small>
  </button>`;
}

function renderRecognition(results){
  recognitionResults.innerHTML=results.map((r,i)=>{
    const best=r.top[0];
    return `<article class="recognition-card ${r.needsReview?'review':''}" data-index="${i}">
      <div class="recognition-head"><span>${Math.floor(i/3)+1}행 ${i%3+1}열</span><strong>${r.needsReview?'확인 필요':'자동 인식'}</strong></div>
      <h3>${best.item.ko}</h3><p>${best.item.name}</p>
      <div class="confidence"><i style="width:${r.confidence}%"></i></div><small>신뢰도 지표 ${r.confidence}%</small>
      <details ${r.needsReview?'open':''}><summary>후보 변경</summary>${r.top.map(c=>candidateButton(c,i)).join('')}</details>
    </article>`;
  }).join('');
  recognitionResults.querySelectorAll('.candidate').forEach(btn=>btn.addEventListener('click',()=>{
    const idx=+btn.dataset.slot;
    const item=photoState.features.cards.find(x=>x.id===btn.dataset.id);
    const result=photoState.detections[idx];
    const chosen=result.top.find(x=>x.item.id===item.id) || {item,score:0};
    result.top=[chosen,...result.top.filter(x=>x.item.id!==item.id)].slice(0,3);
    result.needsReview=false; result.confidence=Math.max(result.confidence,80);
    renderRecognition(photoState.detections);
  }));
  applyBtn.hidden=false;
}

async function recognizeRects(rects){
  const src=matFromDisplayedImage();
  try{
    const results=[];
    for(let i=0;i<rects.length;i++){
      setPhotoStatus(`${i+1}/9 카드 인식 중…`, 'working');
      const crop=cropRectMat(src,rects[i]);
      try{ results.push(recognizeCard(crop)); } finally { crop.delete(); }
      await new Promise(r=>setTimeout(r,0));
    }
    photoState.detections=results;
    renderRecognition(results);
    const reviews=results.filter(x=>x.needsReview).length;
    setPhotoStatus(reviews?`9장 인식 완료. ${reviews}장은 후보를 확인해주세요.`:'9장 인식 완료. 결과를 확인한 뒤 배열에 적용하세요.', reviews?'warn':'ok');
  } finally { src.delete(); }
}

analyzeBtn.addEventListener('click',async()=>{
  if(!photoState.cvReady || !photoState.features || !photoState.img) return;
  analyzeBtn.disabled=true; applyBtn.hidden=true; recognitionResults.innerHTML='';
  try{
    setPhotoStatus('카드 윤곽을 찾는 중…','working');
    const src=matFromDisplayedImage();
    let rects;
    try { rects=sortGrid(detectCardRects(src)); } finally { src.delete(); }
    if(rects.length!==9){
      setPhotoStatus(`자동으로 ${rects.length}장만 찾았습니다. “수동 4점 지정”으로 네 모서리 카드의 중심을 눌러주세요.`,'warn');
      return;
    }
    overlayRects(rects);
    await recognizeRects(rects);
  }catch(e){
    console.error(e); setPhotoStatus(`분석 중 오류: ${e.message}`,'error');
  }finally{ analyzeBtn.disabled=false; }
});

// Fallback: click centers of TL → TR → BR → BL corner cards.
manualBtn.addEventListener('click',()=>{
  if(!photoState.img) return;
  photoState.manualMode=true; photoState.manualPoints=[];
  manualBtn.classList.add('active'); fitCanvasToImage(photoState.img);
  setPhotoStatus('수동 지정: 왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래 카드의 “중심”을 차례로 눌러주세요.','warn');
});

photoCanvas.addEventListener('click',async(e)=>{
  if(!photoState.manualMode || !photoState.img) return;
  const r=photoCanvas.getBoundingClientRect();
  const x=(e.clientX-r.left)*photoCanvas.width/r.width, y=(e.clientY-r.top)*photoCanvas.height/r.height;
  photoState.manualPoints.push({x,y});
  photoCtx.fillStyle='#ef4444'; photoCtx.beginPath(); photoCtx.arc(x,y,8,0,Math.PI*2); photoCtx.fill();
  photoCtx.fillStyle='#fff'; photoCtx.font='bold 14px system-ui'; photoCtx.fillText(String(photoState.manualPoints.length),x-4,y+5);
  if(photoState.manualPoints.length<4){
    setPhotoStatus(`수동 지정 ${photoState.manualPoints.length}/4 완료.`,'warn'); return;
  }
  photoState.manualMode=false; manualBtn.classList.remove('active');
  const [tl,tr,br,bl]=photoState.manualPoints;
  function lerp(a,b,t){return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}
  const centers=[];
  for(let rr=0;rr<3;rr++){
    const left=lerp(tl,bl,rr/2), right=lerp(tr,br,rr/2);
    for(let cc=0;cc<3;cc++) centers.push(lerp(left,right,cc/2));
  }
  const hStep=(Math.hypot(tr.x-tl.x,tr.y-tl.y)+Math.hypot(br.x-bl.x,br.y-bl.y))/4;
  const vStep=(Math.hypot(bl.x-tl.x,bl.y-tl.y)+Math.hypot(br.x-tr.x,br.y-tr.y))/4;
  const w=hStep*0.72, h=vStep*0.88;
  const rects=centers.map(c=>({x:Math.max(0,c.x-w/2),y:Math.max(0,c.y-h/2),width:w,height:h}));
  overlayRects(rects);
  try{ await recognizeRects(rects); }catch(err){console.error(err);setPhotoStatus(`인식 오류: ${err.message}`,'error');}
});

applyBtn.addEventListener('click',()=>{
  if(photoState.detections.length!==9) return;
  photoState.detections.forEach((r,i)=>{
    const id=r.top[0].item.id;
    state.slots[i]={cardId:id,faceDown:false,purse:0,lockUnused:true};
  });
  save(); render();
  setPhotoStatus('인식한 9장을 점수 계산 배열에 적용했습니다. 틀린 카드는 기존 방식으로 눌러서 수정할 수 있습니다.','ok');
  $p('.tableau-section').scrollIntoView({behavior:'smooth',block:'start'});
});

loadFeatures();
