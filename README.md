# Polymarket Analysis Tool

A beginner-friendly leaderboard analysis tool for Polymarket. It pulls top traders from Polymarket's public APIs, fetches their current open positions, and aggregates the data into a readable dashboard.

The goal is simple: see what successful traders are currently exposed to, how much value is in those positions, and how that compares with the market's current odds.

## Features

- Top trader leaderboard by PnL across 24h, 1W, 1M, or all-time windows.
- Open position fetching for each tracked wallet.
- Aggregated market table showing current odds, top trader lean, YES/NO split, trader count, and open value.
- Expandable market rows with per-outcome and per-trader breakdowns.
- Leaderboard tab with PnL and volume.
- Force refresh button plus server-side caching to avoid hammering the Polymarket API.
- Simple light UI designed for quick reading.

## Key Metrics

### Current odds

The current Polymarket price for the leading exposed outcome, based on `curPrice` from open position data.

This is the closest thing in the dashboard to true market odds.

### Trader lean

The share of tracked open position value on the leading outcome for that market.

Example: if tracked traders hold $9,000 on Knicks and $1,000 on Cavaliers, trader lean is 90% Knicks.

### Leaderboard YES/NO

The YES/NO-side split for tracked traders, based on position value.

For markets that are not literally "Yes" and "No" markets, Polymarket's outcome index is used:

- Outcome index `0` is treated as the YES-side.
- Outcome index `1` is treated as the NO-side.

This keeps the old leaderboard-style YES/NO signal available while still separating it from true market odds.

### Open value

The current value of tracked open positions in the market. Resolved, redeemable, and zero-current-value positions are filtered out.

## Project Structure

```text
polymarket-dashboard/
  package.json              Root scripts for running both apps
  README.md
  backend/
    package.json
    server.js               Express API and aggregation engine
    .env.example
  frontend/
    package.json
    next.config.js
    tailwind.config.js
    src/
      app/
        globals.css         App styling
        layout.js
        page.js             Main dashboard UI
      lib/
        api.js              Frontend API helpers and formatters
```

## Backend

Express server on port `3001`.

Endpoints:

```text
GET  /api/leaderboard?limit=20&window=1m&sortBy=pnl
GET  /api/positions/:walletAddress
GET  /api/aggregate?limit=20&window=1m
GET  /api/status
POST /api/cache/clear
```

The main endpoint is `/api/aggregate`. It:

1. Fetches the Polymarket leaderboard.
2. Fetches current open positions for each tracked wallet.
3. Filters out resolved/redeemable/zero-value positions.
4. Aggregates positions by market and outcome.
5. Returns market-level metrics for the dashboard.

## Frontend

Next.js app on port `3000`.

Main views:

- `Market positions`: simplified table of aggregated open positions.
- `Leaderboard`: top traders used in the analysis.

Controls:

- Time window: `24h`, `1W`, `1M`, `All`
- Trader count: `10`, `20`, `50`
- Sort: trader count, open value, current odds, trader lean, YES split
- Refresh: clears the backend cache and reloads data

## Quick Start

### Requirements

- Node.js 18+
- npm 9+

### Install dependencies

From the project root:

```bash
npm install
npm run install:all
```

### Run in development

```bash
npm run dev
```

This starts:

- Backend: http://localhost:3001
- Frontend: http://localhost:3000

### Run services separately

Backend:

```bash
cd backend
npm start
```

Frontend:

```bash
cd frontend
npm run dev
```

On Windows PowerShell, if `npm` is blocked by execution policy, use `npm.cmd`:

```bash
npm.cmd run dev
```

## Production Build

```bash
cd frontend
npm run build
```

Then run the production server:

```bash
npm start
```

## Troubleshooting

| Problem | What to try |
| --- | --- |
| `localhost:3000` does not open | Restart the frontend: `cd frontend && npm.cmd run dev` |
| API error from the frontend | Make sure the backend is running on `localhost:3001` |
| Port already in use | Stop the stale Node process or use a different port |
| No positions found | Try a wider time window or a higher trader count |
| First load is slow | Normal. The backend fetches positions for many wallets concurrently |

## Notes

This project uses public Polymarket endpoints:

- `https://data-api.polymarket.com/v1/leaderboard`
- `https://data-api.polymarket.com/positions`
- `https://gamma-api.polymarket.com/markets`

The API can change over time. If the dashboard starts returning API errors, check whether Polymarket has changed endpoint paths or query parameter names.
