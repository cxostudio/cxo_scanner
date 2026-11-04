#!/usr/bin/env python3
"""
Scanner accuracy, step 1: scan every test page and keep every answer.

  python3 scripts/eval/run.py --base https://<scanner deployment> [--only id1,id2] [--workers 3]

Writes scripts/eval/runs/<timestamp>.json. Compare a run with the labels (score.py) to get
accuracy per checkpoint; re-run after every engine change so a fix never breaks another check.
Uses the deployed API (same engine visitors get), one email per page (the daily scan limit is
per email).
"""
import argparse, json, os, ssl, time, urllib.request, urllib.error, concurrent.futures as cf
from datetime import datetime, timezone

ENGINE = ""
HERE = os.path.dirname(os.path.abspath(__file__))
ctx = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE") or None)

def call(url, body=None, timeout=330):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return json.loads(r.read())

def scan(base, page, rules, stamp):
    t0 = time.time()
    try:
        data = call(f"{base}/scan/api/scan", {"url": page["url"], "rules": rules, "captureScreenshot": False,
                                              "email": f"eval-{page['id']}-{stamp}@cxo.studio", "scanId": f"eval-{stamp}-{page['id']}", **({"engine": ENGINE} if ENGINE else {})})
        res = [{"ruleId": r["ruleId"], "title": r["ruleTitle"], "passed": r["passed"], "reason": r["reason"], **({"status": r["status"]} if "status" in r else {})} for r in data.get("results", [])]
        return {**page, "seconds": round(time.time() - t0), "results": res, "engine": data.get("engine", "v1"), "model": data.get("model"), "timings": data.get("timings")}
    except urllib.error.HTTPError as e:
        return {**page, "seconds": round(time.time() - t0), "error": f"{e.code} {e.read().decode()[:200]}", "results": []}
    except Exception as e:
        return {**page, "seconds": round(time.time() - t0), "error": str(e)[:300], "results": []}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--engine", default="", help="v1 or v2 (default: the deployment's SCAN_ENGINE)")
    a = ap.parse_args()
    global ENGINE
    ENGINE = a.engine
    pages = json.load(open(os.path.join(HERE, "pages.json")))
    if a.only:
        keep = set(a.only.split(","))
        pages = [p for p in pages if p["id"] in keep]
    rules = call(f"{a.base}/scan/api/conversion-checkpoints?pageType=product")["rules"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    print(f"{len(pages)} pages x {len(rules)} checkpoints", flush=True)
    out = []
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for r in ex.map(lambda p: scan(a.base, p, rules, stamp), pages):
            print(f"  {r['id']:<18} {r['seconds']:>4}s  {len(r['results'])} answers {r.get('error','')}", flush=True)
            out.append(r)
    os.makedirs(os.path.join(HERE, "runs"), exist_ok=True)
    path = os.path.join(HERE, "runs", f"{stamp}.json")
    json.dump({"base": a.base, "at": stamp, "engine": a.engine or "default", "rules": rules, "pages": out}, open(path, "w"), indent=1)
    print("saved", path)

if __name__ == "__main__":
    main()
