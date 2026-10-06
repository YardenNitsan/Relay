# Relay

A local AI execution host with a conversational browser interface. Models propose work; the host enforces permissions, budgets and resource admission; tools produce evidence. Local operation needs no cloud account or remote gateway.

Relay is a working implementation under active development, not a claim that every requirement in the master directive has shipped. Read [validation and release gates](docs/validation.md) before granting access to other people or relying on unattended execution.

Local browsers require a one-use owner pairing code delivered through an OS-account-protected file. Knowing the local URL does not grant owner access. Remote access uses a separate authenticated listener. A compromised owner OS account remains outside this browser security boundary.

## Start from this source checkout

Install Node.js 24 LTS and [Ollama](https://docs.ollama.com/). Then:

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4317**. In another terminal, run `npm run pair`, open the private file whose path it reports, and enter its code in the pairing screen. The code expires after five minutes and works once; the resulting browser session lasts up to twelve hours. Keep the host process running. The source checkout stores data in `.data/`; neither an external database nor Docker is required for conversations, local inference and managed file tools. Stop with Ctrl+C before making a filesystem backup of that directory.

Install a model that fits your machine. On the development host, `ollama pull qwen3:4b-instruct` supplied the model used for actual tool/approval/read-back acceptance. This is an example, not a universal hardware recommendation. Relay discovers installed models and checks current memory before each call. Ollama must be running. Set `OLLAMA_NO_CLOUD=1` in Ollama's own environment if you also want to disable its cloud features; Relay rejects runtime models marked as cloud forwarding.

For UI development, run `npm run dev` and `npm run dev:web` in separate terminals. Vite proxies API traffic to the local host. A backend restart pauses interrupted work; it never automatically replays an uncertain mutation.

## Use it

1. Send an objective. Auto routing considers currently available, permitted models and hardware. Fast uses a worker; deeper modes add validated planning, selected specialists and review. Balanced/deeper execution can repair failed checks within a persistent round limit and the task's remaining budgets.
2. To work with files, choose **Bring a project**. Import creates a managed copy; it excludes credentials, links, Git internals and generated dependency trees. The original repository stays untouched. A blank workspace is also supported.
3. Choose **Read only**, **Supervised**, or **Autonomous workspace**. Supervised mutations wait for a concrete approval. Allow-for-task applies to the exact operation and arguments, not arbitrary future actions.
4. Open **Activity** for roles, models, tool results, verification and file diffs. A successful model response is labelled as generation, not objective verification. Failed tool checks prevent a successful verification claim.
5. **Stop all** immediately latches scheduling off, cancels generation and stops managed commands. Only the local owner can resume global scheduling.
6. **Hardware** exposes owner-controlled resource profiles and runtime-reported resident models. Safe is the default; all profiles enforce minimum reserves. A saved policy applies at each new model admission, including the next call of an active task.

The model manager supports optional OpenAI, Anthropic and Gemini API credentials. A consumer ChatGPT/Claude subscription is not API authentication. Credentials are kept on the server in the OS credential vault, an explicit session-only store or the service environment. Cloud data transmission is a separate policy from choosing a model. Local-only is the default; unknown pricing cannot pass a strict monetary budget.

Terminal tools are deliberately unavailable without an explicitly configured local Linux container image and a working Docker engine. See [security guarantees](docs/research-security.md). No fallback runs model-generated commands on the host. Unrestricted host control is disabled.

## Remote use

Remote access is optional and disabled by default. The supported design uses an outbound Cloudflare Tunnel and Access authentication, a separate loopback gateway, host-managed invitations, sessions and independent user grants. Only port 4318 is a tunnel target; **never publish port 4317 or model/database ports**. A leaked URL grants no account or tool authority.

The owner's **Access** panel manages users, grants, active sessions, running tasks and the gateway switch. Public deployment needs an owner-controlled account/domain and identity policy. Follow [remote setup and threat model](docs/remote-access.md). Local operation continues if the gateway or Internet fails.

## Distributions

`npm run package` produces separate Windows ZIP, Linux tar.gz and macOS tar.gz distributions with checksums. Each contains the compiled browser and host, a pinned dependency lockfile, startup scripts and an optional per-user service template. They require Node.js 24 and a first `npm ci --omit=dev` on the destination OS. They are portable packages, not signed native installers.

From an extracted Windows package:

```powershell
npm.cmd ci --omit=dev
.\start.cmd
```

From Linux or macOS:

```sh
sh start.sh --install-dependencies
```

Later starts omit dependency installation. For browser pairing from an extracted package, run `node launch.mjs --pair` so it uses the same native data directory as the packaged host. An explicit location is also supported: `node dist-server/pair.js --data-dir <absolute-host-data-directory>`. The Windows CMD/Node launcher works without changing PowerShell execution policy; `start.ps1` is an optional alternative when your existing policy allows it. Packaged startup uses the OS application-data directory. See [cross-platform operations](docs/operations.md) for paths, configuration, service templates, backups and current platform validation limits. Initial dependency/model installation may require Internet access; installed local operation does not.

## Development and verification

```sh
npm run check       # strict types + deterministic backend/security tests
npm run build       # browser and host bundles
npm run test:e2e    # real Chrome, isolated fixture service, no cloud expense
```

The E2E runner needs Google Chrome installed. It uses an explicitly named deterministic provider only in its separate test host; the normal application has no fixture provider. `node scripts/acceptance.mjs` tests real installed Ollama inference against a running host and writes evidence to `output/local-acceptance.json`.

The checked-in CI workflow runs the same checks on Windows, Linux and macOS with bundled Chromium. It has not been executed on remote runners in this session. `PLAYWRIGHT_CHANNEL=chromium` selects an installed Playwright Chromium instead of system Chrome.

Start with [architecture and ADRs](docs/architecture.md), [implementation ledger](docs/implementation-plan.md), [research](docs/research.md), [provider/resource design](docs/research-providers.md), [security](docs/research-security.md), [design system](docs/design-system.md), and [validation](docs/validation.md).
