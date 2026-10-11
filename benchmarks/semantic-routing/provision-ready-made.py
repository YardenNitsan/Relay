"""Explicit pinned downloads for externally trained zero-shot classifiers."""
import argparse
import hashlib
import json
from pathlib import Path
from huggingface_hub import snapshot_download

ROOT=Path(__file__).resolve().parents[2]
MODELS={
    'mini':('knowledgator/gliclass-multilang-mini','0bd888b6c3ef9fca5f0a9d407bddfbbc7623486b'),
    'edge':('knowledgator/gliclass-multilang-edge','d16c08ef70547514081952104e6fc3d190d9ee39'),
}
parser=argparse.ArgumentParser()
parser.add_argument('--candidate',choices=MODELS,required=True)
args=parser.parse_args()
model,revision=MODELS[args.candidate]
directory=ROOT/'output/semantic-models'/model.split('/')[1]
snapshot_download(model,revision=revision,local_dir=directory,allow_patterns=[
    '*.json','*.safetensors','*.model','README.md','LICENSE*','NOTICE*',
])
assets=[]
for path in sorted(directory.iterdir()):
    if not path.is_file():continue
    sha=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):sha.update(chunk)
    assets.append({'name':path.name,'bytes':path.stat().st_size,'sha256':sha.hexdigest()})
manifest={'candidate':args.candidate,'model':model,'revision':revision,'path':str(directory),
          'purpose':'existing pretrained inference only; no Relay training','assets':assets}
(ROOT/f'output/final-evolution/gliclass-{args.candidate}-assets.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'model':model,'revision':revision,'files':len(assets),'bytes':sum(a['bytes'] for a in assets)}))
