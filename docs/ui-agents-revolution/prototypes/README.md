# Offline Relay concept prototypes

Open `index.html` directly in a browser, or serve this directory through a local static server. No dependencies, fonts, CDN, credentials, model calls, product API requests or persistent storage are used.

- `index.html?concept=dispatch` — task inbox and focused decision detail.
- `index.html?concept=ensemble` — agent team stage and selected assignment.
- `index.html?concept=deliveries` — artifact document and review itinerary.

Each direction has distinct DOM composition, task selection, conversation/evidence views, a light/dark toggle and mobile layout. The top Design lab links switch concepts. Select the release-notes task to try **Approve preview** or **Deny preview**; reset the resulting decision to try the other action. Messages receive explicitly simulated replies and remain only until reload. All fixtures, checks and relationships are synthetic. These screens are research artifacts, not implemented Relay capability.

For browser review use 1440×1000, 390×844, 320×740 and 844×390 in both themes. Also test keyboard navigation, task switching after a decision, agent selection in Ensemble, conversation submit, and return from Dispatch's phone detail. No dependency installation is needed. The parent task owns screenshot and integrated review evidence.

## Verification, 12 October 2026

Fresh installed Chrome automation opened the actual local files. All twelve concept/viewport/theme combinations (three concepts × 390×844 and 1440×960 × light/dark) had no document horizontal overflow and no violations from the full default axe analysis. Separate 320×740 interaction runs passed approve, reset, deny, conversation submit, simulated reply and unsent-draft preservation across content tabs for all three concepts, with no document overflow. JavaScript syntax and whitespace checks passed. These are prototype browser checks, not complete accessibility or physical-phone acceptance.

Review fixes: concept navigation now applies `aria-current` to its actual link; the lab header is a landmark; heading order is coherent; the sample diff is a labeled keyboard-scrollable region; the Deliveries phone header fits 320px; theme changes update text and backgrounds together instead of briefly mixing incompatible colors. The first browser launch attempted an unavailable bundled Chromium; verification used the already installed Chrome channel without installing anything.

Parent visual review selected Dispatch for the shortest path to pending decisions and its mobile density. Ensemble's relationship stage consumed the phone's initial view; Deliveries put decisions below the long artifact on phones. The complete selection rationale and product implementation belong to the parent phase. All three prototypes remain available for comparison.
