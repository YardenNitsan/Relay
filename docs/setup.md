# One-command setup

From the Relay directory, run:

```powershell
.\setup.cmd
```

On Linux or macOS:

```sh
sh setup.sh
```

The command prepares the local project and opens Relay at `http://127.0.0.1:4317`. An existing Relay host is reused without replacing its dependencies, rebuilding its application, or interrupting its tasks. Pending source changes are reported; stop that host before running setup again to apply them.

## What setup does

1. Reuses an available Node.js 24 or newer. If Node is missing or too old, the wrapper downloads the official **24.21.0** distribution into this project's ignored `.tools/` directory, verifies its SHA-256 against the official HTTPS checksum manifest, and retains Node's license. It does not install Node globally or edit PATH permanently.
2. Checks the complete installed dependency tree against the lockfile. A cold setup runs `npm ci` when dependencies are missing or inconsistent. It builds the production browser and host when inputs have changed or outputs are missing.
3. Recognizes Relay's exact loopback pairing response and browser shell. An unrelated service or redirect on the selected port is refused. Setup never kills it or exposes Relay on a public address.
4. Starts a new host detached from the setup terminal, with private logs beneath `.data/startup/`. Closing the setup terminal leaves this host running. Windows background process creation hides its console window.
5. Uses Relay's existing native pairing CLI to create a five-minute, one-use pairing code. It opens the browser and the private code file in the operating system's application. Enter the file's `token` value into **Connect this browser**. The token is never printed to the terminal or included in a URL.
6. Checks whether Ollama is reachable and reports the installed model count. It does not install model runtimes, download models, connect cloud accounts, or weaken hardware admission.

The default data location for this source checkout remains `.data/`. Existing `RELAY_DATA_DIR` and `RELAY_PORT` settings are respected; the latter must be a loopback port from 1024 through 65535. Use the same data-directory setting when stopping or pairing that host.

## Options

| Option | Behavior |
| --- | --- |
| `--no-browser` | Starts or reuses Relay and issues pairing, then prints the URL and private file location without opening applications. |
| `--check` | Inspects Node, dependencies, build state, local service and Ollama. Does not download, install, build, start, pair, or stop anything. |
| `--stop` | Gracefully stops a host previously started by setup, using an owner-only private shutdown request. It refuses to terminate manually started hosts or unrelated processes. |
| `--help` | Prints usage. |

For example, restart a setup-managed host on Windows with:

```powershell
.\setup.cmd --stop
.\setup.cmd
```

The Unix equivalent is `sh setup.sh --stop`, followed by `sh setup.sh`. A manually started `npm start` host must be stopped in its original terminal or service manager. **Stop all** in the browser stops agents and scheduling; it keeps the host application running.

`setup.ps1` is an optional convenience wrapper when your existing PowerShell policy permits script files. `setup.cmd` also works under the usual unsigned-script restriction: bootstrap uses fixed inline PowerShell commands and does not change execution policy or require administrator access.

## Prerequisites and offline behavior

Windows bootstrap uses Windows PowerShell and its archive/hash commands. Linux/macOS bootstrap needs `curl`, `tar`, and either `sha256sum` or `shasum`; it supports x64 and ARM64. Missing operating-system utilities are reported rather than installed with elevated privileges. A complete official Node distribution includes npm. Runtime compatibility still depends on Node's supported operating-system versions and libraries.

The first dependency installation and a missing-Node bootstrap require Internet access. An existing host or a prepared project can be launched without downloading dependencies. No Internet service is required by Relay's local operation itself.

To use local inference, install/start a supported runtime and choose a compatible local model. [Ollama's official download](https://ollama.com/download) is the initial integration. The Models and Hardware views show discovered availability and fit. Large model downloads and hardware policy changes remain explicit owner decisions.

The wrapper follows [Node's official download and checksum guidance](https://github.com/nodejs/node#download). SHA-256 checking against a manifest obtained through HTTPS detects archive corruption; this bootstrap does not claim independent PGP release-signature verification. Detached startup follows the [Node child-process API](https://nodejs.org/api/child_process.html#optionsdetached).

## Verification status

Windows `setup.cmd --help` and `setup.cmd --check` were executed against the existing Node 24.11.1 installation and running Relay host. Check correctly identified Relay and five Ollama model entries without installing, rebuilding, pairing, or stopping anything. Five regression tests cover argument/port validation, wrong-service and redirect refusal, content-based rebuild detection, shutdown-request validation, and native runtime selection. The integrated cold-start/stop result is recorded by the final verification owner; missing-Node downloads and macOS execution must not be inferred from these checks.

Final handover checks on 9 October: strict types and 369 deterministic tests passed across 40 files; production build passed. The 30-case browser run passed 29 cases and hit one connection-indicator timeout; that exact keyboard/accessibility case passed on its focused rerun. The running production host passed desktop/phone inspection of persisted execution, discovered models and hardware. No fresh successful local greeting is claimed.

The Windows launcher passed actual cold build/start, repeat-start reuse, private graceful shutdown, restart and automatic browser/private pairing-file opening. The detached host remains available at http://127.0.0.1:4317. Missing-Node bootstrap, a genuinely fresh dependency installation, Linux/macOS launcher execution and native installers remain unverified. README.md and docs/user-guide.md describe architecture and the complete implemented user experience; docs/setup.md describes one-command setup. Optional model runtimes and model weights are not silently installed.
