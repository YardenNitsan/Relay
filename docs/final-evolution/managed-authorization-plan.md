# Managed mutation authorization boundary

Source review before branch integration found that managed `ToolBroker.commit` passes only its synchronous cancellation/stop guard to `replaceText`. Manual file editing and checkpoint rollback also check durable account authority before asynchronous preparation rather than immediately before the file rename/unlink. Host-file mutations already carry a separate durable authorization callback.

Reproduce with real managed files and durable task/user records: disable an account, increment its session version or expire its task after initial dispatch; deny manual editing/rollback after preparation; revoke a task while a synthetic sandbox run returns changed files. Independently check the original bytes and retained checkpoint evidence. Synthetic sandbox results do not establish real command execution.

Extend the existing optional filesystem authorization callback to both rename and unlink. Pass current task authorization from ordinary writes and sandbox publication, and the caller's live session/workspace authorization from manual edits and rollback. Recheck after broker queueing and immediately before each consequential filesystem operation. Keep storage limits, expected-content conflicts, stop checks, prepared recovery records and permissions intact.

This is a fresh execution-boundary check, not an atomic transaction between PostgreSQL permission changes and the operating system. A multi-file interruption remains conservatively uncertain; no automatic replay or dishonest all-or-nothing guarantee. Reviewed branch integration must additionally reserve both workspaces and require an authentic fork baseline before it can build on this primitive.
