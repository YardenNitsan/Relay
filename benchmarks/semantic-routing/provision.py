"""Explicit experiment provisioning; never called by Relay or during inference."""
import argparse
import json
from pathlib import Path
from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parents[2]
MODELS = [
    ('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2','e8f8c211226b894fcb81acc59f3b34ba3efd5f42'),
    ('intfloat/multilingual-e5-small','614241f622f53c4eeff9890bdc4f31cfecc418b3'),
    ('MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli','0a71e92a985b6e1ad1828cf67ce9c459639c1dca'),
]
parser = argparse.ArgumentParser()
parser.add_argument('--include-deberta',action='store_true')
parser.add_argument('--include-qwen',action='store_true')
args = parser.parse_args()
if args.include_deberta:
    name='MoritzLaurer/mDeBERTa-v3-base-mnli-xnli'
    MODELS.append((name,'8adb042d524ecd5c26d3e3ba0e3fbcf7e2d0864c'))
if args.include_qwen:
    name='Qwen/Qwen3-Embedding-0.6B'
    MODELS.append((name,'97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3'))
paths=[]
for name,revision in MODELS:
    path=ROOT/'output/semantic-models'/name.split('/')[-1]
    snapshot_download(name,revision=revision,local_dir=str(path),allow_patterns=['*.json','*.safetensors','*.model','*.txt','README.md','LICENSE'],ignore_patterns=['onnx/*','openvino/*'])
    paths.append({'model':name,'revision':revision,'path':str(path)})
out=ROOT/'output/final-evolution/router-model-paths.json'
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(paths,indent=2)+'\n',encoding='utf-8')
print(json.dumps([{k:item[k] for k in ['model','revision']} for item in paths]))
