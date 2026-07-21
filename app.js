"use strict";

/* ---------- constants & data ---------- */

const STORE_KEY = "broker-optout-tracker/v2";
const RECHECK_DAYS = 90;
const BROKERS = window.BROKER_DATA.brokers;
const STATUTES = window.STATUTE_DATA.statutes;
const BY_ID = Object.fromEntries(BROKERS.map((b) => [b.id, b]));

const STATUS_LABELS = {
  not_checked: "Not checked",
  no_listing: "No listing found",
  found_listing: "Found listing",
  request_sent: "Request sent",
  removed: "Removed",
  recheck_due: "Recheck due",
};
const LEGACY_STATUS = Object.fromEntries(Object.entries(STATUS_LABELS).map(([k, v]) => [v, k]));

/* ---------- state ---------- */

function emptyState() {
  return { version: 2, profile: { name: "", city: "", state: "other", email: "" }, brokers: {} };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn("state load failed", e); }
  return emptyState();
}

let state = loadState();

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function entry(id) {
  if (!state.brokers[id]) state.brokers[id] = { status: "not_checked", notes: "", history: [], recheckAt: null };
  return state.brokers[id];
}

function setStatus(id, status, note, force = false) {
  const e = entry(id);
  if (e.status === status && !force) return;
  e.status = status;
  e.history.push({ status, at: new Date().toISOString(), ...(note ? { note } : {}) });
  e.recheckAt = status === "removed"
    ? new Date(Date.now() + RECHECK_DAYS * 864e5).toISOString()
    : null;
  save();
  render();
}

/* Anything past its recheck date flips to recheck_due automatically. */
function sweepRechecks() {
  const now = Date.now();
  let changed = false;
  for (const [id, e] of Object.entries(state.brokers)) {
    if (e.status === "removed" && e.recheckAt && Date.parse(e.recheckAt) <= now) {
      e.status = "recheck_due";
      e.history.push({ status: "recheck_due", at: new Date().toISOString(), note: "auto: 90-day recheck window elapsed" });
      changed = true;
    }
  }
  if (changed) save();
}

/* ---------- import / export ---------- */

function exportState() {
  const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `optout-progress-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Exported. Keep this file out of any git repo.");
}

function importState(obj) {
  if (obj && obj.version === 2 && obj.brokers) {
    state = { ...emptyState(), ...obj, version: 2 };
    save();
    render();
    toast("Imported.");
    return;
  }
  // Prototype schema: { name, loc, email, status: { brokerId: "Removed", ... } }
  if (obj && typeof obj.status === "object") {
    const migrated = emptyState();
    const loc = String(obj.loc ?? "");
    const m = loc.match(/^(.*),\s*([A-Za-z]{2})$/);
    migrated.profile = {
      name: String(obj.name ?? ""),
      city: m ? m[1].trim() : loc,
      state: m && STATUTES[m[2].toUpperCase()] ? m[2].toUpperCase() : "other",
      email: String(obj.email ?? ""),
    };
    const unknown = [];
    const now = new Date().toISOString();
    for (const [id, label] of Object.entries(obj.status)) {
      if (!BY_ID[id]) { unknown.push(id); continue; }
      const status = LEGACY_STATUS[label] ?? "not_checked";
      migrated.brokers[id] = {
        status,
        notes: "",
        history: [{ status, at: now, note: "imported from prototype export" }],
        recheckAt: status === "removed" ? new Date(Date.now() + RECHECK_DAYS * 864e5).toISOString() : null,
      };
    }
    state = migrated;
    save();
    render();
    toast(unknown.length ? `Imported; ignored unknown broker ids: ${unknown.join(", ")}` : "Imported prototype export.");
    return;
  }
  toast("Unrecognized file — expected a tracker export or prototype progress JSON.");
}

/* ---------- listing search links ---------- */

function nameParts() {
  const parts = state.profile.name.trim().split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? { first: parts[0], last: parts[parts.length - 1] } : null;
}

const slugify = (s, sep) => s.trim().toLowerCase().replace(/\s+/g, sep);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/* Fill a broker's searchUrl template from the profile; null if the template
   needs a detail the profile doesn't have yet. */
function searchLink(b) {
  const n = nameParts();
  if (!b.searchUrl || !n) return null;
  const p = state.profile;
  const st = p.state && p.state !== "other" ? p.state : "";
  if (b.searchUrl.includes("{city}") && !p.city.trim()) return null;
  if ((b.searchUrl.includes("{state}") || b.searchUrl.includes("{STATE}")) && !st) return null;
  return b.searchUrl
    .replaceAll("{first}", slugify(n.first, "-"))
    .replaceAll("{last}", slugify(n.last, "-"))
    .replaceAll("{First}", cap(n.first))
    .replaceAll("{Last}", cap(n.last))
    .replaceAll("{city}", slugify(p.city, "-"))
    .replaceAll("{state}", st.toLowerCase())
    .replaceAll("{STATE}", st.toUpperCase())
    .replaceAll("{q}", encodeURIComponent(`${n.first} ${n.last}`))
    .replaceAll("{qcs}", encodeURIComponent(st ? `${p.city.trim()}, ${st}` : p.city.trim()));
}

/* site:-scoped web search — works for every broker, no URL scheme needed */
function webSearchLink(b) {
  const name = state.profile.name.trim();
  if (!name) return null;
  const host = new URL(b.optOutUrl).hostname.split(".").slice(-2).join(".");
  return `https://duckduckgo.com/?q=${encodeURIComponent(`"${name}" site:${host}`)}`;
}

/* ---------- scan mode ---------- */

let scanQueue = [];
let scanIndex = 0;

function scanTargets(includeClear) {
  return BROKERS.filter((b) => b.tier === 1).filter((b) => {
    const s = state.brokers[b.id]?.status ?? "not_checked";
    return ["not_checked", "recheck_due"].includes(s) ||
      (includeClear && ["no_listing", "removed"].includes(s));
  });
}

function startScan() {
  scanQueue = scanTargets($("#scanIncludeClear").checked);
  scanIndex = 0;
  if (!scanQueue.length) { toast("Nothing to scan — every tier-1 site has a current status. Tick the re-scan box to sweep them all."); return; }
  renderScanStep();
  const d = $("#scanDialog");
  if (!d.open) d.showModal();
}

function renderScanStep() {
  const b = scanQueue[scanIndex];
  const s = state.brokers[b.id]?.status ?? "not_checked";
  const sl = searchLink(b);
  const wl = webSearchLink(b);
  const links = [
    ...(sl ? [[sl, "Search my name on the site"]] : []),
    [b.optOutUrl, sl ? "Opt-out page" : "Open site / opt-out page"],
    ...(wl ? [[wl, "Web-search my name"]] : []),
  ];
  $("#scanBody").innerHTML = `<div class="scan-card">
    <div class="scan-progress">${scanIndex + 1} of ${scanQueue.length}${wl ? "" : " — fill in your Profile to get search links"}</div>
    <h3>${esc(b.name)}</h3>
    <span class="status"><span class="dot s-${s}"></span>${STATUS_LABELS[s]}</span>
    <p class="note">${esc(b.note)}</p>
    <div class="scan-links">${links.map(([href, label]) => `<a class="button" href="${esc(href)}" target="_blank" rel="noopener">${label} ↗</a>`).join("")}</div>
  </div>`;
}

function scanAnswer(found) {
  const b = scanQueue[scanIndex];
  const prior = state.brokers[b.id]?.status ?? "not_checked";
  if (found) {
    setStatus(b.id, "found_listing", "scan: listing found", true);
  } else if (prior === "recheck_due" || prior === "removed") {
    // still clear on recheck — restart the 90-day clock
    setStatus(b.id, "removed", "scan: still clear", true);
  } else {
    setStatus(b.id, "no_listing", "scan: no listing", true);
  }
  scanAdvance();
}

function scanAdvance() {
  scanIndex++;
  if (scanIndex >= scanQueue.length) {
    $("#scanDialog").close();
    toast("Scan complete — statuses updated.");
    return;
  }
  renderScanStep();
}

function scanPrompt() {
  const targets = scanTargets(false);
  if (!targets.length) return null;
  const items = targets.map((b, i) => {
    const sl = searchLink(b);
    return `${i + 1}. ${b.name}\n   Site / opt-out page: ${b.optOutUrl}${sl ? `\n   Likely search URL: ${sl}` : ""}\n   Notes: ${b.note}`;
  }).join("\n");
  return `Search these people-search sites for listings about me and report what you find. This is a READ-ONLY scan: use each site's own search, and do not submit any forms or opt-out requests yet.
My name and city/state: ask me in chat before you start — do not guess.

${items}

For each site, report one of: "Found listing" (include the listing URL) or "No listing found", so I can record it in my tracker. If a site blocks the search behind a CAPTCHA or login wall, say so and move on — I'll check that one myself.

${SAFETY_CONVENTIONS}`;
}

/* ---------- prompts & letters ---------- */

const SAFETY_CONVENTIONS = `Safety conventions (non-negotiable):
- I will solve any CAPTCHAs myself — pause and tell me when one appears.
- Confirm with me before submitting any form or sending any email.
- Do not create accounts and do not enter passwords or payment details anywhere.
- If a site demands an ID upload or payment to process the opt-out, stop and tell me instead.`;

function agentPrompt(b) {
  const e = state.brokers[b.id];
  return `Help me opt out of the data broker "${b.name}".
Opt-out page: ${b.optOutUrl}
Method: ${b.method === "email" ? `email (${b.contactEmail})` : "web form"}${b.contactEmail && b.method !== "email" ? `\nFallback contact email: ${b.contactEmail}` : ""}
Known gotchas: ${b.note}
Current status in my tracker: ${STATUS_LABELS[e?.status ?? "not_checked"]}
Information I can provide when a form needs it: my full name, city and state, email address, and date of birth where strictly required — ask me in chat rather than guessing.

${SAFETY_CONVENTIONS}

When we finish, tell me which status to record in my tracker: "No listing found", "Request sent", or "Removed".`;
}

function actionableBrokers() {
  return BROKERS.filter((b) => ["found_listing", "recheck_due"].includes(state.brokers[b.id]?.status));
}

function sessionPrompt() {
  const list = actionableBrokers();
  if (!list.length) return null;
  const items = list.map((b, i) =>
    `${i + 1}. ${b.name}\n   URL: ${b.optOutUrl}\n   Status: ${STATUS_LABELS[state.brokers[b.id].status]}\n   Gotchas: ${b.note}`).join("\n");
  return `I'm working through data-broker opt-outs. Below are the brokers currently needing action, already in the right order (cascading opt-outs first — they clear sister sites, so later ones may resolve themselves).

${items}

Work through them one at a time, in order. Before moving to the next broker, tell me which status to record in my tracker: "No listing found", "Request sent", or "Removed".
Information I can provide when a form needs it: my full name, city and state, email address, and date of birth where strictly required — ask me in chat rather than guessing.

${SAFETY_CONVENTIONS}`;
}

function stateSummaryJSON() {
  const brokers = {};
  for (const b of BROKERS) {
    const e = state.brokers[b.id];
    brokers[b.id] = {
      name: b.name,
      status: e?.status ?? "not_checked",
      recheckAt: e?.recheckAt ?? null,
      notes: e?.notes || undefined,
    };
  }
  return JSON.stringify({ generatedAt: new Date().toISOString(), statuses: STATUS_LABELS, brokers }, null, 2);
}

function letterFor(b, stateCode) {
  const s = STATUTES[stateCode] ?? STATUTES.other;
  const p = state.profile;
  const cite = s.citation ? `${s.law} (${s.citation})` : s.law;
  const deadline = s.deadlineDays
    ? `Please confirm completion within ${s.deadlineDays} days, the response period required by ${s.citation}.`
    : `Please confirm completion within 45 days.`;
  return `To: ${b.name}${b.contactEmail ? ` <${b.contactEmail}>` : ""}
Subject: Personal data deletion and do-not-sell request

To whom it may concern:

I am a resident of ${p.city || "[city]"}, ${s.state}. Under the ${cite}, I request that you:

1. Delete all personal information you hold about me, including derived and inferred data;
2. Stop selling or sharing my personal information with third parties;
3. Suppress my information from future collection and exclude me from any lists, products, or datasets you license or sell.

Details to locate my records:
- Full name: ${p.name || "[full name]"}
- City / State: ${p.city || "[city]"}, ${p.state !== "other" ? p.state : "[state]"}
- Email: ${p.email || "[email]"}

${deadline} If you deny any part of this request, state the specific legal basis for the denial. Use the information in this request solely to process it; do not add it to any marketing, lookup, or data products.

Regards,
${p.name || "[full name]"}`;
}

/* ---------- rendering ---------- */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
}

function renderDashboard() {
  const counts = { tracked: BROKERS.length, found_listing: 0, request_sent: 0, removed: 0, recheck_due: 0 };
  for (const b of BROKERS) {
    const s = state.brokers[b.id]?.status;
    if (s in counts) counts[s]++;
  }
  const tiles = [
    ["Tracked", counts.tracked, "not_checked"],
    ["Found listing", counts.found_listing, "found_listing"],
    ["Requests sent", counts.request_sent, "request_sent"],
    ["Removed", counts.removed, "removed"],
    ["Recheck due", counts.recheck_due, "recheck_due"],
  ];
  $("#dashboard").innerHTML = tiles.map(([lbl, n, cls]) =>
    `<div class="tile"><div class="num">${n}</div><div class="lbl"><span class="dot s-${cls}"></span>${lbl}</div></div>`).join("");
}

function brokerRow(b) {
  const e = state.brokers[b.id];
  const status = e?.status ?? "not_checked";
  const updated = e?.history?.length ? e.history[e.history.length - 1].at : null;
  const options = Object.entries(STATUS_LABELS).map(([k, v]) =>
    `<option value="${k}" ${k === status ? "selected" : ""}>${v}</option>`).join("");
  const cascade = (b.cascades ?? []).filter((id) => BY_ID[id]);
  return `<article class="broker" data-id="${b.id}">
  <div class="broker-head">
    <span class="broker-title"><a href="${esc(b.optOutUrl)}" target="_blank" rel="noopener">${esc(b.name)} ↗</a><span class="pill">Tier ${b.tier}</span><span class="pill">${b.method}</span></span>
    <span class="status"><span class="dot s-${status}"></span>${STATUS_LABELS[status]}</span>
  </div>
  <p class="note">${esc(b.note)} <span class="muted">(verified ${esc(b.lastVerified)})</span></p>
  ${cascade.length ? `<p class="cascade-flag">⤷ also clears: ${cascade.map((id) => esc(BY_ID[id].name)).join(", ")}</p>` : ""}
  <div class="broker-controls">
    <select class="status-select" aria-label="Status for ${esc(b.name)}">${options}</select>
    <span class="dates">${updated ? `Updated ${fmtDate(updated)}` : "No activity yet"}${e?.recheckAt ? ` · recheck ${fmtDate(e.recheckAt)}` : ""}</span>
  </div>
  <div class="broker-actions">
    ${b.tier === 1 && (searchLink(b) || webSearchLink(b)) ? `<a class="button" href="${esc(searchLink(b) ?? webSearchLink(b))}" target="_blank" rel="noopener">Find my listing ↗</a>` : ""}
    <button type="button" data-act="prompt">Copy agent prompt</button>
    <button type="button" data-act="letter">Deletion letter</button>
    <a class="button" data-act="claude" target="_blank" rel="noopener" href="#">Open in Claude</a>
    <a class="button" data-act="chatgpt" target="_blank" rel="noopener" href="#">Open in ChatGPT</a>
  </div>
  <input class="notes-input" placeholder="Notes (confirmation numbers, dates, wrinkles…)" value="${esc(e?.notes ?? "")}" aria-label="Notes for ${esc(b.name)}">
</article>`;
}

function render() {
  sweepRechecks();
  renderDashboard();
  $("#tier1List").innerHTML = BROKERS.filter((b) => b.tier === 1).map(brokerRow).join("");
  $("#tier2List").innerHTML = BROKERS.filter((b) => b.tier === 2).map(brokerRow).join("");
}

/* ---------- letter dialog ---------- */

let letterBrokerId = null;

function openLetter(b) {
  letterBrokerId = b.id;
  $("#letterTitle").textContent = `Deletion letter — ${b.name}`;
  $("#letterState").value = state.profile.state || "other";
  refreshLetter();
  $("#letterDialog").showModal();
}

function refreshLetter() {
  const b = BY_ID[letterBrokerId];
  const code = $("#letterState").value;
  const text = letterFor(b, code);
  $("#letterText").value = text;
  const mail = $("#btnMailto");
  if (b.contactEmail) {
    mail.hidden = false;
    const subject = "Personal data deletion and do-not-sell request";
    const body = text.split("\n").slice(3).join("\n"); // strip To/Subject header lines from the body
    mail.href = `mailto:${b.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  } else {
    mail.hidden = true;
  }
}

/* ---------- wiring ---------- */

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

async function copyText(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    // file:// or denied permission — fall back to a prompt-style textarea
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast(msg);
  }
}

function populateStateSelects() {
  const opts = Object.entries(STATUTES)
    .sort(([a], [b]) => (a === "other") - (b === "other") || STATUTES[a].state.localeCompare(STATUTES[b].state))
    .map(([code, s]) => `<option value="${code}">${esc(s.state)}${s.deadlineDays ? "" : ""}</option>`)
    .join("");
  $("#pfState").innerHTML = opts;
  $("#letterState").innerHTML = opts;
}

function bindProfile() {
  const map = { pfName: "name", pfCity: "city", pfState: "state", pfEmail: "email" };
  for (const [id, key] of Object.entries(map)) {
    const el = document.getElementById(id);
    el.value = state.profile[key] ?? "";
    el.addEventListener("input", () => { state.profile[key] = el.value; save(); });
    el.addEventListener("change", render); // refresh "Find my listing" links
  }
}

/* Small API for agents driving this page (and for tests): read state, set
   statuses, or import an export/prototype file programmatically. */
window.tracker = {
  stateSummaryJSON,
  setStatus,
  importState,
  getState: () => JSON.parse(JSON.stringify(state)),
};

document.addEventListener("DOMContentLoaded", () => {
  populateStateSelects();
  bindProfile();
  render();

  $("#btnProfile").addEventListener("click", () => { $("#profilePanel").hidden = !$("#profilePanel").hidden; });
  $("#btnExport").addEventListener("click", exportState);
  $("#btnImport").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try { importState(JSON.parse(await file.text())); }
    catch { toast("Could not parse that file as JSON."); }
    ev.target.value = "";
  });
  $("#btnCopyState").addEventListener("click", () => copyText(stateSummaryJSON(), "State JSON copied — paste it to your agent."));
  $("#btnScan").addEventListener("click", startScan);
  $("#btnScanPrompt").addEventListener("click", () => {
    const p = scanPrompt();
    if (!p) { toast("Nothing to scan — every tier-1 site has a current status."); return; }
    copyText(p, "Scan prompt copied — paste it to your agent.");
  });
  $("#scanIncludeClear").addEventListener("change", startScan);
  $("#btnScanFound").addEventListener("click", () => scanAnswer(true));
  $("#btnScanClear").addEventListener("click", () => scanAnswer(false));
  $("#btnScanSkip").addEventListener("click", scanAdvance);
  $("#btnScanStop").addEventListener("click", () => $("#scanDialog").close());
  $("#btnSessionPrompt").addEventListener("click", () => {
    const p = sessionPrompt();
    if (!p) { toast('No brokers in "Found listing" or "Recheck due" right now.'); return; }
    copyText(p, "Session prompt copied.");
  });

  document.body.addEventListener("change", (ev) => {
    const row = ev.target.closest(".broker");
    if (row && ev.target.classList.contains("status-select")) setStatus(row.dataset.id, ev.target.value);
  });
  document.body.addEventListener("input", (ev) => {
    const row = ev.target.closest(".broker");
    if (row && ev.target.classList.contains("notes-input")) { entry(row.dataset.id).notes = ev.target.value; save(); }
  });
  document.body.addEventListener("click", (ev) => {
    const row = ev.target.closest(".broker");
    if (!row) return;
    const b = BY_ID[row.dataset.id];
    const act = ev.target.dataset.act;
    if (act === "prompt") copyText(agentPrompt(b), "Agent prompt copied — paste it to Claude, ChatGPT, or any agent.");
    if (act === "letter") openLetter(b);
    if (act === "claude") ev.target.href = `https://claude.ai/new?q=${encodeURIComponent(agentPrompt(b))}`;
    if (act === "chatgpt") ev.target.href = `https://chatgpt.com/?q=${encodeURIComponent(agentPrompt(b))}`;
  });

  $("#letterState").addEventListener("change", refreshLetter);
  $("#btnCopyLetter").addEventListener("click", () => copyText($("#letterText").value, "Letter copied."));
  $("#btnCloseLetter").addEventListener("click", () => $("#letterDialog").close());
});
