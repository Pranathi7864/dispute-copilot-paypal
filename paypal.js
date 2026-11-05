const fs = require("fs");
const path = require("path");
const cfg = require("./config");
const { isValidDisputeId, httpError, redact } = require("./security");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assertId = (id) => { if (!isValidDisputeId(id)) throw httpError("Invalid request", 400); };

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
  if (!r.ok) throw httpError("PayPal auth failed", 502, false);
  const data = await r.json();
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cached.token;
}

function upstream(r, data) {
  const e = r.status === 404 ? httpError("Not found", 404) : httpError("Upstream error", 502, false);
  e.detail = `PayPal ${r.status} ${redact(data)}`;
  return e;
}

// GET with timeout and limited retries (safe to retry)
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
      if (!r.ok) throw upstream(r, data);
      return data;
    } catch (e) {
      if (e.status || attempt >= retries) throw e;
      await sleep(300 * (attempt + 1));
    }
  }
}

// POST with NO automatic retries (a retry could duplicate a money action)
async function ppPost(pathname, { json, form }) {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}` };
  let body;
  if (form) body = form;
  else { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  const r = await fetch(`${cfg.PAYPAL_BASE}${pathname}`, { method: "POST", headers, body, signal: AbortSignal.timeout(20000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw upstream(r, data);
  return data;
}

// ---- mock mode (with state changes so the demo shows status updates) ----
const mockFile = path.join(__dirname, "data", "mock_disputes.json");
const mockState = new Map();
const loadMock = () =>
  JSON.parse(fs.readFileSync(mockFile, "utf8")).map((d) => ({ ...d, ...(mockState.get(d.dispute_id) || {}) }));

const pick = (d) => ({
  dispute_id: d.dispute_id, reason: d.reason, status: d.status,
  dispute_amount: d.dispute_amount, create_time: d.create_time, update_time: d.update_time,
});

async function listDisputes() {
  if (cfg.MOCK) return { items: loadMock().map(pick) };
  const data = await ppGet("/v1/customer/disputes");
  return { items: (data.items || []).map(pick) };
}

async function getDispute(id) {
  assertId(id);
  if (cfg.MOCK) {
    const d = loadMock().find((x) => x.dispute_id === id);
    if (!d) throw httpError("Not found", 404);
    return d;
  }
  return ppGet(`/v1/customer/disputes/${encodeURIComponent(id)}`);
}

// ---- guarded writes: only actions.js should call these, after approval ----
async function provideEvidence(id, evidences) {
  assertId(id);
  if (cfg.MOCK) { mockState.set(id, { status: "UNDER_REVIEW" }); return { mock: true }; }
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify({ evidences })], { type: "application/json" }), "input.json");
  return ppPost(`/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, { form });
}

async function sendMessage(id, message) {
  assertId(id);
  if (cfg.MOCK) return { mock: true };
  return ppPost(`/v1/customer/disputes/${encodeURIComponent(id)}/send-message`, { json: { message } });
}

async function acceptClaim(id, { note, reason }) {
  assertId(id);
  if (cfg.MOCK) { mockState.set(id, { status: "RESOLVED" }); return { mock: true }; }
  return ppPost(`/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, {
    json: { note, accept_claim_reason: reason },
  });
}

module.exports = { listDisputes, getDispute, provideEvidence, sendMessage, acceptClaim };