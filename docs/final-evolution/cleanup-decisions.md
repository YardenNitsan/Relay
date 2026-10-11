# Cleanup decisions

## B04 composer layout, 11 October 2026

Replaced the old composer-controls/composer-tools grid, compact/depth selects, agent-row, access-control, privacy-label, shortcut and execution-toggle layout with a context row, editor, action bar and modal settings. `rg` across web source found no callers of the obsolete class names outside styles.css. Removed their selectors from48 rules, preserving shared selectors such as workspace-button in mixed rules.

These selectors have no persistence contract: historical conversations store options/messages, not rendered HTML or CSS names. Existing draft storage keys, account grants, model IDs, tool policy, publication journals and database compatibility remain intact. Original behavior is covered by the old conversation/project/publication tests with navigation adapted to the real new dialog. Retained the authority, draft, approval, publication and rollback assertions. Final check results belong in acceptance-results.md, not an inferred unused-code guarantee.

Pretrained intent experiments did not pass their gates. No primary routing code is removed until a replacement is independently verified; deleting the currently working baseline now would break execution. Experiments remain outside product dependencies and model weights are not committed. Broader duplicate-provider, catalog metadata, dead-feature and retention audits remain open.
