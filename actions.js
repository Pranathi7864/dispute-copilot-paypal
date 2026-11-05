const paypal = require("./paypal");
const { httpError } = require("./security");

const CARRIER = /^[A-Z0-9_]{2,40}$/;

// Tracking info comes from the seller's record, never from the AI.
async function execute(id, p) {
  const { recommendation, evidence_note, message_to_buyer } = p.proposal;
  const r = p.record;

  if (recommendation === "FIGHT") {
    if (!r?.tracking_number || !CARRIER.test(r.carrier || "")) throw httpError("Seller record incomplete", 409);
    if (!p.done.evidence) {
      await paypal.provideEvidence(id, [{
        evidence_type: "PROOF_OF_FULFILLMENT",
        evidence_info: { tracking_info: [{ carrier_name: r.carrier, tracking_number: String(r.tracking_number) }] },
        notes: evidence_note,
      }]);
      p.done.evidence = true;
    }
    if (message_to_buyer && !p.done.message) {
      await paypal.sendMessage(id, message_to_buyer);
      p.done.message = true;
    }
    return;
  }

  if (recommendation === "REFUND") {
    if (!p.done.refund) {
      await paypal.acceptClaim(id, {
        note: message_to_buyer || "Seller accepted the claim.",
        reason: r?.delivery_status === "NOT_SHIPPED" ? "DID_NOT_SHIP_ITEM" : "NOT_ABLE_TO_WIN",
      });
      p.done.refund = true;
    }
    return;
  }
  throw httpError("Nothing to execute", 400);
}

module.exports = { execute };