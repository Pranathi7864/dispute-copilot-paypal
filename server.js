const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cfg = require("./config");
const paypal = require("./paypal");
const agent = require("./agent");
const actions = require("./actions");
const auth = require("./auth");
const { isValidDisputeId, httpError, redact, audit, clean } = require("./security");
const { proposalHash, unverifiedNumbers } = require("./guardrails");

const app = express();
app.disable("x-powered-by");
if (cfg.PROD) app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "10kb" }));
app.use(auth.sessionMiddleware);
app.use("/api", rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));
app.use(express.static("public"));

const analyzeLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// every :id is validated before any handler runs
app.param("id", (req, res, next, id) =>
  isValidDisputeId(id) ? next() : next(httpError("Invalid request", 400)));

const proposals = new Map(); // disputeId -> proposal state (in memory)
const inFlight = new Set();
const TTL_MS = 30 * 60 * 1000;
const publicView = (p) => ({ proposal: p.proposal, hash: p.hash, status: p.status, trace: p.trace, expires_at: p.expiresAt });

// ---- public ----
app.get("/api/health", (req, res) => res.json({ ok: true, mock: cfg.MOCK }));
app.get("/api/session", auth.sessionInfo);
app.post("/api/login", auth.loginLimiter, auth.login);

// ---- everything below needs login ----
app.post("/api/logout", auth.requireAuth, auth.requireCsrf, auth.logout);
app.get("/api/disputes", auth.requireAuth, wrap(async (req, res) => res.json(await paypal.listDisputes())));
app.get("/api/disputes/:id", auth.requireAuth, wrap(async (req, res) => res.json(await paypal.getDispute(req.params.id))));

app.post("/api/disputes/:id/analyze", auth.requireAuth, auth.requireCsrf, analyzeLimiter, wrap(async (req, res) => {
  const id = req.params.id;
  if (!cfg.AGENT_ENABLED) throw httpError("Agent is disabled", 503);
  if (inFlight.has(id)) throw httpError("Analysis already running", 409);
  const existing = proposals.get(id);
  if (existing && ["SUBMITTING", "DONE"].includes(existing.status)) throw httpError(`Dispute already ${existing.status}`, 409);

  inFlight.add(id);
  try {
    const { proposal, trace, ctx } = await agent.analyzeDispute(id);
    const p = {
      proposal, trace, status: "PENDING_APPROVAL",
      hash: proposalHash(id, proposal, ctx.record),
      expiresAt: Date.now() + TTL_MS,
      record: ctx.record, allowed: ctx.allowedText, done: {},
    };
    proposals.set(id, p);
    audit("analyzed", { id, rec: proposal.recommendation, flags: proposal.flags });
    res.json(publicView(p));
  } finally { inFlight.delete(id); }
}));

app.get("/api/disputes/:id/proposal", auth.requireAuth, (req, res) => {
  const p = proposals.get(req.params.id);
  if (!p) return res.status(404).json({ error: "Not found" });
  res.json(publicView(p));
});

// seller may edit the drafted text; edits are re-validated and get a new hash
app.post("/api/disputes/:id/edit", auth.requireAuth, auth.requireCsrf, (req, res) => {
  const id = req.params.id;
  const p = proposals.get(id);
  if (!p || p.status !== "PENDING_APPROVAL" || p.proposal.recommendation !== "FIGHT") throw httpError("Nothing to edit", 409);
  const note = clean(req.body?.evidence_note, 1500);
  const msg = clean(req.body?.message_to_buyer, 800);
  if (!note) throw httpError("Evidence note required", 400);
  if (unverifiedNumbers(`${note} ${msg}`, p.allowed).length) throw httpError("Text contains numbers not found in your records", 400);
  p.proposal = { ...p.proposal, evidence_note: note, message_to_buyer: msg, edited: true };
  p.hash = proposalHash(id, p.proposal, p.record);
  audit("edited", { id });
  res.json(publicView(p));
});

app.post("/api/disputes/:id/approve", auth.requireAuth, auth.requireCsrf, wrap(async (req, res) => {
  const id = req.params.id;
  const p = proposals.get(id);
  if (!p) throw httpError("Nothing to approve", 400);
  if (p.status !== "PENDING_APPROVAL") throw httpError(`Already ${p.status}`, 409);
  if (Date.now() > p.expiresAt) { p.status = "EXPIRED"; throw httpError("Proposal expired, analyze again", 410); }
  if (req.body?.proposal_hash !== p.hash) throw httpError("Proposal changed, review again", 409);
  if (p.proposal.recommendation === "NEEDS_HUMAN") throw httpError("This case needs a human decision", 400);

  const live = await paypal.getDispute(id); // re-check right before acting
  if (live.status !== "WAITING_FOR_SELLER_RESPONSE") {
    audit("approve_blocked", { id, status: live.status });
    throw httpError("Dispute is no longer waiting for your response", 409);
  }

  p.status = "SUBMITTING"; // blocks double submission
  try {
    await actions.execute(id, p);
    p.status = "DONE";
    audit("approved_and_submitted", { id, rec: p.proposal.recommendation });
  } catch (e) {
    p.status = "PENDING_APPROVAL";
    audit("submit_failed", { id });
    throw e;
  }
  res.json({ status: p.status });
}));

app.post("/api/disputes/:id/reject", auth.requireAuth, auth.requireCsrf, (req, res) => {
  const p = proposals.get(req.params.id);
  if (p && p.status === "PENDING_APPROVAL") { p.status = "REJECTED"; audit("rejected", { id: req.params.id }); }
  res.json({ status: p?.status || "NONE" });
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, req, res, next) => {
  console.error(redact(`${req.method} ${req.path}: ${err.message} ${err.detail || ""}`));
  if (err.type === "entity.parse.failed" || err.type === "entity.too.large") return res.status(400).json({ error: "Invalid request" });
  const status = err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) audit("error", { path: req.path, status });
  res.status(status).json({ error: err.expose ? err.message : "Something went wrong" });
});

app.listen(cfg.PORT, () => console.log(`Dispute Copilot on http://localhost:${cfg.PORT} (mock=${cfg.MOCK}, agent=${cfg.AGENT_ENABLED})`));






