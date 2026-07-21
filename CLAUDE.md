# CLAUDE.md — AI-assisted opt-out workflow

This file documents the conventions for using an AI agent (Claude or otherwise) with this tracker, so the workflow is reproducible. Claude users can install the packaged skill instead: copy `skill/broker-optout/` into `~/.claude/skills/`.

## The contract

The human owns: CAPTCHAs, the final click on any submission, identity documents, payment decisions.
The agent owns: navigation, finding listings, filling forms (with confirmation), drafting letters/emails, watching for verification emails, keeping the tracker updated.

Never deviate from the safety conventions embedded in the app's generated prompts:

> I will solve any CAPTCHAs myself. Confirm with me before submitting any form or sending any email. Do not create accounts or enter passwords/payment details. If the site demands ID upload or payment, stop and tell me.

## Per-broker prompt pattern

Use the app's **Copy agent prompt** button, or hand-write:

```
Use Claude in Chrome to opt me out of {broker} at {optOutUrl}.
Known gotchas: {note field from brokers.json}.
I'll handle CAPTCHAs and confirm before any submission.
When done, tell me the status to record: "No listing found", "Request sent", or "Removed".
```

Ask the user in chat for personal details a form needs (name, city/state, DOB where strictly required) — never guess, never pull from files.

## Batch sessions

The **Copy session prompt** button bundles every broker in *Found listing* / *Recheck due*, in cascade order (PeopleConnect suppression first, then BeenVerified — each clears sister sites, so later brokers may already be clean; check before re-submitting). Work one broker at a time; report a status after each before moving on.

## Verification emails

Recommended setup: a dedicated alias (e.g. `optouts.you@yourdomain`) with a forwarding rule into the main inbox. With a Gmail/mail connector, the agent can watch for broker verification emails and surface the confirmation links — the human clicks anything that finalizes a submission. Compliance replies (statutory responses, denials) get summarized and recorded in the broker's notes.

## Status updates back into the tracker

The tracker's **Copy state as JSON** button produces a machine-readable summary. On the tracker page itself, `window.tracker` exposes `stateSummaryJSON()`, `setStatus(brokerId, status)`, `getState()`, and `importState(obj)` for agents with page-script access. An agent driving the browser on the tracker page may also set status dropdowns and notes fields directly — those edits are local UI state, always visible to the user, and safe to make without confirmation. Anything on a *broker's* site still follows the contract above.

## Quarterly recheck prompt pattern

```
It's recheck time. Here is my tracker state: {paste Copy state as JSON}.
For each broker in "Recheck due", search the site for my listing again.
If it's back, tell me so I can mark "Found listing" and we'll re-run the opt-out;
if still clear, I'll mark "Removed" to restart the 90-day clock.
Same conventions: I handle CAPTCHAs and confirm all submissions.
```
