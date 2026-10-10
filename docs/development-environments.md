# Isolated development profiles

The managed `terminal` tool accepts `profile: "default" | "node" | "python" | "dotnet"`. Profiles select an owner-configured, already installed Linux container image. They do not grant host shell access, network access, package installation privileges, or Docker access to the model. Existing calls that omit the profile retain the default image configuration.

| Profile | Owner environment variable | Required runtime inside image |
| --- | --- | --- |
| default | `RELAY_SANDBOX_IMAGE` | Node 24+ at `/usr/local/bin/node` |
| node | `RELAY_SANDBOX_NODE_IMAGE` | Node 24+ at `/usr/local/bin/node` |
| python | `RELAY_SANDBOX_PYTHON_IMAGE` | Python 3.11+ at `/usr/local/bin/python3` |
| dotnet | `RELAY_SANDBOX_DOTNET_IMAGE` | .NET SDK 8+ at `/usr/bin/dotnet` |

Every image also requires Node 24+ at `/usr/local/bin/node` for Relay's trusted supervisor. These minimum versions describe protocol compatibility, not a promise that an old runtime remains supported upstream. The owner must provision and maintain trusted images and approved offline dependencies. Named language profiles require an immutable `sha256:<64 hexadecimal digits>` image ID or `repository@sha256:<64 hexadecimal digits>` digest. There is no fallback from an unconfigured language profile to another image. The legacy default accepts its existing tag configuration and resolves it to the installed image ID before execution.

After installing and reviewing an image through the owner's normal provisioning process, set the corresponding environment variable for the Relay host and restart Relay. No image is downloaded by these tools: execution uses Docker's [`--pull=never`](https://docs.docker.com/reference/cli/docker/container/run/) policy. A profile's availability check confirms the local engine and image; runtime compatibility is verified separately on each execution. The existing hardware panel reports default-image status, not a complete language-profile inventory.

An example terminal request is:

```json
{"profile":"python","argv":["/usr/local/bin/python3","-I","-m","unittest","discover"],"timeoutSeconds":30}
```

The tool argument schema, task permission, exact-argument approval, fresh authorization, cancellation and managed-workspace boundaries still apply. Before running the requested command, Relay starts a separate fixed runtime probe through the same unprivileged child bootstrap. It uses an absolute executable, no shell, a five-second subprocess timeout, bounded output and `/tmp` as its working directory. The Python probe uses [`-I` isolation](https://docs.python.org/3/using/cmdline.html#cmdoption-I); Node and .NET use their documented version commands ([Node](https://nodejs.org/api/cli.html), [.NET](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet)). An absent, unsupported or malformed runtime stops execution before project code runs.

The probe consumes part of the command's existing timeout. Its observed profile/version and the resolved immutable image ID are recorded with command-exit evidence. A command's own stdout cannot replace that provenance. An observed version is evidence of the configured runtime, not an attestation that an owner-supplied image is trustworthy.

All existing limits remain: no network, read-only container root, no writable host mounts, one CPU, 512 MiB memory, 64 MiB workspace and `/tmp` filesystems, bounded file/output/process counts, capability removal for project code and verified process cleanup before workspace reconciliation. Missing cleanup proof blocks later admission. A Python or .NET profile does not mean every project fits those quotas. Dependencies must already exist in the trusted image or admitted workspace; online package restoration is unavailable.

Provisioning is now available through `node --import tsx scripts/provision-development-images.ts all`. See [reviewed image instructions](../development-images/README.md) for pinned sources, local-engine checks and explicit configuration. This owner command downloads official image layers; agent execution still never downloads an image or installs dependencies online. It copies only one reviewed Dockerfile into each build context, rejects remote transports/Buildx overrides and binds the default local builder.

The explicit .NET profile uses a64MiB process file-size limit: CoreCLR clips its executable-memory mapping to RLIMIT_FSIZE, so the original1MiB limit prevented even SDK startup. This changes neither physical RAM/CPU/PID/tmpfs quotas nor the1MiB exported-file limit. Write-Xor-Execute remains enabled. Redirect build/intermediate binaries to disposable `/tmp`; they cannot be returned as UTF-8 workspace files.

Verification: deterministic tests execute the fixed probe and preflight protocol, exercise authorization/profile forwarding through the real broker, and reject forged/missing provenance. Actual Windows Docker Desktop Linux/amd64 acceptance now rejects seeded faults and passes corrected small multi-file Node24.21.0, Python3.14.8 and .NET10.0.401 programs; .NET compiles offline before running. A native receipt verifies512MiB RAM,one CPU,64PIDs and the selected file cap. These are small runtime checks, not medium-project or package-restoration acceptance. Native hosted Linux follow-up, ARM/macOS and larger projects remain separately tracked. Original-project publication remains an explicit owner workflow.
