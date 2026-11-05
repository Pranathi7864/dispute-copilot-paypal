const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DISPUTE_ID = /^PP-[A-Z0-9-]{1,40}$/;
const isValidDisputeId = (id) => typeof id === "string" && DISPUTE_ID.test(id);

// expose=true means the message is safe to show to the user
const httpError = (message, status = 500, expose = status < 500) =>
  Object.assign(new Error(message), { status, expose });

function redact(value) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1[REDACTED]")
    .replace(/("?(access_token|client_secret|secret|authorization|password)"?\s*[:=]\s*"?)[^",\s}]+/gi, "$1[REDACTED]");
}

fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
const AUDIT_FILE = path.join(__dirname, "data", "audit.log");
function audit(event, details = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...details });
  fs.appendFile(AUDIT_FILE, redact(line) + "\n", () => {});
}

const sha = (s) => crypto.createHash("sha256").update(s).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(String(a)), sha(String(b)));
const hashObject = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex");

// strips control characters and caps length
const clean = (v, max) =>
  typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "";

const INJECTION = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)/i,
  /disregard/i,
  /system\s*prompt/i,
  /you\s+are\s+now/i,
  /developer\s+mode/i,
  /without\s+(asking|approval|confirmation)/i,
  /approve\s+(a\s+)?(full\s+)?refund/i,
  /\bact\s+as\b/i,
  /jailbreak/i,
];
const looksLikeInjection = (t) => INJECTION.some((r) => r.test(t));

module.exports = { isValidDisputeId, httpError, redact, audit, safeEqual, hashObject, clean, looksLikeInjection };