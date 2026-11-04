require("dotenv").config();

const mock = process.env.USE_MOCK_PAYPAL === "true";

if (!mock) {
  const missing = ["PAYPAL_CLIENT_ID", "PAYPAL_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}

module.exports = Object.freeze({
  PORT: Number(process.env.PORT) || 3000,
  MOCK: mock,
  PAYPAL_BASE: "https://api-m.sandbox.paypal.com", // hard-coded: sandbox only
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
  PAYPAL_SECRET: process.env.PAYPAL_SECRET,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  AGENT_ENABLED: process.env.AGENT_ENABLED !== "false",
});