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
function calculateEMA(values, period) {
  if (values.length < period) return null;

  let sum = 0;

  for (let i = 0; i < period; i++) {
    sum += values[i];
  }

  let emaValue = sum / period;
  const multiplier = 2 / (period + 1);

  for (let i = period; i < values.length; i++) {
    emaValue =
      (values[i] - emaValue) * multiplier + emaValue;
  }

  return emaValue;
}


// ===============================
// RSI - Wilder
// ===============================
function calculateRSI(values, period = 14) {
  if (values.length <= period) return null;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];

    if (change > 0) {
      gain += change;
    } else {
      loss += Math.abs(change);
    }
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    const currentGain = Math.max(change, 0);
    const currentLoss = Math.max(-change, 0);

    avgGain =
      ((avgGain * (period - 1)) + currentGain) / period;

    avgLoss =
      ((avgLoss * (period - 1)) + currentLoss) / period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return 100 - (100 / (1 + rs));
}


// ===============================
// Normalize API candle
// Supports lowercase + uppercase
// ===============================
function normalizeCandle(c) {
  return {
    time:
      c.openTime ??
      c.OpenTime ??
      c.time ??
      c.Time,

    open: Number(
      c.openPrice ??
      c.OpenPrice ??
      c.open ??
      c.Open
    ),

    high: Number(
      c.highPrice ??
      c.HighPrice ??
      c.high ??
      c.High
    ),

    low: Number(
      c.lowPrice ??
      c.LowPrice ??
      c.low ??
      c.Low
    ),

    close: Number(
      c.closePrice ??
      c.ClosePrice ??
      c.close ??
      c.Close
    ),

    volume: Number(
      c.volume ??
      c.Volume ??
      0
    )
  };
}


// ===============================
// Create proper 2-minute candles
// ===============================
function createTwoMinuteCandles(candles) {

  const buckets = new Map();

  for (const candle of candles) {

    const time = new Date(candle.time);

    if (Number.isNaN(time.getTime())) {
      continue;
    }

    // 2-minute boundary
    const bucket =
      Math.floor(time.getTime() / 120000) * 120000;

    if (!buckets.has(bucket)) {
      buckets.set(bucket, []);
    }

    buckets.get(bucket).push(candle);
  }


  const result = [];

  const sortedBuckets =
    [...buckets.entries()]
      .sort((a, b) => a[0] - b[0]);


  for (const [bucketTime, group] of sortedBuckets) {

    group.sort(
      (a, b) =>
        new Date(a.time) - new Date(b.time)
    );


    // Need at least 2 one-minute candles
    if (group.length < 2) {
      continue;
    }


    result.push({

      time:
        new Date(bucketTime).toISOString(),

      open:
        group[0].open,

      high:
        Math.max(...group.map(c => c.high)),

      low:
        Math.min(...group.map(c => c.low)),

      close:
        group[group.length - 1].close,

      volume:
        group.reduce(
          (sum, c) => sum + c.volume,
          0
        )

    });
  }


  return result;
}


// ===============================
// Signal analysis
// ===============================
function analyze(candles) {

  if (candles.length < 60) {

    throw new Error(
      `Not enough candles for analysis: ${candles.length}`
    );

  }


  const closes =
    candles.map(c => c.close);


  const ema9 =
    calculateEMA(closes, 9);

  const ema21 =
    calculateEMA(closes, 21);

  const ema50 =
    calculateEMA(closes, 50);

  const rsi =
    calculateRSI(closes, 14);


  const last =
    candles[candles.length - 1];

  const previous =
    candles[candles.length - 2];


  let buyScore = 0;
  let sellScore = 0;


  // EMA trend
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
  if (
    rsi >= 52 &&
    rsi <= 68
  ) {
    buyScore++;
  }

  if (
    rsi >= 32 &&
    rsi <= 48
  ) {
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


  const strength =
    Math.round(
      Math.max(buyScore, sellScore) / 4 * 100
    );


  return {

    timeframe: "2 minutes",

    signal,

    strength,

    trend,

    price:
      last.close,

    rsi:
      Number(rsi.toFixed(2)),

    ema9:
      Number(ema9.toFixed(6)),

    ema21:
      Number(ema21.toFixed(6)),

    ema50:
      Number(ema50.toFixed(6)),

    buyScore,

    sellScore,

    candleTime:
      last.time

  };
}


// ===============================
// HOME
// ===============================
app.get("/", (req, res) => {

  res.json({

    status: "online",

    message:
      "Live 2-Minute Signal Backend Running",

    timeframe:
      "2 minutes"

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

        error:
          "MARKET_API_KEY is missing in Render"

      });

    }


    // Get 6 hours of history
    // More data = enough candles for EMA50
    const end =
      new Date();

    const start =
      new Date(
        end.getTime() -
        6 * 60 * 60 * 1000
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
      "500"
    );


    console.log(
      "Requesting history:",
      symbol
    );


    const response =
      await fetch(
        url.toString()
      );


    const text =
      await response.text();


    if (!response.ok) {

      console.error(
        "API ERROR:",
        response.status,
        text
      );


      return res.status(
        response.status
      ).json({

        market: "ERROR",

        error:
          "RealMarketAPI HTTP " +
          response.status,

        details:
          text.slice(0, 500)

      });

    }


    let data;


    try {

      data =
        JSON.parse(text);

    } catch {

      return res.status(500).json({

        market: "ERROR",

        error:
          "RealMarketAPI returned invalid JSON",

        details:
          text.slice(0, 500)

      });

    }


    // Support different response formats
    const items =
      data.items ||
      data.Items ||
      data.data ||
      data.Data ||
      [];


    if (!Array.isArray(items)) {

      return res.status(500).json({

        market: "ERROR",

        error:
          "History candle format not recognized",

        response:
          JSON.stringify(data).slice(0, 1000)

      });

    }


    const oneMinute =
      items
        .map(normalizeCandle)
        .filter(c => {

          return (
            c.time &&
            Number.isFinite(c.open) &&
            Number.isFinite(c.high) &&
            Number.isFinite(c.low) &&
            Number.isFinite(c.close)
          );

        });


    console.log(
      "1-minute candles:",
      oneMinute.length
    );


    const twoMinute =
      createTwoMinuteCandles(
        oneMinute
      );


    console.log(
      "2-minute candles:",
      twoMinute.length
    );


    if (twoMinute.length < 60) {

      return res.status(500).json({

        market: "ERROR",

        error:
          "Not enough candles for analysis",

        oneMinuteCandles:
          oneMinute.length,

        twoMinuteCandles:
          twoMinute.length,

        message:
          "RealMarketAPI did not return enough M1 historical candles for 2-minute analysis."

      });

    }


    const result =
      analyze(twoMinute);


    return res.json({

      market: "LIVE",

      source:
        "RealMarketAPI",

      symbol,

      ...result

    });


  } catch (error) {

    console.error(
      "SERVER ERROR:",
      error
    );


    return res.status(500).json({

      market: "ERROR",

      error:
        error.message

    });

  }

});


// ===============================
// START SERVER
// ===============================
app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "Live 2-Minute Signal Backend Running"
    );

    console.log(
      "Port:",
      PORT
    );

  }
);
