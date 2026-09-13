const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_BASE = "https://api.realmarketapi.com";
const API_KEY = process.env.MARKET_API_KEY;


// ===============================
// EMA
// ===============================
function ema(values, period) {
  if (values.length < period) return null;

  const k = 2 / (period + 1);
  let value = values[0];

  for (let i = 1; i < values.length; i++) {
    value = values[i] * k + value * (1 - k);
  }

  return value;
}


// ===============================
// RSI
// ===============================
function rsi(values, period = 14) {
  if (values.length <= period) return null;

  let gain = 0;
  let loss = 0;

  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    if (change > 0) {
      gain += change;
    } else {
      loss += Math.abs(change);
    }
  }

  if (loss === 0) return 100;

  const rs = gain / loss;

  return 100 - 100 / (1 + rs);
}


// ===============================
// RealMarketAPI candle format
// ===============================
function normalize(c) {
  return {
    time: c.OpenTime,
    open: Number(c.OpenPrice),
    high: Number(c.HighPrice),
    low: Number(c.LowPrice),
    close: Number(c.ClosePrice),
    volume: Number(c.Volume || 0)
  };
}


// ===============================
// Create 2-minute candles
// ===============================
function createTwoMinuteCandles(candles) {

  const sorted = [...candles].sort(
    (a, b) =>
      new Date(a.time) - new Date(b.time)
  );

  const result = [];

  for (let i = 0; i + 1 < sorted.length; i += 2) {

    const a = sorted[i];
    const b = sorted[i + 1];

    result.push({
      time: a.time,
      open: a.open,
      high: Math.max(a.high, b.high),
      low: Math.min(a.low, b.low),
      close: b.close,
      volume: a.volume + b.volume
    });
  }

  return result;
}


// ===============================
// Signal analysis
// ===============================
function analyze(candles) {

  if (candles.length < 50) {
    throw new Error(
      "Not enough candles for analysis"
    );
  }

  const closes = candles.map(
    c => c.close
  );

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);

  const rsiValue = rsi(closes, 14);

  const last =
    candles[candles.length - 1];

  const previous =
    candles[candles.length - 2];

  let buy = 0;
  let sell = 0;


  // Trend
  if (
    ema9 > ema21 &&
    ema21 > ema50
  ) {
    buy++;
  }

  if (
    ema9 < ema21 &&
    ema21 < ema50
  ) {
    sell++;
  }


  // RSI
  if (
    rsiValue >= 52 &&
    rsiValue <= 68
  ) {
    buy++;
  }

  if (
    rsiValue >= 32 &&
    rsiValue <= 48
  ) {
    sell++;
  }


  // Current candle
  if (last.close > last.open) {
    buy++;
  }

  if (last.close < last.open) {
    sell++;
  }


  // Previous candle
  if (previous.close > previous.open) {
    buy++;
  }

  if (previous.close < previous.open) {
    sell++;
  }


  let signal = "WAIT";

  if (
    buy >= 3 &&
    buy > sell
  ) {
    signal = "BUY";
  }

  if (
    sell >= 3 &&
    sell > buy
  ) {
    signal = "SELL";
  }


  let trend = "SIDEWAYS";

  if (
    ema9 > ema21 &&
    ema21 > ema50
  ) {
    trend = "UPTREND";
  }

  if (
    ema9 < ema21 &&
    ema21 < ema50
  ) {
    trend = "DOWNTREND";
  }


  const strength = Math.round(
    Math.max(buy, sell) / 4 * 100
  );


  return {
    timeframe: "2 minutes",
    signal,
    strength,
    trend,
    price: last.close,
    rsi: Number(rsiValue.toFixed(2)),
    ema9: Number(ema9.toFixed(6)),
    ema21: Number(ema21.toFixed(6)),
    ema50: Number(ema50.toFixed(6)),
    buyScore: buy,
    sellScore: sell,
    candleTime: last.time
  };
}


// ===============================
// Home
// ===============================
app.get("/", (req, res) => {

  res.json({
    status: "online",
    message: "Live 2-Minute Signal Backend Running",
    timeframe: "2 minutes"
  });

});


// ===============================
// SIGNAL API
// ===============================
app.get("/api/signal", async (req, res) => {

  try {

    const symbol =
      (req.query.symbol || "EUR/USD")
        .replace("/", "")
        .toUpperCase();


    if (!API_KEY) {

      return res.status(500).json({
        market: "ERROR",
        error: "MARKET_API_KEY is missing in Render"
      });

    }


    // Get last 100 M1 candles
    const end =
      new Date();

    const start =
      new Date(
        end.getTime() -
        3 * 60 * 60 * 1000
      );


    const url =
      new URL(
        "/api/v1/history",
        API_BASE
      );

    url.searchParams.set(
      "apiKey",
      API_KEY
    );

    url.searchParams.set(
      "symbolCode",
      symbol
    );

    url.searchParams.set(
      "startTime",
      start.toISOString()
    );

    url.searchParams.set(
      "endTime",
      end.toISOString()
    );

    url.searchParams.set(
      "pageNumber",
      "1"
    );

    url.searchParams.set(
      "pageSize",
      "200"
    );


    const response =
      await fetch(
        url.toString()
      );


    const text =
      await response.text();


    if (!response.ok) {

      return res.status(
        response.status
      ).json({

        market: "ERROR",

        error:
          "RealMarketAPI HTTP " +
          response.status,

        details: text.slice(0, 500)

      });

    }


    const data =
      JSON.parse(text);


    // History response
    const items =
      data.items ||
      data.Items ||
      [];


    if (!Array.isArray(items)) {

      return res.status(500).json({

        market: "ERROR",

        error:
          "RealMarketAPI history format not recognized"

      });

    }


    const oneMinute =
      items
        .map(normalize)
        .filter(
          c =>
            c.time &&
            Number.isFinite(c.open) &&
            Number.isFinite(c.high) &&
            Number.isFinite(c.low) &&
            Number.isFinite(c.close)
        );


    const twoMinute =
      createTwoMinuteCandles(
        oneMinute
      );


    if (twoMinute.length < 50) {

      return res.status(500).json({

        market: "ERROR",

        error:
          "Not enough candles for 2-minute analysis",

        oneMinuteCandles:
          oneMinute.length,

        twoMinuteCandles:
          twoMinute.length

      });

    }


    const result =
      analyze(twoMinute);


    return res.json({

      market: "LIVE",

      source: "RealMarketAPI",

      symbol: symbol,

      ...result

    });


  } catch (error) {

    console.error(
      error
    );

    return res.status(500).json({

      market: "ERROR",

      error: error.message

    });

  }

});


// ===============================
// START
// ===============================
app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "Live 2-Minute Signal Backend Running"
    );

    console.log(
      "Port: " + PORT
    );

  }
);
