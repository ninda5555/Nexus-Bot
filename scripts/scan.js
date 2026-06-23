// ===================================================================
// NEXUS scheduled scanner -> Telegram alerts.
// Runs every ~5 min via GitHub Actions. For each coin it evaluates the
// engine on the latest CLOSED bar AND the previous bar, and only alerts
// on a FRESH transition into a signal (no repeat spam while it persists).
//
// Secrets (GitHub repo -> Settings -> Secrets and variables -> Actions):
//   TELEGRAM_TOKEN    - from @BotFather
//   TELEGRAM_CHAT_ID  - your chat id (from @userinfobot)
// Never hardcode these.
// ===================================================================
'use strict';
const { COINS, CONF_THRESH, fetchC, decide } = require('../engine/engine');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT  = process.env.TELEGRAM_CHAT_ID;

const fmt = (p, dp)=> p==null?'-':'$'+Number(p).toLocaleString('en-US',{minimumFractionDigits:dp,maximumFractionDigits:dp});

async function tg(text){
  if(!TOKEN || !CHAT){ console.log('[skip telegram] missing TELEGRAM_TOKEN / TELEGRAM_CHAT_ID'); return; }
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode:'HTML', disable_web_page_preview:true })
  });
  if(!r.ok) console.error('telegram error', r.status, await r.text());
}

async function evalCoin(coin){
  const [ltf, htf, htf4h] = await Promise.all([
    fetchC(coin.sym,'5m',300), fetchC(coin.sym,'1h',150), fetchC(coin.sym,'4h',150),
  ]);
  const now  = decide(ltf, htf, htf4h, CONF_THRESH);
  const prev = decide(ltf.slice(0,-1), htf, htf4h, CONF_THRESH); // one bar earlier
  const isExec = d => d==='EXECUTE_LONG' || d==='EXECUTE_SHORT';
  const fresh = isExec(now.decision) && now.decision !== prev.decision;
  return { coin, now, fresh };
}

(async ()=>{
  console.log(`NEXUS scan @ ${new Date().toISOString()} | threshold ${Math.round(CONF_THRESH*100)}%`);
  const results = [];
  for(const c of COINS){
    try{ results.push(await evalCoin(c)); }
    catch(e){ console.error(`[${c.short}] ${e.message}`); }
  }
  const fresh = results.filter(r=>r.fresh);
  for(const r of results){
    const d=r.now; const tag=d.decision;
    console.log(`[${r.coin.short}] ${tag} | dir ${d.dir||'-'} | prob ${d.pConf?Math.round(d.pConf*100)+'%':'-'} | ${d.regime||''}${r.fresh?'  <-- FRESH':''}`);
  }
  for(const r of fresh){
    const { coin, now } = r;
    const long = now.decision==='EXECUTE_LONG';
    const wr = now.bt ? `${Math.round(now.bt.winRate*100)}% backtest hit (${now.bt.n})` : '';
    const msg =
      `${long?'\u{1F7E2} <b>LONG</b>':'\u{1F534} <b>SHORT</b>'} — <b>${coin.short}/USDT</b>\n`+
      `Price: <b>${fmt(now.price, coin.dp)}</b>\n`+
      `Entry: ${fmt(now.entry, coin.dp)}\n`+
      `Stop:  ${fmt(now.sl, coin.dp)}\n`+
      `Target:${fmt(now.tp, coin.dp)}\n`+
      `R:R ${now.rr.toFixed(1)} | Prob ${Math.round(now.pConf*100)}% | ${now.regime.replace(/_/g,' ')}\n`+
      `${wr}\n`+
      `⚠️ Not financial advice. Paper trade first.`;
    await tg(msg);
    console.log(`alert sent: ${coin.short} ${now.decision}`);
  }
  if(!fresh.length) console.log('no fresh signals this scan.');
})().catch(e=>{ console.error(e); process.exit(1); });
