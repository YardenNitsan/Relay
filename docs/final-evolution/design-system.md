# New Relay design system

Status: direction selected; implementation and acceptance pending. The existing `docs/design-system.md` describes v0.1.2 and is not the final redesign.

Three concepts to evaluate against distinctiveness, clarity, trust, usability, accessibility, responsiveness, product fit, performance and maintainability:

1. **Relay Desk:** a focused writing surface with a persistent task ledger and contextual review rail. Conversation remains calm; execution has a dedicated structured workbench. Risk: can resemble existing chat tools without strong workflow composition.
2. **Relay Atlas:** projects and devices form the navigation foundation; task routes connect objective, isolated work and evidence. Risk: a spatial canvas can become difficult on phones and for keyboard users.
3. **Relay Studio:** a creative-instrument composition with an activity strip, central task document and interchangeable evidence panes. Risk: dense professional controls may overwhelm everyday chat users.

## Concept evaluation

Qualitative tradeoffs, not invented usability scores. All three can use the existing React/data architecture.

| Criterion | Desk | Atlas | Studio |
| --- | --- | --- | --- |
| Distinctiveness | Familiar document/chat, needs stronger character | Distinct spatial map | Distinct task document and evidence composition |
| Clarity | Excellent for everyday conversation | Relationships visible, current action less obvious | Objective and current operation anchor the screen |
| Trust | Evidence risks becoming secondary | Location/device are explicit | Execution location, receipts and decisions share the task context |
| Usability | Low learning cost | Canvas navigation adds learning cost | Stable primary surface with progressive expert controls |
| Technical feasibility | Smallest presentation change | Graph layout/state substantially harder | Moderate modular rebuild; contracts can remain |
| Accessibility | Natural document reading order | Spatial relationships need duplicate nonvisual presentation | Semantic document plus ordered execution list |
| Responsiveness | Straightforward single column | Map meaning degrades on phones | Same selected content becomes one focused pane |
| Product fit | Strong assistant, weaker execution instrument | Strong systems view, weaker everyday work | Balances writing, executing, reviewing and configuring |
| Performance | Few layout demands | Large graphs risk expensive updates | Isolate streamed document from low-frequency evidence updates |
| Maintainability | Simple but may accumulate drawers | Many interaction modes | Shared layout slots and feature-owned views |

**Select Relay Studio.** It supports the product's central distinction: an objective becomes inspectable work with explicit authority and evidence. Desk's calm writing experience is retained within the central document; Atlas's device clarity informs labels, not a spatial canvas. The risk of expert-control overload is addressed through a minimal composer, task-specific inspection and separate administration.

## Composition and identity

A quiet, precise instrument with a narrow navigation edge, generous central document and an evidence margin. On wide screens the selected task reads across three scales: workspace context, human objective/result, machine evidence. Use one continuous surface with fine separators and intentional section starts. Rounded cards are reserved for truly separate objects such as an approval, not every metric.

The recognizable motif is a pair of aligned vertical strokes connecting an objective to its receipt. Use this sparingly for active navigation and execution sequencing; do not decorate every element. A cobalt action accent distinguishes interaction from green verified outcomes and amber pending decisions. The Relay logo can remain recognizable while the surrounding interface is replaced.

### Semantic tokens (initial candidates; rendered contrast must pass)

| Role | Light | Dark |
| --- | --- | --- |
| canvas | `#f3f5f8` | `#10141d` |
| surface | `#ffffff` | `#171d29` |
| surface-subtle | `#eaf0f6` | `#202938` |
| text-primary | `#172338` | `#edf2fb` |
| text-secondary | `#4b5d75` | `#afbdd2` |
| border | `#c7d0dd` | `#465269` |
| accent/action | `#244bcb` | `#a7bcff` |
| accent-surface | `#e9efff` | `#26355b` |
| success | `#206346` | `#89d9b0` |
| warning | `#80500d` | `#f0c47b` |
| danger | `#b12b42` | `#ffa8b5` |

Use `--color-*`, `--space-*`, `--text-*`, `--radius-*`, `--motion-*` and component aliases. Components consume roles, not raw palette values. Forced colors must retain boundaries/focus; statuses always include text. Approval urgency never depends on color alone.

- Typography: preserve self-hosted IBM Plex Sans and Mono licenses/offline assets. Body 16px/1.6, compact UI 14px/1.4, supporting metadata no smaller than 12px; task title 24–32px with fluid limits. Mono for code, paths and measurements, not long prose. Use system Hebrew fallbacks and `dir=auto` on user content; never reverse code direction.
- Spacing: 4, 8, 12, 16, 24, 32, 48px; use relationships rather than adding arbitrary margins. Text line length approximately 65–80 characters; code may scroll in its own labeled region.
- Radius: 4px technical insets, 8px controls, 12px independent dialogs/composer. Avoid ubiquitous pill labels.
- Borders/elevation: 1px semantic borders for regions; one restrained overlay shadow. No large blurred gradients or glass effect behind evidence.
- Focus: visible 2px high-contrast outline with 3px offset; focused controls must remain visible beneath sticky surfaces. Separate focus from selected state.
- Motion: 100ms press/hover, 160ms disclosure, 220ms pane entry; no delayed actions. Reduced motion removes transforms and smooth scrolling. Loading uses text/state announcements; no invented progress bar.
- Density: comfortable default; compact list density only where it preserves 44px coarse-pointer targets and readable type. Do not globally shrink the composer or approvals.
- Iconography: retain a coherent local icon set, 18–20px ordinary controls with text or accessible names. Decorative icons are hidden from assistive technology.

## Navigation and feature responsibilities

| Surface | Primary content | Contextual inspection/commands |
| --- | --- | --- |
| Conversation | Message document and excellent composer; history/search belong to navigation | Model/agent/policy sheet, attachments, cancel, jump to latest |
| Workbench | Objective, current state, ordered dependency lanes | Agent handoffs, tool receipts, verification, errors and artifacts; dedicated approvals |
| Projects | Project identity, branch, files and changed-file review | Diff, tests, checkpoints, publication/rollback, memory and related conversations |
| Model Studio | Browsable models with availability and measured/estimated facts clearly labeled | Routing explanation, evaluation, memory/context, configuration and cloud price uncertainty |
| Connections | Host, current browser/device, accounts, providers and sessions grouped by authority | Folder grants, revocation, Companion enrollment when implemented; truthful unsupported states |
| Settings | Goal-based personal/account/provider/host/security/diagnostic sections | Role-gated controls with scope explanations, no wall of toggles |
| Onboarding | Everyday first task or owner setup path | Model readiness, execution location and optional connections without fictional capability claims |

Command palette provides navigation and contextual commands, with visible equivalents and discoverable shortcuts. Destructive/consequential actions remain confirmed through their existing durable server flow. Presentation never grants permissions.

## Adaptive contract

- Below 600px: one main content view, compact context header, reachable navigation sheet and contextual task/evidence switching. Composer remains above the safe area; use dynamic viewport units and test keyboard resizing.
- 600–999px: compact navigation; document with optional replacing inspection view, avoiding two unusably narrow panes.
- 1000–1439px: navigation and document; evidence can share space when minimum readable widths fit.
- 1440px and above: three regions; bound prose width and give surplus width to useful diff/evidence content. Do not stretch paragraphs across 2560px.
- Short height: compress chrome before content; approval action region reachable without trapping the content scroll. Preserve one main scroll owner per view. Container constraints may override width breakpoints.

## Implementation boundaries and acceptance

Separate `web/design/` tokens/primitives, `web/layout/` shell/navigation and feature presentation modules from query/mutation hooks. Retain existing domain types, auth/session behavior, streaming and API clients. Do not add a global state store for layout booleans. Prefer semantic native elements and existing tested primitives; a new dependency needs a demonstrated gap.

Retain before captures and inspect each major surface at 320/360/390/768/1024/1440/1920/2560px plus short landscape, both themes, long content, loading, error, approval and streaming. Review hierarchy, typography, spacing, overflow, focus, touch targets and layout shifts; run axe plus meaningful keyboard/manual checks. No redesign-complete claim is valid until all old features have verified new homes.
