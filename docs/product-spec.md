# Relay product specification

The user's MASTER BUILD DIRECTIVE, cross-platform revision and sections 79–100 are authoritative. This document preserves the implementation brief and acceptance criteria, not a replacement specification.

## Intent

An owner works through a browser conversation with a local execution service on Windows, Linux or macOS. Optionally, authenticated invited users connect through a hardened remote gateway. The service owns durable objectives, selects currently available local or cloud intelligence, coordinates role-based agents, enforces bounded user and agent capabilities, observes real tools, and reports results with evidence. Models and agents are independent concepts. Local-first means installed local operation works without cloud accounts or Internet; data leaves the host only under a separate egress policy.

Remote access is optional. A public address never grants identity, workspace access, computer control or cloud spending. The host authenticates, authorizes, schedules, executes and audits every request. The local owner retains emergency control and can revoke users, sessions and tasks. Gateway failure must not disable local operation. The shared responsive browser supports desktop, tablet and phone, with activity and approvals available at every size.

## Required product surfaces

Conversation and attachment composer; depth, model, budget and computer-access controls; replayable activity; scoped approvals; task history; file/artifact inspection and diffs; model/provider management; measured hardware; obvious emergency stop. Light/dark themes, keyboard access and responsive secondary surfaces. No private chain-of-thought display.

## Execution and storage

Explicit task lifecycle; persisted graph steps, model/tool runs, approvals, evidence and checkpoints; bounded calls/time/iterations; cancellation propagation; recovery pauses uncertain work. Normalized PostgreSQL conversations/messages/tasks/run records, filesystem artifacts. Context is selected and budgeted independently from stored history. Provider adapters normalize Ollama, OpenAI, Anthropic, Gemini and compatible runtimes. Discovery and measurements take precedence over guessed capabilities or throughput.

## Security and truthfulness

Deterministic policy outside models; four clear access levels with scoped grants; no secret exposure; no shell without an OS isolation boundary; no path traversal, symlink traversal or untrusted instructions escalating authority. Stop is latched outside model control. Approvals bind exact actions and tasks. Protect existing files, preserve dirty repositories, and keep proposed workspace changes inspectable. Unavailable infrastructure is shown explicitly. Unsupported unrestricted host control remains disabled until a tested broker exists.

## Acceptance path

Browser -> persisted conversation and objective -> task -> role/model selection -> real inference -> streamed durable activity -> authorized tool request -> deterministic permission decision -> actual tool result -> verification evidence -> persisted assistant answer and inspectable history. Automated tests use deterministic provider fakes; acceptance includes actual installed local inference where hardware admission permits it.

## Delivery approach

Research and document before architecture implementation; modular monolith with cohesive modules. Deliver connected increments, then adversarial tests, real browser interaction and visual critique. Production quality is a target requiring explicit remaining-release gates, not a label earned by a successful build.
