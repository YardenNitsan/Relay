# Captured browser evidence

These are actual browser captures, not generated mockups. `dispatch-1440-light.png`, `ensemble-1440-light.png` and `deliveries-1440-light.png` show the three offline concept prototypes with explicitly synthetic tasks. Their working sources remain in `../prototypes/`.

`dispatch-320-light.png` and `dispatch-1440-dark.png` show the implemented authenticated Work screen against the disposable browser fixture host. Task data and provider responses in that host are deterministic test fixtures. They do not prove real model execution, LAN/remote deployment or physical-phone behavior.

Final prototype rerun: all twelve concept × phone/desktop × theme combinations had zero tagged axe violations and no document overflow. Corrected dark screenshots were visually inspected. Product tests additionally exercise drafts, focus, real fixture API reads and error recovery; see `../testing.md` for exact scope and failures.
