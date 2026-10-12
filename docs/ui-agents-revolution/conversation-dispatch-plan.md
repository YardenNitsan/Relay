# Dispatch conversation implementation

12 October 2026. Scope follows the owner's renewed web/Android-only instruction. Backend, agent orchestration and model routing are unchanged. Read `AGENTS.md`, README, phase continuation/progress, implementation plan, design decision, testing and acceptance, then inspected the current Conversation, Composer, Welcome and styles.

## Intended result

Conversation becomes a readable work document: each user brief has a distinct surface, responses have a quiet author/time margin, and actual execution status remains adjacent to the response it belongs to. The composer leads with writing, then groups specialist/model selection and permission/attachment/send actions. The welcome view distinguishes prompt starters from optional project/model setup. Every action retains its existing handler and permission semantics.

Files owned here: `web/components/Conversation.tsx`, `Composer.tsx`, `Welcome.tsx`; `web/features/conversation/conversation.css`, `welcome.css`; this plan. Workbench, global tokens/styles, RelayFrame and App remain with the parent task. Execution presentation in this increment means conversation task receipts, stream text, errors and paused state, not new execution behavior.

## Work sequence

1. Preserve all conversation follow/history effects, message identity, `.conversation-scroll` ownership, content-visibility boundary and Markdown component. Add semantic body/metadata structure using only saved timestamps and recorded task state.
2. Recompose the writing surface without changing draft keys, upload/send locks, input handling, native dialogs, host-access confirmation or settings controls. Keep accessible action names and existing model-picker component.
3. Replace welcome composition and scoped feature styles for desktop, phone, narrow split panes, short landscape, both themes and large text. Avoid motion that implies execution or incompatible intermediate theme colors.
4. Run strict typechecking and diff review locally. Parent serializes builds/browser fixture4319 and runs existing conversation, draft, attachments, history, model-picker, responsive/follow and approval regressions with visual review. Add behavior tests only if this presentation work changes behavior; it currently does not.

## Rulings

- Retain existing `studio-starting-points` and related welcome hooks alongside new Dispatch classes because browser checks use them; these class names do not require retaining the old composition.
- Scope replacement rules under Dispatch modifiers rather than editing shared legacy CSS while other work is active. Do not change global scroll, shell or modal constraints as incidental cleanup.
- Keep execution inspection as the existing task-specific callback. No fabricated agent identity, selected model, progress percentage or future capability copy.

## Evidence

Implemented the document heading, real saved-message timestamps, author margin, objective surface, response body and adjacent execution record; the metadata stacks above messages in narrow conversation panes. Loading/retry states share the reading column. The composer now places writing before the context/action controls, using one control row when space permits and two rows on phones. Welcome now has a distinct introduction, illustrated prompt starters and separate project/model setup actions.

`npm.cmd run typecheck` passed; `git diff --check` passed. Reviewed the TSX diff: existing follow/history effects, message IDs, Markdown, callbacks, drafts, send/upload guards and settings/host-access flow remain intact. No new product behavior or redundant presentation-only tests were added. Root has the source and owns serialized build, existing browser regressions and visual/axe review. No complete conversation-redesign acceptance is claimed before those checks.

## Integrated checkpoint

Root strict production build and rendered acceptance are recorded in [testing](testing.md): initial core92/94, corrected/supporting111/111, scheduling/initial landscape24/24, and final strict landscape/History/viewport14/14. Actual screenshot review is in [design review](design-review.md). Earlier source-only statements above describe the development checkpoint, not the latest acceptance. Physical-device, deployment and final-head CI remain separate.
