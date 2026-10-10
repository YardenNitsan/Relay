# Initial comparison, 10 October 2026

All data are coding-agent-authored synthetic objectives. An independent agent authored the held-out set without reading the classifier or development examples. The implementer froze candidates/data before loading it. This is an internal held-out exercise, not independent human evaluation or real model task-success measurement.

| Candidate | Complete specified cases /56 | Required-label recall | Forbidden labels | English complete /28 | Hebrew complete /28 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shipped keyword-v1 |14|28.95%|11|12|2|
| Bilingual phrases |26|57.89%|5|15|11|
| Lexical prototypes |7|11.84%|18|5|2|

The phrase candidate passes the predeclared comparison gate (+21.43 percentage points complete-case satisfaction and fewer forbidden violations). The prototype fails and is not selected. Neither result establishes broad semantic understanding. Thirty phrase cases still miss a required label or emit a forbidden one; those remain failures and were not used to tune this frozen candidate. The new security label is absent from the shipped classifier, so some improvement reflects requested taxonomy coverage.

Initial Windows/Node24.11.1 timing during the browser gate: baseline short-objective p95 0.0036ms, phrases0.1859ms, prototypes0.0762ms. A16KiB Hebrew string took phrases10.99ms; it is not covered by the short-case2ms target. Quiet-host timing is required before production promotion. No inference call, resident model or cloud request is involved.

The initial evaluator omitted itself from the hash freeze and hardcoded thresholds. Review found this; its SHA256 was recorded after evaluation as f84ef641d6dde6a33dff1ddbd052424ff6809ecff9ff4742a569ac374f6729b8. Do not interpret that as a prior evaluator freeze. The initial report is retained at ../../docs/final-evolution/evidence/intent-heldout-initial.json. Version2 repeats bind evaluator identity, use frozen thresholds and normalize source line endings for portable hashes. They reproduce the same observed set, not a new held-out set. Candidate/data and thresholds are unchanged.

The quiet-host version2 reproduction after the browser process exited returned identical scores. Windows/Node24.11.1 on Core Ultra7 265KF: phrase median0.074ms/p95 0.183ms across1000 short objectives; the single16KiB adversarial Hebrew input took11.06ms. [Bound evaluator/data and raw report](../../docs/final-evolution/evidence/intent-heldout-quiet.json). This supports the declared short-input gate only; it is not an application latency benchmark.

The unchanged phrase candidate is integrated into production task demand, coarse category and automatic reasoning. Forty-three focused multilingual/routing/reasoning/evaluation cases pass, including explicit required-model, local-only, provider, hardware and output-budget invariants. Full integration gates are recorded separately in final-evolution/acceptance-results.md. Actual model/task outcomes, lightweight semantic encoders and optional local classification models remain unevaluated; documentation research is not a substitute.
