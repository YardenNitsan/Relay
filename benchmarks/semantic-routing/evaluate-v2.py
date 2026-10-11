"""Frozen second experiment: unchanged pretrained encoder, calibrated routes."""
import hashlib
import importlib.metadata
import json
import platform
import statistics
import subprocess
import sys
import time
from pathlib import Path
import psutil

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/final-evolution'
BASE = Path(__file__).resolve().parent

def digest(path):
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()

manifest = json.loads((BASE / 'freeze-v2.json').read_text(encoding='utf-8'))
for name, expected in manifest['hashes'].items():
    if digest(ROOT / name) != expected:
        raise RuntimeError(f'Frozen input changed: {name}')
if psutil.virtual_memory().available < 3 * 1024 ** 3:
    raise RuntimeError('Insufficient free RAM for CPU experiment')
corpus = BASE / 'heldout-v2.json'
subprocess.run(['node', '--import', 'tsx', str(BASE / 'baseline.ts'), str(corpus), str(OUT / 'semantic-baseline-heldout-v2.json')], cwd=ROOT, check=True)
config = json.loads((BASE / 'calibration-v2.json').read_text(encoding='utf-8'))
process = psutil.Process()
before = process.memory_info().rss
start = time.perf_counter()
from candidates import SemanticCandidate, NliCandidate
models = json.loads((OUT / 'router-model-paths.json').read_text(encoding='utf-8'))
name = config['selected']
model = models[['minilm', 'e5', 'nli'].index(name)]
assert {k:model[k] for k in ['model','revision']} == manifest['model']
candidate = NliCandidate(model['path']) if name == 'nli' else SemanticCandidate(model['path'], str(ROOT / 'benchmarks/task-intent/development-v1.json'), name == 'e5')
init = (time.perf_counter() - start) * 1000
candidate.scores('Hello')
cases = json.loads(corpus.read_text(encoding='utf-8'))['cases']
outcomes = []
for case in cases:
    begin = time.perf_counter()
    scores = candidate.scores(case['objective'])
    latency = (time.perf_counter() - begin) * 1000
    predicted = [label for label, threshold in config['thresholds'].items() if scores.get(label, -1) >= threshold]
    missing = sorted(set(case['required']) - set(predicted))
    forbidden = sorted(set(case['forbidden']) & set(predicted))
    outcomes.append({'id':case['id'],'language':case['language'],'predicted':predicted,'scores':scores,
                     'missing':missing,'forbidden':forbidden,'satisfied':not missing and not forbidden,
                     'uncertain':not predicted,'latencyMs':latency})
latencies = sorted(row['latencyMs'] for row in outcomes)
metrics = {'total':len(outcomes),'satisfied':sum(r['satisfied'] for r in outcomes),
           'missingRequired':sum(len(r['missing']) for r in outcomes),'forbiddenLabels':sum(len(r['forbidden']) for r in outcomes),
           'uncertain':sum(r['uncertain'] for r in outcomes),'languages':{lang:{'satisfied':sum(r['satisfied'] for r in outcomes if r['language']==lang),'total':sum(r['language']==lang for r in outcomes)} for lang in ['en','he']}}
runtime = {'os':platform.platform(),'python':platform.python_version(),'packages':{p:importlib.metadata.version(p) for p in ['semantic-router','transformers','torch']},
           'device':'cpu','threads':2,'initializationMs':init,'rssBytes':process.memory_info().rss,'rssIncreaseBytes':process.memory_info().rss-before,
           'peakWorkingSetBytes':getattr(process.memory_info(),'peak_wset',None),'medianMs':statistics.median(latencies),'p95Ms':latencies[int((len(latencies)-1)*.95)]}
baseline = json.loads((OUT / 'semantic-baseline-heldout-v2.json').read_text(encoding='utf-8'))['metrics']
gate = manifest['gate']
checks = {'improvement':metrics['satisfied']-baseline['satisfied']>=gate['minimumImprovement'],
          'minimumSatisfied':metrics['satisfied']/metrics['total']>=gate['minimumSatisfiedFraction'],
          'languages':all(metrics['languages'][l]['satisfied']>=baseline['languages'][l]['satisfied'] for l in ['en','he']),
          'forbidden':metrics['forbiddenLabels']<=baseline['forbiddenLabels']+gate['maximumExtraForbidden'],
          'latency':runtime['p95Ms']<gate['p95LimitMs'],'memory':runtime['rssBytes']<gate['rssLimitBytes'],
          'initialization':runtime['initializationMs']<gate['initializationLimitMs']}
report = {'candidate':name,'model':manifest['model'],'mode':'frozen-test-v2','thresholds':config['thresholds'],'metrics':metrics,
          'runtime':runtime,'baseline':baseline,'checks':checks,'passed':all(checks.values()),'outcomes':outcomes,
          'limits':'Partial required/forbidden synthetic intent labels, not exact-match accuracy or downstream model task success. GPU not sampled; inference configured CPU only.'}
(OUT / 'semantic-heldout-v2.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:report[k] for k in ['candidate','metrics','baseline','runtime','checks','passed']}))
sys.exit(0 if report['passed'] else 2)
