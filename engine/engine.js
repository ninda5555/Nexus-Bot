// ===================================================================
// NEXUS engine (Node) - shared core used by the scheduled Telegram
// alert job. Mirrors the tuned logic in index.html so cloud alerts and
// the dashboard agree. Pure functions, no DOM. Node 18+ (global fetch).
// ===================================================================
'use strict';

const BASE = 'https://fapi.binance.com';
const SL_ATR = 1.8, TP_ATR = 2.7, HORIZON = 24;
const CONF_THRESH = Math.min(0.9, Math.max(0.55, parseFloat(process.env.CONF_THRESH || '0.72')));

const COINS = [
  { sym:'BTCUSDT', short:'BTC', dp:0 },
  { sym:'ETHUSDT', short:'ETH', dp:1 },
  { sym:'SOLUSDT', short:'SOL', dp:2 },
  { sym:'BNBUSDT', short:'BNB', dp:2 },
  { sym:'XRPUSDT', short:'XRP', dp:4 },
  { sym:'DOGEUSDT',short:'DOGE',dp:5 },
];

// -- indicators -----------------------------------------------------
const ema = (a,p)=>{
  const k=2/(p+1), r=new Array(a.length).fill(null);
  let ok=false, pv=0;
  for(let i=0;i<a.length;i++){
    if(i<p-1)continue;
    if(!ok){let s=0;for(let j=i-p+1;j<=i;j++)s+=a[j];pv=s/p;r[i]=pv;ok=true;}
    else{pv=a[i]*k+pv*(1-k);r[i]=pv;}
  } return r;
};
const emaL=(a,p)=>{const r=ema(a,p);return r[r.length-1]??null;};
const rsiL=(c,p=14)=>{
  if(c.length<p+2)return 50;
  let g=0,l=0;
  for(let i=1;i<=p;i++){const d=c[i]-c[i-1];d>0?g+=d:l-=d;}
  let ag=g/p,al=l/p;
  for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+Math.max(d,0))/p;al=(al*(p-1)+Math.max(-d,0))/p;}
  return 100-100/(1+ag/(al||1e-10));
};
const macdL=(c,f=12,s=26,sg=9)=>{
  const ef=ema(c,f),es=ema(c,s);
  const ml=c.map((_,i)=>ef[i]!=null&&es[i]!=null?ef[i]-es[i]:null);
  const vl=ml.filter(v=>v!=null);
  if(vl.length<sg)return{hist:0,accel:0};
  const se=ema(vl,sg);
  const h1=vl[vl.length-1]-(se[se.length-1]||0);
  const h2=vl[vl.length-2]-(se[se.length-2]||0);
  return{hist:h1,accel:h1-h2};
};
const atrL=(can,p=14)=>{
  const tr=[];for(let i=1;i<can.length;i++)tr.push(Math.max(can[i].h-can[i].l,Math.abs(can[i].h-can[i-1].c),Math.abs(can[i].l-can[i-1].c)));
  const r=ema(tr,p);return r[r.length-1]||tr[tr.length-1]||0;
};
const adxD=(can,p=14)=>{
  const pd=[],nd=[],tr=[];
  for(let i=1;i<can.length;i++){
    const u=can[i].h-can[i-1].h,d=can[i-1].l-can[i].l;
    pd.push(u>d&&u>0?u:0);nd.push(d>u&&d>0?d:0);
    tr.push(Math.max(can[i].h-can[i].l,Math.abs(can[i].h-can[i-1].c),Math.abs(can[i].l-can[i-1].c)));
  }
  const ae=ema(tr,p),pe=ema(pd,p),ne=ema(nd,p);
  const la=ae[ae.length-1]||1;
  const pdi=(pe[pe.length-1]||0)/la*100, ndi=(ne[ne.length-1]||0)/la*100;
  const dx=[];
  for(let i=0;i<tr.length;i++){if(ae[i]&&pe[i]!=null&&ne[i]!=null){const a=(pe[i]/ae[i])*100,b=(ne[i]/ae[i])*100;dx.push(Math.abs(a-b)/((a+b)||1)*100);}}
  return{adx:dx.length?dx.slice(-p).reduce((a,b)=>a+b)/Math.min(dx.length,p):20,pdi,ndi};
};
const rvolL=(can,p=20)=>{if(can.length<=p)return 1;const v=can.map(c=>c.v),avg=v.slice(-p-1,-1).reduce((a,b)=>a+b)/p;return v[v.length-1]/(avg||1);};
const cvdS=(can,n=14)=>{if(can.length<n+1)return 0;let cv=0;const r=can.slice(-n);for(const c of r){cv+=(c.c>c.o?c.v:c.c<c.o?-c.v:0);}return cv;};
const stdDev=(a)=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length);};
const volPct=(c,lb=90)=>{if(c.length<lb+20)return 50;const lg=c.slice(1).map((v,i)=>Math.log(v/c[i]));const cur=stdDev(lg.slice(-20));const h=[];for(let i=0;i<lg.length-20;i++)h.push(stdDev(lg.slice(i,i+20)));return h.filter(v=>v<cur).length/h.length*100;};
const bbW=(c,p=20)=>{if(c.length<p+10)return{now:.02,prev:.02};const calc=(i)=>{const sl=c.slice(i-p,i),m=sl.reduce((a,b)=>a+b)/p,s=Math.sqrt(sl.reduce((a,b)=>a+(b-m)**2,0)/p);return(m+2*s-(m-2*s))/m;};return{now:calc(c.length),prev:calc(c.length-10)};};
const swingHL=(can,w=5)=>{const hs=[],ls=[],H=can.map(c=>c.h),L=can.map(c=>c.l);for(let i=w;i<can.length-w;i++){if([...Array(w)].every((_,j)=>H[i]>=H[i-j-1]&&H[i]>=H[i+j+1]))hs.push(i);if([...Array(w)].every((_,j)=>L[i]<=L[i-j-1]&&L[i]<=L[i+j+1]))ls.push(i);}return{hs,ls};};
const effRatio=(c,p=10)=>{if(c.length<p+1)return 0.5;const sl=c.slice(-p-1),ch=Math.abs(sl[sl.length-1]-sl[0]);let path=0;for(let i=1;i<sl.length;i++)path+=Math.abs(sl[i]-sl[i-1]);return path?ch/path:0;};
const emaSlope=(c,p=20,lb=5)=>{const r=ema(c,p).filter(v=>v!=null);if(r.length<lb+1)return 0;return(r[r.length-1]-r[r.length-1-lb])/Math.max(Math.abs(r[r.length-1-lb]),1e-8);};

// -- model ----------------------------------------------------------
function buildFeatures(can){
  const c=can.map(x=>x.c);
  const e20=emaL(c,20),e50=emaL(c,50),e200=emaL(c,200);
  const slope=emaSlope(c,20);
  const {adx,pdi,ndi}=adxD(can);
  const rsi=rsiL(c);
  const {hist:mh,accel:ma}=macdL(c);
  const atr=atrL(can);
  const rvol=rvolL(can);
  const cvd=cvdS(can);
  const vp=volPct(c);
  const {now:bbw,prev:bbwP}=bbW(c);
  const eff=effRatio(c);
  const last=can[can.length-1];
  const close=last.c;
  const closePos=(close-last.l)/Math.max(last.h-last.l,1e-8);
  return {close,e20,e50,e200,slope,adx,pdi,ndi,rsi,mh,ma,atr,rvol,cvd,vp,bbw,bbwP,eff,closePos};
}
function scoreFeatures(f){
  let trend=0;
  if(f.e20&&f.e50&&f.e200){
    if(f.e20>f.e50&&f.e50>f.e200)trend+=0.60;
    else if(f.e20<f.e50&&f.e50<f.e200)trend-=0.60;
    else if(f.e20>f.e50)trend+=0.20;else if(f.e20<f.e50)trend-=0.20;
  }
  trend+=Math.max(-0.40,Math.min(0.40,f.slope*900));
  const adxW=Math.max(0,Math.min(1,(f.adx-15)/30));
  let mom=0;
  mom+=f.mh>0?0.40:f.mh<0?-0.40:0;
  mom+=f.ma>0?0.20:f.ma<0?-0.20:0;
  if(f.rsi>50)mom+=Math.min(0.30,(f.rsi-50)/55);else mom-=Math.min(0.30,(50-f.rsi)/55);
  if(f.rsi>74)mom-=0.35;else if(f.rsi<26)mom+=0.35;
  let flow=0;
  flow+=f.cvd>0?0.45:f.cvd<0?-0.45:0;
  flow+=(f.closePos-0.5)*0.6;
  const rvolW=Math.min(1.4,f.rvol)/1.4;
  let di=f.pdi>f.ndi?0.35:-0.35;
  let struct=0;
  if(f.e20&&f.e50){struct+=f.e20>f.e50?0.3:-0.3;}
  const z=1.7*trend*(0.5+0.5*adxW)+1.1*mom+1.0*flow*(0.4+0.6*rvolW)+0.8*di*adxW+0.6*struct;
  const pUp=1/(1+Math.exp(-z));
  return { pUp, dir:pUp>=0.5?'LONG':'SHORT' };
}
const pConfOf=(s)=> s.dir==='LONG'? s.pUp : 1-s.pUp;
const mtfDir=(s)=> pConfOf(s)>=0.55 ? (s.dir==='LONG'?'buy':'sell') : 'wait';

// Lightweight backtest (same gates as live) -> measured edge per coin
function backtest(can, thr=CONF_THRESH){
  const start=210, end=can.length-HORIZON-1;
  let wins=0, n=0, gw=0, gl=0;
  for(let i=start;i<=end;i++){
    const f=buildFeatures(can.slice(0,i+1));
    if(f.adx<22||f.rvol<1.0)continue;
    const s=scoreFeatures(f);
    if(pConfOf(s)<thr)continue;
    const isLong=s.dir==='LONG', entry=f.close, atr=f.atr;
    if(atr<=0)continue;
    const sl=isLong?entry-SL_ATR*atr:entry+SL_ATR*atr;
    const tp=isLong?entry+TP_ATR*atr:entry-TP_ATR*atr;
    let outcome=0; const rr=TP_ATR/SL_ATR;
    for(let j=i+1;j<=i+HORIZON;j++){
      const b=can[j];
      if(isLong){ if(b.l<=sl){outcome=-1;break;} if(b.h>=tp){outcome=1;break;} }
      else      { if(b.h>=sl){outcome=-1;break;} if(b.l<=tp){outcome=1;break;} }
    }
    n++;
    if(outcome===1){wins++;gw+=rr;}
    else if(outcome===-1){gl+=1;}
    else{const exit=can[i+HORIZON].c;const r=isLong?(exit-entry)/(entry-sl):(entry-exit)/(sl-entry);if(r>=0){wins++;gw+=r;}else{gl+=Math.abs(r);}}
  }
  return { winRate:n?wins/n:0, n, expR:n?(gw-gl)/n:0, pf:gl>0?gw/gl:(gw>0?99:0) };
}

// Full decision for a coin given the three timeframes' candles.
function decide(ltf, htf, htf4h, thr=CONF_THRESH){
  if(!ltf || ltf.length<260) return { decision:'INSUFFICIENT_DATA' };
  const f=buildFeatures(ltf);
  const s=scoreFeatures(f);
  const pConf=pConfOf(s);
  const isLong=s.dir==='LONG';
  const want=isLong?'buy':'sell';
  const m1=mtfDir(scoreFeatures(buildFeatures(htf)));
  const m4=mtfDir(scoreFeatures(buildFeatures(htf4h)));
  const m5=mtfDir(s);
  const base={ decision:'NO_ACTION', dir:s.dir, pConf, regime:'UNCERTAIN', price:f.close };

  // regime
  if(f.rvol<0.55&&f.adx<16) return {...base, regime:'LOW_LIQUIDITY'};
  if(f.adx<22) return {...base, regime:'RANGING'};
  if(f.vp>90&&f.adx<32) return {...base, regime:'CHOP'};
  base.regime=isLong?'TRENDING_UP':'TRENDING_DOWN';
  // hard filters
  if(f.rvol<1.0||f.vp<10||f.bbw>f.bbwP*2.6||f.eff<0.12) return base;
  // mtf: 1H must confirm + >=2/3 aligned
  if(m1!==want) return base;
  if([m5,m1,m4].filter(x=>x===want).length<2) return base;
  // liquidity
  const rs=ltf.slice(-150); const {hs,ls}=swingHL(rs,5);
  if(isLong&&hs.length&&(rs[hs[hs.length-1]].h-f.close)/f.close<0.006) return base;
  if(!isLong&&ls.length&&(f.close-rs[ls[ls.length-1]].l)/f.close<0.006) return base;
  // probability
  if(pConf<thr) return base;
  // trade plan
  const entry=f.close, atr=f.atr;
  let sl=isLong?entry-SL_ATR*atr:entry+SL_ATR*atr;
  if(isLong&&ls.length) sl=Math.min(sl, rs[ls[ls.length-1]].l*0.998);
  else if(!isLong&&hs.length) sl=Math.max(sl, rs[hs[hs.length-1]].h*1.002);
  const sd=Math.abs(entry-sl);
  if(sd<atr*0.5) return base;
  const tp=isLong?entry+TP_ATR*atr:entry-TP_ATR*atr;
  const rr=Math.abs(tp-entry)/sd;
  if(rr<1.4) return base;
  // edge gate
  const bt=backtest(ltf, thr);
  if(bt.n>=12 && (bt.winRate<0.45 || bt.expR<=0)) return {...base, bt};
  // exhaustion critique
  if((f.adx>45&&f.rsi>72&&isLong)||(f.adx>45&&f.rsi<28&&!isLong)){ if(pConf<0.78) return {...base, decision:'LOW_CONFIDENCE'}; }
  return { decision:isLong?'EXECUTE_LONG':'EXECUTE_SHORT', dir:s.dir, pConf, regime:base.regime,
           price:f.close, entry, sl, tp, rr, bt };
}

// -- data fetch -----------------------------------------------------
// Binance geo-blocks some cloud IPs (HTTP 451/403). Try several public
// kline hosts so the scheduled job stays reliable. Spot & futures klines
// share the same array layout, and the engine only needs OHLCV.
const KLINE_HOSTS = [
  (s,iv,l)=>`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=${iv}&limit=${l}`,
  (s,iv,l)=>`https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=${iv}&limit=${l}`,
  (s,iv,l)=>`https://api.binance.com/api/v3/klines?symbol=${s}&interval=${iv}&limit=${l}`,
];
async function fetchC(sym, iv, lim=300){
  let lastErr;
  for(const build of KLINE_HOSTS){
    try{
      const r=await fetch(build(sym,iv,lim));
      if(!r.ok){ lastErr=new Error(`HTTP ${r.status}`); continue; }
      const j=await r.json();
      if(!Array.isArray(j)||!j.length){ lastErr=new Error('empty'); continue; }
      return j.map(c=>({t:+c[0],o:+c[1],h:+c[2],l:+c[3],c:+c[4],v:+c[5]}));
    }catch(e){ lastErr=e; }
  }
  throw new Error(`klines ${sym} ${iv}: ${lastErr?lastErr.message:'all hosts failed'}`);
}

module.exports = { COINS, CONF_THRESH, SL_ATR, TP_ATR, HORIZON, fetchC, decide, backtest, buildFeatures, scoreFeatures, pConfOf };
