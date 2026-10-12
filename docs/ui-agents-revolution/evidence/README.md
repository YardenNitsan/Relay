# Captured browser evidence

These are actual browser captures, not generated mockups. `dispatch-1440-light.png`, `ensemble-1440-light.png` and `deliveries-1440-light.png` show the three offline concept prototypes with explicitly synthetic tasks. Their working sources remain in `../prototypes/`.

`dispatch-320-light.png` and `dispatch-1440-dark.png` show the implemented authenticated Work screen against the disposable browser fixture host. Task data and provider responses in that host are deterministic test fixtures. They do not prove real model execution, LAN/remote deployment or physical-phone behavior.

Final prototype rerun: all twelve concept × phone/desktop × theme combinations had zero tagged axe violations and no document overflow. Corrected dark screenshots were visually inspected. Product tests additionally exercise drafts, focus, real fixture API reads and error recovery; see `../testing.md` for exact scope and failures.

`agents-1440-dark.png` and `agents-320-light.png` capture the implemented specialist inspector/index from the48-case fixture run before the final shared-dialog focus/Stop-all sizing correction. Root inspected both: desktop separates the role list from explicit capabilities/limits; the320px index preserves role selection, recent-work navigation and readable touch rows. Scrollable below-fold content is intentional. The pending full-product redesign is not represented as complete by these captures.

Additional actual renders inspected during Dispatch completion: `conversation-320-light.png`, `models-1440-light.png`, `projects-320-light.png`, `settings-390-light.png`, `memory-390-dark.png` and `host-844-dark.png`. All use synthetic/disposable browser acceptance data; none certifies deployed or physical-device behavior. See [rendered review](../design-review.md).
