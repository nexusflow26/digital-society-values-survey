"""
MIS20070 Digital Society 2026-27 - Changing Values: ternary plot aggregation

Collects every survey response (one dot for the present day, 2026, and one dot for 2060)
and produces:
  * responses.xlsx           - the dataset (Excel) used for the report
  * ternary_aggregated.png   - ONE ternary plot with every response shown as a dot
  * ternary_present.png / ternary_future.png - each period on its own
  * summary.txt              - descriptive statistics and significance tests

The three values sit on the triangle's vertices exactly as on the website:
  Economic and financial security (bottom-left), Environment (bottom-right), Community (top).

Usage
  python ternary_analysis.py --url https://<your-site>.vercel.app --key <ADMIN_KEY>
  python ternary_analysis.py --file output/responses.xlsx       (re-run on a saved dataset)
  python ternary_analysis.py --demo                             (synthetic test data only)
  add  --since 2026-10-05T12:00  to ignore test responses submitted before launch
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # render to files, no window needed
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats

VALUES = ["economic", "environment", "community"]
LABELS = {
    "economic": "Economic and financial security",
    "environment": "Environment",
    "community": "Community",
}
VALUE_COLOURS = {"economic": "#b8650a", "environment": "#2c8150", "community": "#5b4fc4"}
PERIODS = {"present": "Present day (2026)", "future": "2060 scenario"}
PERIOD_COLOURS = {"present": "#245b8f", "future": "#d1495b"}

# Triangle vertices in plot coordinates (same layout as the website)
VERTEX = {
    "economic": np.array([0.0, 0.0]),
    "environment": np.array([1.0, 0.0]),
    "community": np.array([0.5, np.sqrt(3) / 2]),
}

OUT_DIR = Path(__file__).resolve().parent / "output"


# ----------------------------------------------------------------------------- data loading
def fetch_from_site(url, key):
    """Download all responses from the website's admin export endpoint."""
    endpoint = url.rstrip("/") + "/api/responses?" + urllib.parse.urlencode({"key": key})
    with urllib.request.urlopen(endpoint, timeout=30) as resp:
        payload = json.load(resp)
    return records_to_frame(payload["responses"])


def records_to_frame(records):
    rows = []
    for r in records:
        row = {"id": r["id"], "submittedAt": r["submittedAt"]}
        for period in PERIODS:
            for v in VALUES:
                row[f"{period}_{v}"] = float(r[period][v])
        rows.append(row)
    return pd.DataFrame(rows)


def load_file(path):
    path = Path(path)
    if path.suffix.lower() in (".xlsx", ".xls"):
        return pd.read_excel(path, sheet_name="Responses")
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        return records_to_frame(data["responses"] if isinstance(data, dict) else data)
    sys.exit(f"Unsupported file type: {path.suffix}")


def make_demo_data(n=60, seed=7):
    """Synthetic responses for testing the script. NEVER use these in the report."""
    rng = np.random.default_rng(seed)
    present = rng.dirichlet([7, 2, 3], n) * 100   # today: economy-heavy
    future = rng.dirichlet([4, 4, 5], n) * 100    # 2060: more mixed
    df = pd.DataFrame({"id": [f"demo-{i:03d}" for i in range(n)],
                       "submittedAt": pd.Timestamp("2026-10-01").isoformat()})
    for i, v in enumerate(VALUES):
        df[f"present_{v}"] = present[:, i].round(1)
        df[f"future_{v}"] = future[:, i].round(1)
    return df


def clean(df):
    """Drop duplicate respondents and invalid rows; re-close each composition to 100%."""
    before = len(df)
    df = df.drop_duplicates(subset="id", keep="first").copy()
    cols = [f"{p}_{v}" for p in PERIODS for v in VALUES]
    df = df.dropna(subset=cols)
    for p in PERIODS:
        pc = [f"{p}_{v}" for v in VALUES]
        totals = df[pc].sum(axis=1)
        df = df[totals > 0]
        df[pc] = df[pc].div(df[pc].sum(axis=1), axis=0) * 100
    if len(df) != before:
        print(f"Note: removed {before - len(df)} duplicate/invalid rows.")
    return df.reset_index(drop=True)


# ----------------------------------------------------------------------------- statistics
def summarise(df):
    lines = [f"Responses analysed (n): {len(df)}", ""]
    table = []
    for v in VALUES:
        pres, fut = df[f"present_{v}"], df[f"future_{v}"]
        diff = fut - pres
        t_p = stats.ttest_rel(fut, pres).pvalue if len(df) > 1 else float("nan")
        try:
            w_p = stats.wilcoxon(fut, pres).pvalue
        except ValueError:
            w_p = float("nan")
        table.append({
            "Value": LABELS[v],
            "Present mean %": pres.mean(), "Present median %": pres.median(), "Present SD": pres.std(),
            "2060 mean %": fut.mean(), "2060 median %": fut.median(), "2060 SD": fut.std(),
            "Mean change (pts)": diff.mean(),
            "% respondents increasing": (diff > 0).mean() * 100,
            "Paired t-test p": t_p, "Wilcoxon p": w_p,
        })
    summary = pd.DataFrame(table)

    lines.append("Mean importance (%) - present vs 2060")
    for _, r in summary.iterrows():
        lines.append(
            f"  {r['Value']:<34} {r['Present mean %']:5.1f} -> {r['2060 mean %']:5.1f}  "
            f"(change {r['Mean change (pts)']:+5.1f} pts, median {r['Present median %']:.1f} -> {r['2060 median %']:.1f}, "
            f"{r['% respondents increasing']:.0f}% of people raised it; t-test p={r['Paired t-test p']:.3g}, Wilcoxon p={r['Wilcoxon p']:.3g})"
        )

    lines += ["", "Which value people ranked highest (count of respondents)"]
    dominant = {}
    for p, name in PERIODS.items():
        top = df[[f"{p}_{v}" for v in VALUES]].idxmax(axis=1).str.replace(f"{p}_", "", regex=False)
        counts = top.value_counts().reindex(VALUES, fill_value=0)
        dominant[name] = counts
        lines.append(f"  {name}: " + ", ".join(f"{LABELS[v]} {counts[v]} ({counts[v] / len(df) * 100:.0f}%)" for v in VALUES))
    dominant_df = pd.DataFrame(dominant).rename(index=LABELS)

    centre_dist = {}
    for p, name in PERIODS.items():
        d = np.sqrt(((df[[f"{p}_{v}" for v in VALUES]] - 100 / 3) ** 2).sum(axis=1))
        centre_dist[p] = d.mean()
    lines += ["", "Spread: mean distance from the 'all equal' centre (higher = more one-sided views)",
              f"  Present: {centre_dist['present']:.1f}   2060: {centre_dist['future']:.1f}"]
    lines += ["", "p < 0.05 means the present-vs-2060 difference is unlikely to be due to chance."]
    return summary, dominant_df, "\n".join(lines)


# ----------------------------------------------------------------------------- plotting
def to_xy(frame, period):
    fr = frame[[f"{period}_{v}" for v in VALUES]].to_numpy() / 100.0
    verts = np.stack([VERTEX[v] for v in VALUES])
    return fr @ verts


def draw_triangle(ax):
    corners = np.stack([VERTEX["economic"], VERTEX["environment"], VERTEX["community"], VERTEX["economic"]])
    for i in range(1, 10):
        t = i / 10
        for a, b, c in [("economic", "environment", "community"),
                        ("environment", "community", "economic"),
                        ("community", "economic", "environment")]:
            # line where value `a` is constant at t
            p1 = t * VERTEX[a] + (1 - t) * VERTEX[b]
            p2 = t * VERTEX[a] + (1 - t) * VERTEX[c]
            ax.plot([p1[0], p2[0]], [p1[1], p2[1]], color="#e3e0d8", lw=0.8, zorder=0)
        # tick labels (same positions as the website)
        p = t * VERTEX["community"] + (1 - t) * VERTEX["economic"]
        ax.text(p[0] - 0.02, p[1], f"{i * 10}%", ha="right", va="center", fontsize=7, color=VALUE_COLOURS["community"])
        p = t * VERTEX["economic"] + (1 - t) * VERTEX["environment"]
        ax.text(p[0], p[1] - 0.035, f"{i * 10}%", ha="center", va="top", fontsize=7, color=VALUE_COLOURS["economic"])
        p = t * VERTEX["environment"] + (1 - t) * VERTEX["community"]
        ax.text(p[0] + 0.02, p[1], f"{i * 10}%", ha="left", va="center", fontsize=7, color=VALUE_COLOURS["environment"])
    ax.plot(corners[:, 0], corners[:, 1], color="#1c2430", lw=1.4, zorder=1)
    ax.text(*(VERTEX["community"] + [0, 0.05]), LABELS["community"], ha="center", va="bottom",
            fontsize=11, fontweight="bold", color=VALUE_COLOURS["community"])
    ax.text(*(VERTEX["economic"] + [-0.03, -0.09]), "Economic and\nfinancial security", ha="left", va="top",
            fontsize=11, fontweight="bold", color=VALUE_COLOURS["economic"])
    ax.text(*(VERTEX["environment"] + [0.03, -0.09]), LABELS["environment"], ha="right", va="top",
            fontsize=11, fontweight="bold", color=VALUE_COLOURS["environment"])
    ax.set_xlim(-0.15, 1.15)
    ax.set_ylim(-0.22, 1.0)
    ax.set_aspect("equal")
    ax.axis("off")


def plot(df, periods, title, path, show_shift=False):
    fig, ax = plt.subplots(figsize=(8.5, 8))
    draw_triangle(ax)
    means = {}
    for p in periods:
        xy = to_xy(df, p)
        ax.scatter(xy[:, 0], xy[:, 1], s=46, color=PERIOD_COLOURS[p], alpha=0.65,
                   edgecolor="white", linewidth=0.8, zorder=3, label=f"{PERIODS[p]} (n={len(df)})")
        mean_frame = df[[f"{p}_{v}" for v in VALUES]].mean().to_frame().T
        means[p] = to_xy(mean_frame, p)[0]
        ax.scatter(*means[p], s=260, marker="*", color=PERIOD_COLOURS[p], edgecolor="black",
                   linewidth=1, zorder=5, label=f"{PERIODS[p]} - average")
    if show_shift and len(periods) == 2:
        ax.annotate("", xy=means["future"], xytext=means["present"], zorder=4,
                    arrowprops=dict(arrowstyle="-|>", color="#1c2430", lw=1.8, shrinkA=10, shrinkB=10))
    ax.set_title(title, fontsize=14, fontweight="bold", pad=12)
    ax.legend(loc="upper left", bbox_to_anchor=(0.0, 1.0), frameon=False, fontsize=9)
    fig.tight_layout()
    fig.savefig(path, dpi=200, facecolor="white")
    plt.close(fig)
    print(f"Saved {path}")


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="Aggregate the Digital Society survey into ternary plots.")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--url", default=os.environ.get("DS_SITE_URL"), help="Website URL (or set DS_SITE_URL)")
    src.add_argument("--file", help="Load a saved .xlsx / .csv / .json dataset instead of the website")
    src.add_argument("--demo", action="store_true", help="Use synthetic test data (outputs prefixed demo_)")
    ap.add_argument("--key", default=os.environ.get("DS_ADMIN_KEY"), help="ADMIN_KEY (or set DS_ADMIN_KEY)")
    ap.add_argument("--since", help="Ignore responses submitted before this UTC time, e.g. 2026-10-05T12:00 (drops test entries)")
    args = ap.parse_args()

    prefix = ""
    if args.demo:
        df, prefix = make_demo_data(), "demo_"
        print("*** DEMO MODE: synthetic data, do not use in the report ***")
    elif args.file:
        df = load_file(args.file)
    elif args.url:
        if not args.key:
            sys.exit("Please pass --key <ADMIN_KEY> (or set DS_ADMIN_KEY).")
        df = fetch_from_site(args.url, args.key)
    else:
        ap.error("give --url and --key, or --file, or --demo")

    if args.since:
        submitted = pd.to_datetime(df["submittedAt"], utc=True)
        keep = submitted >= pd.Timestamp(args.since, tz="UTC")
        print(f"--since {args.since}: ignoring {(~keep).sum()} earlier (test) responses.")
        df = df[keep]
    if df.empty:
        sys.exit("No responses yet.")
    df = clean(df)
    OUT_DIR.mkdir(exist_ok=True)

    summary, dominant, text = summarise(df)
    print("\n" + text + "\n")
    (OUT_DIR / f"{prefix}summary.txt").write_text(text, encoding="utf-8")

    # Excel dataset: wide (one row per respondent), long (one row per dot), and summary statistics
    long = pd.concat([
        df[["id", "submittedAt"] + [f"{p}_{v}" for v in VALUES]]
        .rename(columns={f"{p}_{v}": LABELS[v] for v in VALUES})
        .assign(Period=PERIODS[p])
        for p in PERIODS
    ], ignore_index=True)
    xlsx = OUT_DIR / f"{prefix}responses.xlsx"
    with pd.ExcelWriter(xlsx, engine="openpyxl") as xw:
        df.round(1).to_excel(xw, sheet_name="Responses", index=False)
        long.round(1).to_excel(xw, sheet_name="Long", index=False)
        summary.round(3).to_excel(xw, sheet_name="Summary", index=False)
        dominant.to_excel(xw, sheet_name="Summary", startrow=len(summary) + 3)
    print(f"Saved {xlsx}")

    plot(df, ["present", "future"], "Society's values: present day (2026) vs 2060",
         OUT_DIR / f"{prefix}ternary_aggregated.png", show_shift=True)
    plot(df, ["present"], "Society's values today (2026)", OUT_DIR / f"{prefix}ternary_present.png")
    plot(df, ["future"], "Society's values in 2060", OUT_DIR / f"{prefix}ternary_future.png")


if __name__ == "__main__":
    main()
