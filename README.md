# Dispute Copilot

An AI agent that helps small online sellers respond to PayPal disputes, with a human approving every money action.

**Demo video:** <YOUTUBE_URL>

## The problem

Small sellers get paid through PayPal. When a buyer opens a dispute, such as "item not received", PayPal's Resolution Center gives the seller a short deadline to respond with proof. Many sellers don't know what evidence PayPal needs, how to word it, or whether to fight or refund. They miss deadlines, send weak evidence, and lose money they should have kept.

## The solution

Dispute Copilot sits on top of PayPal's dispute system. For each dispute it:

1. Reads the dispute through the PayPal Disputes API.
2. Checks the seller's own order and tracking records.
3. Decides whether to **fight** (strong proof), **refund** (no proof), or **escalate to a human** (unclear or risky).
4. Drafts the evidence note and a polite message to the buyer, using only facts from the seller's records.
5. Waits for the seller to approve, then submits through the PayPal API.

## How it works

PayPal Disputes API -> seller records -> AI agent (tool calling) -> guardrails -> human approval -> PayPal

The agent can only read data. It cannot submit, refund, or message anyone. Only the approval step, which a person triggers, writes to PayPal.

## Tools used

- **PayPal Disputes API (sandbox):** lists disputes, reads details, provides evidence, sends messages, accepts claims.
- **Groq (`openai/gpt-oss-120b`):** the AI model. It uses tool calling to read the dispute and seller record, then proposes a resolution.
- **Google Gemini:** automatic fallback if the primary model is unavailable.
- **Node.js, Express, Helmet:** backend and security headers.
- Plain HTML, CSS, and JavaScript for the dashboard.

## Demo data

The dashboard runs on realistic sample disputes (`data/mock_disputes.json`) and seller records (`data/orders.json`) so every decision path can be tried instantly. Set `USE_MOCK_PAYPAL=false` to read disputes from your PayPal sandbox account instead. No real money or customer data is involved.

## Safety design

- **Human in the loop:** every submission needs approval. Approvals are single-use, expire after 30 minutes, and are tied to a hash of the exact proposal shown. The live dispute status is re-checked right before submitting.
- **Prompt-injection defence:** buyer messages are treated as untrusted text and scanned. A suspicious message forces human review.
- **Output validation:** the AI's answer is schema-checked, length-capped, and fact-checked. Any long number in a draft that isn't in the seller's records sends the case to human review. Tracking data sent to PayPal comes from the seller record, never from the AI.
- **Escalation rules:** high-value, low-confidence, flagged, missing-record, or non-waiting disputes always go to a human.
- **App security:** password login, CSRF protection, secure session cookies, rate limiting, strict input validation, Helmet security headers, generic error messages, redacted logs, and an audit log.
- **Sandbox lock:** the PayPal base URL is hard-coded to the sandbox.
- **Optional auto-handling (off by default):** for low-value, high-confidence, flag-free cases only, with an hourly cap and a kill switch.

## Run it yourself

Requires Node.js 18 or newer.

1. Clone this repo and open the folder.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and fill in:
   - `ADMIN_PASSWORD` (at least 12 characters) and `SESSION_SECRET` (random, at least 32 characters)
   - `GROQ_API_KEY` and `GROQ_MODEL` (for example `openai/gpt-oss-120b`), and/or `GEMINI_API_KEY`
   - `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET` from a PayPal sandbox app with Disputes enabled (only needed when `USE_MOCK_PAYPAL=false`)
   - Keep `USE_MOCK_PAYPAL=true` for the sample disputes.
4. Run `npm start`, open http://localhost:3000, and log in with your `ADMIN_PASSWORD`.

## Try these three cases

- **PP-D-1001** ($85, item delivered with tracking): the agent proposes contesting, citing the real tracking number. Approve it to see the status update.
- **PP-D-1002** ($40, never shipped): the agent proposes a refund.
- **PP-D-1003** ($320, the buyer message tries to hijack the AI): the agent flags it and sends it to a human, and Approve stays disabled.

## Future work

Native integration inside PayPal's Resolution Center, webhook-driven handling, deadline reminders, and broader dispute and evidence types.

## License

MIT
