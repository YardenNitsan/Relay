# Relay user guide

This guide describes **0.1.2**. For daily Windows use, double-click `setup.cmd` in the Relay folder; it starts or reuses the local host and opens the browser. See [setup](setup.md) for pairing and shutdown, and [release notes](release-0.1.2.md) for upgrade precautions and verified limits.

On the unreleased modernization branch, **Models** opens the new Model Studio. Search the catalog or filter Local/Cloud, inspect a model, then choose **Use model** to enter the existing reasoning and sharing controls. Inspection does not start inference. On a phone, **All models** returns to the catalog. **Connections** contains personal cloud credentials and, for the local owner, host runtime and Google application settings. Unsaved keys stay only in memory and require confirmation before dismissal.

The inspector distinguishes advertised capabilities and reported sizes from measured speed and recorded evaluation results. Unknown cloud input/output prices remain unknown. Local-owner measurement controls show their budgets and consent requirements. Reopening an unfinished capability/coding evaluation recovers its Stop control, including queued work that has no result yet. Leaving Model Studio does not itself cancel an admitted task. These controls do not establish general model quality; see the [final-evolution acceptance ledger](final-evolution/acceptance-results.md).

## Specialists, personal tasks and client devices

Open **Agents** in navigation, or choose the agent beside the composer. Selecting a specialist changes its instructions and allowed tools; model, depth, computer access and cloud policy stay separate. **General orchestration** restores automatic general work. Missing integrations are stated directly in the agent details.

For the Personal Assistant, select **Supervised** and ask to create a task such as “Remind me to review the release tomorrow.” The model can propose an item with an explicit UTC due date and request approval. Saved items belong to your account. Listing, completing and deleting items use the same personal-task tool. This is a persistent task list, not an operating-system notification or Google Calendar event.

Email and Calendar can work from supplied information. After separate Google Workspace setup and account consent, explicitly enable Gmail or calendar reads in Advanced controls for a local-only, read-only task. No sending or calendar editing is available. Browser and Computer agents use only the structured tools actually available; choosing them does not enable unrestricted browser or desktop automation.

**External clients** creates/revokes tokens for coding applications that use the host's local models. Their tools run on their device, and their conversations are not stored as Relay chats. The owner must explicitly grant this access. Read the [API compatibility limits](external-clients.md) before configuring Codex or Claude Code.

The owner can issue a **LAN invitation** from Access after creating an account. On the configured LAN HTTPS address, enter the five-minute code once. It pairs that browser to that account, never to the owner. Remote public browsers authenticate through Cloudflare Access; the free domainless setup is described [here](cloudflare-free.md).

Relay turns a conversation into accountable work on your host. You choose the objective, available intelligence and permitted scope; the host schedules execution and records what happened.

This guide describes the current application. The [validation ledger](validation.md) records what has been tested on actual systems, and the [project report](project-report.md) tracks remaining work.

## Find your way

- [Start, pair and stop Relay](#start-pair-and-stop-relay)
- [Your first conversation](#your-first-conversation)
- [Models, agents and compute depth](#models-agents-and-compute-depth)
- [Workspaces and attachments](#workspaces-and-attachments)
- [Computer access and approvals](#computer-access-and-approvals)
- [Activity, changes and verification](#activity-changes-and-verification)
- [Models and cloud providers](#models-and-cloud-providers)
- [Machine resources and calibration](#machine-resources-and-calibration)
- [History, search and model context](#history-search-and-model-context)
- [Public web research and Git](#public-web-research-and-git)
- [MCP tools](#mcp-tools)
- [Remote access and user management](#remote-access-and-user-management)
- [Data, backups and updates](#data-backups-and-updates)
- [Troubleshooting](#troubleshooting)

## Start, pair and stop Relay

### Source installation

Open a terminal in the Relay source directory:

| Platform | Start or reuse the host |
| --- | --- |
| Windows | `.\setup.cmd` |
| Linux / macOS | `sh setup.sh` |

For a new host, setup prepares dependencies and browser/host assets, using an existing suitable Node.js installation or a project-local runtime. An already-running Relay host is reused without rebuilding or interruption; stop it first to apply pending source updates. Missing dependencies require Internet access during setup. Setup does not install Ollama or LM Studio, download model weights, connect cloud providers or enable remote access.

The normal browser address is **http://127.0.0.1:4317**. The host must stay running while you use Relay. Closing a browser tab does not stop its tasks.

Setup opens the browser and the protected pairing-code file. Enter the file's `token` value in **Connect this browser**. The code is single use and expires after five minutes. A successful pairing creates a local owner session lasting up to twelve hours; it can survive a host restart until expiry or revocation. Another browser profile needs its own pairing.

Keep the pairing file private. Share neither its contents nor a browser session with another person; use the optional remote-user flow for shared access.

| Setup option | Effect |
| --- | --- |
| `--help` | Show available options. |
| `--check` | Diagnose the environment without installing, building, starting or pairing. |
| `--no-browser` | Prepare/start Relay and report its URL and pairing-file path without opening windows. |
| `--stop` | Gracefully stop a setup-managed host; refuse to stop a separately launched host. |

Use `.\setup.cmd --stop` followed by `.\setup.cmd` to restart on Windows, or the corresponding `sh setup.sh` commands on Linux/macOS. Startup logs are under the selected data directory's `startup/` folder. [Complete setup behavior and platform prerequisites →](setup.md)

### Manual start

With Node.js 24 or later already installed:

```sh
npm ci
npm run build
npm start
```

In a second terminal in the same directory, run `npm run pair`. Open the protected file at the reported path, then enter its code in the browser. Leave the host terminal running. Stop it with `Ctrl+C`; use your service manager if you launched Relay as a service.

On Windows, `npm.cmd` avoids the PowerShell script launcher if local execution policy blocks `npm.ps1`. Do not weaken system-wide script policy just to run npm.

### Portable archives

Portable packages have different launchers from a source checkout. After extracting an archive:

- **Windows:** install the packaged production dependencies with `npm.cmd ci --omit=dev`, then run `.\start.cmd`.
- **Linux/macOS:** run `sh start.sh --install-dependencies`; later starts can use `sh start.sh`.
- **Pairing:** run `node launch.mjs --pair` from that package.

These archives require Node.js 24+ and target-platform dependencies. They are not signed native installers. Package launchers use native application-data directories, while a source checkout defaults to `.data/`. Pair with the same data directory as the running host.

### Stopping work versus stopping the service

| Action | What stops | What remains |
| --- | --- | --- |
| **Cancel task** in Activity | The selected task and its managed requests | Other tasks, the host and recorded evidence |
| **Stop all agents** | New scheduling and managed agent/model/tool work across the host | The host, records and an explicit stopped state |
| **Resume Relay** | Clears the host's global stop after owner action | Previously cancelled tasks stay cancelled; inspect preserved tasks individually |
| Setup `--stop`, `Ctrl+C` or service shutdown | The host process after graceful cancellation/persistence | Database, workspaces, checkpoints and logs |

Emergency stop is enforced by the host, independently of model reasoning. The stopped state persists across restart. Runtime cancellation may leave a model cached in an external runtime; Relay does not indiscriminately unload models belonging to other applications.

## Your first conversation

1. Start a supported local runtime with an installed model.
2. Open **Models & providers**, refresh discovery and check hardware fit.
3. Return to the conversation. Start with **Auto model**, **Balanced**, **Read only** and **Local only**.
4. Type an objective and press **Enter** or the send button. Use **Shift+Enter** for a new line.
5. Open **Activity** when you want to inspect execution or respond to an approval.

For a first task, ask a question that needs no files or network:

> Explain the difference between authentication and authorization, with a short example.

A missing cloud provider is normal. A missing local model means Relay has no local intelligence to run yet; install a suitable model in your runtime, then refresh discovery.

The chat shows the answer as it is produced, along with short factual progress such as “Preparing your answer” or “Checking the answer.” Ordinary Balanced conversation uses one worker. Balanced adds review when a specialist, workspace, host-file capability, network/MCP tools or required verification is selected. These activity labels describe execution; they are not private model reasoning. Open the execution record to see the assigned roles, models and recorded outputs.

### The interface

| Surface | Use it for |
| --- | --- |
| Conversation | Objectives, streamed answers and task status |
| Composer | Text, text-file attachments, model preference and compute depth |
| **Execution options** | Budgets, context, cloud sharing, public network access and selected MCP servers |
| **Choose workspace** | Create, import, select or inspect a managed workspace |
| **Activity** | Plan, work log, pending approvals, changes and evidence |
| **History** | Find saved conversations or individual messages |
| **Models & providers** | Model discovery, hardware fit, calibration and optional provider connections |
| **Usage** | Side drawer with today's reported tokens and provider-reported remaining rate capacity; unknown balances remain labelled unknown |
| **Machine / This machine** | Host telemetry, memory policy, resident models and execution-boundary status |
| **MCP tools** | Owner-managed external tool catalogs |
| **Access & remote connections** | Owner-managed users, policies, browser sessions and remote work |

On a narrow window or phone, **Menu** opens the navigation sheet and secondary views use the available screen. Owner-only destinations do not appear for invited users. The connected host name matters on remote devices: actions execute on that host, not on the phone.

Use **Ctrl+K** on Windows/Linux or **Command+K** on macOS to open the command palette. Tab through controls, use arrow keys in selectors/tabs and press Escape to close dialogs. Light and dark themes are available from navigation or the desktop theme control.

Composer drafts are saved in this browser's local storage, scoped to the account and conversation. Submitted history is stored by the host. Treat a shared browser profile as access to its saved drafts as well as its active session.

### Delete a conversation

Open **conversation history**, select the trash icon beside the conversation, review its title and choose **Delete conversation**. **Cancel** keeps it. If Relay reports unfinished work, open its execution record and stop the task first, then delete it.

The conversation disappears from history and search, including after reloading. Deleting the currently open conversation returns you to a new draft. Workspace files stay unchanged. The host retains stored messages and execution records for audit and usage accounting; this action is not permanent data erasure. There is no restore button yet.

New conversations are saved only when their first objective is accepted. Retrying a failed first submission or recovering a lost response reuses that request instead of creating an extra chat.

## Models, agents and compute depth

A **model** provides inference: a particular local model, or an API model from a connected provider.

An **agent** is a role in a task, with instructions, permitted tools, context and a model assignment. A reviewer is not synonymous with Claude, and a worker is not synonymous with a local model. The router selects from the intelligence actually available and authorized at that point.

A **task** is the persisted execution of an objective. A conversation can contain many tasks. A task may contain multiple agent steps and model calls.

### Depth

| Mode | Current execution shape | Choose it when |
| --- | --- | --- |
| **Fast** | A worker, with host checks for the operations actually performed | The objective is straightforward or latency matters |
| **Balanced** | One worker for ordinary conversation; review and bounded repair for specialist or tool-enabled work | Everyday chat and controlled tasks without unnecessary review calls |
| **Deep** | Planner, selected architecture/security specialists, worker and reviewer | The task benefits from examining dependencies and risks |
| **Maximum** | The deeper graph can also include independent research/alternative analysis | Extra comparison is worth the calls and time |

The planner may propose a smaller specialist set and acceptance criteria. Application code validates the proposal and constructs the graph. Invalid proposals retain the bounded default graph. A planner cannot create new permissions, arbitrary executable graph nodes or a larger budget.

Independent graph steps may become eligible together, but actual concurrency depends on the scheduler and resources. Local generation is serialized to protect memory. Selecting Maximum does not promise that multiple large local models will run at the same time, or that multiple distinct providers will be used.

### Model routing

**Auto model** considers discovered models, account access, cloud policy, availability, required tool support, context size, hardware admission and available performance measurements. It does not select an unconnected provider.

Choosing a named model in the composer expresses a preference. It still has to meet policy and hardware requirements; fallback may select another suitable model. The execution record is the source of truth for which model actually ran. Calibration is different: it requires its selected model so another model cannot silently supply the measurement.

Cloud failure can trigger bounded rerouting to another eligible model. If no permitted model can continue, inspect the task's reported reason. Relay must not cross a local-only boundary just to make progress.

### Budgets

Open **Execution options** to set:

- Maximum model calls.
- Active execution time in seconds.
- Maximum iterations.
- Context token budget.
- Optional cloud cost cap.
- Cloud sharing, network and MCP scope.

The initial composer defaults are Balanced, 12 calls, 600 seconds, 5 iterations and an 8,192-token context budget, with local-only sharing. Account policy can impose lower ceilings.

Queue time and whole-task approval/resource waits do not consume active seconds. A parallel agent still working keeps the task clock running. Fully approval-blocked tasks release their execution slot, but remain within the account in-flight quota and retain workspace/host exclusivity. Approved work waits for capacity before resuming. See [execution accounting](execution-accounting.md).

More context increases memory demand, particularly the KV cache; it does not simply mean “more intelligence.” Keep it proportionate to the task. Budgets remain attached to the task across retries and resumes rather than resetting on restart.

A strict cloud cost cap can reject a model whose pricing is unknown. An empty cost cap is not a declaration that cloud calls are free. Remote accounts have separate provider and daily-spend limits.

## Workspaces and attachments

### Import a project

On the modernization branch, open **Projects** or **Choose workspace**, choose **New workspace**, enter a name and the project's absolute source-directory path, then choose **Import managed copy**. This host-path import is available only to the local owner. Other users create an empty personal workspace and upload files from their device instead; entering a path must not grant access to the owner's computer.

Relay copies supported files into its managed storage. It excludes links, sensitive paths, Git internals and common dependency/build trees. This filtering is a protection layer, not a guarantee that every possible secret has been recognized.

**The original source directory stays unchanged.** Tools operate on the selected managed copy. Importing does not grant access to every folder on the host, and source Git branches/history are not imported.

You can also create an empty managed workspace without supplying a source directory. Open a project in the index to browse and search its files; additional files are paginated. Inspecting a project does not change conversation context: choose **Use for conversation** explicitly. **All projects** returns to the index on phones. File actions stay in the editor footer; unsaved edits require an explicit discard decision before leaving, and in-flight file operations must finish first.

For an initial file task, prefer a small change you can inspect:

> Read the documentation in this workspace. Correct the outdated start command in README.md, then read the saved file and explain what changed.

Use **Supervised** until you are comfortable with the scope. Confirm the workspace name beside the composer before sending.

### Attach a text file

The paperclip accepts UTF-8 text/code files and supported PDF/modern Word documents. Documents are parsed into bounded text copies; this is not image understanding or OCR. See [document attachment limits](personal-files.md).

Attachments are saved inside the selected managed workspace. Attaching without a selected workspace creates one for conversation attachments, including a private personal workspace for invited users. The composer adds the saved path to the draft so the task can reference it. This does not remove context or permission limits.

Your own file management is independent of agent autonomy: even with agents set to Read only, you can upload, edit and delete your own files. In a personal workspace you may choose Read only, Supervised or Autonomous workspace for agents. Shared host workspaces retain their owner-granted access limits. Open a file in the project's **Files** view for edit/download/delete controls; edits reject stale content hashes. [Personal file behavior and limits](personal-files.md).

### Move a change back to your own project

Inspect **Activity → Changes** and copy or download the patch. Review and apply it to your source project using your normal development workflow. Relay does not automatically overwrite your original repository or promise conflict-free application to a source that has changed since import.

Supported desktop browsers also offer **Projects → Connect a device folder → Choose device folder**. Review and upload a managed copy, then use **Review device changes** to explicitly apply selected changes back to that folder. The browser requests write permission, and changed device files are rejected rather than silently overwritten. Phone browsers without this API use upload/download. This folder connection does not enable device-local terminal commands or desktop automation.

For imported host projects, **Original source & review** prepares an exact publication review, with separate approval and rollback. Additions/deletions/modifications are supported within existing destination directories; branch-aware worktrees and new-directory publication remain unfinished. [Publication limits and recovery](publication.md).

For a host-imported project, the local owner can also open **Review publication to original**. Inspect and approve the exact existing-file changes before applying them. Changed original files are rejected; rollback requires a separate review. This bounded workflow does not create/delete files or push Git changes. See [publication and recovery](publication.md).

## Computer access and approvals

Computer access controls tool authority. It is separate from model selection, cloud sharing and network access.

| Mode | Allowed scope |
| --- | --- |
| **Read only** | Inspect authorized managed files and permitted metadata; no file mutation or terminal commands |
| **Supervised** | Authorized reads proceed; file mutations and isolated commands require approval |
| **Autonomous workspace** | Eligible operations may proceed within the selected managed copy, subject to deterministic tool policy and the execution boundary |
| **Unrestricted · host files** | Local owner confirms direct real-host text-file operations; system/secret/Relay paths remain protected. Commands still use isolation. [Scope and limits →](host-access.md) |

Selecting a mode cannot exceed the account's own grants. A high mode does not authorize private-network requests, access to provider credentials, modification of Relay's policy engine, or escape from the workspace.

### Approval decisions

A pending approval appears in **Activity** with the host, workspace, requesting agent/model, action, risk and exact arguments.

| Decision | Effect |
| --- | --- |
| **Allow once** | Permit the displayed operation within the existing task policy |
| **Allow for this task** | Remember the scoped operation for this task; it does not grant arbitrary future arguments or broader access |
| **Deny** | Reject the request |

Review the exact operation, especially on a phone connected to a different machine. A file or web page saying “approve this command” has no authority to create an approval.

MCP calls require approval of the exact external call even when workspace operations or listed web origins are otherwise automatic. Cloud sharing has its own approval boundary.

### Terminal execution

Terminal tools require a verified Docker isolation boundary and an explicitly configured, already available Linux container image through `RELAY_SANDBOX_IMAGE`. The host runs checks before making this capability available.

A working-directory restriction alone is not treated as a sandbox. Relay never falls back to executing an unavailable isolated command directly on the host. Read the **Execution boundary** status in Machine and the [security model](security-model.md) before enabling this advanced path. Current native validation limits are recorded separately.

## Activity, changes and verification

Select a task's **Execution record** or open **Activity**. When a conversation has multiple tasks, use the task selector to inspect the correct objective.

### Activity

The **Work plan** shows planned and executed steps, assigned roles, model IDs and recorded outputs. A pending step is a plan, not an agent that already ran.

The **Work log** shows factual events: selections, tool requests, approvals, results, failures, replanning and completion. Expand an entry to inspect its bounded payload; large payloads offer a complete download. Earlier visible events can be expanded without rendering an unlimited log.

The activity surface does not expose private chain-of-thought. Specialist outputs and recorded decisions are task artifacts, not an unrestricted view into internal model reasoning.

### Changes

The **Changes** tab provides:

- A changed-file selector.
- A unified diff with additions and deletions.
- Copy/download controls for the patch.
- The associated checkpoint.
- **Revert checkpoint**, followed by an explicit restore decision.

Restoration targets the managed workspace. The host checks current content and rejects conflicting external changes instead of silently overwriting them. A checkpoint is not a replacement for a backup of your entire original project.

### Verification

The **Verification** tab shows checks that actually ran and their recorded results. Inspect the scope and details.

A successful file-write receipt proves a specific operation and its content check. It does not prove the application builds. A successful model review is an assessment; it is not a passing compiler or test suite. A successful response from a remote MCP service records what that service reported; it is not proof of a local side effect.

The API also supports explicit required-read verification contracts with expected whole-file hashes. This is a bounded verification feature for integrations; the current composer does not provide a general acceptance-contract editor or turn every natural-language request into one automatically.

### Task states and recovery

| State | Meaning / next step |
| --- | --- |
| Created / Analyzing / Planning | Work is admitted or being planned; inspect model/resource reasons if it cannot proceed |
| Executing | One or more eligible steps are working |
| Waiting for approval | Review the exact action in Activity |
| Waiting for user | Read the reported problem or uncertainty before continuing |
| Verifying | The host is evaluating the result and available evidence |
| Replanning | Bounded repair/review work is being arranged |
| Paused | Work is preserved; resolve the reported condition, then use **Resume task** when offered |
| Completed | The task reached its completion checks; inspect evidence for the actual scope |
| Failed / Cancelled | Execution ended; inspect the record and start a new objective if needed |

After a host restart, interrupted work is preserved and may need explicit resumption. If a tool action might have happened but its result is unknown, Relay blocks automatic replay. Inspect the managed files or external system before deciding how to proceed. Repeatedly pressing Resume does not make an uncertain effect safe.

## Models and cloud providers

### Local models

**Models & providers** lists models discovered from enabled runtimes. Search by name/provider or filter Local and Cloud. Entries can show runtime, quantization, context capacity, advertised capabilities, weight size, state and measured throughput when available.

Choose **Check hardware fit** to assess a local model using the current context budget. Read the reasons, not just the outcome. Unknown architecture or telemetry can prevent admission.

Relay integrates with local runtimes; it is not itself a model downloader or an embedded inference engine. Manage model downloads in Ollama or LM Studio. Relay starts an installed LM Studio background service when the host starts; install the official llmster daemon once to avoid opening the desktop app. Reopening Models refreshes both independent libraries. A selected LM Studio model is loaded with a bounded context only after native memory admission, then unloaded after the call. A large model can remain unsafe under current host pressure even though it appears in the list. See [runtime setup](local-inference.md).

### Optional provider connections

The owner can connect OpenAI, Anthropic and Gemini under **Provider connections**. Remote users connect their own owner-permitted accounts under **Your provider connections**:

1. Obtain a supported API credential from that provider.
2. Expand **Connect provider** and enter the API key.
3. Choose session-only storage or **Save in the operating system's secret store**.
4. Select **Save credential**, then **Check connection**.
5. Review discovered models and the provider's state.

A consumer ChatGPT, Claude or Gemini subscription is not automatically an API credential. Relay does not scrape browser sessions or cookies to imitate API access.

The OS vault must be available to save persistently. Headless Linux may lack an unlocked Secret Service. Use explicit session-only storage or configure the host's vault; there is no automatic plaintext credential fallback.

Use **Enabled** to exclude your provider from selection, **Check connection** to refresh its health, or **Remove credential** to remove your stored credential. Only the owner manages local runtime controls. Backend environment variables belong exclusively to the owner; removing an environment-supplied credential from the running service cannot rewrite its startup environment.

### Three different data-sharing decisions

| Boundary | What may leave the host | Where to control it |
| --- | --- | --- |
| Cloud inference | Selected task, conversation and workspace context sent to a model provider | **Cloud sharing** |
| Public web research | The requested URL, including ordinary query text, sent to the website | **Research network access** and exact origin list |
| MCP call | Selected tool arguments sent to the configured external service | Server selection, network origin and exact-call approval |

**Local only** controls AI inference. If you separately authorize a public web or MCP tool, that network operation still leaves the host. Conversely, permitting cloud inference does not authorize arbitrary web tools.

Cloud sharing options are **Local only**, **Ask before sharing** and **Allow cloud providers**. The approval option applies to the actual sharing request; it is not a promise that an automatic classifier identifies every sensitive string. Connecting a provider is separate from permitting task content to be sent.

Do not place credentials in ordinary prompts or files for agents to use. Normal tools cannot read the provider secret store, and Relay applies credential tripwires/redaction, but arbitrary private information cannot be identified perfectly.

## Machine resources and calibration

Open **Machine** on desktop, or **This machine** from the navigation sheet. The owner can inspect CPU, RAM, swap/pagefile, GPU, storage, resource policy, runtime-resident models, database type and execution-boundary availability.

Values are actual host observations where supported. **Unavailable** means no reliable measurement was obtained. It does not mean zero usage.

### Resource profiles

| Profile | Intent |
| --- | --- |
| **Safe** | Preserve substantial headroom and host responsiveness; default |
| **Balanced** | Permit more useful allocation while maintaining reserves |
| **Performance** | Use tighter, still enforced safety reserves |
| **Custom** | Set explicit limits within deterministic minimum safety floors |

Save a profile to apply it to subsequent admission decisions. Editing controls without saving does not change the host policy, and saving does not rewrite an already-running model call.

Memory admission includes weights, context-dependent KV cache, runtime buffers and current pressure. Apple Silicon/integrated memory is treated as a shared pool rather than incorrectly adding RAM and GPU memory together. Compatibility does not depend solely on CUDA or a model file's size.

If a task pauses for memory pressure, close unneeded applications yourself, choose a smaller model or reduce the context budget for a new task. Inspect the task reason before resuming. Relay does not close your other applications automatically or silently switch to paid cloud inference.

The resident-model view reports what a supported runtime exposes. It is not proof of exclusive ownership, measured peak memory or permission for Relay to unload another application's model.

### Measure local performance

In a local model entry, expand **Measure local performance** and choose **Run calibration**.

Calibration runs a fixed public prompt through the normal local queue, safety policy and cancellation path, with a 120-second limit. It has no file, web, MCP or cloud tools and requires the selected model. Use **Stop calibration** to cancel.

The result shows only counters returned by the runtime, such as generated tokens, load duration and generation throughput. Missing counters remain missing. A completed generation without counters is not presented as a measured result.

This is a sample of that run. It is not a reasoning/coding score, a peak-memory stress test, a sustained thermal benchmark or a guarantee at another context size. Hardware/runtime/model identity is recorded with durable performance data. [Calibration details →](calibration.md)

## History, search and model context

Open **History** to browse all your saved conversations. Pages are ordered by conversation creation time; updating an older conversation does not reorder those pages.

Use the search selector to choose:

- **Conversation titles** for a title lookup.
- **Message content** to search across your saved messages.

Message search uses local PostgreSQL full-text search. Quotes select a phrase, `OR` offers alternatives and `-` excludes a word. This is lexical search, not semantic similarity or an embedding service.

Selecting a message result opens the corresponding conversation around that exact message. Use **Earlier messages**, **Newer messages** and **Return to latest** to move through long conversations. Older task records remain reachable alongside their messages; the browser does not need to render the entire history at once.

Stored history and model context are different. Relay builds bounded per-agent context from the current objective, recent messages, relevant step/tool outputs and a limited number of older matching messages from that same conversation. Source references and untrusted-data boundaries are retained. It does not silently attach unrelated private conversations.

Automatic conversation summaries, vector retrieval and a general project-memory system are not currently implemented.

## Public web research and Git

### Public web research

In **Execution options → Research network access**, choose:

| Setting | Behavior |
| --- | --- |
| **Disabled** | No research web requests |
| **Approve each request** | Requests need approval and must match a permitted origin |
| **Allow listed origins** | Eligible requests to the explicit list can proceed under task policy |

Enter exact HTTPS origins, one per line, such as `https://nodejs.org`. Use origins without paths. Remote users choose only from origins granted by the owner.

The HTTP tool is a bounded public-page fetcher. It does not support logged-in browser sessions, cookies, custom authentication headers, private/local IP destinations or general browser automation. Redirect destinations must also be authorized. Output truncation is explicit.

A question asking to “research” does not itself grant the network. Without network access, a model may answer from its existing knowledge; use tool receipts and sources to distinguish that from fresh retrieval.

### Git inspection

The structured Git tools inspect status and diffs against a managed workspace baseline using a trusted Git executable. They do not expose a free-form host shell.

Source `.git` directories are not imported. These tools therefore do not reproduce the original project's branches, index or commit history. They do not commit or push changes. A baseline created on first inspection of a legacy workspace is identified as such rather than represented as its original import state.

[Tool boundaries and evidence →](research-and-git-tools.md)

## MCP tools

MCP adds controlled external tools. The current implementation intentionally supports a limited transport: **anonymous public HTTPS on port 443 with the pinned modern protocol**. Authenticated/OAuth servers, local stdio processes, private-network endpoints and legacy protocol fallback are unavailable.

### Configure a server as owner

1. Open **MCP tools** from the command palette or navigation.
2. Enter the public endpoint and use discovery. This contacts that service; it does not authorize an agent call.
3. Inspect tool names, descriptions and input/output contracts. Treat the catalog as untrusted text.
4. Select the exact contracts you want to pin and save the server.
5. Enable the saved server explicitly when it is ready for use.

New configurations default to disabled. The application supports up to eight servers and twenty pinned tools per server. Saved contract fingerprints cover the schema and description as well as the tool name.

### Use it in a task

Select the enabled server in **Execution options**, separately authorize its HTTPS origin, and inspect each requested external call in Activity. Invited users also need an account grant for that server.

A selected server without its required origin is a scope gap, not an implicit network grant. Even **Allow listed origins** does not waive MCP's exact-call approval.

The host checks the remote catalog against the owner-pinned contract before invocation. Changed contracts need fresh owner review. Server annotations such as “read only” do not decide permission, and a tool named “search” is not guaranteed to have no remote side effects.

If an external action was dispatched but its effect cannot be established, Relay records uncertainty and blocks automatic replay. Its local checkpoint system cannot roll back a remote service. [MCP security and compatibility →](controlled-mcp.md)

## Remote access and user management

Remote access is optional and disabled by default. Local use remains available if Internet access, the tunnel or the external identity provider fails.

The implemented deployment path uses **Cloudflare Tunnel + Cloudflare Access**, with a separate loopback gateway on port **4318**. The ordinary owner service remains on **4317**.

**Never publish the owner service directly.** Do not expose PostgreSQL, Ollama, LM Studio or Docker management endpoints. A URL is an address, not permission to control the computer.

### Configure the gateway

Follow [Google sign-in and permanent address setup](remote-setup.md) for identity-provider configuration, TLS/Host requirements and tunnel ingress rules. Use a domain and Access application you control. In **Access → Remote gateway**, save the HTTPS address, Access issuer, application audience and registration mode. Restart Relay, then explicitly enable the listener. Advanced environment configuration takes precedence over saved settings.

The setup form persists deployment identifiers, not Google or tunnel secrets. Keep those in the corresponding gateway/service credential store. A saved URL does not prove the public tunnel works. Test an authorized account, an uninvited account and revocation before relying on remote access. Public deployment acceptance remains separate from local tests. Keeping the same domain, named tunnel and host data directory preserves the address and accounts across Relay updates.

The separate listener shares the host process; it is a request/authentication boundary, not a separate OS isolation boundary.

### Add a user

In **Access & remote connections**, add the exact email identity accepted by the configured identity provider. Choose Chat user or Trusted user, then review the policy.

Adding a user creates an allow-list entry. It does not send an email invitation. New users start with local model access, no workspace grants and no cloud spending.

Alternatively, select **Owner approval** registration. Google-authenticated people permitted by your Access policy can request an account by opening the link. Their request appears as pending; they have no model or computer access before approval. Open the request, choose grants, then approve it. Denied accounts stay denied on subsequent sign-ins. The host accepts at most 100 pending requests and 1,000 non-owner registration records.

Grant each dimension deliberately:

| Permission | What it controls |
| --- | --- |
| Allowed intelligence | Which local runtimes/cloud providers the account may use |
| Granted workspaces | Which managed projects are visible to tools |
| Maximum computer access | The upper limit for task access mode |
| In-flight tasks, calls and active seconds | Account/task limits; up to three tasks execute on the host and one local inference call runs at a time |
| Daily cloud budget | Cloud spending allowance in addition to task limits |
| Network origins and access | Public research destinations and approval ceiling |
| MCP server IDs | Which enabled external catalogs the user may select |

A role name alone does not grant arbitrary host files or terminal access. Backend ownership checks protect conversations/tasks even if someone guesses an ID. Remote users can configure their own permitted cloud credentials; they cannot access the owner's keys, change local runtime settings or grant themselves capabilities.

### Personal cloud accounts

In **Models → Your provider connections**, connect each provider that the owner has allowed. Keys are sent over the authenticated HTTPS connection and retained only in the host service's memory or your separate entry in its OS secret store. Session-only credentials disappear when the host restarts or the owner revokes your account's sessions/policy. Other Relay users never receive them. Trust the host operator: its OS administrator controls the machine and credential store.

Google sign-in is for your Relay account. It does not authorize a ChatGPT/Claude/Gemini consumer subscription for these APIs. OpenAI, Anthropic and Gemini currently use personal API credentials in Relay. No cloud connection is necessary to use the host's permitted local models.

Cloud sharing still starts at **Local only**. Change it explicitly for a task. Strict monetary caps reject models whose prices are unknown. If the owner enables **Allow personal API use without a dollar cap**, you can leave the task cap empty and rely on call/time limits plus spending controls in your own provider account. Relay reports unknown charges as unknown; this option cannot guarantee a dollar limit.

### Sessions and revocation

The owner can inspect active browser sessions and remote work. Browser/user-agent labels are useful descriptions, not proof of a physical device's identity.

- **Revoke session** ends that browser's access.
- **Revoke sessions & stop work** ends a user's sessions and cancels their active tasks.
- Saving a changed user policy revokes previous sessions and active work so the new policy takes effect.
- **Stop remote work** stops invited users' work while leaving owner work alone.
- **Disable remote access** revokes remote sessions/tasks without disabling local access.
- **Stop all agents** remains the host-wide emergency action.

Remote sessions last up to one hour and depend on continued valid gateway identity and host policy. Revoking one browser session does not by itself cancel every task already created by that user; use the user-level stop when that is your intent.

Accounts have at most 20 active browser sessions. Existing valid sessions continue working at the limit; sign out another browser or ask the owner to revoke one before adding a device. Remote **Sign out** deletes the current Relay session and opens Cloudflare Access logout, which also ends that Access session across its protected applications. It does not cancel work already submitted or delete conversations.

## Data, backups and updates

### Where data lives

| Launch mode / platform | Default data location |
| --- | --- |
| Source checkout | `Relay/.data/` |
| Packaged Windows | `%LOCALAPPDATA%\Relay` |
| Packaged Linux | `$XDG_DATA_HOME/relay` or `~/.local/share/relay` |
| Packaged macOS | `~/Library/Application Support/Relay` |

`RELAY_DATA_DIR` can select an absolute custom location. Use the same value for the host and pairing command. Only one host process may own a data directory.

The host stores structured PostgreSQL data, managed workspaces, checkpoints and artifacts separately. Default embedded PGlite needs no external PostgreSQL service. Native PostgreSQL uses `DATABASE_URL`.

Provider keys saved in the OS vault are separate from ordinary database rows. Their secure-store references can exist in the database; the secret values are not a normal conversation field.

### Back up

1. Stop the host gracefully.
2. Back up the entire data directory for an embedded installation.
3. If using native PostgreSQL, back up that database separately as well as filesystem artifacts.
4. Handle any OS-vault migration through the platform's supported credential mechanisms.

A data-directory copy does not export the OS vault. Conversation content, artifacts, logs and backups may contain private project information; protect them with your normal account permissions and volume/backup encryption. Relay does not claim custom at-rest encryption of all application data.

### Update

Stop the host, make a backup, update the source or replace the extracted package, then use its setup/launch procedure. Source setup rebuilds stale outputs and installs locked dependencies when needed. Database migrations occur through the host; arbitrary downgrades are not guaranteed safe.

Do not open a database directory from two hosts or delete it to troubleshoot a model error. [Operations reference →](operations.md)

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Browser cannot reach Relay | Confirm the host is running and use `http://127.0.0.1:4317`. Run setup `--check`; inspect the host terminal or startup log. |
| “Pairing required,” expired code or session | Generate a fresh pairing code using setup or `npm run pair` from the same host account/data directory. Codes expire after five minutes; local sessions after up to twelve hours. |
| Pairing another browser invalidated a code | Codes are one-use credentials. Avoid concurrent pairing commands, then use the newest protected file. |
| No models available | Start Ollama/LM Studio with an installed model, enable the provider and refresh discovery. No cloud connection is required. |
| Local runtime exists but a model is rejected | Inspect required capabilities, context, metadata and hardware-fit reasons. Tool objectives need tool support; unknown data can block safe admission. |
| Paused for RAM/GPU pressure | Free memory yourself, choose a smaller model or reduce context for a new task. Review the safety reason before resuming; another stage such as Balanced review also needs admission. |
| Answer text is visible but task still checks | Tool-enabled or specialist Balanced tasks and deeper modes include review. Follow the factual status and Activity; intermediate text is not a completed, verified result. |
| No output while a model loads | Inspect Activity and the runtime. Loading/generation can take time; do not infer a successful run from a spinner. |
| Task waiting for approval | Open Activity and inspect host, workspace, action and exact arguments. Use an explicit decision. |
| Terminal unavailable | Read Machine's execution-boundary reason. Docker/image/preflight requirements must be satisfied; there is no host-shell fallback. |
| Host mode unavailable | Only a paired local owner can confirm direct host file access. Remote accounts cannot enable it. Native shell commands remain unavailable. |
| Provider connected but never selected | Check enabled state, task cloud-sharing policy, model capability/context, account provider grant and cloud budget. Connection alone does not authorize sharing. |
| Strict cost cap rejects a provider | Its prices may be unknown. Relay cannot guarantee a cap with unsupported price information; choose another eligible model or explicitly reconsider the budget. |
| Secret-store save fails | Check OS-vault availability/unlock status. Choose explicit session-only storage if appropriate; credentials then need re-entry after restart. |
| Web/MCP denied in Local only mode | Inference privacy and tool network grants are separate. Set only the exact required origins and server grants; private endpoints stay blocked. |
| MCP discovery/contract fails | Check supported anonymous HTTPS/protocol/schema restrictions. Re-review a changed contract rather than bypassing the fingerprint check. |
| Git inspection unavailable | Ensure a supported trusted Git installation exists and inspect baseline/size limits. Source repository history is not imported. |
| Revert refused | Files changed after the recorded operation. Inspect current content and resolve the conflict rather than forcing overwrite. |
| Task cannot resume after an interrupted tool | Effects may be uncertain. Inspect the real filesystem or remote service before issuing a new objective. |
| Stop remains active after restart | The emergency stop is persisted. The owner must explicitly Resume Relay; restart is not a bypass. |
| Remote user cannot open a conversation | Ownership and grants are enforced on the backend. Use that user's own history; a guessed/copied private ID does not grant access. |
| Remote access works poorly or fails | Inspect tunnel/Access identity configuration and gateway status. Local use does not depend on those external services. |
| Setup cannot stop a running host | It may have been started manually or by another service manager. Stop it through its actual launcher; setup will not kill an unrelated listener. |

When reporting an issue, include the host OS, Relay version, affected task ID, visible error and a small relevant log excerpt. Remove pairing codes, cookies, API keys, private prompts and confidential file content. Distinguish an ordinary fixture test from an actual runtime or remote deployment result.

## Recent workflow improvements

- **Attach files:** use the paperclip or drag files onto the chat. Text/code is supported directly; PDF and `.docx` create an explicitly labeled extracted text copy. Originals stay on your device. See [format and size limits](personal-files.md).
- **Choose permissions first:** selecting Supervised or Autonomous with no workspace prepares a private workspace before applying the mode. You no longer need host-folder write privileges to upload and manage your own files. Shared folders and unrestricted host access retain separate grants.
- **Know the model:** the task's model strip uses actual model selection and call records, including fallback changes. Auto remains your selection preference; the strip identifies what the task actually selected or ran. Agents use the same model routing and hardware protection.
- **Completion alerts:** open **Notifications** from navigation or the command palette. In-app alerts are available while Relay is open. Enable system notifications explicitly for a generic alert when the tab is in the background; no prompt, answer or filename appears in the system notification. Unsupported phone browsers show in-app alerts. Closing the browser disables this delivery path; scheduled reminders and Web Push are not implemented.
- **Efficient output:** Execution options include Efficient/Standard and a maximum output allowance per call. A shorter allowance can truncate a complex answer, so Relay pauses on reported truncation and does not describe it as complete. Required verification remains intact.
- **Fresh models:** opening Models queries the installed runtime catalog. Download models through your runtime, then reopen the panel. Being installed does not mean a model fits current memory.
- **Google for Gemini:** the owner configures a Google OAuth application once; each permitted account then connects separately. Follow [the setup guide](google-connection-setup.md). Google sign-in does not grant another provider's consumer subscription, Gmail or Calendar access.

### Mobile-data DNS troubleshooting

If the public address works on Wi-Fi but reports `DNS_PROBE_FINISHED_NXDOMAIN` on mobile data, compare the exact full hostname and another DNS resolver before changing Relay. For this deployment, both Google and Cloudflare public DNS resolved the Worker and Access names on 9 October. Android can use Private DNS `one.one.one.one`; iOS can use Cloudflare's 1.1.1.1 app for cellular DNS. This is a troubleshooting option, not a required Relay client. Do not disable TLS or authentication to address a DNS failure. [Android](https://developers.cloudflare.com/1.1.1.1/setup/android/), [iOS](https://developers.cloudflare.com/1.1.1.1/setup/ios/).

## Further reading

- [Architecture and implementation decisions](architecture.md)
- [Security model](security-model.md) and [local owner pairing](adr-012-local-owner-pairing.md)
- [Local inference](local-inference.md), [calibration](calibration.md) and [execution budgets](adr-014-durable-execution-budgets.md)
- [History retrieval](history.md), [MCP](controlled-mcp.md) and [HTTP/Git tools](research-and-git-tools.md)
- [Validation evidence](validation.md) and [remaining project work](project-report.md)


## Provider, model and reasoning drawer

Use **Choose model** beside the composer. Choose a connected provider, then one of its discovered models and a supported reasoning setting. Apply keeps your draft unsent; cloud sharing is an explicit choice. Auto can include authorized local and cloud models and selects economical supported effort. Output/call/cost limits remain in Advanced. See [model selection](model-selection.md) for supported controls, costs and provider-default limitations.

## Approved memory and scheduled work

Open **Commands → Manage memory** (or **Menu → Memory**) to save a project fact or personal preference. Saving and editing require your approval. Disable a note to stop including it in future tasks; export or permanently delete your own notes from the same view. Notes remain untrusted context and grant no permissions. See [memory](memory.md).

The local owner can open **Manage schedules** to save a disabled one-time or repeating task, then review and enable its per-run limits. This first version permits only local, read-only work without external tools. Inspect run history, disable and cancel pending runs, or archive a schedule. Intervals use elapsed minutes, so local clock times may change across daylight-saving transitions. See [scheduling](scheduling.md) for missed-run and crash-recovery behavior.

## Account reads and diagnostics

**Google Workspace** is separate from Gemini model access. After the owner configures a dedicated Google Cloud application and you authorize your own account, explicitly search/read Gmail or inspect calendar events and availability. Opening the panel never fetches mail automatically. Advanced task controls also offer explicit Gmail and calendar read scopes. Opting in permanently keeps that conversation local-only and read-only; use a separate conversation for cloud models. Sending and event changes remain unavailable. See [Google Workspace setup](google-workspace.md); a configured application alone does not prove a working account connection.

Expand **Where the time went** in task activity to inspect recorded execution, model, tool and waiting intervals. Unknown measurements stay unknown; overlapping intervals must not be added together. The local owner can export a bounded metadata-only diagnostic bundle in **Machine**, or review an explicit **Data retention** cleanup preview there. No automatic destructive cleanup is enabled. See [diagnostics](diagnostics.md), [retention](retention.md) and [offline backups](backups.md).

**Models → Evaluate executable coding** offers an optional synthetic coding suite using an approved isolated Node environment. It requires explicit compute confirmation and a configured, available sandbox; otherwise the action stays disabled. Reports bind the exact model and container configuration. They do not yet change Auto ranking or prove broad coding quality. See [coding evaluations](code-evaluation.md).
