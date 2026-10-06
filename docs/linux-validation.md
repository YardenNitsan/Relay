# Native Linux validation

Relay's shared core has been executed under native Linux Node.js in Ubuntu on WSL2, rather than inferred from TypeScript compilation on Windows. This validates the Linux runtime and POSIX filesystem path; it does not establish macOS compatibility or native Linux GPU, desktop, installer, or sandbox guarantees.

## Reproduce

On Linux in this Git checkout:

```sh
bash scripts/linux-verify.sh
```

On the development Windows host with its existing Ubuntu WSL distribution:

```powershell
wsl.exe -d Ubuntu -- bash /mnt/c/Users/yarde/Documents/codexp/Relay/scripts/linux-verify.sh
```

The script uses an isolated directory beneath `/tmp/relay-linux-verification`. It downloads the official Node.js 24.11.1 Linux archive and checks it against the HTTPS-published SHA-256 manifest. It does not install global packages, change startup services, or modify the operating system. An existing local runtime in that directory is reused.

The input is a Git-index/ignore-filtered snapshot of the current working tree, including uncommitted implementation changes. Explicit rejection rules exclude runtime data, credentials, dependency trees, and generated releases. The archive hash identifies the exact tested snapshot. Dependencies are installed from the existing lockfile using native Linux npm, without copying Windows `node_modules`.

Each run retains `install.log`, `check.log`, `build.log`, `source.sha256`, the source archive, `host.log`, and `host-smoke.json` in its private verification directory. Only the sanitized final report is copied back to `output/linux-validation.json`. No pairing codes, session credentials, provider keys, or host data are copied back.

## What the compiled-host verification checks

- Unpaired native HTTP clients cannot obtain an owner session or read conversations.
- The actual compiled pairing CLI creates owner-only POSIX directories (`0700`) and credential delivery files (`0600`). Credentials stay in memory and private files.
- Pairing establishes an owner session; replay of its consumed code is rejected.
- Authenticated mutations without the session's CSRF token are rejected.
- A real conversation is written to filesystem-backed embedded PostgreSQL.
- The actual hardware endpoint returns Linux telemetry; unavailable fields remain explicitly unknown.
- The production service serves its built browser application.
- A graceful shutdown and restart preserve the conversation and authorized session.
- The authenticated event stream survives its idle heartbeat after restart.
- Issued pairing, session, and CSRF tokens do not appear in collected host logs.
- Both compiled service instances exit cleanly after `SIGTERM`; no service is left running.

The full strict-type check and deterministic test suite run before the build and compiled-host checks. Expensive inference and paid provider calls are not part of this harness.

## Recorded evidence

The final run on 2026-10-06 at 18:14 UTC used Linux `6.6.87.2-microsoft-standard-WSL2`, x86_64, Node.js `v24.11.1`, and npm `11.6.2`. Locked installation, strict types, **249 tests across 24 files**, the production build, and all nine compiled-host checks passed. This snapshot includes the required file-evidence verification contract and its adversarial completion tests. Both service instances stopped gracefully. Actual telemetry identified 20 logical CPU cores, 16,512,090,112 bytes of physical RAM, and no exposed GPU; the scheduler correctly reported CPU memory architecture.

The tested source archive is retained at `/tmp/relay-linux-verification/run-Ht3tk5qi/source.tar`, SHA-256 `e65a3890ff1ada037160c27398d29396cf3f65352d4a09728cbc489c42a13c9d`. This is a working-tree snapshot, not a claim that an earlier Git commit contains these changes. `output/linux-validation.json` records the timestamp, source hash, native test counts, telemetry, and host checks. Rerun the harness after subsequent source changes; do not combine results from different source snapshots.

## Remaining platform evidence

WSL2 reports a virtualized Linux machine and its available devices. These results do not claim bare-metal NVIDIA/AMD/Intel inference, native keyring daemon availability, container command execution, Linux browser rendering, systemd installation, public gateway deployment, or signed distribution support. macOS requires its own execution evidence. Those remain separate release checks, with no silent host-shell or plaintext-secret fallback.
