const cfg = require("./config");
const { clean, hashObject } = require("./security");

const RECS = ["FIGHT", "REFUND", "NEEDS_HUMAN"];
const CONFS = ["LOW", "MEDIUM", "HIGH"];

// any 6+ digit number in the draft must exist in the real data
function unverifiedNumbers(text, allowedText) {
  const found = text.match(/\d{6,}/g) || [];
  return [...new Set(found)].filter((n) => !allowedText.includes(n));
}

function proposalHash(id, p, record) {
  return hashObject({
    id,
    rec: p.recommendation,
    note: p.evidence_note,
    msg: p.message_to_buyer,
    tracking: record?.tracking_number || null,
    carrier: record?.carrier || null,
  });
}

// Never trust the model: validate, cap, fact-check, and apply policy.
function enforce(raw, ctx) {
  const flags = [];
  if (!raw) flags.push("AGENT_NO_PROPOSAL");

  const out = {
    recommendation: RECS.includes(raw?.recommendation) ? raw.recommendation : "NEEDS_HUMAN",
    confidence: CONFS.includes(raw?.confidence) ? raw.confidence : "LOW",
    reasoning: clean(raw?.reasoning, 1200),
    evidence_note: clean(raw?.evidence_note, 1500),
    message_to_buyer: clean(raw?.message_to_buyer, 800),
    missing_info: clean(raw?.missing_info, 500),
  };
  const downgrade = (flag) => { flags.push(flag); out.recommendation = "NEEDS_HUMAN"; };

  if (ctx.injection) downgrade("PROMPT_INJECTION_SUSPECTED");
  if (ctx.status !== "WAITING_FOR_SELLER_RESPONSE") downgrade("NOT_AWAITING_SELLER_RESPONSE");
  if (!ctx.record) downgrade("NO_SELLER_RECORD");
  if (ctx.amount > cfg.MAX_AUTO_AMOUNT) downgrade("HIGH_VALUE");
  if (out.confidence === "LOW") downgrade("LOW_CONFIDENCE");

  if (out.recommendation === "FIGHT") {
    const r = ctx.record;
    const hasProof = r && r.tracking_number && r.delivery_status === "DELIVERED" &&
      ctx.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
    if (!hasProof) downgrade("INSUFFICIENT_PROOF");
    else if (!out.evidence_note) downgrade("EMPTY_EVIDENCE_NOTE");
    else if (unverifiedNumbers(`${out.evidence_note} ${out.message_to_buyer}`, ctx.allowedText).length)
      downgrade("UNVERIFIED_FACTS");
  }
  if (out.recommendation === "REFUND") {
    out.evidence_note = "";
    if (ctx.record?.delivery_status === "DELIVERED") flags.push("RECORD_SAYS_DELIVERED_CONSIDER_FIGHTING");
  }

  return { ...out, flags, route: out.recommendation === "NEEDS_HUMAN" ? "NEEDS_HUMAN" : "READY_FOR_APPROVAL" };
}

// Strict, all-conditions-must-pass check. Anything doubtful stays with the human.
function autoEligible(proposal, ctx) {
  return (
    cfg.AUTO_HANDLE === true &&
    cfg.AUTO_ACTIONS.includes(proposal.recommendation) &&
    proposal.route === "READY_FOR_APPROVAL" &&
    proposal.confidence === "HIGH" &&
    (proposal.flags || []).length === 0 &&
    !proposal.edited &&
    ctx.status === "WAITING_FOR_SELLER_RESPONSE" &&
    !!ctx.record &&
    ctx.amount > 0 &&
    ctx.amount <= cfg.AUTO_HANDLE_MAX_AMOUNT
  );
}

module.exports = { enforce, proposalHash, unverifiedNumbers, autoEligible };