const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cfg = require("./config");
const paypal = require("./paypal");
const { isValidDisputeId, redact, audit } = require("./security");

const app = express();
app.disable("x-powered-by");
app.use(helmet()); // strict CSP: no inline scripts, so the dashboard will use external JS files
app.use(express.json({ limit: "10kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));
app.use(express.static("public"));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.get("/api/health", (req, res) => res.json({ ok: true, mock: cfg.MOCK }));

app.get("/api/disputes", wrap(async (req, res) => {
  res.json(await paypal.listDisputes());
}));

app.get("/api/disputes/:id", wrap(async (req, res) => {
  if (!isValidDisputeId(req.params.id)) return res.status(400).json({ error: "Invalid request" });
  res.json(await paypal.getDispute(req.params.id));
}));

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Central error handler: details go to the server log (redacted), never to the user
app.use((err, req, res, next) => {
  console.error(redact(`${req.method} ${req.path}: ${err.message} ${err.detail || ""}`));
  audit("error", { path: req.path, status: err.status || 500 });
  const status = err.status === 400 || err.status === 404 ? err.status : 502;
  const msg = status === 400 ? "Invalid request" : status === 404 ? "Not found" : "Something went wrong";
  res.status(status).json({ error: msg });
});

app.listen(cfg.PORT, () => console.log(`Dispute Copilot on http://localhost:${cfg.PORT} (mock=${cfg.MOCK})`));