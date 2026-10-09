# PDF and Word text copies

Relay accepts PDF and `.docx` uploads as **extracted text copies**, up to 8 MiB per source document. The browser sends the original bytes to the authenticated workspace upload endpoint; the host does not retain the original binary. The resulting `.txt` copy is editable and available to agents under the same workspace permissions as other files. It does not preserve document layout, images, signatures, tracked changes, or original-format editing. Legacy `.doc`, password-protected files, and scanned PDFs without selectable text need conversion first. No OCR is performed.

DOCX extraction includes ordinary Word text runs, paragraph boundaries, tabs, line breaks, and conventional header/footer/footnote/endnote parts. Tables become paragraph text; ordering follows document XML. Embedded objects, remote relationships, scripts, macros and linked content are not executed or fetched. PDF text order depends on the original document and may differ from visual reading order. Users should inspect extracted text before relying on it.

## Implementation and boundaries

- `server/documents/ingest.ts` admits one active parser globally, validates the extension and 8 MiB input ceiling, and launches a fixed Node child entry without a shell. Filenames never become filesystem paths or executable arguments. The child receives only document bytes and a fixed format selector.
- `server/documents/parser.mjs` uses PDF.js text extraction with evaluation, font faces, system fonts, rendering and native addons disabled. It permits at most 200 pages. It does not render the PDF or execute its embedded actions.
- Word ZIP entries are streamed sequentially with Yauzl's actual-size validation: at most 256 entries, 8 MiB per decompressed entry, and 24 MiB total decompressed content. Duplicate names, traversal paths, encrypted members, inconsistent sizes and excessive expansion are rejected. No archive files are written to disk.
- A strict namespace-aware SAX parser reads selected Word XML parts. DTDs are rejected, only predefined XML entities are accepted, and nesting is limited to 128 levels. No HTML conversion takes place. Document text remains untrusted data.
- Both formats have a 240 KiB extracted UTF-8 text ceiling and a 15-second wall deadline. Cancellation/deadline kills the child and waits for its close before releasing the parser slot. Output pipes are bounded, errors are fixed public messages, and parser diagnostics are discarded.
- The child receives no provider credentials, application environment, `NODE_OPTIONS`, or user-home variables. Node permissions grant reads only for its fixed entry and installed dependencies; filesystem writes, spawning children, worker threads and addons are not granted.
- `npm run build` copies the fixed parser into `dist-server/parser.mjs`, included by portable packaging. Runtime dependencies remain pinned in the lockfile. There are no runtime parser downloads.

The 192 MiB V8 heap limit is **not a hard total-process memory limit**: native buffers and PDF decompression can allocate outside the JS heap. Node's permission model is a defensive restriction on trusted libraries, **not an OS sandbox against compromised parser code**. On the supported Node 24 runtime, it also does not provide a network isolation boundary; this implementation supplies in-memory bytes only and never follows external document references. Strong hostile-parser isolation with OS-enforced memory/network limits remains future work. A child crash or malformed response returns a controlled error rather than terminating the host, but no zero-OOM guarantee is claimed.

Workspace authorization, upload rate limits, request body size, private ownership and commit-time permission rechecks live in the API/broker boundary. Parsing cannot grant filesystem or agent capabilities. A parser success does not bypass workspace storage limits.

## Research and dependency decisions

Reviewed official upstream sources on 9 October 2026:

| Library | Pinned version | License | Purpose |
| --- | --- | --- | --- |
| [PDF.js distribution](https://github.com/mozilla/pdf.js) | 6.4.299 | Apache-2.0 | Maintained PDF text extraction |
| [Yauzl](https://github.com/thejoshwolfe/yauzl) | 3.4.0 | MIT | Sequential ZIP parsing and verified decompressed sizes |
| [SAX](https://github.com/isaacs/sax-js) | 1.6.1 | BlueOak-1.0.0 | Streaming XML with namespace and entity controls |

[Mammoth raw-text extraction](https://github.com/mwilliamson/mammoth.js) was evaluated. Its HTML conversion and formatting features are unnecessary for a plain-text copy; its current dependency tree also brought an unused CLI dependency with an unpatched moderate advisory. It was removed. The Saxes alternative was rejected after current upstream research showed its repository archived. The final installed dependency tree reported zero known vulnerabilities at implementation time; that is a dated audit result, not a permanent security guarantee.

PDF.js's [prior evaluation vulnerability](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq) supports explicitly disabling evaluation even with a patched maintained release. Yauzl documents lazy entries and actual-size validation for bounded decompression. Node documents the [permission model's security limitations](https://nodejs.org/api/permissions.html); Relay does not represent these flags as container-equivalent isolation.

## Verification

`npm test -- tests/documents.test.ts` uses actual minimal PDF and DOCX bytes and verifies extracted text, unchanged input bytes, literal markup, malformed/oversized inputs, archive size lies, decompression limits, traversal rejection, XML entities, empty documents, output bounds, cancellation, concurrent admission and forced deadline. API and browser suites additionally verify the user-visible upload path. Source fixtures are in `tests/helpers/documents.ts` and contain no private documents.
