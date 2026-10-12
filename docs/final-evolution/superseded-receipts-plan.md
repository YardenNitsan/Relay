# Bounded superseded tool text

Observed failure: coding-9HTadP completed guarded repairs that later independently pass9/9, but the live task paused before its next request. Its saved22,507-byte context plus tool schemas exceeded the conservative32K context/8192output allowance. It contains repeated reads and three executions of the same visible test command. Do not relax resource reserves, output limits, verification, permissions or the grader.

When context still exceeds the existing budget after optional prose pruning, shorten only older structured `file_read` or `terminal` receipt text when a later valid receipt exists for exactly the same operation arguments. Keep the latest receipt intact. Retain every exact action, call ID, tool-result pair and all result metadata, including path/hash, exit status and checkpoint. Use the existing explicit `truncated` receipt representation. Full receipts remain immutable in tool_calls; this does not execute or retry anything.

Never shorten required reviewer evidence, workflow assignments, unknown tools, failures without structured results, unmatched/duplicate call IDs or opaque provider-continuation messages. If safe text shortening still cannot fit, preserve the current fail-closed pause. Record the number and bytes shortened as operational evidence.

- [x] Red regressions for duplicate file/test receipts; latest data, hashes/exit codes, original inputs and exact call pairs preserved.
- [x] Negative tests for opaque continuation, unmatched/duplicate IDs, unrelated tools, required review evidence and insufficient remaining budget.
- [x] Small deterministic helper and context integration; no extra model calls, classifier or routing change.
- [x] Verify the actual saved failure context fits without changing its actions, then strict checks/build and rerun the same live coding acceptance with both outcomes retained.
- [x] Accurate ledger, review and coherent commit/push. Successful repair bytes alone are not successful end-to-end completion.

Verification before the live repeat: the exact saved failure context now fits at22,701serialized bytes versus the unchanged24,192budget (previously26,157). Three older receipt texts shorten; zero messages disappear and all exact actions/original input remain unchanged. Two initial red regressions precede60focused passes across six context/replay files. Fresh strict full check passes1,418tests/one platform skip across132files in303.13s; production build passes. The full check includes the concurrent session-replay fix. Source review confirms no callers depend on the old compaction-event boolean. Live completion remains unverified until the unchanged acceptance driver finishes.

Unchanged live repeat coding-vwOFL5 on a8bded9 passed:6calls/218119ms, visible tests, independent9/9, published9/9 and exact rollback. Host exited and a separate post-shutdown database inspection found0sessions. No shortening event occurred in this shorter successful transcript, so this is not causal evidence that compaction improved task quality or speed. Prior failures and exact saved-context replay remain retained. Broader coding reliability remains open.
