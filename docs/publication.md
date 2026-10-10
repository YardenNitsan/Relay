# Review and publish an imported project

An owner can publish reviewed modifications from a managed copy back to its original imported directory. Open **Workspaces**, select a host-imported project, then **Review publication to original**. Prepare a review, inspect each diff and its exact before/after contents, select the explicit approval checkbox, and publish. A later managed edit cannot change the frozen approved contents. Downloading the review exports those contents; treat that JSON as private source material.

This first publication workflow accepts modifications to existing text files only: at most 20 files and 2 MiB of combined original/replacement text per review. Additions, deletions and renames require a separate workflow and are rejected. It does not stage Git changes, run Git hooks, push branches or invoke a host shell. It does not expose a publication tool to agents. Browser device-folder synchronization remains a separate owner-controlled path.

## Authorization and coordination

Publication is local-owner-only through the existing authenticated, CSRF-protected API. Every execution boundary reloads the exact browser session, its expiry, account status/version, global stop generation and restoration state. Logging out that browser revokes queued and in-flight work without requiring an account-wide session revocation. Approval is an exact digest of immutable review metadata, original/replacement hashes and file identities; reviews expire after ten minutes. A stop-generation change revokes old approvals.

Relay reserves both the managed workspace and its global host-access lane during preview, publication, rollback review and reconciliation. Host-access tasks parked at an approval still block publication. New host tasks remain queued until the reservation is released. The publication service also serializes operations across API listeners, including previews from different workspaces importing the same source. A pending uncertain receipt blocks a new publication to that source.

Before writing, Relay checks the complete set of original hashes, each file identity and the original root identity. It rechecks authorization and identity before each write and between 64 KiB write chunks. Host path protections, hard-link/link rejection, credential-content restrictions and private checkpoints continue to apply. Protected Relay installation or data directories cannot be modified through publication.

These checks coordinate Relay operations and detect many external changes. They cannot make an open-file write atomic against another program running as the same OS user. Stop external editors/build tools before publishing. File writes preserve the existing inode and its permissions; the batch is **not atomic**, and interruption can leave a partial file or some files changed. This limitation follows the existing verified-handle host writer, rather than claiming that path/hash checks prevent every OS race. See [Node file operation documentation](https://nodejs.org/api/fs.html#filehandlewritefiledata-options). Git's separate [patch application behavior](https://git-scm.com/docs/git-apply) does not replace these authorization and recovery requirements.

The authenticated apply route allows a bounded 65-second socket idle period and a 60-second operation deadline, including queue time. Client disconnection or deadline expiry cancels at the next safe boundary. The normal server/body limits remain unchanged. A file system operation already in progress may finish before cancellation is observed.

## Recovery and rollback

Private journals under the Relay data directory's `publications/` record frozen bytes, identities, exact approval, status and completed file names. Existing private host checkpoints also retain prepared mutation evidence. Neither is sent to model prompts. Journals are included when the whole data directory is backed up. Publication does not create a migration or modify the import Git baseline; successful publication/rollback receipts provide the next publication comparison baseline.

An interrupted `applying` record stays blocked after restart. Automatic retries never replay it. Inspect **Saved reviews and recovery receipts**. If changed files still exactly match the published bytes, **Prepare rollback review** creates a separate, explicitly approved reverse modification. A newer owner edit or changed file identity blocks rollback instead of overwriting it.

If every file matches the entire original state or the entire approved state, the separately confirmed **Verify file states and close receipt** action can reconcile the journal without writing source files. Mixed states, partially written files and unrelated changes cannot be silently reconciled. Inspect the private host checkpoints and files manually, preserve unrelated changes, and then review recovery again. If rollback itself is interrupted, its receipt is also uncertain; it is not automatically replayed.

At most 100 journals are retained in this initial workflow. Capacity exhaustion stops new previews and requires deliberate owner maintenance; there is no automatic destructive pruning or recovery-record deletion. Storage admission includes journal growth and the host writer independently budgets its checkpoints.

## Verification and limitations

`tests/publication.test.ts` exercises real disposable source files and a real database: frozen bytes, unrelated edits, identity replacement, conflicts, explicit rollback, sequential publications, mid-write revocation, partial-file recovery refusal, crash journals, expired approvals, stop generation, installation protection, browser-session logout/expiry, client cancellation and UTF-8 BOM preservation. `tests/publication-reservation.test.ts` exercises Engine admission and approvals without executing host writes. `tests/e2e/publication.spec.ts` uses isolated source fixtures at 320, 390 and 1440 pixels for actual review/publication/rollback and a conflict.

These fixtures do not certify adversarial native filesystem behavior on macOS/Linux, malicious same-user processes or network filesystems. Native cross-platform and physical-device acceptance remain separate. No actual user repository was published as part of implementation verification.
