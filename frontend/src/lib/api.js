const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function assertOk(res) {
  if (res.ok) return;

  let message = `API error: ${res.status}`;
  try {
    const body = await res.json();
    if (body?.details) message += ` - ${body.details}`;
    else if (body?.error) message += ` - ${body.error}`;
  } catch {
    // Keep the status-only error if the response is not JSON.
  }

  throw new Error(message);
}

export async function fetchAggregate({ limit = 20, window = "1m" } = {}) {
  const res = await fetch(
    `${API_URL}/api/aggregate?limit=${limit}&window=${window}`,
    { cache: "no-store" }
  );
  await assertOk(res);
  return res.json();
}

export async function fetchLeaderboard({ limit = 20, window = "1m" } = {}) {
  const res = await fetch(
    `${API_URL}/api/leaderboard?limit=${limit}&window=${window}`,
    { cache: "no-store" }
  );
  await assertOk(res);
  return res.json();
}

export async function fetchPositions(wallet) {
  const res = await fetch(`${API_URL}/api/positions/${wallet}`, {
    cache: "no-store",
  });
  await assertOk(res);
  return res.json();
}

export async function clearCache() {
  const res = await fetch(`${API_URL}/api/cache/clear`, { method: "POST" });
  return res.json();
}

export function fmt$$(n) {
  if (!n && n !== 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function fmtPct(n) {
  if (!n && n !== 0) return "—";
  return `${n.toFixed(1)}%`;
}

export function fmtPnl(n) {
  if (!n && n !== 0) return "—";
  const sign = n >= 0 ? "+" : "";
  return sign + fmt$$(n);
}

export function shortWallet(w) {
  if (!w) return "—";
  if (w.length <= 10) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

export function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
