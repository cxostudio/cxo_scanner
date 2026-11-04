"""Accuracy of a scanner run against the manual review (review/<page>/verdicts.json).

  python3 score_review.py runs/<a>.json [runs/<b>.json ...]

Only rows where the review answered Pass or Fail count. A scanner "not relevant" counts
as a pass (that is how the results page treats it). Pages whose URL changed are skipped.
"""
import collections, glob, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ver = {}
for f in glob.glob(os.path.join(HERE, 'review/*/verdicts.json')):
    pid = f.split(os.sep)[-2]
    for v in json.load(open(f)):
        ver[(pid, v['ruleId'])] = v
urls = {p['id']: p['url'] for p in json.load(open(os.path.join(HERE, 'pages.json')))}
for path in sys.argv[1:]:
    run = json.load(open(path))
    ok = n = ff = fp = unk = 0
    per = collections.defaultdict(lambda: [0, 0])
    pages = 0
    for p in run['pages']:
        if not p['results'] or p['url'] != urls.get(p['id']):
            if p.get('error'): print(f"   {p['id']}: {p['error'][:120]}")
            continue
        pages += 1
        for r in p['results']:
            v = ver.get((p['id'], r['ruleId']))
            if not v or v['answer'] not in ('Pass', 'Fail'):
                continue
            n += 1
            truth = v['answer'] == 'Pass'
            if r.get('status') == 'unknown': unk += 1
            good = truth == r['passed']
            ok += good
            if not good:
                if truth: ff += 1
                else: fp += 1
            per[r['title'][:70]][0] += 1
            per[r['title'][:70]][1] += good
    print(f"{os.path.basename(path)} [{run.get('engine','v1')}] {pages} pages: {ok}/{n} = {ok/max(1,n):.1%}  false fails {ff}, false passes {fp}, couldn't check {unk}")
    if '--detail' in os.environ.get('SCORE', ''):
        for k, (t, g) in sorted(per.items(), key=lambda x: x[1][1] / x[1][0])[:15]:
            print(f"   {g/t:4.0%} {k}")
