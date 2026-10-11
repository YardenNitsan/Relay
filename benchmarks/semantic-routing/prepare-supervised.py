"""Prepare label-blind consumed inputs; never rewrite historical datasets."""
import hashlib
import json
import os
from pathlib import Path

os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
os.environ['TOKENIZERS_PARALLELISM']='false'
os.environ['CUDA_VISIBLE_DEVICES']=''
ROOT=Path(__file__).resolve().parents[2]
BASE=Path(__file__).resolve().parent
MODEL='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
REVISION='e8f8c211226b894fcb81acc59f3b34ba3efd5f42'
RUBRIC='d3442d57f1184b92b79698734e4b02c37541addb8a5aabbbdbe0d82217b837dd'
digest=lambda value:hashlib.sha256(value).hexdigest()
rubric=BASE/'annotation-rubric-v4.md'
if digest(rubric.read_bytes())!=RUBRIC:
    raise RuntimeError('Annotation rubric differs from its pre-annotation freeze')
paths=json.loads((ROOT/'output/final-evolution/router-model-paths.json').read_text(encoding='utf-8'))
model=next(item for item in paths if item['model']==MODEL and item['revision']==REVISION)
from transformers import AutoTokenizer
tokenizer=AutoTokenizer.from_pretrained(model['path'],local_files_only=True,trust_remote_code=False)
rows=[]
sources=[]
for name in ['training-v3.json','heldout-v2.json']:
    raw=(BASE/name).read_bytes()
    sources.append({'path':name,'sha256':digest(raw)})
    for case in json.loads(raw)['cases']:
        original=case['objective']
        bounded=original[:16384]
        tokens=tokenizer(bounded,add_special_tokens=True)['input_ids']
        # Truncated items are retained for auditing, excluded before annotation.
        # No guessed reconstruction or invisible suffix supplies reference labels.
        valid=len(tokens)<=256 and bounded==original
        rows.append({'id':f'consumed-{len(rows)+1:03d}','source':name,'sourceId':case['id'],
                     'language':case['language'],'objective':bounded if valid else None,
                     'originalSha256':digest(original.encode()),'tokenCount':len(tokens),
                     'inputDisposition':'ready' if valid else 'excluded_truncation',
                     'effectiveSha256':digest(bounded.encode()) if valid else None})
report={'schemaVersion':1,'mode':'consumed-development-only','annotators':'independent AI reviewers; no human adjudication claimed',
        'rubricSha256':RUBRIC,'sources':sources,
        'preprocessing':{'fields':['objective'],'normalization':'none','maxCharacters':16384,'maxTokens':256,
                         'specialTokens':True,'truncation':'exclude from this development corpus; production handling unimplemented',
                         'model':MODEL,'revision':REVISION,'tokenizerClass':type(tokenizer).__name__},'cases':rows}
output=BASE/'supervised-inputs-v4.json'
with output.open('x',encoding='utf-8',newline='\n') as stream:
    stream.write(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'rows':len(rows),'excluded':sum(row['inputDisposition']!='ready' for row in rows),'sha256':digest(output.read_bytes())}))
