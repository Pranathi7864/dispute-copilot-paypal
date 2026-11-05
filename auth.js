const session = require("express-session");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const cfg = require("./config");
const { safeEqual, audit } = require("./security");

const sessionMiddleware = session({
  name: "dc.sid",
  secret: cfg.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "strict", secure: cfg.PROD, maxAge: 2 * 60 * 60 * 1000 },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many attempts, try later" },
});

function login(req, res) {
  const pw = req.body?.password;
  if (typeof pw !== "string" || pw.length > 200 || !safeEqual(pw, cfg.ADMIN_PASSWORD)) {
    audit("login_failed", { ip: req.ip });
    return res.status(401).json({ error: "Invalid credentials" });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Something went wrong" });
    req.session.authed = true;
    req.session.csrf = crypto.randomBytes(32).toString("hex");
    audit("login_ok", { ip: req.ip });
    res.json({ ok: true, csrfToken: req.session.csrf });
  });
}

const logout = (req, res) => req.session.destroy(() => { res.clearCookie("dc.sid"); res.json({ ok: true }); });

const requireAuth = (req, res, next) =>
  req.session?.authed ? next() : res.status(401).json({ error: "Login required" });

const requireCsrf = (req, res, next) => {
  const t = req.get("x-csrf-token");
  if (!t || !req.session?.csrf || !safeEqual(t, req.session.csrf)) return res.status(403).json({ error: "Invalid request" });
  next();
};

const sessionInfo = (req, res) =>
  res.json(req.session?.authed ? { authenticated: true, csrfToken: req.session.csrf } : { authenticated: false });

module.exports = { sessionMiddleware, loginLimiter, login, logout, requireAuth, requireCsrf, sessionInfo };