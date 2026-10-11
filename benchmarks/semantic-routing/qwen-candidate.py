"""Official SentenceTransformer pooling through Semantic Router's encoder API."""
import json
from pathlib import Path
from typing import Any
from pydantic import PrivateAttr
from semantic_router import Route, SemanticRouter
from semantic_router.encoders.base import DenseEncoder, AsymmetricDenseMixin
from semantic_router.index import LocalIndex
from sentence_transformers import SentenceTransformer
from candidates import DESCRIPTIONS

class QwenEncoder(DenseEncoder, AsymmetricDenseMixin):
    _model: Any = PrivateAttr()
    def __init__(self,path):
        super().__init__(name=path,score_threshold=0.0)
        self._model=SentenceTransformer(path,device='cpu',local_files_only=True,trust_remote_code=False,
                                        model_kwargs={'use_safetensors':True},tokenizer_kwargs={'padding_side':'left'})
        self._model.max_seq_length=256
    def encode_documents(self,docs):
        return self._model.encode(docs,batch_size=4,normalize_embeddings=True,show_progress_bar=False).tolist()
    def encode_queries(self,docs):
        return self._model.encode(docs,batch_size=4,normalize_embeddings=True,show_progress_bar=False,
                                  prompt='Instruct: Given a user request, retrieve examples with the same task intent and required capabilities.\nQuery: ').tolist()
    def __call__(self,docs):
        return self.encode_documents(docs)

class QwenCandidate:
    def __init__(self,path,training):
        cases=json.loads(Path(training).read_text(encoding='utf-8'))['cases']
        routes=[Route(name=label,score_threshold=0.0,utterances=[c['objective'] for c in cases if label in c['required']]) for label in DESCRIPTIONS]
        self.router=SemanticRouter(encoder=QwenEncoder(path),routes=routes,index=LocalIndex(),aggregation='max',
                                   top_k=sum(len(r.utterances) for r in routes),auto_sync='local')
    def scores(self,objective):
        result=self.router(objective[:16384],limit=None)
        result=result if isinstance(result,list) else [result]
        return {r.name:float(r.similarity_score) for r in result if r.name is not None}
