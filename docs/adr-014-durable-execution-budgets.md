# ADR014: Durable execution reservations

The previous per-attempt timer allowed a manual resume to reset elapsed execution and agent iterations. Model-call and cost counters alone did not enforce the requested time budget.

Reserve at most five seconds of future execution in PostgreSQL before starting work. A monotonic process clock enforces expiry; a refresh transaction extends the reservation only by time consumed since the previous reservation. Database failure aborts execution rather than granting time without a durable record. Orderly close charges elapsed time and refunds unused reservation. Recovery charges any outstanding reservation, clears its lease and never counts time while the service was offline. Lease identity prevents an old process from refunding a replacement lease.

Per-step iteration counters are incremented atomically before model dispatch and survive repairs, pauses and restart. Exhausted tasks require a new objective with an appropriate budget; resume is not an unbounded budget reset. Time includes queueing for a local model and waiting for an approval while the task owns an execution slot. It does not measure exclusive CPU time.

This deliberately trades up to five seconds of unused budget after a crash for enforceable limits. It avoids a distributed task framework and wall-clock assumptions, while using the existing transactional control plane. The [Node monotonic clock](https://nodejs.org/api/perf_hooks.html#performance-now) supplies elapsed-time measurement. Tests cover overlapping leases, conservative crash recovery, stale close, incremental reservations and iteration exhaustion.
