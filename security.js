const fs = require("fs");
const path = require("path");

const DISPUTE_ID = /^PP-[A-Z0-9-]{1,40}$/;
const isValidDisputeId = (id) => typeof id === "string" && DISPUTE_ID.test(id);

function redact(value) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1[REDACTED]")
    .replace(/("?(access_token|client_secret|secret|authorization)"?\s*[:=]\s*"?)[^",\s}]+/gi, "$1[REDACTED]");
}

fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
const AUDIT_FILE = path.join(__dirname, "data", "audit.log");

function audit(event, details = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...details });
  fs.appendFile(AUDIT_FILE, redact(line) + "\n", () => {});
}

module.exports = { isValidDisputeId, redact, audit };