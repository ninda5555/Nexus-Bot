import os, time, logging, asyncio, aiohttp, threading, http.server, socketserver
import pandas as pd
import numpy as np
import ta
import xgboost as xgb
from datetime import datetime

# ==========================================
# CONFIG & BRIDGE (PRE-FILLED FOR YOU)
# ==========================================
class Config:
    SYMBOL = "BTCUSDT"
    TIMEFRAME = "5m"
    MIN_PROBABILITY = 0.65
    ATR_SL_MULTIPLIER = 1.8 
    ATR_TP_MULTIPLIER = 2.5 

TELEGRAM_TOKEN = "8703348962:AAHHJR-THoTvFwmgTbSVNayC6y1_l8E8xe0" 
CHAT_ID = "1878773823"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

# Cloud-er jonno Dummy Server (Render bot-ke bondho korbe na)
def start_dummy_server():
    PORT = int(os.environ.get("PORT", 8080))
    Handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        logging.info(f"Nexus Server listening on port {PORT}")
        httpd.serve_forever()

# ==========================================
# AI BRAIN ENGINE
# ==========================================
class ApexBrainV3:
    def __init__(self):
        self.model = xgb.XGBClassifier(n_estimators=700, learning_rate=0.008, max_depth=7, objective='multi:softprob', random_state=42)
        self.is_trained = False

    def engineer_features(self, df):
        df = df.copy()
        df['rsi'] = ta.momentum.rsi(df['close'], 14)
        df['mfi'] = ta.volume.money_flow_index(df['high'], df['low'], df['close'], df['volume'], 14)
        df['atr'] = ta.volatility.average_true_range(df['high'], df['low'], df['close'], 14)
        df['ema_short'] = df['close'].ewm(span=9).mean()
        df['ema_long'] = df['close'].ewm(span=21).mean()
        df['trend_strength'] = (df['ema_short'] - df['ema_long']) / df['ema_long']
        def hurst(ts):
            lags = range(2, 20)
            tau = [np.sqrt(np.std(np.subtract(ts[lag:], ts[:-lag]))) for lag in lags]
            return np.polyfit(np.log(lags), np.log(tau), 1)[0] * 2.0
        df['hurst'] = df['close'].rolling(100).apply(hurst, raw=True)
        return df.dropna()

    def train(self, df):
        logging.info("🧠 Nexus is learning market patterns...")
        df = self.engineer_features(df)
        targets = []
        closes, atrs = df['close'].values, df['atr'].values
        for i in range(len(df) - 20):
            entry, atr = closes[i], atrs[i]
            long_tp, long_sl = entry + (atr * 2), entry - (atr * 1.5)
            short_tp, short_sl = entry - (atr * 2), entry + (atr * 1.5)
            future = df.iloc[i+1 : i+21]
            if (future['high'] >= long_tp).any(): targets.append(1)
            elif (future['low'] <= short_tp).any(): targets.append(-1)
            else: targets.append(0)
        targets.extend([0] * 20)
        df['target'] = np.array(targets) + 1
        self.model.fit(df[['rsi', 'mfi', 'trend_strength', 'hurst']][:-20], df['target'][:-20])
        self.is_trained = True

# ==========================================
# MAIN LOOP
# ==========================================
async def send_to_mobile(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage?chat_id={CHAT_ID}&text={message}"
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response: return await response.json()

async def main_loop():
    api_url = "https://api.binance.com/api/v3/klines"
    brain = ApexBrainV3()
    async with aiohttp.ClientSession() as session:
        async with session.get(api_url, params={"symbol":Config.SYMBOL, "interval":Config.TIMEFRAME, "limit":1000}) as resp:
            data = await resp.json()
            df = pd.DataFrame(data).iloc[:, :6]
            df.columns = ['time', 'open', 'high', 'low', 'close', 'volume']
            for c in df.columns[1:]: df[c] = pd.to_numeric(df[c])
            brain.train(df)
        
        logging.info("💎 NEXUS CLOUD ENGINE LIVE 💎")
        while True:
            try:
                async with session.get(api_url, params={"symbol":Config.SYMBOL, "interval":Config.TIMEFRAME, "limit":150}) as resp:
                    data = await resp.json()
                    df = pd.DataFrame(data).iloc[:, :6]
                    df.columns = ['time', 'open', 'high', 'low', 'close', 'volume']
                    for c in df.columns[1:]: df[c] = pd.to_numeric(df[c])
                    df_f = brain.engineer_features(df)
                    latest = df_f.iloc[-1]
                    probs = brain.model.predict_proba(df_f[['rsi', 'mfi', 'trend_strength', 'hurst']].iloc[-1:])[0]
                    signal = None
                    if probs[2] > Config.MIN_PROBABILITY: signal = "🚀 LONG (BUY)"
                    elif probs[0] > Config.MIN_PROBABILITY: signal = "📉 SHORT (SELL)"
                    if signal:
                        msg = f"🔥 NEXUS SIGNAL 🔥\n\n🎯 Action: {signal}\n💵 Price: ${latest['close']}\n🧠 Confidence: {max(probs)*100:.1f}%\n🕒 {datetime.now().strftime('%H:%M:%S')}"
                        await send_to_mobile(msg)
                await asyncio.sleep(60)
            except Exception as e:
                await asyncio.sleep(10)

if __name__ == "__main__":
    threading.Thread(target=start_dummy_server, daemon=True).start()
    asyncio.run(main_loop())