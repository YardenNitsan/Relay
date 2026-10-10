# Relay 0.1.2

10 October 2026. This release strengthens controlled execution, model selection, recovery and the responsive interface. The full modernization directive remains partially implemented; the [workstream status table](evolution-report.md#workstream-status) records delivered and outstanding capabilities.

## Changes

- Fresh durable authorization at managed, host-file, HTTP and MCP dispatch boundaries; revocation and stop-state regressions.
- Ordered checksummed migrations through version 9, historical upgrades and failure rollback tests. Encrypted stopped embedded-database backups include artifacts; restore targets a new directory with execution disabled for review. Owner-confirmed retention protects referenced state.
- Separate active, approval and resource-wait accounting; approval suspension releases scarce execution slots. Account concurrency and bounded scheduler fairness are aligned.
- Connected-provider/model/reasoning drawer with per-account discovery. Auto retains privacy, capability, hardware and budget gates while considering richer task requirements, supported effort, exact expiring prices and compatible evaluation evidence. Broad measured routing-quality gains are not established.
- Validated bounded workflow graphs, compact structured handoffs, explicit private project/preference memory and durable owner-controlled local read-only schedules.
- Pinned isolated Node/Python/.NET profiles. Existing-file source publication requires frozen review and exact approval, rejects conflicts and records uncertain effects; rollback requires separate review. No unrestricted host shell, dependency-installation network or automatic remote push is added.
- Separate Google Workspace consent and explicit local-only, read-only Gmail/Calendar task tools. No email sending or calendar mutation. Unconfigured connections remain unavailable.
- Versioned synthetic capability evaluations and a separate isolated executable Node suite. Generated code never runs on the host; missing sandbox configuration refuses before inference.
- Observed content/load/stream/cleanup timing and bounded diagnostic export. Startup locking prevents stale-lock reclamation races; authenticated external inference tolerates bounded cold loads without relaxing service deadlines.
- Responsive conversation controls, Advanced disclosure, factual execution summaries, model drawers, publication review and memory/schedule/account panels. Keyboard, draft preservation, approvals and narrow layouts have browser regressions.

## Verification

The final implementation passed strict types and **1,194 deterministic tests with one platform-specific skip across 110 files on both Windows and Ubuntu WSL**, production builds, and **110/110 Windows Chrome browser tests**. WSL additionally passed actual compiled-host pairing, private-file permissions, CSRF, persistence, restart and SSE checks. Browser coverage includes 320px and 390px viewports; this does not constitute physical phone or complete accessibility certification.

The production-data backup was encrypted, verified and restored separately before migration 9 activation. All 16 visible conversations and eight unfinished tasks were retained. Current live inference, archive and release evidence is recorded in [validation](validation.md); earlier dated checks remain explicitly historical.

The running 0.1.2 build passed actual LM Studio generation (274 input / 56 output tokens, saved answer, no residual Relay instance), persisted phase timing inspection, and the external Responses API with real output (41 input / 10 output tokens) and unchanged Relay chat history. Eight live desktop/phone panels passed without runtime errors. The measured greeting took 15.75 seconds including 10.83 seconds of loading; this is one cold-load observation, not a performance improvement claim.

## Upgrade and daily operation

1. Finish or pause current work and stop the setup-managed host with `setup.cmd --stop` (Windows) or `sh setup.sh --stop` (Linux/macOS).
2. Preserve a stopped encrypted backup and its separate key using the [backup guide](backups.md). OS-vault credentials and original host project files require separate protection.
3. Update the source/dependencies and run `setup.cmd` or `sh setup.sh`. Setup builds as needed and starts the loopback host. Migrations apply transactionally; incompatible or corrupted histories fail closed.
4. Open `http://127.0.0.1:4317`. For daily Windows use, double-click `setup.cmd`; the launcher reuses an already-running host and opens the browser/private pairing file when needed.

Do not open migrated data with an older binary. For rollback, restore the stopped backup into a new directory with the compatible version and complete restoration review. Keep the original backup and key. [Database upgrade details](database-upgrades.md).

## Remaining limits

Native PostgreSQL backup/locking acceptance, actual Docker profile execution, live Google consent and cloud provider acceptance, held-out routing-quality measurements, overall task deadlines, full Git branch/add/delete workflows, controlled dependency installation, semantic indexing/OCR, write connectors, browser/desktop automation, conditional/remote-user scheduling and real external CLI compatibility remain incomplete or externally blocked. Physical-device accessibility, physical Linux GPU, native macOS and signed installers are not verified. Portable archives are unsigned integrity-checked candidates, not native installation certification.

No resource safety margin was reduced. Estimates and monitoring do not guarantee crash-free execution. No paid provider call, model download or new public infrastructure deployment was required for this release verification.
