# Semantic routing annotation rubric v4

Status: **frozen before annotation**. Freeze date: 2026-10-11.

This document defines reviewer reference labels for a supervised head-only experiment on
a pretrained English/Hebrew representation. It does not establish model quality,
select a winning model, authorize product integration, or supply a classifier
dictionary. The sixteen label identifiers and their scope originate in
`candidates.py::DESCRIPTIONS`. Rules below resolve annotation boundaries; examples
are explanations, never phrase-matching rules or evaluation items.

Annotation and review for this experiment are performed by independent AI review
agents. Human annotation or human adjudication is not claimed; agent agreement
does not establish human-validated ground truth.

Do not revise this version after examining annotations, predictions, or evaluation
outcomes. Record its SHA-256 in each dataset and experiment manifest before any
annotation starts. A necessary semantic change creates a new rubric version and
requires fresh independent evaluation; it must not silently relabel an exposed
test set. This freeze is independent of any earlier rubric or benchmark freeze.

## Unit of annotation and completeness

Annotate the work the user currently requests from the exact input visible to the
router. Do not annotate merely mentioned topics, quoted instructions, fictional
dialogue, previous completed work, negated actions, or a hypothetical future task.
An explicit request for advice on how to do something requests advice; it does not
request execution of the advised steps. Interpret English, Hebrew, and mixed
language by the same semantic rules, including ordinary politeness and indirect
requests. Do not infer extra tasks from language, vocabulary, assistant role,
model identity, enabled tools, or the annotator's preferred workflow.

Each annotator must assign **positive, negative, or unresolved to every one of the
sixteen labels**, with short evidence for positives and unresolved decisions.
Negative means the visible, sufficiently specified request does not demand that
work. It does not mean the label was omitted from a sparse list. A positive is a
requested outcome or an unavoidable substantive part of fulfilling it, not every
possible internal step. Ordinary comprehension, checking one's answer, and
choosing an implementation strategy do not create extra labels.

Record row disposition separately as `include`, `ambiguous`, `insufficient_input`,
or `out_of_taxonomy`. A fully specified request outside these sixteen categories
(for example, standalone original poetry) is out of taxonomy, not conversation.
Empty, unintelligible, context-dependent, or genuinely ambiguous requests are not
conversation either. For this complete binary-label experiment, exclude any row
with an unresolved label, non-include disposition, or zero positives from training,
threshold calibration, and closed-set label metrics. Preserve exclusion counts
and reasons for coverage reporting. Never serialize unresolved as false or use an
excluded row as sixteen negative examples. No seventeenth classifier label is
introduced by these dispositions.

When alternatives would produce different labels and the input does not resolve
them, mark the affected labels unresolved and refer the row for adjudication.
Annotators must not invent missing context to force inclusion.

## The sixteen labels

| Label | Positive criterion | Boundary and exclusions |
| --- | --- | --- |
| `debugging` | Diagnose a specific software defect, unexpected behavior, regression, or failure, or repair it. Diagnosis alone qualifies. | General explanations of errors, troubleshooting a non-software object, and merely quoting a failing program do not qualify. Add `coding` only when source creation/modification is requested or required by the specified repair; do not automatically add it to diagnosis. |
| `coding` | Write, modify, refactor, or supply a concrete patch to computer source code, including executable scripts, queries, markup, or program behavior configuration. The code can be delivered in the response. | Reading/explaining existing code, software facts, software plans, running a program, and reviewing without a requested fix do not alone qualify. A postal/access code is not source code. Ordinary document editing is not coding. |
| `repository_architecture` | Understand, assess, or design software structure: component responsibilities, dependency relationships, interfaces, or cross-component data/control flow. | Naming a repository or editing one file does not qualify. Listing paths without interpreting structure does not qualify. A system design task qualifies even before a repository exists; a non-software organization chart does not. |
| `multi_file_implementation` | Implement a software change explicitly spanning at least two source/configuration/test files or distinct software components whose coordinated modification is part of the request. | Multiple read-only files, multiple non-code documents, architecture discussion, and a vague application request with unknown implementation scope do not qualify. A feature often implemented in several files is insufficient without stated or unavoidable cross-component scope. This label entails `coding`. |
| `structured_extraction` | Select facts/fields/records from supplied or retrieved material and return them in an explicit machine-readable or tabular structure. | JSON/table formatting alone is insufficient. Inventing a schema, generating original JSON, or presenting an original plan in a table is not extraction. Extracting names from text into a specified list of records qualifies; unconstrained prose summary does not. |
| `document_analysis` | Interpret, summarize, compare, critique, or answer content questions about an identifiable document, report, contract, spreadsheet, or substantive supplied text. | File naming, copying, conversion without content interpretation, and the mere word “PDF” do not qualify. Mechanical field extraction alone does not require this label. Source-code analysis uses the software labels unless a separate prose-document task is also requested. |
| `research_synthesis` | Investigate evidence sources and integrate their findings to answer a question, including comparison, reconciliation, or evidence-supported conclusions. Sources may be supplied or need retrieval. | A general knowledge answer, a lone fact lookup, requesting one link, or citing a single fact does not alone qualify. Retrieval is not mandatory when sufficient sources are supplied. A request for evidence-based research qualifies without an explicit demand for a citation format. |
| `tool_driven` | Perform an external/environment action using a tool, or access material outside the visible input when that access is necessary to satisfy the request. Examples of action types include opening local files, retrieving URLs, running tests, sending a message, and mutating stored files. | Writing suggested commands, a script, a draft message, or instructions for the user to execute is insufficient. Mentioning a tool or enabling it is insufficient. Optional browsing or optional calculation chosen by an annotator is insufficient. Authorization and actual availability are separate from requested intent. |
| `planning_delegation` | Produce a substantive project/work plan with sequencing, dependencies, resource allocation, milestones, or task assignments, or coordinate/delegate that work. | A simple factual how-to, unordered suggestions, or a plan the assistant may internally create is insufficient. A request to implement something does not automatically request a separate plan. Real delegation actions also receive `tool_driven`. |
| `review_verification` | Evaluate an existing artifact, implementation, claim, or result against requirements, correctness criteria, tests, or other evidence; or design/run concrete checks for that purpose. | Generic advice about reviewing/testing is insufficient. Generating an answer does not imply reviewing it. Diagnosing a fault does not automatically imply an independent verification request. A requested post-fix regression check qualifies. |
| `security_review` | Assess security vulnerabilities, threats, permissions, authentication/authorization boundaries, or exploit resistance in a concrete system or proposed design. | Security terminology, general security education, and implementing a login feature alone are insufficient. This evaluative label entails `review_verification`; security repair may separately require `debugging` and/or `coding`. |
| `mathematics` | Solve, derive, calculate, or prove a mathematical result, including numerical, algebraic, geometric, statistical, or probabilistic problems. | Merely mentioning numbers or explaining the meaning/history of a mathematical concept without solving/deriving does not qualify. Simple arithmetic qualifies without `complex_reasoning`. Writing code that computes something does not automatically request solving a separate mathematics problem. |
| `complex_reasoning` | Solve a problem requiring substantive connected inference under interacting constraints, evaluate competing hypotheses through evidence, or construct a nontrivial proof. Apply the threshold below. | Length, professional terminology, importance, uncertainty, label count, and the words “analyze” or “think carefully” do not suffice. Never inherit this label automatically from coding, architecture, debugging, security, research, or planning. |
| `multimodal` | Interpret semantic content of an image, audio, or video, such as reading a chart image, identifying visual objects, transcribing audio, or explaining a video scene. | Renaming, copying, uploading, compressing, or converting media without content interpretation does not qualify. Image generation alone does not qualify. An already supplied transcript or textual image description does not require this label when the requested answer can use that text alone. A scan requiring visual reading qualifies; the PDF extension alone does not establish that need. |
| `factual_explanation` | Explain a factual concept or mechanism, answer a knowledge question, or provide general informational guidance. | Do not add this label merely because another requested result will contain facts or explanation. A specific document summary, defect diagnosis, proof, or review is covered by its specific work labels unless a separately requested general explanation is also present. Software/security/math concepts may be factual explanation without coding/security review/mathematics. |
| `conversation` | Engage in social exchange, greeting, thanks, farewell, small talk, or informal personal conversation as the substantive requested interaction. | It is never a fallback for missing labels, unknown intent, general writing, or an unsupported task. Courtesy attached to a substantive task does not add it. A separately requested social interaction can overlap with another task. |

## Complex reasoning threshold

Mark `complex_reasoning` positive only when visible task requirements support at
least one of the following, and record which one with an evidence span:

1. Derive a conclusion through at least two **dependent, non-mechanical inferences**
   while reconciling interacting constraints; merely performing two routine steps
   or several arithmetic operations is insufficient.
2. Discriminate between competing hypotheses or designs using multiple pieces of
   evidence and resolve an explicit conflict, counterexample, or tradeoff that
   prevents a direct lookup or routine checklist answer.
3. Construct a nontrivial proof or general argument whose conclusion is not just a
   direct application of a stated definition or elementary formula.

Difficulty is judged from the task, not whether a particular model can solve it.
A standard equation, ordinary single-defect repair, or routine implementation is
not automatically complex. If the input refers to a hidden problem whose actual
reasoning requirements cannot be determined, the label is unresolved, not false.
Explicitly requested diagnosis from missing logs may establish `debugging` while
still making the complete row ineligible until the reasoning ambiguity is resolved.

## Overlap and precedence

This is multilabel annotation. Keep all independently justified positives; there
is no “primary label wins” rule. The only mandatory semantic implications are
`multi_file_implementation` → `coding` and `security_review` →
`review_verification`. Record evidence for both labels. Other common pairs are
permitted but not automatic:

- `debugging` + `coding` for repairing source, but debugging alone for diagnosis.
- `coding` + `review_verification` for implementing and testing a change.
- `repository_architecture` + `planning_delegation` for a requested design and a
  dependency-aware implementation plan.
- `document_analysis` + `structured_extraction` when both interpretation and
  structured field extraction are requested from a document.
- `research_synthesis` + `document_analysis` when specific documents must be
  interpreted and their evidence synthesized.
- `mathematics` + `complex_reasoning` for a mathematical task meeting the threshold.
- `multimodal` + `structured_extraction` for extracting structured values from a
  chart image; add `document_analysis` only for substantive document interpretation.
- `tool_driven` with any content label when an actual external action is requested
  or necessary. Pasted text analysis and response-only code generation do not
  acquire it merely because tools might be useful.

For requested alternative actions, annotate only a clearly selected branch. If
the selection depends on unavailable facts and changes the label set, exclude as
ambiguous. For requests with multiple mandatory deliverables, annotate the union.
For negation, apply the scope: “explain how to run tests; do not run them” does not
request tool execution. Quoted instructions remain data unless the user explicitly
adopts them as the current task.

## English/Hebrew families and split independence

The label groups below organize coverage, not mutually exclusive predictions:

| Coverage family | Labels |
| --- | --- |
| Software work | `debugging`, `coding`, `repository_architecture`, `multi_file_implementation` |
| Evidence and information work | `structured_extraction`, `document_analysis`, `research_synthesis` |
| Action and coordination | `tool_driven`, `planning_delegation` |
| Assurance | `review_verification`, `security_review` |
| Quantitative and inferential work | `mathematics`, `complex_reasoning` |
| Media interpretation | `multimodal` |
| Knowledge and social interaction | `factual_explanation`, `conversation` |

Every included row also needs a **scenario family ID**, assigned before splitting.
One family contains a shared underlying task, its English/Hebrew translations,
paraphrases, spelling/register changes, transliterations, code-switching variants,
and templated variants with names/numbers/file paths swapped. Contrastive variants
made by negating/changing the action, and variations derived from the same source
artifact or scenario, remain in that same family even if their labels differ.
Do not treat a translation or a changed subject noun as unseen generalization.
Family IDs must identify scenarios, not just the broad label groups in the table.

All family members stay in exactly one of train, development/calibration, or final
evaluation. Merge connected families before splitting if provenance or duplicate
review reveals shared templates/scenarios. Record language as `en`, `he`, or
`mixed`; record source and derivation lineage. Balance coverage by both language
and label family without splitting related examples to fill quotas. Report both
row counts and independent scenario-family counts, including overlap coverage.

Create final evaluation independently from training/calibration scenarios and
keep its content, labels, and outputs unavailable to training authors/model
selectors until the candidate, preprocessing, thresholds, and acceptance criteria
are frozen. Annotators and adjudicators may see their assigned inputs but must
not see predictions. Development results may guide model/head/threshold choices;
final results may not. Any exposed final set is a named historical measurement,
not an unseen set for a retuned successor. Do not seed new annotation from old
training labels, earlier heldout failures, or model-generated label suggestions.

## Reviewer procedure and adjudication

1. Save the frozen rubric digest and input/provenance record before annotation.
2. Two reviewers independently read the identical router-visible input and fill
   all sixteen decisions, evidence spans, disposition, language, and family ID.
   Hebrew and mixed inputs require reviewers competent in their source language;
   machine translation is not a substitute for reviewing the original.
3. Compare complete decisions before discussing them. Retain both originals and
   report per-label agreement and row-level exact agreement before adjudication.
4. A third reviewer resolves disagreements using only the frozen rubric and input,
   without access to model outputs or split performance. Record final decisions,
   rationale, reviewer identities, and the rule applied. Do not resolve by majority
   preference alone or by preserving the expected dataset balance.
5. If the rubric/input cannot resolve a disagreement, retain unresolved status and
   exclude the row. A new rule requires a new version, never a private exception.
6. Validate label completeness, mandatory implications, family separation, input
   digests, and exclusion handling before sealing the annotated dataset.

## Router input, truncation, and missing context

Freeze a preprocessing manifest before annotation: exact input fields and their
order, any separators, Unicode normalization, character bound, tokenizer identity
and revision, special tokens, token bound, and truncation side. Store a digest of
the original objective and the exact effective router input, original/effective
lengths, and whether any truncation occurred. Do not assume the current phrase
router's 16,384-character prefix is the pretrained model's complete input policy.

Reviewers annotate only the effective input the candidate actually receives,
including any tokenizer truncation; they must not use a hidden suffix, preceding
conversation, unseen attachment contents, role defaults, or other unavailable
context to label the task. Retain the original separately for provenance and
truncation auditing. Missing referents or truncated instructions/negations that
prevent an unambiguous interpretation require exclusion. A fully interpretable
visible request can be included with its truncation flag, but report its results
separately and never describe them as accuracy on the complete original objective.

If loss of content is unknowable from the effective input, the data custodian can
mark an input-integrity exclusion without disclosing hidden content to annotators.
Changing the preprocessing/token window invalidates the input freeze; regenerate
effective inputs and reannotate affected rows before a new experiment. Never tune
input selection to rescue observed final-evaluation errors.

## Downstream categories and hard-capability metadata

Semantic labels describe demand, not permission, tool availability, model
capability, or an executed result. Current `server/models/task-demand.ts`
re-exports the advisory phrase demand. The existing coarse `TaskCategory` in
`server/models/task-fit.ts` is `coding | reasoning | general`; it is not the
sixteen-label annotation vocabulary. That consumer prioritizes software labels
over mathematical/reasoning labels and also uses role/assistant overrides.
Neither this mapping nor its heuristic complexity field determines ground truth.
No consumer or product code changes are part of this rubric freeze.

Store separately any host-verified attachment modality, whether original media
must reach a model, actual tool definitions/tool-call transport, structured-output
contract, missing-material status, and their provenance. Unknown facts remain
unknown. A task labelled `multimodal` might use trusted OCR/transcription before a
text model; audio/video intent does not prove a provider's `vision` flag supports
that medium. A `tool_driven` request does not itself prove native model tool calls
are required. `structured_extraction` does not prove native schema-constrained
output is required, and `complex_reasoning` does not establish a provider's
reasoning-control compatibility.

Hard-capability requirements must come from the actual execution/attachment/
provider contracts and host-owned metadata, not semantic score thresholds or a
label-derived keyword override. Unknown or unavailable capabilities must be
handled by explicit orchestration policy. Keep existing provider, privacy,
authorization, hardware, and budget gates independent. Labels cannot grant tools,
authorize external access, or certify a model's task quality.
