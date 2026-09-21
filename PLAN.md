# DrawDSL improvement plan

## Purpose and implementation rules

This is an implementation backlog for coding agents, based on repository revision `5844051`, reviewed on 2026-09-21. Tasks below are recommendations, not completed changes. Start with correctness and deployment fixes; implement each task as a small, independently verified change.

The longer-term move away from draw.io is covered in [FUTURE_RENDERER_PLAN.md](FUTURE_RENDERER_PLAN.md). That migration can proceed after the correctness foundation; it does not require completing every enhancement here.

- Re-read the relevant code and this plan before implementing; file/function references are more durable than line numbers.
- Preserve the namespaced DSL, aliases, formatting semantics, saved-diagram schema, and existing share links unless a task explicitly specifies a change.
- Use TypeScript, native browser APIs, and the existing `node:test` runner. Introduce a browser-test dependency only for the browser regression task.
- Add regression checks alongside each behavioral fix. Do not replace invariant checks with large generated XML snapshots.
- Extract small functions/modules when a task needs them for reuse or testing. Avoid a framework migration, general plugin framework, or broad file reorganization.
- Root-level diagrams and local tool output are not the supported fixture corpus. Use tracked examples or purpose-built small fixtures; preserve unrelated local files.
- Update this checklist and record checks performed when a task is actually complete.

## Architecture and verified baseline

```text
CLI: src/drawdsl.ts -> src/cli.ts
Web: index.html -> src/web.ts
                       |
             src/parser.ts + src/symbols/*
                       |
                 DocumentAst
                       |
             src/layout/index.ts
             ├── elk.ts: hierarchical placement / grids
             └── routing.ts: libavoid + route cleanup
                       |
                 LayoutResult
                       |
              src/render/drawio.ts
                       |
            .drawio XML / GraphViewer preview
```

The compiler already has useful boundaries and extensive routing tests. Keep those boundaries. Browser persistence, sharing, editing, compilation, and viewer integration currently live together in `src/web.ts`.

Checks run with Node `v24.16.0`:

| Check | Result |
| --- | --- |
| `npm test` | All 30 tests passed |
| `npm run check` | Passed |
| `npm run lint:ts` | Passed |
| `npm run web:build` | Passed; large-chunk warning |

The production application JS was approximately 1.55 MB uncompressed / 480 KB gzip, plus a 492 KB WASM asset. The remotely loaded diagrams.net viewer is additional and not included in these build sizes. These numbers identify a measurement opportunity, not a demonstrated performance failure.

Compiler defects below were reproduced with direct Node calls where stated. Browser findings are based on source inspection: the browser automation service timed out during this review, so interactive behavior and screenshots remain implementation-time verification work.

## Priority and execution order

| ID | Priority | Deliverable | Dependencies |
| --- | --- | --- | --- |
| P01 | High | Own-property symbol resolution | None |
| P02 | High | Safe, unambiguous draw.io serialization | P01 recommended |
| P03 | High | Separate PR validation from Pages deployment | None |
| P04 | High | Revision-safe compilation and explicit preview state | None |
| P05 | High | Reliable shared-link decoding and copying | P04 state conventions |
| P06 | Medium | Parser diagnostics, numeric validation, formatter fix | P01 |
| P07 | Medium | Reliable saved-diagram state and recovery | P04 state conventions |
| P08 | Medium | Browser regressions and keyboard/mobile usability | P03; develop alongside P04–P07 |
| P09 | Medium | Direct file export and CLI contract checks | P02, P04 |
| P10 | Later | Measured performance improvements | P04, P08 |

Suggested first delivery: P01–P05 plus regression coverage for their affected paths. Tasks touching `src/web.ts` should be sequenced to avoid competing state models.

## P01 — Reject inherited properties as symbols

- [x] Implement and verify.

**Evidence:** `parseDsl("core:toString x")` and `parseDsl("core:__proto__ x")` currently succeed. `resolveSymbol()` and `qualifiedCandidates()` use ordinary object indexing, so properties inherited from `Object.prototype` can be treated as symbol definitions. AWS alias lookup has the same own-property issue.

**Files:** `src/symbols/registry.ts`, `tests/drawdsl.test.ts`.

**Implementation:**

1. Use `Object.hasOwn()` for both alias and symbol lookup, consistently in both registry functions.
2. Keep unknown-symbol suggestions and existing aliases working. A new registry abstraction is unnecessary.
3. Test `toString`, `constructor`, `hasOwnProperty`, and `__proto__` through the registry and parser, for both namespaces.

**Acceptance:** Unknown inherited names fail during parsing rather than layout/rendering; supported names and aliases still resolve to their existing definitions. Error source locations are added in P06.

## P02 — Make draw.io output structurally and textually correct

- [x] Implement and verify.

**Evidence:** This valid DSL produces two `<mxCell id="edge_1_a_b">` elements:

```text
core:box a
core:box b
core:box edge_1_a_b
a --> b
```

Also, both `core:image x` and `core:image x "javascript:alert(1)"` currently parse. `nodeStyle()` inserts the image label directly into a semicolon-delimited style value. XML escaping does not prevent a literal semicolon in that value from becoming a style delimiter. Labels are XML-escaped, but most styles enable `html=1`; XML escaping alone is not a contract that labels display as literal text after draw.io parses the XML.

**Files:** `src/parser.ts`, `src/render/drawio.ts`, `src/symbols/core.ts`, `tests/drawdsl.test.ts`.

**Implementation:**

1. Make generated edge cell IDs disjoint from user node IDs, including forward declarations. Prefer a renderer-local edge ID namespace containing a character the DSL cannot use in IDs; retain user node IDs and references. Update the existing example assertion that assumes `edge_1_internet_cdn` if necessary.
2. Require a quoted, absolute HTTP(S) URL for `core:image`, using the platform `URL` parser plus an explicit protocol allowlist. Report the declaration line. Do not fetch images during parsing or CLI generation.
3. Handle the draw.io style delimiter independently of XML escaping. Verify draw.io's supported URL representation; either serialize delimiter-containing URLs losslessly using that representation, or reject unsupported raw delimiters with an actionable error. Do not silently truncate URLs or let URL text introduce style keys.
4. Define node and edge labels as plain text, including `<`, `>`, `&`, quotes, and newlines. Prefer an existing draw.io plain-text mode if it preserves expected wrapping; otherwise encode both layers deliberately. Verify in a real viewer rather than only matching XML strings.

**Acceptance:**

- Cell IDs are unique for adversarial but valid user IDs; edge references resolve to the intended vertices.
- Missing/relative/non-HTTP(S) image URLs fail with useful errors. HTTPS URLs with query parameters and fragments survive serialization.
- A URL containing `;shape=...` cannot change the cell shape or add a style key.
- Labels such as `<b>literal</b> & text` display literally for nodes and edges; multiline labels still work.
- Existing diagrams remain editable in diagrams.net. This task fixes the current exporter even if the future native preview is adopted.

## P03 — Separate CI validation from deployment

- [x] Implement and verify.

**Evidence:** `.github/workflows/pages.yml` triggers on `pull_request`, but its sole job declares the `github-pages` environment and runs `configure-pages`, artifact upload, and `deploy-pages` without an event/ref condition. Workflow-wide concurrency uses the constant group `pages`, allowing unrelated PR checks and deployments to cancel each other.

**Files:** `.github/workflows/pages.yml`, `package.json`, `README.md`.

**Implementation:**

1. Run install, type-check, lint, tests, and production build in a validation/build job for PRs and main.
2. Put the Pages environment and deployment steps in a separate job gated to `refs/heads/main` and non-PR events, dependent on successful validation. Reuse the built artifact.
3. Give validation only `contents: read`; scope `pages: write` and `id-token: write` to deployment.
4. Scope validation concurrency to the branch/PR. Serialize production deployments separately so a PR cannot cancel a main deployment.
5. Document Node 24 as the development/CI baseline and declare a compatible `engines.node` range rather than leaving runtime requirements implicit.

**Acceptance:** A fork PR can run all checks without deployment permissions or the Pages environment; a successful main build can deploy; a failed build cannot deploy. Verify the event conditions and artifact/job dependencies, then confirm actual GitHub runs when available. Do not claim remote validation from local checks alone.

## P04 — Make browser compilation revision-safe

- [x] Implement and verify.

**Evidence:** `revision` increments only when `render()` starts, not when input changes. During the 300 ms debounce, an older in-flight render can still publish. Failed parses leave `latestXml` and enabled XML buttons pointing at a previous source. Theme toggles perform the entire layout again. Router/viewer initialization promises start immediately, but rejection handlers are attached only when compilation reaches their awaits.

**Files:** `src/web.ts`, `index.html`, `src/web.css`; a small extracted compile-controller module only if needed for deterministic tests.

**Implementation:**

1. Track a source revision when DSL changes via typing, formatting, loading a saved diagram, or restoring a share link. Capture the revision and source at compilation start; discard results/errors unless they still match.
2. Represent pending, current, and failed/stale output explicitly. Keeping the last successful preview is useful, but label it stale and disable current-output export/copy until the current source compiles. Preserve the ability to return from XML view to DSL.
3. Ensure a compilation that finishes while XML view is open updates the displayed XML consistently with the compiled source.
4. Handle initialization failures immediately. Treat compilation success and viewer failure separately: a viewer load failure should not prevent access to valid generated XML.
5. Rebuild only the preview presentation on a theme change; reuse the current successful result rather than rerunning layout.
6. Keep status updates from unrelated async operations from silently erasing errors before the user can see them.

**Acceptance:** Deterministically delay compile A, edit to B, and resolve A during B's debounce: A never becomes current. Invalid B cannot be exported as A. Viewer failure is reported without an unhandled rejection; XML remains available if compilation succeeded. Theme changes do not invoke layout again.

## P05 — Make share links reliable and bounded

- [ ] Implement and verify.

**Evidence:** `syncShareUrl()` can run without a revision guard for Copy share link. Startup reads `z` regardless of `v`; a decompression error message is subsequently cleared by successful starter rendering. `decompressDsl()` buffers the entire expanded stream without a size limit. There are no automated share-link tests.

**Files:** `src/web.ts`; extract a small `src/share.ts` for codec functions; add `tests/share.test.ts`; update sharing documentation.

**Implementation:**

1. Preserve legacy `#dsl=...` links and current `#v=1&z=...` links. Explicitly reject unsupported compressed versions. Define precedence for links containing both forms.
2. Separate encoding a captured DSL string from mutating browser history. Use revision checks for every history update. Copy the URL built for the source snapshot at click time, rather than reading mutable `location.href` after unrelated async work.
3. Bound both encoded input and expanded UTF-8 bytes. Start with documented limits of 1 MiB encoded payload and 2 MiB decoded DSL; stop/cancel decompression as soon as the expanded limit is exceeded instead of checking after full buffering. Treat these as share-import limits, not arbitrary limits on CLI documents.
4. Surface malformed base64, gzip, UTF-8, unsupported version, and size errors persistently. Do not overwrite the user's edits if restoration completes late.
5. Retain raw-link fallback when compression is unavailable. Explain clearly when a compressed link cannot be opened because decompression is unavailable.

**Acceptance:** Round trips preserve Unicode, literal backslashes, newlines, and empty documents. Bad/oversized links fail without crashing or being silently replaced by a successful starter status. Rapid edits and delayed compression never publish an older source over a newer one. Unit-test codec behavior with native APIs; browser-test history/clipboard races.

## P06 — Improve diagnostics and formatter correctness

- [ ] Implement and verify.

**Evidence:** Unknown symbols, unknown endpoints, and unclosed containers often lack a source line. Duplicate document `direction` silently uses the last value while duplicate container directions fail. `grid-columns 999999999999999999999` is accepted despite not being a safe integer. Formatting a valid unquoted edge label ending in `{` indents subsequent statements because `formatDsl()` treats any `code.endsWith("{")` as a block opener.

**Files:** `src/parser.ts`, `src/formatter.ts`, `src/config.ts`, `src/model.ts` if source locations are retained, `src/web.ts`, compiler tests.

**Implementation:**

1. Carry declaration/edge line information or retain parser-local locations so post-parse validation reports the offending line. Introduce one small error type with a numeric line field if the browser needs structured diagnostics; preserve useful CLI messages.
2. Reject duplicate document directions consistently. Validate `grid-columns` as an integer from 1 to 10000, reusing the existing numeric validation convention; retain child-count clamping during layout.
3. Recognize actual declaration block openers in the formatter rather than arbitrary trailing braces. Reuse a small parser scanning helper if necessary; do not introduce a parser generator.
4. Use structured line information to mark the offending editor line and offer a keyboard-accessible way to focus it. Do not infer locations by parsing human-readable error strings.
5. Clarify directive ranges, duplicate behavior, and multiline-label behavior in README/SKILL authoring guidance.

**Acceptance:** Unknown symbols/references and unmatched containers identify the original source line. Boundary/overflow values and duplicate directions are covered. Formatting is idempotent and preserves the full semantic AST for nested blocks, comments, escaped quotes, multiline declarations, CRLF, and edge labels ending in braces. CLI and playground report compatible diagnostics.

## P07 — Repair saved-diagram UI state and storage failure handling

- [ ] Implement and verify.

**Evidence:** `renderSavedDiagrams()` removes the `#saved-empty` element with `replaceChildren()` and retains a reference to the detached element, so the empty message cannot be shown again. `loadSavedDiagram()` changes `loadedDiagramId` but does not refresh active-list styling. `readSavedDiagrams()` returns `[]` for corrupt/unavailable storage, indistinguishable from an empty collection; a later save can overwrite corrupt data. Loading another diagram immediately replaces unsaved edits.

**Files:** `src/web.ts`, `index.html`, saved-state browser tests.

**Implementation:**

1. Keep the empty-state element outside the replaceable list, or explicitly render it as part of the list. Refresh loaded/active state after every load/save/delete.
2. Compare the current source with the loaded snapshot for dirty state. Confirm replacement only when it would discard unsaved changes; use existing native dialog patterns.
3. Distinguish empty storage from read/parse failure. Report failure and preserve the stored bytes until an explicit recovery/reset action; do not turn corruption into a successful empty read followed by overwrite.
4. Handle quota/permission failure without changing loaded identity or claiming success. React to `storage` events so other-tab saves/deletions are visible; do not silently replace dirty editor contents.
5. Keep the existing v1 record format; an IndexedDB migration is unnecessary for this fix.

**Acceptance:** The empty message appears at startup and after deleting the last item. Active styling follows the loaded item. Dirty edits are not lost by accidental loading. Corrupt/quota-denied storage produces a recoverable message, preserves source/data, and does not report a successful save. Another tab's changes do not silently reset the editor.

## P08 — Add focused browser regressions and fix keyboard/mobile defects

- [ ] Implement and verify.

**Evidence:** Tests currently import compiler modules only. The editor intercepts every Tab, including Shift+Tab, leaving keyboard users without the ordinary focus exit. Toolbar/header rows have no wrapping behavior at narrow widths. `updateEditor()` retokenizes every line twice and rebuilds markup even on scroll. The highlighting operator regex uses `-.-` with an unescaped dot, unlike the parser's literal dashed operator.

**Files:** `src/web.ts`, `src/web.css`, `index.html`, `package.json`, lockfile, a minimal Playwright configuration and browser tests, CI validation job.

**Implementation:**

1. Add a small Chromium Playwright smoke/regression suite and `npm run test:web`. Keep browser tests separate from `tests/*.test.ts`, which the Node runner loads.
2. Make tests deterministic by intercepting the remote viewer script with a small test stub for app-state tests. Include a real-viewer integration procedure separately; the stub cannot prove diagram rendering correctness.
3. Test compile failure/recovery, stale results, XML/DSL switching, save/load/delete, storage failure, raw/compressed links, viewer failure, and clipboard denial.
4. Restore a documented keyboard escape from indentation mode; at minimum let Shift+Tab leave the editor and provide a way to move forward without inserting spaces. Preserve native focus visibility and label the editor appropriately in XML view.
5. Make toolbars/header wrap or scroll within their own region, so 320–375 px screens do not force document-wide overflow or hide essential controls. Verify desktop layout too.
6. Escape the literal dot in the highlighting regex. Separate scroll synchronization from tokenization; compute each line's highlight once per content refresh.

**Acceptance:** Tests run against the built app at `/drawdsl/` in CI. All controls can be reached without a mouse; focus can leave the editor in both directions. Narrow viewports expose every essential action without page-wide horizontal scrolling. Parser-valid dashed operators are highlighted correctly. Scrolling does not rebuild syntax markup.

## P09 — Add direct downloads and verify CLI behavior

- [ ] Implement and verify.

**Opportunity:** The playground only exposes clipboard XML; downloading a file is a simpler path into draw.io and gives users a portable DSL backup. The CLI has no subprocess contract tests.

**Files:** `src/web.ts`, `index.html`, `src/cli.ts` only where tests reveal defects, `tests/cli.test.ts`, README.

**Implementation:**

1. Add Download `.drawio` for the current successful output and Download `.drawdsl` for current source, including invalid drafts. Use native Blob/object-URL downloads and revoke URLs after use.
2. Reuse the loaded diagram name for a safe filename, with a stable fallback. Do not require clipboard permission or a viewer network connection.
3. Exercise the real CLI entrypoint using Node subprocesses and temporary directories: successful generation, `--check`, formatting to stdout, `--format --write`, invalid input, missing files, and invalid argument counts.
4. Assert exit codes (success 0, operational/DSL failure 1, usage 2), stdout/stderr contracts, and that validation failure leaves an existing output/input file untouched.

**Acceptance:** Downloaded source is exact and generated XML matches the current successful compile. Failed compilation cannot download stale XML as if current. CLI checks run under `npm test` and clean up their temporary files.

## P10 — Profile before optimizing layout or moving it to a worker

- [ ] Measure and record findings; implement only justified changes.

**Evidence:** `routing.ts` repeatedly constructs obstacles/segments and scores segment pairs; `elk.ts` scans all document edges for projected layouts. Browser layout runs in the main JS context. These are potential hotspots, not measured regressions. The build-size warning alone does not justify a bundling rewrite.

**Files:** `src/layout/routing.ts`, `src/layout/elk.ts`, `src/web.ts`, a small benchmark under `scripts/`, package script if useful.

**Implementation:**

1. Create deterministic small/medium/large fixtures (roughly 25/100/300 nodes) with representative nesting and edges. Measure parse, placement, routing/cleanup, render, and browser input responsiveness separately; report graph sizes, environment, warm-up, and medians.
2. Use an interactive goal of keeping editor input responsive within roughly 100 ms on the recorded reference machine. Identify actual long tasks before choosing a change; do not add hardware-dependent timing assertions to ordinary CI.
3. Apply the cheapest measured improvement first: avoid redundant work, reuse per-compile indexes/obstacles, or avoid unnecessary recompilation. Preserve geometry invariants and route quality tests.
4. If compilation still blocks interaction, move the existing pipeline to one module Web Worker with revision-tagged messages, one active job and one latest pending source. Initialize router WASM inside the worker, handle failure, and verify production asset paths. Message IDs discard stale results; they do not cancel synchronous work already running.
5. Retain the current routing algorithm unless profiling and regression fixtures justify a change. Removing unused `sharedContainerOrigin()` is safe only after confirming no new callers; it is not a performance project.

**Acceptance:** Record before/after measurements and unchanged correctness results. If no meaningful problem is measured, close the task with findings instead of adding a worker/cache. Coordinate worker ownership with the future SVG renderer so the pipeline is moved only once.

## Completion checklist for each implementation delivery

- Reproduce the targeted defect or document the intended new behavior.
- Add the smallest durable regression check for the affected behavior.
- Run `npm test`, `npm run check`, `npm run lint:ts`, and `npm run web:build`.
- Once P08 exists, run `npm run test:web` for web changes and relevant production asset-path checks.
- Verify viewer-specific changes against real diagrams.net; deterministic viewer stubs do not cover integration.
- Update user-facing documentation for changed validation or controls.
- Inspect the final diff and report completed task IDs, checks, and any remaining blockers.
