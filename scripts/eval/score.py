#!/usr/bin/env python3
"""
Scanner accuracy, step 2: compare a scan run with the labelled answers.

  python3 scripts/eval/score.py runs/<run>.json labels.csv

labels.csv is the labelling sheet exported as CSV (columns include "Page", "Checkpoint ID",
"Your answer": Pass / Fail / Not applicable). Prints accuracy per checkpoint, worst first,
split into false fails (we say fail, the page passes: hurts credibility most) and false passes.
"""
import csv, json, sys
from collections import defaultdict

run = json.load(open(sys.argv[1]))
labels = {}
for row in csv.DictReader(open(sys.argv[2], encoding="utf-8")):
    ans = (row.get("Your answer") or "").strip().lower()
    if ans in ("pass", "fail"):
        labels[(row["Page"], row["Checkpoint ID"])] = ans == "pass"

stats = defaultdict(lambda: {"title": "", "right": 0, "false_fail": 0, "false_pass": 0})
for page in run["pages"]:
    for r in page["results"]:
        key = (page["id"], r["ruleId"])
        if key not in labels:
            continue
        s = stats[r["ruleId"]]
        s["title"] = r["title"]
        if r["passed"] == labels[key]:
            s["right"] += 1
        elif r["passed"]:
            s["false_pass"] += 1
        else:
            s["false_fail"] += 1

total = sum(s["right"] + s["false_fail"] + s["false_pass"] for s in stats.values())
right = sum(s["right"] for s in stats.values())
print(f"Overall: {right}/{total} right ({right / total:.0%})" if total else "No labelled answers yet")
print(f"{'right':>6} {'f.fail':>6} {'f.pass':>6}  checkpoint")
for rid, s in sorted(stats.items(), key=lambda kv: kv[1]["right"] / max(1, kv[1]["right"] + kv[1]["false_fail"] + kv[1]["false_pass"])):
    n = s["right"] + s["false_fail"] + s["false_pass"]
    print(f"{s['right']:>3}/{n:<2} {s['false_fail']:>6} {s['false_pass']:>6}  {s['title'][:80]}")
