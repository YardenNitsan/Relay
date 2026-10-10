# Trusted development image and native language acceptance plan

> For agentic workers: use superpowers:executing-plans for implementation.

Owner scope: C04/C05, directive sections 7 and 21. Continue after the active coding acceptance and its verified checkpoint. This increment provisions reproducible owner-selected images and verifies native language execution. Online project dependency restoration, package-source grants and broader project builds remain separate open work.

## Findings and design

Existing profiles correctly require a digest-pinned local image and run a fixed unprivileged language probe, but only the default/Node image has native acceptance. Python and .NET images also need the trusted Node24 supervisor. Do not copy the Alpine/musl Node binary into a glibc base. The inspected [official Node24 Bookworm Dockerfile](https://raw.githubusercontent.com/nodejs/docker-node/main/24/bookworm-slim/Dockerfile) includes runtime library verification; the [official Python Bookworm Dockerfile](https://raw.githubusercontent.com/docker-library/python/master/3.14/slim-bookworm/Dockerfile) uses the same Debian family. [.NET10 uses Ubuntu by default](https://learn.microsoft.com/en-us/dotnet/core/compatibility/containers/10.0/default-images-use-ubuntu); do not assume a nonexistent Bookworm tag.

Use reviewed official image manifests pinned to immutable digests. Keep provisioning an explicit owner/developer command, not an agent tool or an automatic runtime download. Build from a small dedicated context containing only reviewed Dockerfiles and a lock manifest; never send the repository or user files as build context. Include Node's required shared libraries in a compatible, inspected way and test the actual supervisor entrypoint. No package installation from arbitrary registries during execution.

Native .NET build output is binary, whereas workspace exchange accepts bounded UTF-8 files. Direct build/intermediate output to disposable container `/tmp`, preserve original sources, and verify command receipts before claiming support. Investigate actual PID/memory/tmpfs limits; do not weaken them merely to pass a build. Any configurable tier needs explicit bounded admission and regressions. Keep SDK telemetry off and no network.

## Dependency-ordered work

- [ ] Resolve and record official Node24, Python3 and .NET10 image digests/platforms, inspect upstream source/licensing and create minimal reviewed Dockerfiles/lock manifest.
- [ ] Implement explicit local-engine provisioning with fixed registry references, bounded owned build context and no host-user data. Emit actual resulting immutable image IDs without changing the running host's configuration.
- [ ] Verify trusted Node and language probes inside each built image through the actual DockerSandbox, not host execution or an unrestricted `docker run` substituted for broker acceptance.
- [ ] Execute multi-file Python tests and a multi-file C# build/test with actual failing-before/passing-after behavior, offline sources and disposable binary output. Keep original workspace hashes intact except approved source edits.
- [ ] Record actual versions/image IDs, limits, errors and supported host/container architecture. Add deterministic regressions for confirmed defects; run native and relevant security checks.
- [ ] Add repeatable hosted native acceptance where resource limits permit, document exact owner commands and remaining package-restoration/platform gates; update C04/C05 honestly.

No step in this plan is marked complete by research or a successful image build alone.

## Registry inspection (10 October, metadata only)

`docker buildx imagetools inspect` resolved these official indexes without downloading or executing their images:

- Node24 Bookworm slim: `sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20`; amd64 manifest `sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd`; source revision `93a7bafc324a85ac1ee461604cff87cffacb6d7a`.
- Python3.14 Bookworm slim: `sha256:48b13b003dda20b16f9442b8475aa05fe21bf6579a8c881db92ffb4d8fd20f83`; amd64 manifest `sha256:a66d3a463d0be3cc537c269b0d3418746dda512417a975559a0eaa8a6406baaf`; source revision `7cc547b3ff8d45d540cd23144227af126a79d60c` and manifest version3.14.8.
- .NET10 SDK Noble: `sha256:e70cdb7f80b0348f5cb85f19a8f670fca061f033d57eed12fa003d58b0e06317`; amd64 manifest `sha256:0eeb52c76e35a5431ca707ad2bc75e38006a05393045d8532ae44c15d9474523`.

Node/Python amd64 manifests use the same Debian base digest. ARM manifests exist but are not native acceptance. Verify resulting runtime libraries and actual broker execution before checking off image support.
