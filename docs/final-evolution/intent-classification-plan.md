# D01: measured multilingual task demand

The owner's directive requires overlapping English/Hebrew task understanding, without adding unmeasured inference overhead or changing authorization. This is a bounded replacement of `taskDemand` and the separately inconsistent `taskCategory` heuristic, not a new permission or execution planner. Prepare the isolated experiment during B06 verification; integrate production inline after the B06 checkpoint.

## Candidates and decision

1. Preserve the shipped `keyword-v1` implementation verbatim as the benchmark baseline.
2. Evaluate bounded Unicode normalization, bilingual terms and context-sensitive phrase rules. In particular, software failure plus repair intent should imply debugging, while fixing a bicycle should not imply coding. Preserve overlap; expose a separate security-review hint and stable existing evaluation category names.
3. Compare a lightweight word/character-feature nearest-prototype candidate trained only on the development examples. This is lexical similarity, not a claim of semantic embeddings. Reject it if it offers no worthwhile held-out benefit.

No new dependency, external egress, resident model or cloud classifier. A local model/embedding comparison remains a separate measured experiment; documentation research alone does not complete that requirement. Avoid classifying retrieved documents as instructions: only the original objective is input, and every result remains advisory.

## Reproducible evaluation

- Version a balanced development set before implementation and a separately authored held-out set. Both are synthetic representative objectives, not user traffic or independent certification. The implementer must not inspect held-out objectives/labels until candidates and thresholds are frozen and hashed.
- Each case has required labels and explicit forbidden false positives. Measure required-label recall, forbidden-label violations, complete case satisfaction, English/Hebrew breakdown and per-label recall. Partial labels do not justify reporting general precision/F1.
- Run baseline and candidates on identical cases. Record source/data hashes, runtime/hardware, warm median/p95 latency and bounded worst-case input. Predeclare the gate: improve complete-case satisfaction by at least 10 percentage points, do not increase forbidden-label violations, and keep p95 below 2ms on this host. If not, retain baseline and document the failed candidate.
- Do not retune after observing held-out failures; retain them for the next independently versioned experiment.
- Integrate only the chosen candidate. Derive the coarse coding/reasoning/general category from the same demand while preserving explicit specialist-role/account selection. Routing still applies provider/privacy/tools/context/pricing/hardware gates first. Missing quality evidence remains unknown.
- Add regression tests for Unicode/Hebrew, repair paraphrases, overlap, nonsoftware repairs, bounded input and deterministic results. Recheck routing/reasoning/evaluation and hard eligibility tests, strict types, complete tests and production build. Classification improvement is not evidence of better model task success; D02/D03 remain open.

## Inspected research and limits

- [scikit-learn text feature extraction](https://scikit-learn.org/stable/modules/feature_extraction.html#text-feature-extraction): sparse word/character features are inexpensive but lose linguistic structure. Use as a measured comparison, not as semantic understanding.
- [Sentence Transformers semantic search](https://www.sbert.net/examples/sentence_transformer/applications/semantic-search/README.html): embeddings compare meaning with vector similarity; a separate encoder/runtime introduces installation, residency and latency tradeoffs. No encoder is installed or benchmarked by reading this source.
- [fastText supervised classification tutorial](https://fasttext.cc/docs/en/supervised-tutorial.html): supervised labels, train/test separation and n-grams provide a small-model alternative. Relay's initial corpus is too small to establish broad quality; defer any production model dependency until an actual benefit is measured.
