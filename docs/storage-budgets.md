# Managed artifact storage

The broker checks aggregate managed content before creating snapshots, uploading files, writing checkpoints, reverting files or making temporary Git objects. The accounting includes `workspaces`, `baselines`, `checkpoints`, `runs`, `containers` and `git-runs`. Database and logs are separate from this artifact budget; they still consume the measured free space of the same host volume.

The default content limit is the smaller of 4 GiB and ten percent of the volume. Each operation must also leave the smaller of 5 GiB and ten percent of the volume free. Reservations include replacement-file and checkpoint serialization overhead, rather than only the final file-size difference. Current free-space measurement is mandatory. Missing telemetry, unsafe links, special files or an oversized inspection fail closed. Traversal is bounded to 100,000 entries and depth forty, and never follows symbolic links or file hardlinks.

Checks occur inside the broker's serialized mutation boundary. This is admission control for Relay's own writes; other applications can still consume space after a measurement. It is not a filesystem quota imposed on the whole computer, database retention policy, or a replacement for kernel limits on an untrusted subprocess. Successful command staging copies are removed after their checkpoint is saved; interrupted staging is retained for owner inspection and counted on the next admission.

There is no automatic destructive retention policy. Machine now provides an explicit preview and confirmation for bounded expired credentials and eligible terminal task payloads; see [retention](retention.md). That policy preserves resumable tasks, uncertain effects and mutation checkpoints, and does not delete workspace artifacts. If the artifact budget is reached, stop the service, back up its state and perform deliberate owner maintenance. Removing referenced checkpoints or database records casually is unsafe.

Tests cover aggregate accounting including baselines/temporary copies, free-space reserves, missing telemetry, invalid reservation sizes and an actual broker write denied before either file content or a checkpoint changes.
