# CLAUDE.md — Digital Society "Changing Values" website

This file is the working spec for this project. Follow it when building or changing anything.
Source documents (in this folder, not committed to git):
- `MIS20070 Project Brief 2026-27 Sept 7.pdf` — the UCD MIS20070 group assignment brief (Part 3, Section 2 is what this repo delivers).
- `Digital Society Website .pdf` — the group's chosen scenario, values and website requirements.

## 1. What we are building (from the brief — non-negotiable)

1. **A website featuring ternary plots**, one of the three values at each vertex.
   We build **one website containing two ternary plots**:
   - Plot 1 — **Present day (2026)**: how much importance society *currently* places on each value.
   - Plot 2 — **2060** (the year the future scenario is set): how these values will be prioritised in that future world.
2. Respondents indicate relative importance by **placing a single dot on each plot**.
3. **Each respondent submits one response for the present and one for 2060.**
4. **Only one submission per ternary plot per respondent** must be accepted (enforced server-side, not just in the browser).
5. Collect **at least 50 responses**.
6. **A Python program** aggregates all responses into **a single ternary plot, each input shown as a dot**.
7. The report section needs (so the repo must make each of these easy to produce):
   - screen grab of the aggregated ternary plot → `analysis/output/ternary_aggregated.png`
   - 250–350 word analysis of results → statistics printed by the Python script + `analysis/output/summary.txt`
   - link to the website → the Vercel URL
   - link to the dataset **as an Excel file** → `analysis/output/responses.xlsx`
   - the Python code (copy/paste) → `analysis/ternary_analysis.py` (keep it as one self-contained, readable file)
   - the HTML code of the website (copy/paste) → `index.html` (keep it as one self-contained file: inline CSS + JS)

## 2. Scenario and values (from "Digital Society Website.pdf" — use this wording)

**The three values** (vertices, always in this order and with these labels):
| Key           | Label                               | Vertex       | Colour token |
|---------------|-------------------------------------|--------------|--------------|
| `economic`    | Economic and financial security     | bottom-left  | amber        |
| `environment` | Environment                         | bottom-right | green        |
| `community`   | Community                           | top          | blue/purple  |

**The future world (2060)** — show this text verbatim on the site before Plot 2:

> By 2060, as extreme climate change became apparent, with rising sea levels and flooding, private insurers began refusing to insure the worst-affected land. This had a knock-on effect: no insurance meant no mortgages, causing a crash in the property market. Houses in these areas became practically worthless, driving up prices further inland and causing an influx of migrants moving inland. Coastal cities became full of people too poor to leave, minimally governed and severely neglected. The contrast not only in life expectancy but also in available facilities and quality of life grew strikingly obvious, driven by the varying population density.

## 3. Architecture

```
index.html               Static single-page site (survey). Inline CSS + JS, no build step, no frameworks.
api/submit.js            POST — validates and stores one response (present + 2060) per respondent.
api/status.js            GET  — tells the page whether this browser has already submitted.
api/responses.js         GET  — admin-only export (JSON or CSV), protected by ADMIN_KEY.
api/_lib.js              Shared helpers: Upstash Redis REST client, validation, cookies, hashing.
analysis/ternary_analysis.py   Python: fetch/load responses → Excel + aggregated ternary plot + statistics.
analysis/requirements.txt      Python deps (pandas, numpy, matplotlib, openpyxl, scipy).
vercel.json              Headers / function config.
```

- **Hosting:** Vercel (static `index.html` at the repo root + Node serverless functions in `api/`). Code on GitHub; Vercel deploys from the GitHub repo.
- **Storage:** Upstash Redis (free tier, added through the Vercel Marketplace → "Upstash for Redis"). Accessed via its REST API with plain `fetch` — **no npm dependencies**. Env vars: `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`; both names supported).
- **Admin export:** `ADMIN_KEY` env var (long random string). `GET /api/responses?key=...&format=csv|json`.
- If Redis env vars are missing the API falls back to an in-memory store **for local testing only** and says so in responses (`"storage":"memory"`).

### Data model (Redis)
- `resp:<respondentId>` → JSON record, written with `SET NX` (this is the one-submission guarantee).
- `responses` (list) → every accepted record, appended only after `SET NX` succeeds.
- `rl:<ipHash>` → per-hour rate-limit counter (anti-spam; IP is hashed with a salt and **never stored with responses**).

Record shape (percentages, each 0–100, each plot sums to 100, 1 decimal place):
```json
{ "id": "uuid", "submittedAt": "ISO-8601",
  "present": {"economic": 50.0, "environment": 20.0, "community": 30.0},
  "future":  {"economic": 35.5, "environment": 40.0, "community": 24.5} }
```

### One-submission-per-plot enforcement (layered)
1. Browser generates an anonymous UUID stored in `localStorage`.
2. Server rejects the UUID if `resp:<id>` already exists (`SET NX`) → HTTP 409.
3. Server sets an HttpOnly cookie `ds_submitted` (1 year) and rejects any submit carrying it → survives clearing localStorage.
4. Page calls `/api/status` on load and locks both plots if already submitted.
5. Hashed-IP rate limit (max 10 submits/hour) stops scripted spam. Do **not** hard-block by IP — many respondents share UCD Wi-Fi.
Known limitation (mention in report): a determined person using a different browser/incognito could submit again; no login is used because collecting identities would conflict with anonymity.

## 4. Website UX rules
- Order on page: header → short intro + consent/anonymity note → "How to read a ternary plot" mini-guide → Plot 1 (Present, 2026) → scenario text → Plot 2 (2060) → Submit → thank-you state.
- Click/tap anywhere in the triangle to place the dot; drag to adjust; clicks just outside snap to the nearest edge. Exactly **one dot per plot**.
- Show live percentages for all three values under each plot (sum = 100%).
- Grid lines every 10% with faint labels so people can read positions.
- Submit stays disabled until both dots are placed. One submit sends both plots.
- After submission (or if already submitted) both plots are locked and a thank-you message is shown.
- Mobile-friendly (pointer events, responsive SVG, ≥44px touch targets), keyboard-accessible (arrow keys move the focused dot), light + dark mode.
- **No personal data** collected (no name, email, demographics). State this on the page. Do not show aggregate results on the page (it would bias answers).

## 5. Python analysis rules (`analysis/ternary_analysis.py`)
- Inputs: `--url <site> --key <ADMIN_KEY>` (live fetch) **or** `--file <xlsx|csv|json>`; `--demo` makes synthetic data for testing only (outputs prefixed `demo_` so it can never be confused with real data).
- Outputs in `analysis/output/`:
  - `responses.xlsx` — sheets `Responses` (one row per respondent, both plots), `Long` (one row per dot), `Summary` (stats).
  - `ternary_aggregated.png` — **single ternary plot**, every response as a dot: present = one colour, 2060 = another, plus mean markers and an arrow showing the average shift.
  - `ternary_present.png`, `ternary_future.png` — each period alone (handy for the report).
  - `summary.txt` — the statistics printed to the console.
- Statistics: n, mean / median / std per value per period, mean change present→2060, paired t-test + Wilcoxon per value, which value dominates (count of respondents whose highest value is X) per period.
- Triangle orientation must match the website (Economic bottom-left, Environment bottom-right, Community top).

## 6. Deployment checklist
1. `git init`, commit, push to a GitHub repo (PDFs are git-ignored — they are course material).
2. Vercel → New Project → import the GitHub repo (framework preset: **Other**, no build command).
3. Vercel → Storage / Marketplace → add **Upstash for Redis** and connect it to the project (sets `KV_REST_API_*`).
4. Vercel → Settings → Environment Variables → add `ADMIN_KEY` and `IP_SALT` (random strings).
5. Redeploy, open the site, submit a test response, check `/api/responses?key=...`, then delete test data (see README).
6. Share the URL; collect ≥ 50 responses; run the Python script.

## 7. Conventions
- Keep `index.html` a single self-contained file (it is pasted into the report).
- Keep the Python script a single self-contained file (it is pasted into the report), well commented.
- No secrets in the repo. `.env*` and `analysis/output/` are git-ignored.
- Test changes locally with `node scripts/test-api.js` (API logic) and `python analysis/ternary_analysis.py --demo` before pushing.
