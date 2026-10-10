# Your files and agent permissions

Approved users can create personal managed workspaces and upload supported text files without receiving access to the host owner's folders. Other Relay accounts cannot open a personal workspace by guessing its identifier. The host owner still administers the physical storage; this is not encryption against the machine owner.

## Upload and manage files

Use the attachment button or drag files onto the conversation. Without a selected workspace, Relay creates a private workspace for your attachments. On the modernization branch, open **Projects → New workspace** to create one explicitly. Remote users cannot enter a host directory to import someone else's files. The native file picker has no restrictive extension filter; unsupported formats are identified before import.

Within your personal workspace you can inspect, download, edit and delete supported text files. Open a project, search its paths and choose a file; **Use for conversation** is separate from inspection. Manual actions are independent from the permission mode given to agents. File edits use a content hash: if the saved file changed since you opened it, Relay refuses to overwrite it. Reopen and review the newer file before saving. Uploads create files rather than silently replacing an existing filename. Closing or changing views requires confirmation for unsaved file edits; pending mutations must finish. Drafts stay in the current editor memory, not shared browser storage, and forced sign-out still clears the account interface.

Each ordinary account can create up to eight personal workspaces. Existing per-workspace and host storage limits also apply. Text/code attachments are UTF-8 up to 240 KiB. Text-bearing PDF and modern Word `.docx` documents can be imported up to 8 MiB each: Relay extracts a bounded text copy for the agent and stores that `.txt` copy in your private workspace. The original document stays on your device and is not retained or edited by Relay. Formatting, layout and embedded images are not preserved. Scanned PDFs need OCR, encrypted documents need decryption, and legacy `.doc` files need conversion; these operations are not implemented.

Document parsing runs in a separate bounded process with an input/output ceiling, timeout and cancellation. ZIP entry and expanded-size checks limit DOCX decompression; XML entities/external content are not followed. A single document import runs at a time on the host. This is defensive parser isolation, not a claim that arbitrary hostile parser exploits are contained by a full OS sandbox.

## Choose agent autonomy

| Mode in your personal workspace | Agent behavior |
| --- | --- |
| Read only | Read and inspect supplied files; cannot modify them. |
| Supervised | Request approval for file changes. |
| Autonomous workspace | Make permitted changes within the selected workspace without repeated file approval. |

Choose a mode before sending the objective. With no workspace selected, choosing Supervised or Autonomous creates a private workspace first and applies the mode only when creation succeeds. Network access, model accounts, budgets and external integrations remain independent. Choosing a stronger workspace mode does not grant unrestricted host access. Shared workspaces retain the account's host-granted ceiling.

The permission menu controls **agents**, not your own intentional upload, edit or delete actions.

## Files that stay on your device

In supported desktop browsers, **Connect a folder on this device** lets you select a folder explicitly. Relay previews a bounded set of supported text files before you import a managed copy. The model works on that host copy. Review the resulting changes before choosing which ones to apply back to the selected device folder; browser write permission is requested separately. Changed local files must be reviewed rather than silently overwritten.

The connection is held only in memory for the current browser session. You can close Workspaces and return while the page remains open; reloading, signing out or explicitly disconnecting loses the handle. Browsers without the required folder API, including many phone browsers, retain upload/download file management. Relay cannot grant itself access to arbitrary device files or execute device-local commands from ordinary browser JavaScript. Full external-agent command execution belongs to the user's installed agent, using the [external model client](external-clients.md) connection.

## Why an agent may show zero tools

Specialist instructions and real tool connections are different. A new account with no workspace can still chat and plan. Create a private workspace or attach text files to enable its file tools. The agent catalog refreshes after creation.

The Computer specialist can use permitted structured file tools; clicking windows, typing into desktop applications and arbitrary desktop control need a separate connector that is not implemented. A nonzero file-tool count does not imply desktop automation. Similarly, Email and Calendar can draft and plan from supplied files while their live account connectors remain unavailable.
