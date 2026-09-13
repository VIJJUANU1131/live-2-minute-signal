const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_URL =
  process.env.MARKET_API_URL || "https://api.realmarketapi.com";
const API_KEY = process.env.MARKET_API_KEY;

// -------------------------
// EMA
// -------------------------
function calculateEMA(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);
  let ema = values[0];

  for (let i = 1; i < values.length; i++) {
    ema =
      (values[i] - ema) * multiplier + ema;
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

  for (
    let i = closes.length - period;
    i < closes.length;
    i++
  ) {
    const change =
      closes[i] - closes[i - 1];

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
// M1 → M2 candles
// -------------------------
function makeTwoMinuteCandles(candles) {
  const result = [];

  const sorted = [...candles].sort(
    (a, b) =>
      new Date(
        a.openTime || a.time || a.timestamp
      ).getTime() -
      new Date(
        b.openTime || b.time || b.timestamp
      ).getTime()
  );

  for (let i = 0; i < sorted.length - 1; i += 2) {
    const c1 = sorted[i];
    const c2 = sorted[i + 1];

    if (!c1 || !c2) continue;

    result.push({
      time:
        c1.openTime ||
        c1.time ||
        c1.timestamp,

      open: Number(c1.open),

      high: Math.max(
        Number(c1.high),
        Number(c2.high)
      ),

      low: Math.min(
        Number(c1.low),
        Number(c2.low)
      ),

      close: Number(c2.close)
    });
  }

  return result;
}

// -------------------------
// Signal Analysis
// -------------------------
function analyzeMarket(candles) {
  if (
    !Array.isArray(candles) ||
   if (candles.length < 50) {
  ) {
    throw new Error(
      "Not enough candles for analysis"
    );
  }

  const closes = candles.map(
    (c) => Number(c.close)
  );

  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);

  const rsi = calculateRSI(closes, 14);

  const last =
    candles[candles.length - 1];

  const previous =
    candles[candles.length - 2];

  let buyScore = 0;
  let sellScore = 0;

  // Trend
  if (
    ema9 > ema21 &&
    ema21 > ema50
  ) {
    buyScore++;
  }

  if (
    ema9 < ema21 &&
    ema21 < ema50
  ) {
    sellScore++;
  }

  // RSI
  if (rsi >= 52 && rsi <= 68) {
    buyScore++;
  }

  if (rsi >= 32 && rsi <= 48) {
    sellScore++;
  }

  // Current candle
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

  if (
    buyScore >= 3 &&
    buyScore > sellScore
  ) {
    signal = "BUY";
  }

  if (
    sellScore >= 3 &&
    sellScore > buyScore
  ) {
    signal = "SELL";
  }

  const strength = Math.round(
    (Math.max(
      buyScore,
      sellScore
    ) /
      4) *
      100
  );

  let trend = "SIDEWAYS";

  if (
    ema9 > ema21 &&
    ema21 > ema50
  ) {
    trend = "UPTREND";
  } else if (
    ema9 < ema21 &&
    ema21 < ema50
  ) {
    trend = "DOWNTREND";
  }

  return {
    timeframe: "2 minutes",
    signal,
    strength,
    trend,
    price: last.close,
    rsi: Number(rsi.toFixed(2)),
    ema9: Number(ema9.toFixed(6)),
    ema21: Number(ema21.toFixed(6)),
    ema50: Number(ema50.toFixed(6)),
    buyScore,
    sellScore,
    candleTime: last.time
  };
}

// -------------------------
// Health Check
// -------------------------
app.get("/", (req, res) => {
  res.json({
    status: "online",
    message:
      "Live 2-Minute Signal Backend Running",
    marketAPI: "RealMarketAPI",
    timeframe: "2 minutes"
  });
});

// -------------------------
// Live Signal API
// -------------------------
app.get("/api/signal", async (req, res) => {
  try {
    const symbol = (
      req.query.symbol || "EURUSD"
    )
      .replace("/", "")
      .toUpperCase();

    if (!API_KEY) {
      return res.status(500).json({
        market: "ERROR",
        error:
          "MARKET_API_KEY is not configured in Render"
      });
    }

    const url = new URL(
      "/api/v1/candle",
      API_URL
    );

    // IMPORTANT: Capital letters
    url.searchParams.set(
      "ApiKey",
      API_KEY
    );

    url.searchParams.set(
      "SymbolCode",
      symbol
    );

    url.searchParams.set(
      "TimeFrame",
      "M1"
    );

    url.searchParams.set(
      "pageSize",
      "200"
    );

    console.log(
      "Requesting market data for:",
      symbol
    );

    const response = await fetch(
      url.toString()
    );

    const responseText =
      await response.text();

    if (!response.ok) {
      console.error(
        "RealMarketAPI error:",
        response.status,
        responseText
      );

      return res.status(500).json({
        market: "ERROR",
        error:
          "RealMarketAPI HTTP " +
          response.status,
        details: responseText
      });
    }

    let json;

    try {
      json = JSON.parse(responseText);
    } catch (e) {
      return res.status(500).json({
        market: "ERROR",
        error:
          "RealMarketAPI returned invalid JSON",
        details: responseText
      });
    }

    console.log(
      "RealMarketAPI response received"
    );

    const rawCandles =
      json.data ||
      json.candles ||
      json.values ||
      json.results ||
      [];

    if (!Array.isArray(rawCandles)) {
      return res.status(500).json({
        market: "ERROR",
        error:
          "Candle data not found in API response",
        receivedKeys:
          Object.keys(json)
      });
    }

    const candles =
      makeTwoMinuteCandles(
        rawCandles
      );

    if (candles.length < 50) {
      return res.status(500).json({
        market: "ERROR",
        error:
          "Not enough candles for 2-minute analysis",
        oneMinuteCandles:
          rawCandles.length,
        twoMinuteCandles:
          candles.length
      });
    }

    const result =
      analyzeMarket(candles);

    res.json({
      market: "LIVE",
      provider: "RealMarketAPI",
      symbol,
      ...result
    });

  } catch (error) {
    console.error(
      "Signal error:",
      error
    );

    res.status(500).json({
      market: "ERROR",
      error: error.message
    });
  }
});

// -------------------------
// Start Server
// -------------------------
app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "================================="
    );
    console.log(
      "Live 2-Minute Signal Backend"
    );
    console.log(
      "RealMarketAPI Connected"
    );
    console.log(
      "Server running on port " +
        PORT
    );
    console.log(
      "================================="
    );
  }
);
