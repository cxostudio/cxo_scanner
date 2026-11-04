"""Merge scanner answers with the blind manual review into one labelling CSV.

Usage: python3 merge_review.py <out.csv>
Scanner answers: latest run per page (runs/*.json, newest first wins).
Review: review/<page>/verdicts.json.
"Check this" = review disagrees with the scanner, or review confidence is low,
or the two scanner runs disagreed with each other.
"""
import csv, glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
pages = json.load(open(os.path.join(HERE, 'pages.json')))
snap = json.load(open(os.path.join(HERE, '../../lib/conversionCheckpoints/checkpoints.snapshot.json')))['records']
prio = {r['id']: r['fields'].get('Priority Level', '') for r in snap}
EXCLUDE = {'lugarde'}  # bot wall: neither the scanner nor the review saw the product page

runs = sorted(glob.glob(os.path.join(HERE, 'runs', '*.json')), reverse=True)
latest, history = {}, {}
for path in runs:
    run = json.load(open(path))
    for p in run['pages']:
        if not p['results']:
            continue
        # a page is only valid in runs that scanned its current URL
        cur = next((x['url'] for x in pages if x['id'] == p['id']), None)
        if p['url'] != cur:
            continue
        latest.setdefault(p['id'], p)
        for r in p['results']:
            history.setdefault((p['id'], r['ruleId']), set()).add(r['passed'])

clean = lambda s: re.sub(r'\s+in( visible product( page sections?)?)?\.?$', '', s.strip())
rows, missing = [], []
for page in pages:
    pid = page['id']
    if pid in EXCLUDE:
        continue
    vpath = os.path.join(HERE, 'review', pid, 'verdicts.json')
    if pid not in latest or not os.path.exists(vpath):
        missing.append(pid)
        continue
    verdicts = {v['ruleId']: v for v in json.load(open(vpath))}
    for r in latest[pid]['results']:
        said = 'Pass' if r['passed'] else 'Fail'
        v = verdicts.get(r['ruleId'], {})
        mine = v.get('answer', '')
        conf = v.get('confidence', '')
        flip = len(history.get((pid, r['ruleId']), ())) > 1
        agree = mine == said
        flags = []
        if mine and not agree:
            flags.append('Claude disagrees' if mine != 'Not applicable' else 'Not applicable?')
        if conf == 'low':
            flags.append('Claude unsure')
        if flip:
            flags.append('Scanner flipped between runs')
        rows.append([
            pid, page['url'], r['title'], prio.get(r['ruleId'], ''), said, clean(r['reason']),
            mine, conf, v.get('evidence', ''), 'Yes' if flags else '', '; '.join(flags),
            mine or said, '', r['ruleId'],
        ])

with open(sys.argv[1], 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['Page', 'Product page', 'Checkpoint', 'Priority', 'Scanner said', 'What the scanner saw',
                "Claude's answer", 'Confidence', 'What Claude saw', 'Check this?', 'Why check',
                'Final answer', 'Note', 'Checkpoint ID'])
    w.writerows(rows)

n = len(rows)
agree = sum(1 for r in rows if r[6] == r[4])
na = sum(1 for r in rows if r[6] == 'Not applicable')
judged = [r for r in rows if r[6] in ('Pass', 'Fail')]
print(f'{n} rows, missing review for: {missing or "none"}')
print(f'scanner = Claude on {agree}/{n}; on Pass/Fail rows {sum(r[6]==r[4] for r in judged)}/{len(judged)} = {sum(r[6]==r[4] for r in judged)/max(1,len(judged)):.0%}; Not applicable {na}')
print(f'rows to check: {sum(1 for r in rows if r[9])}')
