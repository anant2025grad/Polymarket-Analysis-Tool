require("dotenv").config();
const express = require("express");
const cors = require("cors");
const NodeCache = require("node-cache");
const axios = require("axios");

const app = express();
const cache = new NodeCache({ stdTTL: 120 }); // 2 min cache

app.use(cors());
app.use(express.json());

// ─── API base URLs ─────────────────────────────────────────────────────────
const DATA_API = "https://data-api.polymarket.com";
const GAMMA_API = "https://gamma-api.polymarket.com";
const LEADERBOARD_API = `${DATA_API}/v1/leaderboard`;

const LEADERBOARD_TIME_PERIODS = {
  "1d": "DAY",
  "24h": "DAY",
  day: "DAY",
  "1w": "WEEK",
  week: "WEEK",
  "1m": "MONTH",
  month: "MONTH",
  all: "ALL",
};

const LEADERBOARD_ORDER_BY = {
  pnl: "PNL",
  profit: "PNL",
  volume: "VOL",
  vol: "VOL",
};

// ─── Axios instance with timeout + headers ──────────────────────────────────
const polyApi = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": "PolymarketDashboard/1.0",
    Accept: "application/json",
  },
});

// ─── Helper: fetch with retry ───────────────────────────────────────────────
async function fetchWithRetry(url, params = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await polyApi.get(url, { params });
      return res.data;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ─── GET /api/leaderboard ───────────────────────────────────────────────────
function toNumber(value, fallback = 0) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function activePositions(positions) {
  return positions.filter((pos) => {
    const size = toNumber(pos.size || pos.amount || pos.totalBought);
    const currentValue = toNumber(pos.currentValue, size * toNumber(pos.curPrice));
    return size > 0 && currentValue > 0 && pos.redeemable !== true;
  });
}

function positionSide(pos, outcome) {
  const normalized = String(outcome || "").toLowerCase();
  if (normalized === "yes" || normalized === "1" || normalized === "long") return "yes";
  if (normalized === "no" || normalized === "0" || normalized === "short") return "no";
  if (pos.outcomeIndex === 0 || pos.side === 0) return "yes";
  if (pos.outcomeIndex === 1 || pos.side === 1) return "no";
  return "unknown";
}

function leaderboardParams({ limit, window = "1m", sortBy = "pnl" }) {
  return {
    limit: parseInt(limit, 10),
    timePeriod: LEADERBOARD_TIME_PERIODS[String(window).toLowerCase()] || "MONTH",
    orderBy: LEADERBOARD_ORDER_BY[String(sortBy).toLowerCase()] || "PNL",
  };
}

// Pulls top traders from Polymarket leaderboard
app.get("/api/leaderboard", async (req, res) => {
  const { limit = 20, window = "1m", sortBy = "pnl" } = req.query;
  const cacheKey = `leaderboard_${limit}_${window}_${sortBy}`;

  const cached = cache.get(cacheKey);
  if (cached) return res.json({ data: cached, cached: true });

  try {
    const data = await fetchWithRetry(LEADERBOARD_API, leaderboardParams({ limit, window, sortBy }));

    const traders = Array.isArray(data) ? data : data.data || [];
    cache.set(cacheKey, traders);
    res.json({ data: traders, cached: false });
  } catch (err) {
    console.error("Leaderboard error:", err.message);
    res.status(500).json({ error: "Failed to fetch leaderboard", details: err.message });
  }
});

// ─── GET /api/positions/:wallet ─────────────────────────────────────────────
// Fetches open positions for a single wallet
app.get("/api/positions/:wallet", async (req, res) => {
  const { wallet } = req.params;
  const cacheKey = `positions_${wallet}`;

  const cached = cache.get(cacheKey);
  if (cached) return res.json({ data: cached, cached: true });

  try {
    const data = await fetchWithRetry(`${DATA_API}/positions`, {
      user: wallet,
      sizeThreshold: 0.01,
    });

    const positions = activePositions(Array.isArray(data) ? data : data.data || []);
    cache.set(cacheKey, positions);
    res.json({ data: positions, cached: false });
  } catch (err) {
    console.error(`Positions error for ${wallet}:`, err.message);
    res.status(500).json({ error: "Failed to fetch positions", wallet, details: err.message });
  }
});

// ─── GET /api/aggregate ────────────────────────────────────────────────────
// Main endpoint: leaderboard + all positions + aggregation
app.get("/api/aggregate", async (req, res) => {
  const { limit = 20, window = "1m" } = req.query;
  const cacheKey = `aggregate_${limit}_${window}`;

  const cached = cache.get(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    // Step 1: Get leaderboard
    console.log(`Fetching leaderboard: top ${limit} traders, window=${window}`);
    const lbData = await fetchWithRetry(
      LEADERBOARD_API,
      leaderboardParams({ limit, window, sortBy: "pnl" })
    );

    const traders = Array.isArray(lbData) ? lbData : lbData.data || [];
    if (!traders.length) {
      return res.status(404).json({ error: "No traders found on leaderboard" });
    }

    console.log(`Got ${traders.length} traders, fetching positions...`);

    // Step 2: Fetch positions for each trader (with concurrency limit)
    const CONCURRENCY = 5;
    const allPositions = [];
    const walletPositions = {};
    const errors = [];

    for (let i = 0; i < traders.length; i += CONCURRENCY) {
      const batch = traders.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (trader) => {
          const wallet = trader.proxyWallet || trader.wallet || trader.address;
          if (!wallet) return null;

          try {
            const posData = await fetchWithRetry(`${DATA_API}/positions`, {
              user: wallet,
              sizeThreshold: 0.01,
            });
            const positions = activePositions(Array.isArray(posData) ? posData : posData.data || []);
            return { wallet, trader, positions };
          } catch (e) {
            errors.push({ wallet, error: e.message });
            return { wallet, trader, positions: [] };
          }
        })
      );

      results.forEach((r) => {
        if (r.status === "fulfilled" && r.value) {
          const { wallet, trader, positions } = r.value;
          walletPositions[wallet] = { trader, positions };
          allPositions.push(...positions.map((p) => ({ ...p, _wallet: wallet, _trader: trader })));
        }
      });

      // Small delay between batches to be respectful
      if (i + CONCURRENCY < traders.length) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Step 3: Aggregate across all positions
    const aggregated = aggregatePositions(allPositions, walletPositions, traders);

    const result = {
      traders,
      walletPositions,
      aggregated,
      fetchedAt: new Date().toISOString(),
      errors: errors.length ? errors : undefined,
    };

    cache.set(cacheKey, result);
    res.json({ ...result, cached: false });
  } catch (err) {
    console.error("Aggregate error:", err.message);
    res.status(500).json({ error: "Aggregation failed", details: err.message });
  }
});

// ─── GET /api/market/:conditionId ──────────────────────────────────────────
app.get("/api/market/:conditionId", async (req, res) => {
  const { conditionId } = req.params;
  const cacheKey = `market_${conditionId}`;

  const cached = cache.get(cacheKey);
  if (cached) return res.json({ data: cached, cached: true });

  try {
    const data = await fetchWithRetry(`${GAMMA_API}/markets`, {
      condition_id: conditionId,
    });
    const markets = Array.isArray(data) ? data : data.data || [];
    const market = markets[0] || null;
    cache.set(cacheKey, market, 600); // cache markets 10 min
    res.json({ data: market, cached: false });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch market", details: err.message });
  }
});

// ─── GET /api/status ───────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  const keys = cache.keys();
  res.json({
    status: "ok",
    cacheSize: keys.length,
    cacheKeys: keys,
    uptime: process.uptime(),
  });
});

// ─── POST /api/cache/clear ─────────────────────────────────────────────────
app.post("/api/cache/clear", (req, res) => {
  cache.flushAll();
  res.json({ ok: true, message: "Cache cleared" });
});

// ─── Aggregation Engine ────────────────────────────────────────────────────
function aggregatePositions(allPositions, walletPositions, traders) {
  // Build trader PnL map for weighting
  const traderPnlMap = {};
  traders.forEach((t) => {
    const wallet = t.proxyWallet || t.wallet || t.address;
    const pnl = parseFloat(t.pnl || t.profit || 0);
    traderPnlMap[wallet] = Math.max(pnl, 0); // no negative weighting
  });

  // Group by market (conditionId or market_id)
  const marketMap = {};

  allPositions.forEach((pos) => {
    const marketId =
      pos.conditionId || pos.condition_id || pos.market || pos.marketId || "unknown";
    const outcome = String(
      pos.outcome || (pos.side === 0 ? "Yes" : pos.side === 1 ? "No" : "Unknown")
    );
    const size = toNumber(pos.size || pos.amount || pos.totalBought);
    const avgPrice = toNumber(pos.avgPrice || pos.price || pos.averagePrice, 0.5);
    const currentPrice = toNumber(pos.curPrice, toNumber(pos.currentValue) / Math.max(size, 1));
    const capital = toNumber(pos.currentValue, size * currentPrice);
    const wallet = pos._wallet;
    const traderPnl = traderPnlMap[wallet] || 1;

    if (!marketMap[marketId]) {
      marketMap[marketId] = {
        marketId,
        title: pos.title || pos.market_title || pos.marketTitle || marketId,
        slug: pos.slug || pos.marketSlug || null,
        positions: [],
        wallets: new Set(),
        totalYesSize: 0,
        totalNoSize: 0,
        totalYesCapital: 0,
        totalNoCapital: 0,
        totalSize: 0,
        weightedConviction: 0,
        totalCapital: 0,
        avgPrice: 0,
        outcomeStats: {},
        traders: [],
      };
    }

    const m = marketMap[marketId];
    m.positions.push(pos);
    m.wallets.add(wallet);

    const side = positionSide(pos, outcome);
    if (side === "yes") {
      m.totalYesSize += size;
      m.totalYesCapital += capital;
    } else if (side === "no") {
      m.totalNoSize += size;
      m.totalNoCapital += capital;
    }

    if (!m.outcomeStats[outcome]) {
      m.outcomeStats[outcome] = {
        outcome,
        oppositeOutcome: pos.oppositeOutcome || null,
        capital: 0,
        size: 0,
        weightedPrice: 0,
        wallets: new Set(),
      };
    }
    m.outcomeStats[outcome].capital += capital;
    m.outcomeStats[outcome].size += size;
    m.outcomeStats[outcome].weightedPrice += currentPrice * capital;
    m.outcomeStats[outcome].wallets.add(wallet);

    m.totalSize += size;
    m.totalCapital += capital;
    m.avgPrice += currentPrice * capital;
    // Weighted conviction: larger positions from higher-PnL traders count more
    m.weightedConviction += capital * traderPnl;

    m.traders.push({
      wallet,
      username:
        pos._trader?.userName ||
        pos._trader?.username ||
        pos._trader?.name ||
        pos._trader?.pseudonym ||
        wallet.slice(0, 8) + "…",
      outcome,
      side,
      size,
      capital,
      avgPrice,
      currentPrice,
      pnl: traderPnl,
    });
  });

  // Convert to array and compute consensus metrics
  const markets = Object.values(marketMap)
    .filter((m) => m.wallets.size >= 1)
    .map((m) => {
      const walletCount = m.wallets.size;
      const totalSideSize = m.totalYesSize + m.totalNoSize;
      const yesRatio = totalSideSize > 0 ? m.totalYesSize / totalSideSize : 0;
      const noRatio = totalSideSize > 0 ? m.totalNoSize / totalSideSize : 0;
      const totalSideCapital = m.totalYesCapital + m.totalNoCapital;
      const yesCapitalRatio = totalSideCapital > 0 ? m.totalYesCapital / totalSideCapital : 0;
      const noCapitalRatio = totalSideCapital > 0 ? m.totalNoCapital / totalSideCapital : 0;
      const consensus = yesRatio >= 0.5 ? "YES" : "NO";
      const consensusStrength = Math.max(yesRatio, noRatio);

      // Normalize weighted conviction
      const maxPnl = Math.max(...traders.map((t) => parseFloat(t.pnl || 0)), 1);
      const normalizedConviction = Math.min((m.weightedConviction / maxPnl / 1000) * 100, 100);

      // Whale concentration: top wallet size vs total
      const topSize = Math.max(...m.traders.map((t) => t.size));
      const whaleConcentration = m.totalSize > 0 ? (topSize / m.totalSize) * 100 : 0;

      // Smart money sentiment: weighted YES ratio
      const weightedYes = m.traders
        .filter((t) => t.side === "yes")
        .reduce((acc, t) => acc + t.size * t.pnl, 0);
      const weightedTotal = m.traders
        .filter((t) => t.side === "yes" || t.side === "no")
        .reduce((acc, t) => acc + t.size * t.pnl, 0);
      const smartMoneySentiment = weightedTotal > 0 ? (weightedYes / weightedTotal) * 100 : 50;
      const outcomes = Object.values(m.outcomeStats)
        .map((o) => ({
          outcome: o.outcome,
          oppositeOutcome: o.oppositeOutcome,
          capital: o.capital,
          size: o.size,
          wallets: [...o.wallets],
          traderCount: o.wallets.size,
          share: m.totalCapital > 0 ? (o.capital / m.totalCapital) * 100 : 0,
          avgPrice: o.capital > 0 ? o.weightedPrice / o.capital : 0,
        }))
        .sort((a, b) => b.capital - a.capital);
      const topOutcome = outcomes[0] || null;
      const secondOutcome = outcomes[1] || null;
      const topOutcomeShare = topOutcome?.share || 0;

      return {
        ...m,
        wallets: [...m.wallets],
        outcomes,
        walletCount,
        avgMarketPrice: m.totalCapital > 0 ? m.avgPrice / m.totalCapital : 0,
        topOutcome: topOutcome?.outcome || "Unknown",
        topOutcomePrice: topOutcome?.avgPrice || 0,
        topOutcomeCapital: topOutcome?.capital || 0,
        topOutcomeShare,
        secondOutcome: secondOutcome?.outcome || topOutcome?.oppositeOutcome || null,
        secondOutcomePrice: secondOutcome?.avgPrice || (topOutcome ? 1 - topOutcome.avgPrice : 0),
        yesRatio: yesRatio * 100,
        noRatio: noRatio * 100,
        yesCapitalRatio: yesCapitalRatio * 100,
        noCapitalRatio: noCapitalRatio * 100,
        consensus: topOutcome?.outcome || consensus,
        consensusStrength: topOutcomeShare || consensusStrength * 100,
        normalizedConviction,
        whaleConcentration,
        smartMoneySentiment: topOutcomeShare || smartMoneySentiment,
      };
    })
    .sort((a, b) => b.walletCount - a.walletCount || b.totalCapital - a.totalCapital);

  // Top-level stats
  const totalCapital = markets.reduce((acc, m) => acc + m.totalCapital, 0);
  const topMarkets = markets.slice(0, 10);

  // Cross-market YES/NO split
  const totalYes = markets.reduce((acc, m) => acc + m.totalYesSize, 0);
  const totalNo = markets.reduce((acc, m) => acc + m.totalNoSize, 0);
  const totalAll = totalYes + totalNo;
  const averageTopLean =
    markets.length > 0
      ? markets.reduce((acc, m) => acc + (m.topOutcomeShare || 0), 0) / markets.length
      : 0;

  return {
    markets,
    topMarkets,
    totalMarketsTracked: markets.length,
    totalCapitalDeployed: totalCapital,
    averageTopLean,
    globalYesRatio: totalAll > 0 ? (totalYes / totalAll) * 100 : 50,
    globalNoRatio: totalAll > 0 ? (totalNo / totalAll) * 100 : 50,
    uniqueMarketsTraded: markets.length,
    avgPositionsPerTrader:
      traders.length > 0 ? allPositions.length / traders.length : 0,
  };
}

// ─── Start server ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Polymarket Dashboard Backend running on http://localhost:${PORT}`);
  console.log(`   Endpoints:`);
  console.log(`   GET  /api/leaderboard      - Top traders`);
  console.log(`   GET  /api/positions/:wallet - Wallet positions`);
  console.log(`   GET  /api/aggregate        - Full aggregated data`);
  console.log(`   GET  /api/status           - Server status`);
  console.log(`   POST /api/cache/clear      - Clear cache\n`);
});
