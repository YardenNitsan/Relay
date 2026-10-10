# Executable coding evaluations

`relay-code-eval-v1` is a separate, explicitly requested suite of three synthetic JavaScript coding cases. It supplements `relay-capability-eval-v2` without changing that protocol's prompts, graders or existing reports. It is available to the local owner through **Models → Evaluate executable coding**.

The owner must approve local compute and isolated execution. If the approved Node sandbox is unavailable, its actual reason is displayed and the start action stays disabled. The backend independently checks availability before model calls. Relay never installs Docker, pulls images, downloads models or enables networking to make this action work.

## What is verified

The cases implement settled-transaction aggregation, repair an interval merge and implement a deterministic dependency order. Each case has five deterministic input/output vectors, including empty inputs, boundary cases, nesting, special object-property names, invalid records, repeated edges and cycles. The model returns one bounded JSON object containing only `solution.cjs`, a CommonJS module exporting a synchronous function. Invalid paths, extra files, tool proposals, malformed JSON and source above 32 KiB fail the submission without execution.

The host supplies inputs and a fixed harness to the existing `DockerSandbox`, then compares actual returned JSON with expected outputs **outside the container**. Answer keys are never staged inside the container or included in the model prompt. Neither exit code zero, model claims nor a printed `passed:true` can pass a case. Truncation, process failure, wrong shapes, wrong values and changed exported source/input/harness files cannot pass. Only hashes and bounded check receipts are retained in the evaluation report, not generated source or stdout.

This remains a small public suite, not a secret benchmark or proof against benchmark memorization. Program outputs are untrusted values. Source can inspect its provided inputs and its container; matching output demonstrates behavior on these vectors only. Hash comparison checks the final exported files and does not claim to detect every temporary in-container modification. No real repository, private document, user message, credential or external account appears in the cases.

## Execution boundary

All generated code runs through the existing broker's **same** serialized DockerSandbox instance, cleanup ledger and stop-generation guard. Generated source is written as text to a unique private temporary staging directory; it is never evaluated, imported or spawned on the host. The trusted harness also executes only in the container. Fixed filenames are cleaned individually; container exports are inspected in memory and never extracted to host paths.

Use an owner-pinned, already installed immutable image via `RELAY_SANDBOX_NODE_IMAGE`. The existing sandbox requires a local Linux Docker engine with memory/swap/PID/CPU/seccomp controls and verifies its Node 24+ runtime, privilege drop and bounded mounts. It uses no network, no writable host mount, a read-only root, one CPU, 512 MiB RAM/swap, bounded output and a 15-second command budget. Existing supervisor/setup/cleanup overhead can exceed the command budget. Cleanup uncertainty blocks future commands; cancellation joins cleanup before returning. These limits do not guarantee that all host failures are impossible.

A trusted no-op preflight runs before any model call and records the exact image digest and observed Node version. A second preflight inside the normal task slot must match before generation starts. Every execution receipt must match again. The report binds model artifact/runtime/quantization/hardware/context/output/default reasoning, image digest, Node version and trusted harness SHA-256. Changed configurations cannot inherit evidence.

The generation path shares `localEvaluationExecutor` with the existing capability suite: per-account gateway, local inference lease, hardware admission, pressure monitoring, durable authorization, bounded output, cancellation and model-call usage settlement remain intact. Code cases request no agent tools. The local-owner session and task state are rechecked throughout the suite and around container execution; the authorization watcher aborts revoked work. A durable unique task claim prevents replay after failure or interruption. No automatic repair, code retry or external effect is performed.

## API, persistence and budgets

- `GET /api/models/code-evaluations/status` reads actual sandbox availability.
- `POST /api/models/code-evaluations` accepts `{modelId, contextTokens?, maxOutputTokens?, maxSeconds?, confirmed:true}` and runs verified preflight before atomically creating the conversation, task and protocol marker.
- `GET /api/models/code-evaluations` returns the owner's latest 40 coding reports.

Tasks use three local model calls, explicit output/context/time caps, read-only task options, no workspace, no network/MCP access and zero cloud allowance. The special protocol marker authorizes only this fixed internal suite; the ordinary agent broker does not gain an arbitrary background execution tool. The initial trusted preflight happens before task creation, has its own bounded deadline and is disclosed by the confirmation. Its container check is additional work outside the task's active execution accounting.

The authenticated start request receives a bounded 60-second socket allowance; metadata and preflight retain an independent 45-second deadline. Client disconnects cancel preflight, and cancellation is checked before and inside task creation. A disconnected preflight cannot silently enqueue model work. Ordinary unauthenticated socket limits remain unchanged.

Migration 9 extends the existing protocol constraint without rewriting migration 6 or old reports. Capability readers explicitly select v2; coding readers select v1. Both share the 200-attempt account retention ceiling. A stopped, failed or interrupted attempt cannot automatically replay and supplies no completed score. Fixture-sourced reports remain ineligible. Current coding reports are inspectable measurements and do **not** contribute to Auto ranking; a controlled held-out task comparison and compatible execution-environment routing integration are still required.

## Verification and limits

Focused tests cover strict source contracts, deterministic grading, fixture exclusion, provenance drift, host staging cleanup, fixed container commands, source/input/harness tampering, unavailable preflight with no task/model call, actual database claims, call accounting, permission revocation, old-suite isolation, duplicate-run rejection and upgrade compatibility. Sandbox/model executors in these tests are fixtures: no generated source executes on the test host, and they do not establish a live container run or model-quality result.

Browser fixtures cover the disabled action and honest unavailable reason at 320 px and desktop. Native Docker execution, a real coding model benchmark, native PostgreSQL contention and measured improvement over existing routing remain separate acceptance work. Container configuration must be supplied by the owner; missing prerequisites remain unavailable rather than silently falling back to a host process.

The boundary follows [Node's documented warning that `node:vm` is not a security mechanism](https://nodejs.org/api/vm.html) and [Docker's documented `none` network mode](https://docs.docker.com/engine/network/drivers/none/), reviewed October 10, 2026. It reuses Relay's existing supervisor rather than treating either VM contexts or network isolation alone as a complete sandbox.
