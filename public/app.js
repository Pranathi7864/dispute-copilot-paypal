(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  const REASONS = {
    MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
    MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Item not as described",
  };
  const FLAGS = {
    PROMPT_INJECTION_SUSPECTED: "A buyer message looks like an attempt to manipulate the AI. It was treated as untrusted text.",
    HIGH_VALUE: "The amount is above the automatic-handling limit, so a human must decide.",
    LOW_CONFIDENCE: "The AI was not confident enough.",
    NO_SELLER_RECORD: "No matching order record was found for this transaction.",
    INSUFFICIENT_PROOF: "The seller records do not contain enough proof to contest this dispute.",
    UNVERIFIED_FACTS: "The draft contained details that are not in your records.",
    NOT_AWAITING_SELLER_RESPONSE: "This dispute is not waiting for a seller response.",
    AGENT_NO_PROPOSAL: "The AI did not return a usable proposal.",
    EMPTY_EVIDENCE_NOTE: "The AI returned an empty evidence note.",
    RECORD_SAYS_DELIVERED_CONSIDER_FIGHTING: "Your records say the item was delivered. Consider contesting instead of refunding.",
    PROMPT_DONE: "",
  };
  const STATUS = {
    PENDING_APPROVAL: "Waiting for your approval",
    SUBMITTING: "Submitting to PayPal...",
    DONE: "Submitted to PayPal",
    REJECTED: "You rejected this proposal",
    EXPIRED: "Proposal expired, analyze again",
  };

  let csrf = null;
  let selectedId = null;
  let current = null;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const show = (e, on) => e.classList.toggle("hidden", !on);
  const money = (a) => (a ? `${a.value} ${a.currency_code}` : "-");
  const when = (s) => (s ? new Date(s).toLocaleString() : "-");
  const setMsg = (text, kind) => { const m = $("msg"); m.textContent = text || ""; m.className = "msg " + (kind || ""); };
  const enc = encodeURIComponent;

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { showLogin(); throw new Error(data.error || "Login required"); }
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // ---------- views ----------
  function showLogin() {
    csrf = null; selectedId = null; current = null;
    show($("loginView"), true);
    show($("appView"), false);
    show($("logoutBtn"), false);
  }
  function showApp() {
    show($("loginView"), false);
    show($("appView"), true);
    show($("logoutBtn"), true);
    loadList().catch((e) => setMsg(e.message, "error"));
  }

  async function login() {
    $("loginMsg").textContent = "";
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("password").value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { $("loginMsg").textContent = data.error || "Login failed"; return; }
    csrf = data.csrfToken;
    $("password").value = "";
    showApp();
  }

  async function logout() {
    try { await api("POST", "/api/logout"); } catch { /* ignore */ }
    showLogin();
  }

  // ---------- dispute list and details ----------
  async function loadList() {
    const data = await api("GET", "/api/disputes");
    const box = $("disputeList");
    box.replaceChildren();
    if (!data.items.length) { box.append(el("p", "muted", "No disputes found.")); return; }
    for (const d of data.items) {
      const row = el("button", "row" + (d.dispute_id === selectedId ? " active" : ""));
      row.append(
        el("strong", "", d.dispute_id),
        el("span", "pill", d.status),
        el("span", "", REASONS[d.reason] || d.reason),
        el("span", "", money(d.dispute_amount))
      );
      row.addEventListener("click", () => selectDispute(d.dispute_id).catch((e) => setMsg(e.message, "error")));
      box.append(row);
    }
  }

  function renderDetail(d) {
    const box = $("detail");
    box.replaceChildren();
    const dl = el("dl");
    const add = (k, v) => { dl.append(el("dt", "", k), el("dd", "", v)); };
    add("Dispute ID", d.dispute_id);
    add("Reason", REASONS[d.reason] || d.reason);
    add("Amount", money(d.dispute_amount));
    add("Status", d.status);
    add("Respond by", when(d.seller_response_due_date));
    box.append(dl);
    const msgs = d.messages || [];
    if (msgs.length) {
      box.append(el("h3", "", "Buyer messages (untrusted text)"));
      for (const m of msgs) box.append(el("div", "bubble", `${m.posted_by}: ${m.content}`));
    }
  }

  async function selectDispute(id) {
    selectedId = id;
    setMsg("");
    current = null;
    show($("proposalCard"), false);
    loadList().catch(() => {});
    renderDetail(await api("GET", `/api/disputes/${enc(id)}`));
    show($("detailCard"), true);
    try {
      current = await api("GET", `/api/disputes/${enc(id)}/proposal`);
      renderProposal();
    } catch { /* no saved proposal yet */ }
  }

  // ---------- proposal ----------
  function renderProposal() {
    if (!current) return;
    const p = current.proposal;
    const pending = current.status === "PENDING_APPROVAL";
    const fight = p.recommendation === "FIGHT";
    const ready = p.route === "READY_FOR_APPROVAL";

    show($("proposalCard"), true);
    const badge = $("routeBadge");
    badge.textContent = ready ? "Ready for approval" : "Needs your attention";
    badge.className = "pill " + (ready ? "ok" : "warn");
    $("confText").textContent = `AI confidence: ${p.confidence}`;
    $("recText").textContent =
      p.recommendation === "FIGHT" ? "Recommendation: contest the dispute with evidence"
      : p.recommendation === "REFUND" ? "Recommendation: refund the buyer (accept the claim)"
      : "Recommendation: this needs your own decision";
    $("reasoning").textContent = p.reasoning || "-";

    const flags = $("flags");
    flags.replaceChildren();
    for (const f of p.flags || []) flags.append(el("li", "", FLAGS[f] || f));
    show($("flagsBox"), (p.flags || []).length > 0);

    $("missing").textContent = p.missing_info || "";
    show($("missingBox"), !!p.missing_info);

    $("note").value = p.evidence_note || "";
    $("buyerMsg").value = p.message_to_buyer || "";
    show($("noteWrap"), fight);
    show($("msgWrap"), (fight || p.recommendation === "REFUND") && !!p.message_to_buyer);
    $("note").disabled = !(pending && fight);
    $("buyerMsg").disabled = !(pending && fight);

    $("statusText").textContent =(STATUS[current.status] || current.status) + (current.auto_note ? " - " + current.auto_note : "");
    $("traceText").textContent =
      `Agent steps: ${(current.trace || []).join(" > ")}. Expires: ${when(current.expires_at)}`;

    $("approveBtn").disabled = !(pending && ready);
    $("rejectBtn").disabled = !pending;
    $("reanalyzeBtn").disabled = !(pending || current.status === "REJECTED" || current.status === "EXPIRED");
  }

  async function analyze(force) {
    if (!selectedId) return;
    setMsg("The AI agent is analyzing this dispute. This can take up to a minute.", "info");
    $("analyzeBtn").disabled = true;
    $("reanalyzeBtn").disabled = true;
    try {
      current = await api("POST", `/api/disputes/${enc(selectedId)}/analyze`, { force: !!force });
      setMsg("");
      renderProposal();
    } catch (e) {
      setMsg(e.message, "error");
    } finally {
      $("analyzeBtn").disabled = false;
    }
  }

  async function saveEdits() {
    current = await api("POST", `/api/disputes/${enc(selectedId)}/edit`, {
      evidence_note: $("note").value,
      message_to_buyer: $("buyerMsg").value,
    });
  }

  async function approve() {
    if (!window.confirm("Submit this response to PayPal? This cannot be undone.")) return;
    $("approveBtn").disabled = true;
    try {
      const p = current.proposal;
      if (p.recommendation === "FIGHT" &&
          ($("note").value !== p.evidence_note || $("buyerMsg").value !== p.message_to_buyer)) {
        await saveEdits();
      }
      await api("POST", `/api/disputes/${enc(selectedId)}/approve`, { proposal_hash: current.hash });
      current = await api("GET", `/api/disputes/${enc(selectedId)}/proposal`);
      setMsg("Submitted to PayPal.", "ok");
      renderDetail(await api("GET", `/api/disputes/${enc(selectedId)}`));
      loadList().catch(() => {});
    } catch (e) {
      setMsg(e.message, "error");
    }
    renderProposal();
  }

  async function reject() {
    try {
      await api("POST", `/api/disputes/${enc(selectedId)}/reject`);
      current = await api("GET", `/api/disputes/${enc(selectedId)}/proposal`);
      setMsg("Proposal rejected. Nothing was sent to PayPal.", "info");
    } catch (e) {
      setMsg(e.message, "error");
    }
    renderProposal();
  }

  // ---------- wiring ----------
  $("loginBtn").addEventListener("click", login);
  $("password").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
  $("logoutBtn").addEventListener("click", logout);
  $("analyzeBtn").addEventListener("click", () => analyze(false));
  $("reanalyzeBtn").addEventListener("click", () => analyze(true));
  $("approveBtn").addEventListener("click", approve);
  $("rejectBtn").addEventListener("click", reject);

  (async function init() {
    try {
      const h = await (await fetch("/api/health")).json();
      $("modeBadge").textContent = h.mock ? "Mock PayPal data" : "PayPal sandbox";
    } catch { /* ignore */ }
    const s = await (await fetch("/api/session")).json().catch(() => ({}));
    if (s.authenticated) { csrf = s.csrfToken; showApp(); } else showLogin();
  })();
})();