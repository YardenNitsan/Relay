# Task-intent comparison v1

This corpus tests advisory intent labels, not model answer quality, permissions or execution success. All objectives are synthetic and authored by coding agents. No private user data was copied. The held-out author did not read classifier code or the development set; the implementer freezes candidates before loading held-out objectives/labels. This is useful internal separation, not independent human validation.

`development-v1.json` is the implementation/training set (40 objectives,20 per language). `heldout-v1.json` has56 objectives,28 per language, independently authored. Required labels are essential; forbidden labels test explicit false positives. Other labels are unscored, so recall and case satisfaction must not be described as overall precision, accuracy or F1.

`baseline-v1.ts` preserves the shipped keyword classifier. `candidates.ts` contains an experimental bilingual phrase/context classifier and a lexical nearest-prototype comparison. The latter uses weighted word/character features from development only, with a fixed0.3 cosine threshold. Development resubstitution performance is not generalization evidence. Neither candidate uses semantic embeddings or makes a model call.

Run in order:

```text
node --import tsx scripts/benchmark-task-intent.ts --development
node --import tsx scripts/benchmark-task-intent.ts --freeze
node --import tsx scripts/benchmark-task-intent.ts --heldout
```

The initial freeze-v1 records the four source/data hashes. Review found that it omitted evaluator identity and did not bind threshold use; this is a disclosed reproducibility limitation in the first run. Its evaluator SHA256 was recorded afterward as f84ef641d6dde6a33dff1ddbd052424ff6809ecff9ff4742a569ac374f6729b8, not retroactively claimed as frozen beforehand. The initial report is retained in docs/final-evolution/evidence/intent-heldout-initial.json.

The current exclusive freeze command creates freeze-v2, adding evaluator identity and frozen threshold use. Held-out repeats refuse changed source/data/evaluator artifacts and use thresholds from that record. This is reproduction of an already observed set, not a fresh held-out experiment. Candidate/data and predeclared thresholds stay unchanged: at least10 percentage points better complete-case satisfaction, no extra forbidden-label violations and short-objective p95 under2ms on the measured host. Bounded maximum-length input timing is reported separately. Compare language breakdowns and failures before integration. Do not tune to these held-out results; a future experiment needs a new set.

Reports under `output/final-evolution/intent-*.json` include source/data hashes, per-label coverage, language breakdowns, failure IDs and timing. Record retained results in the final-evolution evidence ledger. Timing under concurrent heavy checks is provisional; repeat on a quiet host before promotion. A passing classification gate does not complete D02/D03 model/routing task-quality acceptance.
