# Values under water: 2026 vs 2060

MIS20070 Digital Society 2026–27 group project, Part 3 Section 2 ("Changing values").

An anonymous survey website with **two ternary plots**: one for how society prioritises
**Economic and financial security**, **Environment** and **Community** today (2026), and one for the
2060 flooded-coast future scenario. Each respondent places one dot per plot and can submit once.
A Python script aggregates all responses into a single ternary plot, an Excel dataset and statistics.

```
public/index.html              the website (single file: HTML + CSS + JS)
api/                           Vercel serverless functions (submit, status, admin export)
analysis/ternary_analysis.py   Python aggregation + statistics
scripts/                       local dev server + API tests
```

## Run locally
```bash
npm run dev          # http://localhost:3000  (uses an in-memory store, data is lost on restart)
npm test             # API tests
```

## Deploy (GitHub + Vercel)
1. **GitHub:** create an empty repo on github.com (no README), then:
   ```bash
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. **Vercel:** sign in at vercel.com with GitHub → **Add New → Project** → import the repo.
   Framework preset **Other**, leave build settings empty → **Deploy**.
3. **Database:** in the Vercel project → **Storage** → **Create / Browse Marketplace** → **Upstash for Redis** (free plan)
   → connect it to this project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
4. **Secrets:** project → **Settings → Environment Variables**, add:
   - `ADMIN_KEY`: a long random password (used to download the data)
   - `IP_SALT`: any random string
5. **Redeploy** (Deployments → ⋯ → Redeploy) so the new variables are picked up.
6. Test: open the site, submit once, then visit `https://<site>.vercel.app/api/responses?key=<ADMIN_KEY>`.
   Note the time, so you can exclude test responses later with `--since`.

## Analyse the results (Python)
```bash
pip install -r analysis/requirements.txt
python analysis/ternary_analysis.py --url https://<site>.vercel.app --key <ADMIN_KEY> --since 2026-10-05T12:00
```
Outputs in `analysis/output/`:
- `ternary_aggregated.png`: every response as a dot (present = blue, 2060 = red), averages as stars and an arrow for the shift
- `ternary_present.png`, `ternary_future.png`: each period alone
- `responses.xlsx`: the dataset for the report (sheets: Responses, Long, Summary)
- `summary.txt`: means, medians, changes, t-test / Wilcoxon p-values, most-prioritised value counts

Re-run on a saved dataset with `--file analysis/output/responses.xlsx`; try the script without real data using `--demo`.

## Privacy and one-response rule
No names, emails or demographics are collected. Duplicate submissions are blocked by an anonymous
browser ID (checked server-side with an atomic Redis `SET NX`), a one-year HttpOnly cookie, and a
hashed-IP rate limit (10/hour, so people on shared campus Wi-Fi are not blocked). Someone using a
different browser or incognito window could still answer twice; that is the trade-off for not
requiring a login.
