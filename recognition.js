'use strict';

/* Castle Combo photo recognizer v5
   Recognition pipeline:
   1) Detect each physical card border independently (no fixed 3x3 cell assumption).
   2) Perspective-warp each detected card to a normalized portrait image.
   3) Recognize with a hybrid score:
      - full-card ORB visual features
      - top-left cost-symbol region ORB
      - top-right shield-symbol region ORB
      - left vertical Korean card-name OCR (Tesseract.js, rotated to a horizontal line)
   4) Sort detected card centers into the final 3x3 layout only after recognition.
   5) Enforce unique cards across the tableau and expose candidates for review.
*/

const photoState = {
  cvReady: false,
  features: null,
  img: null,
  objectUrl: null,
  detections: [],
  detectedItems: [],
  manualPoints: [],
  manualMode: false,
  ocrWorker: null,
  ocrReady: false,
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
    setPhotoStatus(photoState.features ? '사진을 선택하면 자동 분석할 수 있습니다.' : '카드 인식 데이터를 불러오는 중…');
    analyzeBtn.disabled = !photoState.img || !photoState.features;
  };
  if (typeof cv === 'object' && cv && typeof cv.then === 'function') cv.then(markReady);
  else markReady();
}
window.onOpenCvReady = onOpenCvReady;

async function loadFeatures() {
  try {
    const r = await fetch('data/card-layout-features-v5.json?v=20260809-5');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    photoState.features = await r.json();
    setPhotoStatus(photoState.cvReady ? '카드 90장 고정 레이아웃 인식 데이터 준비 완료.' : 'OpenCV를 불러오는 중…', 'ok');
    analyzeBtn.disabled = !photoState.cvReady || !photoState.img;
  } catch (e) {
    console.error(e);
    setPhotoStatus('카드 인식 데이터를 불러오지 못했습니다. data/card-layout-features-v5.json 위치를 확인해주세요.', 'error');
  }
}

function fitCanvasToImage(img) {
  // More pixels are kept than v3 because contour detection and OCR both benefit from resolution.
  const maxW = 1600;
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
    photoState.detectedItems = [];
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
  const tl=points.reduce((a,b)=>(a.x+a.y)<(b.x+b.y)?a:b);
  const br=points.reduce((a,b)=>(a.x+a.y)>(b.x+b.y)?a:b);
  const tr=points.reduce((a,b)=>(a.y-a.x)<(b.y-b.x)?a:b);
  const bl=points.reduce((a,b)=>(a.y-a.x)>(b.y-b.x)?a:b);
  return [tl,tr,br,bl];
}

function quadMetrics(q){
  const qq=orderQuad(q);
  const w=(dist(qq[0],qq[1])+dist(qq[3],qq[2]))/2;
  const h=(dist(qq[0],qq[3])+dist(qq[1],qq[2]))/2;
  return {q:qq,w,h,ratio:Math.min(w,h)/Math.max(w,h)};
}

function contourApproxQuad(cnt, epsilonFactor){
  const peri=cv.arcLength(cnt,true), approx=new cv.Mat();
  try{
    cv.approxPolyDP(cnt,approx,epsilonFactor*peri,true);
    if(approx.rows!==4 || !cv.isContourConvex(approx)) return null;
    const pts=[]; for(let i=0;i<4;i++) pts.push({x:approx.data32S[i*2],y:approx.data32S[i*2+1]});
    return pts;
  } finally { approx.delete(); }
}

function minRectQuad(cnt){
  const r=cv.minAreaRect(cnt), pts=cv.RotatedRect.points(r);
  return pts.map(p=>({x:p.x,y:p.y}));
}

function contourToCard(cnt, imgArea){
  const area=Math.abs(cv.contourArea(cnt));
  if(area<imgArea*0.004 || area>imgArea*0.30) return null;

  // Try several polygon tolerances. Outer card borders can be rounded/partly interrupted.
  let pts=null;
  for(const eps of [0.018,0.025,0.035,0.050]){
    pts=contourApproxQuad(cnt,eps);
    if(pts) break;
  }
  if(!pts) pts=minRectQuad(cnt);

  const {q,w,h,ratio}=quadMetrics(pts);
  if(w<38||h<55) return null;
  // Perspective may distort the apparent ratio, so this is intentionally generous.
  if(ratio<0.50 || ratio>0.86) return null;
  const b=boundsOf(q), c=centerOf(q);
  if(b.width<=0||b.height<=0) return null;
  const rectangularity=area/(b.width*b.height);
  if(rectangularity<0.42) return null;
  const expected=64/90;
  const ratioFit=Math.exp(-Math.pow((ratio-expected)/0.105,2));
  return {...b,quad:q,center:c,area,ratio,score:area*(0.35+0.65*ratioFit)*Math.min(1,rectangularity+0.25)};
}

function collectCandidatesFromBinary(binary, src, out){
  const contours=new cv.MatVector(), hierarchy=new cv.Mat();
  try{
    cv.findContours(binary,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
    const imgArea=src.cols*src.rows;
    for(let i=0;i<contours.size();i++){
      const cnt=contours.get(i);
      try{const q=contourToCard(cnt,imgArea);if(q)out.push(q);}finally{cnt.delete();}
    }
  } finally {contours.delete();hierarchy.delete();}
}

function detectCardQuads(src) {
  const gray=new cv.Mat(), blur=new cv.Mat(), edges=new cv.Mat(), closed=new cv.Mat(), adaptive=new cv.Mat();
  const kernel3=cv.Mat.ones(3,3,cv.CV_8U), kernel7=cv.Mat.ones(7,7,cv.CV_8U), cand=[];
  try {
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);

    // Multi-threshold edge passes make borders survive dark/light tabletops and mild glare.
    for(const [lo,hi] of [[25,80],[40,120],[65,180]]){
      cv.Canny(blur,edges,lo,hi);
      cv.morphologyEx(edges,closed,cv.MORPH_CLOSE,kernel7);
      collectCandidatesFromBinary(closed,src,cand);
    }

    // Adaptive threshold adds candidates when the border has weak contrast but the card body is locally distinct.
    cv.adaptiveThreshold(gray,adaptive,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY_INV,31,7);
    cv.morphologyEx(adaptive,closed,cv.MORPH_CLOSE,kernel3);
    collectCandidatesFromBinary(closed,src,cand);

    cand.sort((a,b)=>b.score-a.score);
    const picked=[];
    for(const q of cand){
      if(picked.some(p=>boxIoU(p,q)>0.38 || dist(p.center,q.center)<Math.min(p.height,q.height)*0.27)) continue;
      picked.push(q);
      if(picked.length>=24) break;
    }

    if(!picked.length) return [];
    // Prefer nine similarly sized card candidates. This removes table edges and large mats.
    const areas=picked.map(x=>x.area).sort((a,b)=>a-b);
    const med=areas[Math.floor(areas.length/2)];
    let similar=picked.filter(x=>x.area>med*0.42&&x.area<med*2.35);
    if(similar.length<9) similar=picked;
    similar.sort((a,b)=>b.score-a.score);
    return similar.slice(0,12);
  } finally {
    gray.delete();blur.delete();edges.delete();closed.delete();adaptive.delete();kernel3.delete();kernel7.delete();
  }
}

function chooseNineCandidates(items){
  if(items.length<=9)return items;
  // Search for the 9-card subset with consistent dimensions and plausible 3-row geometry.
  const sorted=[...items].sort((a,b)=>b.score-a.score);
  let best=sorted.slice(0,9),bestScore=-Infinity;
  const pool=sorted.slice(0,Math.min(12,sorted.length));
  // Small combinational search: at most C(12,9)=220 subsets.
  function rec(start,chosen){
    if(chosen.length===9){
      const areas=chosen.map(x=>x.area).sort((a,b)=>a-b), med=areas[4];
      const variance=chosen.reduce((s,x)=>s+Math.abs(x.area-med)/med,0)/9;
      const ratioVariance=chosen.reduce((s,x)=>s+Math.abs(x.ratio-(64/90)),0)/9;
      const ys=[...chosen].sort((a,b)=>a.center.y-b.center.y);
      const rows=[ys.slice(0,3),ys.slice(3,6),ys.slice(6,9)];
      const rowSpread=rows.reduce((s,r)=>s+(Math.max(...r.map(x=>x.center.y))-Math.min(...r.map(x=>x.center.y))),0);
      const avgH=chosen.reduce((s,x)=>s+x.height,0)/9;
      const shapePenalty=rowSpread/Math.max(1,avgH);
      const quality=chosen.reduce((s,x)=>s+x.score,0)/(med*9);
      const score=quality-variance*1.15-ratioVariance*2.2-shapePenalty*0.55;
      if(score>bestScore){bestScore=score;best=[...chosen];}
      return;
    }
    for(let i=start;i<=pool.length-(9-chosen.length);i++)rec(i+1,[...chosen,pool[i]]);
  }
  rec(0,[]);return best;
}

function sortGrid(items) {
  if(items.length!==9) return items;
  // Rows are derived from physical centers only after individual card borders were found.
  const sorted=[...items].sort((a,b)=>a.center.y-b.center.y);
  const rows=[sorted.slice(0,3),sorted.slice(3,6),sorted.slice(6,9)];
  rows.forEach(row=>row.sort((a,b)=>a.center.x-b.center.x));
  return rows.flat();
}


function roiClone(src,x,y,w,h){
  const xx=Math.max(0,Math.min(src.cols-1,Math.round(x))), yy=Math.max(0,Math.min(src.rows-1,Math.round(y)));
  const ww=Math.max(1,Math.min(src.cols-xx,Math.round(w))), hh=Math.max(1,Math.min(src.rows-yy,Math.round(h)));
  const roi=src.roi(new cv.Rect(xx,yy,ww,hh)),out=roi.clone();roi.delete();return out;
}

function warpQuadMat(src,item){
  const q=orderQuad(item.quad), size=photoState.features.normalizedSize||[320,450], W=size[0],H=size[1];
  const srcPts=cv.matFromArray(4,1,cv.CV_32FC2,[q[0].x,q[0].y,q[1].x,q[1].y,q[2].x,q[2].y,q[3].x,q[3].y]);
  const dstPts=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,W-1,0,W-1,H-1,0,H-1]);
  const M=cv.getPerspectiveTransform(srcPts,dstPts),out=new cv.Mat();
  try{cv.warpPerspective(src,out,M,new cv.Size(W,H),cv.INTER_CUBIC,cv.BORDER_REPLICATE);return out;}
  finally{srcPts.delete();dstPts.delete();M.delete();}
}
function cropCenteredMat(src,item){
  const size=photoState.features.normalizedSize||[320,450], W=size[0],H=size[1];
  const x=Math.max(0,Math.round(item.x)),y=Math.max(0,Math.round(item.y));
  const x2=Math.min(src.cols,Math.round(item.x+item.width)),y2=Math.min(src.rows,Math.round(item.y+item.height));
  const roi=src.roi(new cv.Rect(x,y,Math.max(1,x2-x),Math.max(1,y2-y))),out=new cv.Mat();
  try{cv.resize(roi,out,new cv.Size(W,H),0,0,cv.INTER_AREA);return out;}finally{roi.delete();}
}
function cardMatFor(src,item){return item.quad?warpQuadMat(src,item):cropCenteredMat(src,item);}

function normalizeKoreanText(s){return (s||'').replace(/[^가-힣0-9]/g,'').trim();}
function levenshtein(a,b){
  a=normalizeKoreanText(a);b=normalizeKoreanText(b);if(!a&&!b)return 0;if(!a||!b)return Math.max(a.length,b.length);
  const dp=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){let prev=dp[0];dp[0]=i;for(let j=1;j<=b.length;j++){const tmp=dp[j];dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=tmp;}}
  return dp[b.length];
}
function textSimilarity(a,b){const aa=normalizeKoreanText(a),bb=normalizeKoreanText(b);if(!aa||!bb)return 0;return Math.max(0,1-levenshtein(aa,bb)/Math.max(aa.length,bb.length));}

function b64Bytes(s){const bin=atob(s),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return a;}
function ensureTemplateVectors(){
  if(photoState.features._decoded)return;
  for(const c of photoState.features.cards){c._regions={};for(const [k,v] of Object.entries(c.regions))c._regions[k]=b64Bytes(v);}
  photoState.features._decoded=true;
}
function signatureForRegion(cardMat,rect){
  const [rx,ry,rw,rh]=rect,W=cardMat.cols,H=cardMat.rows,sz=photoState.features.signatureSize||24;
  const roi=roiClone(cardMat,rx*W,ry*H,rw*W,rh*H),gray=new cv.Mat(),eq=new cv.Mat(),gx=new cv.Mat(),gy=new cv.Mat(),mag=new cv.Mat(),norm=new cv.Mat(),small=new cv.Mat();
  try{
    cv.cvtColor(roi,gray,cv.COLOR_RGBA2GRAY);cv.equalizeHist(gray,eq);
    cv.Sobel(eq,gx,cv.CV_32F,1,0,3);cv.Sobel(eq,gy,cv.CV_32F,0,1,3);cv.magnitude(gx,gy,mag);cv.normalize(mag,norm,0,255,cv.NORM_MINMAX,cv.CV_8U);
    cv.resize(norm,small,new cv.Size(sz,sz),0,0,cv.INTER_AREA);return new Uint8Array(small.data);
  }finally{roi.delete();gray.delete();eq.delete();gx.delete();gy.delete();mag.delete();norm.delete();small.delete();}
}
function corrSimilarity(a,b){
  if(!a||!b||a.length!==b.length)return 0;let ma=0,mb=0;for(let i=0;i<a.length;i++){ma+=a[i];mb+=b[i];}ma/=a.length;mb/=b.length;
  let num=0,da=0,db=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;num+=x*y;da+=x*x;db+=y*y;}const den=Math.sqrt(da*db);return den?Math.max(0,num/den):0;
}
function allRegionSignatures(cardMat){
  const out={};for(const [k,r] of Object.entries(photoState.features.regions))out[k]=signatureForRegion(cardMat,r);return out;
}
function matToCanvas(mat){const c=document.createElement('canvas');c.width=mat.cols;c.height=mat.rows;cv.imshow(c,mat);return c;}
function prepareNameForOcr(cardMat){
  const r=photoState.features.regions.name,W=cardMat.cols,H=cardMat.rows;
  const strip=roiClone(cardMat,r[0]*W,r[1]*H,r[2]*W,r[3]*H),rot=new cv.Mat(),gray=new cv.Mat(),bin=new cv.Mat(),scaled=new cv.Mat();
  try{cv.rotate(strip,rot,cv.ROTATE_90_CLOCKWISE);cv.cvtColor(rot,gray,cv.COLOR_RGBA2GRAY);cv.threshold(gray,bin,0,255,cv.THRESH_BINARY+cv.THRESH_OTSU);cv.resize(bin,scaled,new cv.Size(bin.cols*3,bin.rows*3),0,0,cv.INTER_CUBIC);return scaled.clone();}
  finally{strip.delete();rot.delete();gray.delete();bin.delete();scaled.delete();}
}
async function ensureOcrWorker(){
  if(photoState.ocrWorker)return photoState.ocrWorker;if(typeof Tesseract==='undefined')throw new Error('Tesseract.js를 불러오지 못했습니다.');
  setPhotoStatus('한글 카드명 OCR 엔진을 불러오는 중…','working');
  photoState.ocrWorker=await Tesseract.createWorker(['kor'],1,{logger:m=>{if(m.status==='loading language traineddata'&&m.progress)setPhotoStatus(`한글 OCR 데이터 ${Math.round(m.progress*100)}%`,'working');}});return photoState.ocrWorker;
}
async function ocrCardName(cardMat){
  try{const worker=await ensureOcrWorker(),m=prepareNameForOcr(cardMat),canvas=matToCanvas(m);m.delete();await worker.setParameters({tessedit_pageseg_mode:Tesseract.PSM.SINGLE_LINE,preserve_interword_spaces:'0'});const {data}=await worker.recognize(canvas);return normalizeKoreanText(data.text||'');}
  catch(e){console.warn('OCR failed',e);return '';}
}
function scoreOrientation(cardMat,ocrText=''){
  ensureTemplateVectors();const q=allRegionSignatures(cardMat),weights={art:.27,name:.23,cost:.10,shield:.12,effect:.13,score:.15},raw=[];
  for(const item of photoState.features.cards){
    const parts={};let visual=0;for(const [k,w] of Object.entries(weights)){parts[k]=corrSimilarity(q[k],item._regions[k]);visual+=w*parts[k];}
    const txt=ocrText?textSimilarity(ocrText,item.ko):0;
    // Exact layout + card-name OCR: OCR is a strong bonus, but bad OCR never destroys good visual evidence.
    const hybrid=visual+(ocrText?0.30*txt:0)+(txt>=0.84?0.10:0);
    raw.push({item,hybrid,textScore:txt,...parts});
  }
  raw.sort((a,b)=>b.hybrid-a.hybrid);return raw;
}
function rotate180(src){const out=new cv.Mat();cv.rotate(src,out,cv.ROTATE_180);return out;}
async function recognizeCard(cardMat){
  // Determine orientation from layout signatures first, then OCR only the better orientation.
  const s0=scoreOrientation(cardMat,''),r180=rotate180(cardMat);let s1;
  try{s1=scoreOrientation(r180,'');}finally{}
  const use180=(s1[0]?.hybrid||0)>(s0[0]?.hybrid||0)+0.035, chosen=use180?r180:cardMat;
  const ocrText=await ocrCardName(chosen),scores=scoreOrientation(chosen,ocrText);
  if(!use180)r180.delete();
  else r180.delete();
  const a=scores[0]?.hybrid||0,b=scores[1]?.hybrid||0,margin=a-b;
  const confidence=Math.max(0,Math.min(99,Math.round(38+margin*175+Math.max(0,a-.40)*55)));
  return {top:scores.slice(0,8),confidence,needsReview:a<0.48||margin<0.07,ocrText,rotated180:use180};
}
function overlayItems(items){
  fitCanvasToImage(photoState.img);photoCtx.save();photoCtx.lineWidth=4;photoCtx.font='bold 18px system-ui';
  items.forEach((it,i)=>{
    photoCtx.strokeStyle='#22c55e';photoCtx.fillStyle='rgba(20,20,20,.76)';
    if(it.quad){const q=orderQuad(it.quad);photoCtx.beginPath();photoCtx.moveTo(q[0].x,q[0].y);q.slice(1).forEach(p=>photoCtx.lineTo(p.x,p.y));photoCtx.closePath();photoCtx.stroke();}
    else photoCtx.strokeRect(it.x,it.y,it.width,it.height);
    const c=it.center||{x:it.x+it.width/2,y:it.y+it.height/2};photoCtx.fillRect(c.x-18,c.y-14,36,28);photoCtx.fillStyle='#fff';photoCtx.fillText(String(i+1),c.x-5,c.y+7);
  });photoCtx.restore();
}

function makeUnique(results){
  const order=results.map((r,i)=>({i,best:r.top[0]?.hybrid||0,margin:(r.top[0]?.hybrid||0)-(r.top[1]?.hybrid||0)})).sort((a,b)=>(b.margin-a.margin)||(b.best-a.best));
  const used=new Set();
  for(const o of order){const r=results[o.i],chosen=r.top.find(c=>!used.has(c.item.id))||r.top[0];if(chosen){r.top=[chosen,...r.top.filter(c=>c.item.id!==chosen.item.id)];used.add(chosen.item.id);}}
  return results;
}

function candidateButton(c,slotIndex){
  const used=new Set(photoState.detections.map((r,i)=>i===slotIndex?null:r.top[0]?.item.id).filter(Boolean)),disabled=used.has(c.item.id);
  const textPct=Math.round((c.textScore||0)*100),hybridPct=Math.round((c.hybrid||0)*100);
  return `<button type="button" class="candidate" data-slot="${slotIndex}" data-id="${c.item.id}" ${disabled?'disabled':''}>
    <b>${c.item.ko}</b><small>종합 ${hybridPct} · OCR ${textPct}% · 그림 ${Math.round(c.art*100)} · 카드명 ${Math.round(c.name*100)} · 비용 ${Math.round(c.cost*100)} · 방패 ${Math.round(c.shield*100)} · 효과 ${Math.round(c.effect*100)} · 점수 ${Math.round(c.score*100)}${disabled?' · 다른 칸에서 선택됨':''}</small>
  </button>`;
}

function renderRecognition(results){
  recognitionResults.innerHTML=results.map((r,i)=>{
    const best=r.top[0],ocr=r.ocrText||'읽지 못함';
    return `<article class="recognition-card ${r.needsReview?'review':''}" data-index="${i}">
      <div class="recognition-head"><span>${Math.floor(i/3)+1}행 ${i%3+1}열</span><strong>${r.needsReview?'확인 필요':'자동 인식'}</strong></div>
      <h3>${best?.item.ko||'인식 실패'}</h3>
      <div class="confidence"><i style="width:${r.confidence}%"></i></div><small>신뢰도 ${r.confidence}% · OCR: ${ocr}</small>
      <details ${r.needsReview?'open':''}><summary>인식 근거 / 후보 변경</summary>${r.top.slice(0,5).map(c=>candidateButton(c,i)).join('')}</details>
    </article>`;
  }).join('');
  recognitionResults.querySelectorAll('.candidate:not([disabled])').forEach(btn=>btn.addEventListener('click',()=>{
    const idx=+btn.dataset.slot,result=photoState.detections[idx],chosen=result.top.find(x=>x.item.id===btn.dataset.id);if(!chosen)return;
    result.top=[chosen,...result.top.filter(x=>x.item.id!==chosen.item.id)];result.needsReview=false;result.confidence=Math.max(result.confidence,82);makeUnique(photoState.detections);renderRecognition(photoState.detections);
  }));applyBtn.hidden=false;
}

async function recognizeItems(items){
  const src=matFromDisplayedImage();
  try{
    const results=[];
    for(let i=0;i<items.length;i++){
      setPhotoStatus(`${i+1}/9 카드 분석 중… 64×90 규격 보정 + 고정 레이아웃 6영역 비교`,'working');
      const crop=cardMatFor(src,items[i]);
      try{results.push(await recognizeCard(crop));}finally{crop.delete();}
      await new Promise(r=>setTimeout(r,0));
    }
    photoState.detections=makeUnique(results);renderRecognition(photoState.detections);
    const reviews=photoState.detections.filter(x=>x.needsReview).length;
    setPhotoStatus(reviews?`9장 인식 완료. ${reviews}장은 후보를 확인해주세요.`:'9장 인식 완료. 결과를 확인한 뒤 배열에 적용하세요.',reviews?'warn':'ok');
  }finally{src.delete();}
}

analyzeBtn.addEventListener('click',async()=>{
  if(!photoState.cvReady||!photoState.features||!photoState.img)return;
  analyzeBtn.disabled=true;applyBtn.hidden=true;recognitionResults.innerHTML='';
  try{
    setPhotoStatus('64×90mm 카드 비율을 기준으로 카드 테두리를 개별 검출하는 중…','working');
    const src=matFromDisplayedImage();let items;
    try{items=detectCardQuads(src);items=chooseNineCandidates(items);items=sortGrid(items);}finally{src.delete();}
    photoState.detectedItems=items;
    if(items.length!==9){
      overlayItems(items);
      setPhotoStatus(`카드 테두리를 ${items.length}장 찾았습니다. 9장이 아니면 “수동 4점 지정”을 사용하거나 촬영 각도를 조금 바꿔주세요.`,'warn');return;
    }
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
  const r=photoCanvas.getBoundingClientRect(),x=(e.clientX-r.left)*photoCanvas.width/r.width,y=(e.clientY-r.top)*photoCanvas.height/r.height;
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
  save();render();setPhotoStatus('인식한 9장을 배열에 적용했습니다. 틀린 카드만 눌러 수정할 수 있습니다.','ok');$p('.tableau-section').scrollIntoView({behavior:'smooth',block:'start'});
});

loadFeatures();
