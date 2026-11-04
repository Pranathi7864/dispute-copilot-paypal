const fs = require("fs");
const path = require("path");
const cfg = require("./config");
const { isValidDisputeId, redact } = require("./security");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpError = (message, status) => Object.assign(new Error(message), { status });

let cached = { token: null, expiresAt: 0 };

async function getToken() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  const auth = Buffer.from(`${cfg.PAYPAL_CLIENT_ID}:${cfg.PAYPAL_SECRET}`).toString("base64");
  const r = await fetch(`${cfg.PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw httpError(`PayPal auth failed (${r.status})`, 502);
  const data = await r.json();
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cached.token;
}

// GET-only helper with timeout and limited retries for network/5xx errors
async function ppGet(pathname, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      const token = await getToken();
      const r = await fetch(`${cfg.PAYPAL_BASE}${pathname}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (r.status >= 500 && attempt < retries) { await sleep(300 * (attempt + 1)); continue; }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const e = httpError(`PayPal ${r.status}`, r.status);
        e.detail = redact(data);
        throw e;
      }
      return data;
    } catch (e) {
      if (e.status || attempt >= retries) throw e;
      await sleep(300 * (attempt + 1));
    }
  }
}

const pick = (d) => ({
  dispute_id: d.dispute_id,
  reason: d.reason,
  status: d.status,
  dispute_amount: d.dispute_amount,
  create_time: d.create_time,
  update_time: d.update_time,
});

const mockFile = path.join(__dirname, "data", "mock_disputes.json");
const loadMock = () => JSON.parse(fs.readFileSync(mockFile, "utf8"));

async function listDisputes() {
  if (cfg.MOCK) return { items: loadMock().map(pick) };
  const data = await ppGet("/v1/customer/disputes");
  return { items: (data.items || []).map(pick) };
}

async function getDispute(id) {
  if (!isValidDisputeId(id)) throw httpError("Invalid dispute id", 400);
  if (cfg.MOCK) {
    const d = loadMock().find((x) => x.dispute_id === id);
    if (!d) throw httpError("Not found", 404);
    return d;
  }
  return ppGet(`/v1/customer/disputes/${encodeURIComponent(id)}`);
}

module.exports = { listDisputes, getDispute };