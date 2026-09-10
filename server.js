const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_URL = process.env.MARKET_API_URL;
const API_KEY = process.env.MARKET_API_KEY;

// -------------------------
// EMA
// -------------------------
function calculateEMA(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);
  let ema = values[0];

  for (let i = 1; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }

  return ema;
}

// -------------------------
// RSI
// -------------------------
function calculateRSI(closes, period = 14) {
  if (closes.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  if (losses === 0) return 100;

  const rs = gains / losses;

  return 100 - 100 / (1 + rs);
}

// -------------------------
// 2 Minute Strategy
// -------------------------
function analyzeMarket(candles) {
  if (!Array.isArray(candles) || candles.length < 60) {
    throw new Error("At least 60 candles are required");
  }

  const normalized = candles.map((c) => ({
    time: c.time || c.datetime || c.timestamp,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close)
  }));

  const closes = normalized.map((c) => c.close);

  const ema9 = calculateEMA(closes.slice(-60), 9);
  const ema21 = calculateEMA(closes.slice(-60), 21);
  const ema50 = calculateEMA(closes.slice(-60), 50);

  const rsi = calculateRSI(closes, 14);

  const last = normalized[normalized.length - 1];
  const previous = normalized[normalized.length - 2];

  let buyScore = 0;
  let sellScore = 0;

  // Trend
  if (ema9 > ema21 && ema21 > ema50) {
    buyScore++;
  }

  if (ema9 < ema21 && ema21 < ema50) {
    sellScore++;
  }

  // RSI
  if (rsi >= 52 && rsi <= 68) {
    buyScore++;
  }

  if (rsi >= 32 && rsi <= 48) {
    sellScore++;
  }

  // Last candle
  if (last.close > last.open) {
    buyScore++;
  }

  if (last.close < last.open) {
    sellScore++;
  }

  // Previous candle
  if (previous.close > previous.open) {
    buyScore++;
  }

  if (previous.close < previous.open) {
    sellScore++;
  }

  let signal = "WAIT";

  if (buyScore >= 3 && buyScore > sellScore) {
    signal = "BUY";
  }

  if (sellScore >= 3 && sellScore > buyScore) {
    signal = "SELL";
  }

  return {
    timeframe: "2 minutes",
    signal: signal,
    price: last.close,
    rsi: Number(rsi.toFixed(2)),
    ema9: Number(ema9.toFixed(6)),
    ema21: Number(ema21.toFixed(6)),
    ema50: Number(ema50.toFixed(6)),
    buyScore: buyScore,
    sellScore: sellScore,
    candleTime: last.time
  };
}

// -------------------------
// Health Check
// -------------------------
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "Live 2-Minute Signal Backend Running",
    timeframe: "2 minutes"
  });
});

// -------------------------
// Live Signal API
// -------------------------
app.get("/api/signal", async (req, res) => {
  try {
    const symbol = req.query.symbol || "EUR/USD";

    if (!API_URL) {
      return res.status(500).json({
        error: "MARKET_API_URL is not configured in Render"
      });
    }

    if (!API_KEY) {
      return res.status(500).json({
        error: "MARKET_API_KEY is not configured in Render"
      });
    }

    const url =
      API_URL +
      "?symbol=" +
      encodeURIComponent(symbol) +
      "&interval=2min" +
      "&limit=100" +
      "&apikey=" +
      encodeURIComponent(API_KEY);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        "Market API returned HTTP " + response.status
      );
    }

    const data = await response.json();

    const candles =
      data.data ||
      data.values ||
      data.candles ||
      data.results;

    if (!Array.isArray(candles)) {
      return res.status(500).json({
        error: "Market API candle format not recognized",
        receivedKeys: Object.keys(data)
      });
    }

    const result = analyzeMarket(candles);

    res.json({
      market: "LIVE",
      symbol: symbol,
      ...result
    });

  } catch (error) {
    console.error("Signal error:", error);

    res.status(500).json({
      market: "ERROR",
      error: error.message
    });
  }
});

// -------------------------
// Start Server
// -------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log("=================================");
  console.log("Live 2-Minute Signal Backend");
  console.log("Server running on port " + PORT);
  console.log("=================================");
});
