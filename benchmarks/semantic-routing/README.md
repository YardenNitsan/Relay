# Pretrained intent experiments

No candidate passed promotion. The owner requires an existing ready-made pretrained tool and forbids a Relay-trained classifier/head. These scripts are deliberately separate from production Relay and its package dependencies. They cannot load inference models through Relay or authorize tools. Read `protocol.md`, `protocol-v2.md` and [router-replacement.md](../../docs/final-evolution/router-replacement.md) before interpreting scores.

Use a disposable Python environment. `requirements.lock` records the original Windows experiment environment, not a universal cross-platform lock or the newer ready-made environment. Models and environments live under ignored `output/`, not in the product. Provisioning explicitly downloads pinned public model files; inference adapters use offline CPU execution and two threads. GLiClass disables remote model code. Vela explicitly imports its downloaded, hash-verified upstream implementation; it does not use a remote-code autoloader or HTTP server.

From the repository root, after installing the reference environment dependencies:

```powershell
python -m venv output/semantic-router-venv
output/semantic-router-venv/Scripts/python.exe -m pip install -r benchmarks/semantic-routing/requirements.lock
output/semantic-router-venv/Scripts/python.exe benchmarks/semantic-routing/provision.py --include-deberta --include-qwen
output/semantic-router-venv/Scripts/python.exe benchmarks/semantic-routing/run-frozen.py
output/semantic-router-venv/Scripts/python.exe benchmarks/semantic-routing/evaluate-v2.py
```

The frozen evaluators intentionally exit2 when a quality gate fails. Never regenerate a freeze to bypass a mismatch. V1 binds the adapter/evaluator/baseline/data; the execution driver was hashed separately before the original run. V2 also binds its execution evaluator. Source hashes normalize CRLF where specified by each manifest. Runtime results vary by hardware. Run sequentially with no competing heavy workloads; the experiment refuses inadequate free RAM.

`results/` retains development and held-out reports, including failures and per-case predictions. Once viewed, a held-out corpus is consumed: rerunning it is reproducibility evidence, never a new unseen test. `develop-v3.py` explicitly uses both old test sets as consumed development material; its scores cannot support promotion. The original historical task-intent development corpus is reused as training, not unseen validation.

Partial annotations mean unlisted labels are unknown, not negative examples. Satisfied-case counts require all required labels and no forbidden predictions, but do not measure all false positives. These benchmarks do not establish downstream LLM quality, task completion, physical-phone acceptance or production integration.

## Ready-made default configurations, 11 October 2026

The original environment remains preserved. New runs use the separate ignored `output/pretrained-router-venv`. Do not install its newer dependencies into `output/semantic-router-venv`.

`requirements-ready-made.lock` records the Windows GLiClass/Vela environment; `requirements-gliner.lock` records the subsequent GLiNER2 additions without changing their existing dependency versions. These are reproduction references, not supported cross-platform product distributions. Retained asset manifests under `results/` identify exactly what was downloaded; large weights remain ignored.

| Candidate and frozen asset pin | Actual consumed-v2 result | Runtime evidence |
| --- | --- | --- |
| [GLiClass multilingual mini](https://huggingface.co/knowledgator/gliclass-multilang-mini/tree/0bd888b6c3ef9fca5f0a9d407bddfbbc7623486b), `0bd888b6c3ef9fca5f0a9d407bddfbbc7623486b` | [15/64; EN 8, HE 7](results/gliclass-mini-development.json), default `>= 0.5`; 0 errors | p95 362.34 ms; end RSS 1.846 GB; peak 2.036 GB; initialization 19.137 s. |
| [Vela 2.0 0.3B](https://huggingface.co/vllm-sr/Vela-2.0-0.3B/tree/d6f03aa9baca4f9017fa8f8e9c2764d3bed3f409), `d6f03aa9baca4f9017fa8f8e9c2764d3bed3f409` | [30/64; EN 13, HE 17](results/vela-development.json), shipped Set `> 0.3`; 0 errors | p95 289.65 ms; end RSS 1.411 GB; peak 2.318 GB; initialization 4.055 s. |
| [GLiNER2.5 multilingual Decide](https://huggingface.co/fastino/GLiNER2.5-multi-Decide/tree/e173bca1f0c4217d7a55b3b0c705d5ece8a0218d), `e173bca1f0c4217d7a55b3b0c705d5ece8a0218d` | [15/64; EN 11, HE 4](results/gliner-development.json), shipped independent decoder0.5/minimum0; 0 errors | p95 333.21 ms; end RSS 1.895 GB; peak 3.178 GB; initialization 8.769 s. |

The third configuration also fails the quality/latency/RSS gates. Reproduce with `provision-gliner.py`, then `benchmark-gliner.py --output output/final-evolution/<new-name>.json` in the GLiNER environment. The latter reserves a fresh ignored output path; publish a reviewed copy afterward. It uses the released `Classifier` API, not the older forced-one-label decoder. The final model-facing input is bounded including its schema; no custom classifier or decoder is added.

GB above is decimal; the existing memory gate is 1.5 GiB. Both fail the existing p95 <250 ms gate, mini also fails end RSS, and both are below v2's 65% absolute quality requirement. The retained phrase baseline is 22/64 on this same corpus. These compare native default configurations, not optimized models or an unseen winner. V1/v2 are consumed development data, and no fresh held-out result is claimed for either model. Independent review verified all selections/constraint totals and source hashes without rerunning inference.

The [GLiClass documentation](https://docs.knowledgator.com/docs/models/text-classification/gliclass) explicitly lists Hebrew training and cross-lingual labels. Mini's library/checkpoint declare Apache-2.0. The smaller edge checkpoint is pinned at `d16c08ef70547514081952104e6fc3d190d9ee39`, but is not measured in this table. Vela's card does not list Hebrew among its 17 languages. Its contributions are Apache-2.0 with inherited MIT and [Gemma tokenizer terms](https://huggingface.co/vllm-sr/Vela-2.0-0.3B/blob/d6f03aa9baca4f9017fa8f8e9c2764d3bed3f409/DISTRIBUTION_TERMS.md); preserve all downloaded notices. Neither language coverage nor a license identifier alone establishes deployment suitability.

`benchmark-ready-made.py` invokes GLiClass 0.1.20's multilabel pipeline with local safetensors, `trust_remote_code=False`, FP32 CPU and the frozen description strings. It rejects complete assembled inputs above 512 tokens. `benchmark-vela.py` invokes the pinned upstream Set implementation through FP32 ONNX Runtime CPU, rejects assembled inputs above 1,024 tokens or any truncation/windowing, and keeps its shipped calibration. Maximum observed inputs were 260 and 267 tokens respectively. Both record complete scores and exclusive output files; neither trains or fits anything. `uncertain` means no selected labels, not calibrated epistemic uncertainty.

Once provisioning/runtime dependencies are deliberately prepared, reproduce sequentially with new output names:

```powershell
output/pretrained-router-venv/Scripts/python.exe benchmarks/semantic-routing/provision-ready-made.py --candidate mini
output/pretrained-router-venv/Scripts/python.exe benchmarks/semantic-routing/benchmark-ready-made.py --candidate mini --output output/final-evolution/gliclass-mini-repeat.json
output/pretrained-router-venv/Scripts/python.exe benchmarks/semantic-routing/provision-vela.py --include-weights
output/pretrained-router-venv/Scripts/python.exe benchmarks/semantic-routing/benchmark-vela.py --output output/final-evolution/vela-repeat.json
```

`provision-vela.py` without `--include-weights` downloads only small code/configuration/license/documentation files. Its explicit full mode adds the pinned tokenizer and approximately 1.24 GB ONNX graph and verifies their published SHA256 values. Asset manifests are in ignored `output/final-evolution/`; report hashes bind them and the evaluator/corpus/label source. Exact measured package versions are retained in each report. These are local Windows results, not verified cross-platform production packaging.

## Reference annotations and unseen status

The v4 rubric, two AI annotation files and adjudication concern consumed material and are evaluation references only. They are not human ground truth. The frozen rubric's historical supervised-head wording does not authorize training; the later owner instruction supersedes it. Preserve unresolved labels and non-include dispositions. Neither reannotation nor adjudication makes these inputs fresh.

An independent reviewer is authoring sealed v5. Do not inspect its objectives before candidate/evaluator/assets/descriptions/thresholds/input policy and gates are frozen. No v5 execution or acceptance result is claimed here. GLiNER2.5 multilingual Decide is currently a research candidate only. Retain all failed outcomes; no new pretrained candidate has been promoted into Relay.
