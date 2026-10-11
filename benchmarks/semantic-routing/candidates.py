"""Adapters for existing pretrained inference libraries, never permission decisions."""
import os
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["CUDA_VISIBLE_DEVICES"] = ""

from pathlib import Path
import json
import torch
torch.set_num_threads(2)
torch.set_num_interop_threads(1)

DESCRIPTIONS = {
    "debugging": "diagnosing and repairing software defects",
    "coding": "writing or modifying computer source code",
    "repository_architecture": "understanding software architecture and repository dependencies",
    "multi_file_implementation": "implementing software changes across multiple components or files",
    "structured_extraction": "extracting information into a structured table or JSON",
    "document_analysis": "analyzing the contents of documents or contracts",
    "research_synthesis": "researching sources and synthesizing cited evidence",
    "tool_driven": "executing commands or using tools to perform actions",
    "planning_delegation": "planning a project and coordinating dependent work",
    "review_verification": "reviewing or testing work to verify correctness",
    "security_review": "auditing security vulnerabilities and authorization boundaries",
    "mathematics": "solving mathematical problems",
    "complex_reasoning": "reasoning through a complex problem or proving a result",
    "multimodal": "interpreting images, audio, or video",
    "factual_explanation": "explaining factual concepts or answering knowledge questions",
    "conversation": "casual social conversation and greetings",
}


class SemanticCandidate:
    def __init__(self, model_path: str, training_path: str, e5: bool = False):
        from semantic_router import Route, SemanticRouter
        from semantic_router.encoders import HuggingFaceEncoder
        from semantic_router.index import LocalIndex
        self.prefix = "query: " if e5 else ""
        training = json.loads(Path(training_path).read_text(encoding="utf-8"))["cases"]
        routes = [Route(name=label, score_threshold=0.0, utterances=[
            self.prefix + case["objective"] for case in training if label in case["required"]
        ]) for label in DESCRIPTIONS]
        encoder = HuggingFaceEncoder(
            name=model_path, device="cpu", score_threshold=0.0,
            tokenizer_kwargs={"local_files_only": True, "trust_remote_code": False, "model_max_length": 256},
            model_kwargs={"local_files_only": True, "trust_remote_code": False, "use_safetensors": True},
        )
        self.router = SemanticRouter(encoder=encoder, routes=routes, index=LocalIndex(),
                                     aggregation="max", top_k=sum(len(r.utterances) for r in routes), auto_sync="local")

    def scores(self, objective: str) -> dict[str, float]:
        # Static routes contain no function schemas or LLM: library call only
        # selects semantic matches, and cannot perform actions or cloud calls.
        result = self.router(self.prefix + objective[:16384], limit=None)
        result = result if isinstance(result, list) else [result]
        return {item.name: float(item.similarity_score) for item in result if item.name is not None}


class NliCandidate:
    def __init__(self, model_path: str):
        from transformers import AutoModelForSequenceClassification, AutoTokenizer, pipeline
        tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True, trust_remote_code=False)
        model = AutoModelForSequenceClassification.from_pretrained(
            model_path, local_files_only=True, trust_remote_code=False, use_safetensors=True)
        self.classifier = pipeline("zero-shot-classification", model=model, tokenizer=tokenizer, device=-1)
        self.labels = list(DESCRIPTIONS.values())
        self.reverse = {description: label for label, description in DESCRIPTIONS.items()}

    def scores(self, objective: str) -> dict[str, float]:
        result = self.classifier(objective[:16384], self.labels,
                                 hypothesis_template="This request involves {}.", multi_label=True)
        return {self.reverse[label]: float(score) for label, score in zip(result["labels"], result["scores"])}


def labels_for(scores: dict[str, float], threshold: float) -> list[str]:
    # Thresholds describe uncertainty, not probabilities of successful LLM work.
    return [label for label in DESCRIPTIONS if scores.get(label, -1) >= threshold]
