# Cross-platform operations

The shared Node.js host and browser run on Windows, Linux and macOS. `server/host/platform.ts` isolates application-data paths and native credential backend descriptions. Inference is delegated to supported runtimes rather than compiled into the host. Actual development acceptance was performed on Windows; Linux/macOS runtime and installer acceptance remain release gates.

| Concern | Windows | Linux | macOS |
| --- | --- | --- | --- |
| Packaged data | `%LOCALAPPDATA%\Relay` | `$XDG_DATA_HOME/relay` or `~/.local/share/relay` | `~/Library/Application Support/Relay` |
| Persistent credentials | Credential Manager | Secret Service, with unlocked session | Keychain |
| Optional startup template | Current-user scheduled task | User systemd service | User LaunchAgent |
| Local acceleration | Runtime-reported CUDA/AMD/CPU | Runtime-reported CUDA/AMD/CPU | Runtime-reported Metal/CPU |
| Commands | Optional Linux-container broker | Optional Linux-container broker | Optional Linux-container broker |

Apple Silicon uses one physical-memory pool, not RAM plus imaginary dedicated VRAM. Metal's native recommended working-set telemetry is not yet bound. Missing measurements remain unknown. See [resource admission](research-providers.md).

## Configuration

| Variable | Meaning |
| --- | --- |
| `RELAY_PORT` | Local loopback port, default 4317 |
| `RELAY_DATA_DIR` | Explicit absolute host data directory; overrides all defaults |
| `RELAY_PACKAGED=1` | Use the native application-data path instead of source `.data/` |
| `RELAY_DEV=1` | Authorize the loopback Vite development origin; `npm run dev` sets this explicitly, production startup does not |
| `DATABASE_URL` | Optional native PostgreSQL connection; otherwise embedded PostgreSQL |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | Optional provider credentials inherited by the service, never tools |
| `RELAY_SANDBOX_IMAGE` | Explicit trusted, already installed Linux-container image for commands |
| `RELAY_REMOTE_ENABLED`, `RELAY_REMOTE_ORIGIN`, `RELAY_ACCESS_ISSUER`, `RELAY_ACCESS_AUDIENCE`, `RELAY_REMOTE_PORT` | Optional authenticated gateway; see [remote setup](remote-access.md) |

Do not commit credentials or store them in ordinary configuration. Prefer the UI's OS vault connection. Linux headless services often lack an unlocked Secret Service session; persistent credential setup must fail explicitly in that environment, rather than save plaintext. Choose a session-only credential if appropriate. Removal of an environment credential masks it for the current service but cannot rewrite its launcher's environment.

## Lifecycle

`npm start` runs the compiled host in the foreground. The local listener always binds `127.0.0.1`. Do not change it to `0.0.0.0` to obtain remote access. One host process may own a data directory; a process lock prevents concurrent embedded database writers. Logs are structured JSON on stdout/stderr. Terminal output and model-native continuation have independent limits and are not dumped into host logs.

Ctrl+C/SIGTERM cancels active transports, stops managed containers and pauses unfinished tasks. Restart recovers persisted tasks, graphs, approval history and events. A browser reconnect replays only incremental events after its cursor. An in-flight operation without a committed receipt is marked uncertain; Relay requires inspection and a new objective rather than replaying it.

The global stop latch persists across restart. A provider may retain its cached model allocation after cancellation; Relay does not unload models belonging to another application. Runtime model retention currently uses a five-minute keep-alive.

## Startup templates

Templates in `packaging/` and distribution `service/` directories are opt-in and require reviewing paths. Never run Relay as administrator/root merely to enable a service.

- Windows: `register-startup.ps1 -InstallDirectory <absolute path>` registers a current-user login task without elevation when your existing script policy permits registration. The action runs Node with `launch.mjs`, which selects the native data directory. The owner can remove it in Task Scheduler. Interactive startup uses `start.cmd`; it does not require changing PowerShell execution policy.
- Linux: adjust installation and Node paths in `relay.service`, install under the user's systemd directory and use `systemctl --user`. Secret Service availability must be tested in that session.
- macOS: replace `INSTALL_DIRECTORY` and the Node path in `com.relay.local.plist`, then install as the user's LaunchAgent. Both Intel and ARM64 use the same source; destination `npm ci` selects native packages.

Templates have not been registered automatically. Packaging does not provide native installer signing, notarization, privilege elevation or automatic updates. Upgrade deliberately: stop the host, back up state, replace application files, install locked dependencies for the destination OS, and start again. Current schema migrations are additive; downgrade compatibility is not promised.

## Storage and backup

The data directory contains embedded PostgreSQL, service-owned workspace copies, file checkpoints and bounded command artifacts. Large filesystem content remains outside message rows. Database rows retain references and provenance. Native PostgreSQL deployments need their own database backup in addition to the filesystem directory.

For embedded PostgreSQL, stop the host before copying the whole directory. Back up the OS credential vault through the OS's supported mechanism; copying application data does not export provider keys. Logs/model context may contain private project text, so treat backups as sensitive. Storage encryption at rest is provided by the host volume, not a custom application cipher. No deletion/retention scheduler or aggregate workspace disk quota is currently implemented.
