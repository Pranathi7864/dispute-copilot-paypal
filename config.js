require("dotenv").config();

const mock = process.env.USE_MOCK_PAYPAL === "true";
const agentOn = process.env.AGENT_ENABLED !== "false";

const required = ["ADMIN_PASSWORD", "SESSION_SECRET"];
if (!mock) required.push("PAYPAL_CLIENT_ID", "PAYPAL_SECRET");
if (agentOn && !process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) required.push("GROQ_API_KEY or GEMINI_API_KEY");
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32) { console.error("SESSION_SECRET must be at least 32 characters"); process.exit(1); }
if (process.env.ADMIN_PASSWORD.length < 12) { console.error("ADMIN_PASSWORD must be at least 12 characters"); process.exit(1); }

module.exports = Object.freeze({
  PORT: Number(process.env.PORT) || 3000,
  PROD: process.env.NODE_ENV === "production",
  MOCK: mock,
  PAYPAL_BASE: "https://api-m.sandbox.paypal.com", // hard-coded: sandbox only
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
  PAYPAL_SECRET: process.env.PAYPAL_SECRET,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  AGENT_ENABLED: agentOn,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
  GROQ_MODEL: process.env.GROQ_MODEL,
  AI_PROVIDER: (process.env.AI_PROVIDER || "gemini").toLowerCase(),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  SESSION_SECRET: process.env.SESSION_SECRET,
  MAX_AUTO_AMOUNT: Number(process.env.MAX_AUTO_AMOUNT) || 200,
    AUTO_HANDLE: process.env.AUTO_HANDLE === "true",
  AUTO_HANDLE_MAX_AMOUNT: Number(process.env.AUTO_HANDLE_MAX_AMOUNT) || 50,
  AUTO_HANDLE_PER_HOUR: Number(process.env.AUTO_HANDLE_PER_HOUR) || 5,
  AUTO_ACTIONS: (process.env.AUTO_ACTIONS || "FIGHT").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
});