"""Development only: expanded consumed exemplars or larger pretrained NLI."""
import argparse
import json
import statistics
import time
from pathlib import Path
import psutil

ROOT=Path(__file__).resolve().parents[2]
BASE=Path(__file__).resolve().parent
OUT=ROOT/'output/final-evolution'
parser=argparse.ArgumentParser()
parser.add_argument('--candidate',choices=['minilm','e5','deberta','qwen'],required=True)
args=parser.parse_args()
training=[]
for path in [ROOT/'benchmarks/task-intent/development-v1.json',BASE/'development-v1.json',BASE/'heldout-v1.json']:
    training.extend(json.loads(path.read_text(encoding='utf-8'))['cases'])
train_path=BASE/'training-v3.json'
train_path.write_text(json.dumps({'provenance':'Consumed v1 datasets, no unseen claims','cases':training},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
cases=json.loads((BASE/'heldout-v2.json').read_text(encoding='utf-8'))['cases']
if psutil.virtual_memory().available<4*1024**3: raise RuntimeError('Insufficient free RAM')
process=psutil.Process();before=process.memory_info().rss;begin=time.perf_counter()
from candidates import SemanticCandidate,NliCandidate,DESCRIPTIONS
models=json.loads((OUT/'router-model-paths.json').read_text(encoding='utf-8'))
model_id={'minilm':'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2','e5':'intfloat/multilingual-e5-small','deberta':'MoritzLaurer/mDeBERTa-v3-base-mnli-xnli','qwen':'Qwen/Qwen3-Embedding-0.6B'}[args.candidate]
model=next(item for item in models if item['model']==model_id)
if args.candidate=='qwen':
    import importlib.util
    spec=importlib.util.spec_from_file_location('qwen_candidate',BASE/'qwen-candidate.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    candidate=module.QwenCandidate(model['path'],str(train_path))
else:
    candidate=NliCandidate(model['path']) if args.candidate=='deberta' else SemanticCandidate(model['path'],str(train_path),args.candidate=='e5')
initialization=(time.perf_counter()-begin)*1000
candidate.scores('Hello');rows=[]
for case in cases:
    start=time.perf_counter();scores=candidate.scores(case['objective'])
    rows.append({'id':case['id'],'scores':scores,'latencyMs':(time.perf_counter()-start)*1000})
thresholds={};insufficient=[]
for label in DESCRIPTIONS:
    positives=[r['scores'].get(label,-1) for c,r in zip(cases,rows) if label in c['required']]
    negatives=[r['scores'].get(label,-1) for c,r in zip(cases,rows) if label in c['forbidden']]
    if len(positives)<2 or len(negatives)<2:
        thresholds[label]={'minilm':.4,'e5':.85,'deberta':.5,'qwen':.6}[args.candidate];insufficient.append(label);continue
    def error(t):
        fp=sum(s>=t for s in negatives)/len(negatives);fn=sum(s<t for s in positives)/len(positives)
        return (fp+fn,fp,-t)
    thresholds[label]=min([x/100 for x in range(10,96,5)],key=error)
outcomes=[]
for case,row in zip(cases,rows):
    predicted=[label for label,threshold in thresholds.items() if row['scores'].get(label,-1)>=threshold]
    missing=sorted(set(case['required'])-set(predicted));forbidden=sorted(set(case['forbidden'])&set(predicted))
    outcomes.append({**row,'predicted':predicted,'missing':missing,'forbidden':forbidden,'satisfied':not missing and not forbidden})
latencies=sorted(r['latencyMs'] for r in rows)
report={'mode':'consumed-v2-development-only','candidate':args.candidate,'model':{k:model[k] for k in ['model','revision']},
        'thresholds':thresholds,'uncalibrated':insufficient,'satisfied':sum(r['satisfied'] for r in outcomes),'total':len(cases),
        'forbiddenLabels':sum(len(r['forbidden']) for r in outcomes),'missingRequired':sum(len(r['missing']) for r in outcomes),'outcomes':outcomes,
        'runtime':{'initializationMs':initialization,'rssBytes':process.memory_info().rss,'rssIncreaseBytes':process.memory_info().rss-before,
                   'p95Ms':latencies[int((len(latencies)-1)*.95)],'medianMs':statistics.median(latencies)}}
(OUT/f'semantic-{args.candidate}-development-v3.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:report[k] for k in ['candidate','satisfied','total','forbiddenLabels','missingRequired','runtime']}))
