# Data Broker Opt-Out Tracker

A self-hosted, no-server tracker for getting your personal information off data-broker sites — the core value of paid services like Incogni (systematic opt-outs + re-monitoring), as a static web page you own.

**Privacy story: nothing leaves your browser.** No server, no accounts, no telemetry, no analytics. Your profile and progress live in your browser's `localStorage` and in JSON files you export yourself. The repo contains only public broker data.

**Use it:** open the GitHub Pages site, or clone and open `index.html` straight from disk (`file://` works), or run any static file server.

## The workflow (the app is just the scoreboard)

1. **Set up a dedicated email alias** for opt-outs (e.g. `optouts.you@yourdomain`), with a forwarding rule into your inbox. Verification links and compliance replies stay corralled, and you can kill the alias later.
2. **Fill in your profile** (name, city, state, email) — stored locally only.
3. **Scan for your listings.** Hit **Start scan** to step through every tier-1 site: each step gives you a direct search-my-name link (where the site's URL scheme allows), the opt-out page, and a `site:`-scoped web search, plus *Found listing / No listing* buttons that record the result and advance. Or hand the **Copy scan prompt** output to your AI agent for a read-only sweep (see below). Each broker row also has its own **Find my listing** link.
4. **Do the cascading opt-outs first.** The list is already in the right order:
   - **PeopleConnect suppression center** — one suppression covers Intelius, TruthFinder, Instant Checkmate, and US Search. ⚠️ **Suppress, don't delete:** their "right to delete" deletes your suppression account *and the suppressions with it*. Keep the account on file.
   - **BeenVerified** — clears sister sites (PeopleLooker, NeighborWho, Ownerly, NumberGuru).
   - **SmartBackgroundChecks / PeopleFinders** — same parent; one usually clears the other.
5. **Work down the tier-1 list.** Some (TruePeopleSearch especially) will have cleared on their own after the cascades — re-check before submitting.
6. **Tier 2 brokers** (Acxiom, LexisNexis, Epsilon, CoreLogic, Experian Marketing, Thomson Reuters CLEAR) have no public listings — use their privacy portals or send the generated **deletion letter**.
7. **Expect 1–45 days per broker.** Statutory response windows are typically 45 days; several brokers (Radaris, MyLife) are notorious for needing repeat rounds.
8. **Recheck every 90 days.** When you mark a broker *Removed*, the tracker schedules a recheck; overdue entries flip to *Recheck due* automatically (and show up in the next scan; a still-clear answer restarts the 90-day clock). Data brokers re-scrape public records — removal is a subscription you pay in attention.

## Features

- Status tracking per broker (`Not checked → Found listing → Request sent → Removed → Recheck due`) with timestamps and notes
- **Scan mode**: guided step-through of every people-search site with per-site search links; results recorded as you go
- Dashboard counts and cascade-first ordering
- **Deletion letter generator** with a state dropdown citing the right statute (CCPA/CPRA, VCDPA, MODPA, TDPSA, …) and a `mailto:` deep link for email-method brokers
- **JSON export/import** of full state (also accepts the older prototype export format)
- **Agent prompts** for AI-assisted opt-outs (see below)
- `brokers.json` and `statutes.json` are standalone, PR-able data files

## Using this with your AI agent

A web page cannot — and should not — command your browser agent directly: agents rightly treat page content as data, not instructions (that's what keeps prompt injection at bay). So this app generates prompts **you** hand to your own agent. Human-in-the-loop by design.

- **Copy scan prompt**: a read-only sweep — the agent searches every unchecked tier-1 site for your listing and reports found/not-found per site, no forms submitted. The perfect first agent task: low-stakes, no confirmations needed.
- **Copy agent prompt** (per broker): a self-contained, agent-agnostic prompt with the URL, the known gotchas, and safety conventions baked in. Paste into Claude, ChatGPT/Atlas, or any agent with browser access. "Open in Claude / ChatGPT" links prefill the same prompt.
- **Copy session prompt**: bundles everything currently in *Found listing* or *Recheck due*, in cascade order, into one batch prompt.
- **Copy state as JSON**: machine-readable status summary an agent can read (and tell you how to update).

**What automates well:** navigating opt-out flows, finding your listing, filling forms, drafting deletion emails, watching an inbox for verification links.
**What stays human:** CAPTCHAs, the final click on any submission, and anything touching identity documents or payment. That second list is by design — these flows involve your legal identity, and the prompts explicitly instruct agents to stop and hand back control at those points.

**Claude users:** this repo ships a skill at [`skill/broker-optout/`](skill/broker-optout/SKILL.md) that teaches Claude the full workflow (cascade order, per-broker gotchas, verification-email handling, status updates, quarterly rechecks) — copy the folder into `~/.claude/skills/` or your project's `.claude/skills/`. Other agents can be pointed at [`CLAUDE.md`](CLAUDE.md), which documents the same conventions in plain markdown.

## Repo hygiene: no personal data, ever

- Profile + progress exist only in `localStorage` and files you export.
- `.gitignore` blocks `*progress*.json` and `profile*.json` from the first commit — git history is forever once pushed.
- `sample-progress.json` (fake data) is the only progress file that belongs in the repo; use it to demo the import flow.

## Data files & contributing

- [`brokers.json`](brokers.json) — the broker list: opt-out URLs, method, gotcha notes, cascade relationships, `lastVerified` dates. PRs welcome; please update `lastVerified` and run `node scripts/sync-data.mjs` (regenerates the `brokers.js`/`statutes.js` mirrors that let the app run from `file://`).
- [`statutes.json`](statutes.json) — state → privacy-statute map for the letter generator.
- A weekly GitHub Action link-checks every opt-out URL and files an issue when links rot (the main failure mode of broker lists). Schema validation runs on every PR.

## Attribution & license

Broker list and opt-out details adapted from the **[Big Ass Data Broker Opt-Out List](https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List)** by Yael Grauer and contributors, licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). In keeping with that license, this project is **non-commercial** and released under **CC BY-NC-SA 4.0** as well ([LICENSE.md](LICENSE.md)). Found a broken or changed opt-out flow? Please also contribute the correction upstream to BADBOOL.

## Disclaimer

Not legal advice. Opt-out results vary by broker and reappearance is common; statutes and URLs change. This tool tracks your requests — it can't guarantee any broker honors them.
