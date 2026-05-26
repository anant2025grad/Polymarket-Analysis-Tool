"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchAggregate,
  clearCache,
  fmt$$,
  fmtPct,
  fmtPnl,
  shortWallet,
  timeAgo,
} from "../lib/api";

const WINDOWS = [
  { label: "24h", value: "1d" },
  { label: "1W", value: "1w" },
  { label: "1M", value: "1m" },
  { label: "All", value: "all" },
];
const LIMITS = [10, 20, 50];

function pct(n) {
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

function StatCard({ label, value, sub }) {
  return (
    <section className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </section>
  );
}

function OutcomeBar({ market }) {
  const share = Math.max(0, Math.min(market.topOutcomeShare || 0, 100));
  return (
    <div className="lean-cell">
      <div className="lean-label">
        <span>{fmtPct(share)}</span>
        <span>{market.topOutcome}</span>
      </div>
      <div className="lean-track">
        <div className="lean-fill" style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

function YesNoBar({ market }) {
  const yes = Math.max(0, Math.min(market.yesCapitalRatio ?? market.yesRatio ?? 0, 100));
  const no = Math.max(0, Math.min(100 - yes, 100));

  return (
    <div className="yn-cell">
      <div className="yn-label">
        <span>YES {fmtPct(yes)}</span>
        <span>NO {fmtPct(no)}</span>
      </div>
      <div className="yn-track">
        <div className="yn-yes" style={{ width: `${yes}%` }} />
        <div className="yn-no" style={{ width: `${no}%` }} />
      </div>
    </div>
  );
}

function MarketRow({ market }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr className="table-row" onClick={() => setExpanded((open) => !open)}>
        <td>
          <div className="market-title">{market.title || "Untitled market"}</div>
          <div className="market-sub">
            {market.secondOutcome
              ? `${market.topOutcome} vs ${market.secondOutcome}`
              : market.topOutcome}
          </div>
        </td>
        <td>
          <span className="side-pill">{market.topOutcome}</span>
        </td>
        <td>{pct(market.topOutcomePrice || market.avgMarketPrice || 0)}</td>
        <td>
          <OutcomeBar market={market} />
        </td>
        <td>
          <YesNoBar market={market} />
        </td>
        <td>{market.walletCount}</td>
        <td>{fmt$$(market.totalCapital)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="expanded-cell">
            <div className="breakdown-grid">
              <div>
                <h3>Outcome breakdown</h3>
                <div className="mini-table">
                  {(market.outcomes || []).map((outcome) => (
                    <div className="mini-row" key={outcome.outcome}>
                      <span>{outcome.outcome}</span>
                      <span>{pct(outcome.avgPrice)}</span>
                      <span>{fmtPct(outcome.share)}</span>
                      <span>{fmt$$(outcome.capital)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3>Trader positions</h3>
                <div className="mini-table">
                  {(market.traders || []).slice(0, 8).map((trader, index) => (
                    <div className="mini-row" key={`${trader.wallet}-${index}`}>
                      <span>{trader.username || shortWallet(trader.wallet)}</span>
                      <span>{trader.outcome}</span>
                      <span>{pct(trader.currentPrice || 0)}</span>
                      <span>{fmt$$(trader.capital || 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function LeaderboardRow({ trader, rank }) {
  const wallet = trader.proxyWallet || trader.wallet || trader.address || "";
  const pnl = parseFloat(trader.pnl || trader.profit || 0);
  const volume = parseFloat(trader.vol || trader.volume || 0);
  const name =
    trader.userName ||
    trader.username ||
    trader.name ||
    trader.pseudonym ||
    shortWallet(wallet);

  return (
    <tr>
      <td>{rank}</td>
      <td>
        <div className="market-title">{name}</div>
        <div className="market-sub">{shortWallet(wallet)}</div>
      </td>
      <td className={pnl >= 0 ? "positive" : "negative"}>{fmtPnl(pnl)}</td>
      <td>{fmt$$(volume)}</td>
    </tr>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [window_, setWindow] = useState("1m");
  const [limit, setLimit] = useState(20);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [tab, setTab] = useState("markets");
  const [sortBy, setSortBy] = useState("traders");

  const load = useCallback(
    async (bustCache = false) => {
      setLoading(true);
      setError(null);
      try {
        if (bustCache) await clearCache();
        const result = await fetchAggregate({ limit, window: window_ });
        setData(result);
        setLastRefresh(new Date());
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [limit, window_]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => load(), 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [load]);

  const agg = data?.aggregated;
  const markets = agg?.markets
    ? [...agg.markets].sort((a, b) => {
        if (sortBy === "capital") return b.totalCapital - a.totalCapital;
        if (sortBy === "odds") return b.topOutcomePrice - a.topOutcomePrice;
        if (sortBy === "lean") return b.topOutcomeShare - a.topOutcomeShare;
        if (sortBy === "yes") return (b.yesCapitalRatio || 0) - (a.yesCapitalRatio || 0);
        return b.walletCount - a.walletCount || b.totalCapital - a.totalCapital;
      })
    : [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Polymarket Analysis Tool</h1>
          <p><i>"She tryna finesse Polymarket for bread" - Aubrey 'Drake' Graham</i></p>
        </div>

        <div className="controls">
          <span className="status-dot" />
          <span className="muted">
            {loading ? "Updating" : lastRefresh ? `Updated ${timeAgo(lastRefresh)}` : "Ready"}
          </span>
          <div className="segmented">
            {WINDOWS.map((item) => (
              <button
                key={item.value}
                className={window_ === item.value ? "active" : ""}
                onClick={() => setWindow(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="select-label">
            Top
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {LIMITS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <button className="refresh-button" disabled={loading} onClick={() => load(true)}>
            Refresh
          </button>
        </div>
      </header>

      <main className="content">
        {error && <div className="error-box">{error}</div>}

        <div className="stats-grid">
          <StatCard label="Traders" value={data?.traders?.length ?? "-"} sub={`Top ${limit} by PnL`} />
          <StatCard label="Open markets" value={agg?.uniqueMarketsTraded ?? "-"} sub="After filtering resolved positions" />
          <StatCard label="Open value" value={agg ? fmt$$(agg.totalCapitalDeployed) : "-"} sub="Current position value" />
          <StatCard label="Avg trader lean" value={agg ? fmtPct(agg.averageTopLean) : "-"} sub="Share on the leading side" />
        </div>

        <div className="tabs">
          <button className={tab === "markets" ? "active" : ""} onClick={() => setTab("markets")}>
            Market positions
          </button>
          <button className={tab === "leaderboard" ? "active" : ""} onClick={() => setTab("leaderboard")}>
            Leaderboard
          </button>
        </div>

        {tab === "markets" && (
          <section className="panel">
            <div className="panel-toolbar">
              <div>
                <h2>Markets</h2>
                <p>{markets.length} markets with current open value</p>
              </div>
              <label className="select-label">
                Sort
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="traders">Trader count</option>
                  <option value="capital">Open value</option>
                  <option value="odds">Current odds</option>
                  <option value="lean">Trader lean</option>
                  <option value="yes">YES split</option>
                </select>
              </label>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Top side</th>
                    <th>Current odds</th>
                    <th>Trader lean</th>
                    <th>Leaderboard YES/NO</th>
                    <th>Traders</th>
                    <th>Open value</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !data && (
                    <tr>
                      <td colSpan={7} className="empty-cell">
                        Loading top trader positions...
                      </td>
                    </tr>
                  )}
                  {!loading && markets.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty-cell">
                        No open positions found for this window.
                      </td>
                    </tr>
                  )}
                  {markets.map((market) => (
                    <MarketRow key={market.marketId} market={market} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "leaderboard" && (
          <section className="panel">
            <div className="panel-toolbar">
              <div>
                <h2>Leaderboard</h2>
                <p>Traders used for the market analysis</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Trader</th>
                    <th>PnL</th>
                    <th>Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.traders || []).map((trader, index) => (
                    <LeaderboardRow key={trader.proxyWallet || index} trader={trader} rank={index + 1} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
