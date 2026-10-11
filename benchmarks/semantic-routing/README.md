# Pretrained intent experiments

No candidate passed promotion. These scripts are deliberately separate from production Relay and its package dependencies. They cannot load inference models through Relay or authorize tools. Read `protocol.md`, `protocol-v2.md` and `docs/final-evolution/router-replacement.md` before interpreting scores.

Use a disposable Python environment. `requirements.lock` records the actual Windows experiment environment, not a universal cross-platform lock. Models and environments live under ignored `output/`, not in the product. Provisioning explicitly downloads pinned public model files; inference adapters use offline CPU execution, two threads and no remote model code.

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
