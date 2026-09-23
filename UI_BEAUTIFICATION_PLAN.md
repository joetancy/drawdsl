# DrawDSL UI beautification — implementation handoff for Luna

## Goal

Make the playground feel like a polished developer workspace: calm, readable, compact, and focused on writing DSL beside a large diagram preview. This is a frontend presentation and interaction refresh, not a compiler or routing redesign.

## Current observations

Based on `index.html`, `src/web.css`, `src/web.ts`, and the CodeMirror integration:

- The editor toolbar mixes editing, sharing, view switching, and four export actions at equal visual weight.
- Emoji icons, repeated outlined buttons, and a full-width saved-diagrams strip create visual noise.
- `main` subtracts a fixed 104px from the viewport even though both top bars can wrap. This makes usable height unreliable on smaller screens.
- The preview lacks a clear panel heading; its loading, failure, and stale-output states need a consistent presentation.
- Dark mode is largely a collection of individual overrides. CodeMirror syntax colors and selection states need an intentional dark palette too.
- Status messages all use error-colored text, including successful saves and formatting.

Before implementation, capture baseline screenshots of the current application at desktop and mobile sizes. These observations are code-based, not a completed visual audit.

## Design direction

**Quiet architecture workbench.** Neutral surfaces, a single blue accent, crisp typography, restrained borders, and generous canvas space. Keep the interface practical rather than decorative.

### Visual tokens

Define shared CSS variables in `src/web.css`; consume them in CodeMirror themes where appropriate.

| Token | Light | Dark |
| --- | --- | --- |
| App background | `#F5F7FA` | `#0F1520` |
| Panel surface | `#FFFFFF` | `#17202E` |
| Muted surface | `#EEF2F6` | `#1D2939` |
| Main text | `#172B4D` | `#E6EDF5` |
| Secondary text | `#526174` | `#AAB8CA` |
| Border | `#D5DEE8` | `#344256` |
| Accent | `#2563EB` | `#8AB4FF` |

These are starting values; verify contrast on the actual rendered controls and syntax tokens. Define separate success, warning, error, selection, and focus tokens.

- Use the system sans-serif stack for UI and the existing monospace stack for code. No external font request needed.
- UI text: 13–14px; panel headings: 13px semibold; editor: 14px with comfortable line height.
- Spacing scale: 4, 8, 12, 16, 24px. Corners: 6–8px for controls, 10–12px for panels/dialogs.
- Use shadows primarily on dialogs and floating surfaces, not every panel.
- Replace emoji with consistent small inline SVG icons. Decorative SVGs use `aria-hidden`; icon-only controls need accessible names and tooltips.
- Keep motion subtle (roughly 120–160ms) and respect reduced-motion preferences.

## Target layout

```text
┌ DrawDSL                 Diagram name / saved state      Help  GitHub  Theme ┐
├ Saved diagrams ▾       Save   Save copy                    Share   Export ▾ ┤
│ ┌ Source ──────────────────────┐ ┌ Diagram preview ────────────────────────┐ │
│ │ DSL / XML       Fold  Format │ │ Preview status                          │ │
│ │                             │ │                                         │ │
│ │ CodeMirror                  │ │ diagrams.net viewer                     │ │
│ │                             │ │ (existing zoom/navigation controls)     │ │
│ └ Diagnostic / status ────────┘ └─────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

Use a full-height CSS grid shell with intrinsic header/tool rows and `minmax(0, 1fr)` for the workspace. Remove the fixed header-height subtraction. Editor and preview scroll independently.

Desktop starts with approximately 40% editor / 60% preview. On narrow screens, stack panels with explicit useful minimum heights and normal page scrolling; avoid squeezing both into fixed half-viewport rows underneath a wrapping toolbar. All actions remain reachable at 360px width.

## Implementation phases

### 1. Establish the shell and visual system

**Files:** `src/web.css`, `index.html`.

- Introduce shared tokens and consistent button, input, panel, and dialog styles.
- Replace broad selectors such as `header span` with purpose-specific classes so icon markup is not accidentally styled as subtitle text.
- Implement the intrinsic-height page shell and panel layout.
- Add a clear preview heading and align source/preview panel headers.
- Give the app title a simple wordmark treatment; preserve its existing reset navigation behavior.

**Done when:** Both panels use available height reliably; desktop and mobile have no page-level horizontal overflow or clipped controls.

### 2. Simplify action hierarchy and saved diagrams

**Files:** `index.html`, `src/web.ts`, `src/web.css`.

- Keep Fold and Format beside the editor. Present DSL/XML as a clear view switch, including a read-only indicator for XML.
- Put sharing and exports in the document toolbar. Give Download draw.io the strongest visual emphasis among export actions.
- Group Copy XML, Download DSL, and Download draw.io in a compact Export disclosure using native HTML controls. Prefer a disclosure containing normal buttons over implementing ARIA menu keyboard behavior from scratch.
- Consolidate DSL guide and SKILL.md under a Help disclosure.
- Replace the always-expanded saved-diagram strip with a Saved diagrams disclosure containing the existing load/delete list. Keep diagram naming, Save, and Save copy discoverable.
- Show the loaded name and actual unsaved state using the existing source/snapshot comparison. Avoid displaying “Saved” merely because a diagram has been loaded.
- Preserve stable element IDs where practical. Existing JS listeners should continue to target the actual controls, not duplicate hidden versions.
- Update dynamic button text in `src/web.ts` along with the HTML so success feedback and theme switching do not restore emoji or erase new icon markup.

**Done when:** Every existing action remains available; save/load/delete, dirty confirmation, XML switching, and export disabling still behave correctly.

### 3. Polish the editor and preview states

**Files:** `src/editor.ts`, `src/web.ts`, `src/web.css`.

- Theme CodeMirror itself: gutters, active line, caret, selection, fold placeholders, search UI, and syntax highlighting in both themes. Use CodeMirror extensions/compartments for theme changes.
- Keep text and selection entirely inside CodeMirror. Do not reintroduce text overlays or custom folded-document mappings.
- Use a compact, stable status area with distinct neutral, success, warning, and error treatments; pair meaningful color with text/icons.
- Surface “Rendering”, “Up to date”, “Showing last successful preview”, and viewer-load failure accurately from existing async render state. Respect revision checks so old compilations cannot overwrite current status.
- Maintain the last successful preview on invalid DSL and retain disabled stale-XML export behavior.
- Add a restrained loading presentation and actionable viewer-failure text. Preserve XML access when viewer loading fails.
- Keep preview decoration outside the viewer's generated DOM. If using a faint grid background, it must not appear in exported diagrams or compete with diagram edges.
- Reuse the viewer's zoom controls. Do not add decorative zoom buttons without a working viewer API integration.

**Done when:** Editor selection stays aligned, code is readable in both themes, and compilation/viewer states communicate what is happening without layout jumps.

### 4. Dialogs, responsive details, and accessibility

**Files:** `index.html`, `src/web.css`, `src/web.ts` as needed.

- Give guide, skill, and delete dialogs consistent headings, padding, close controls, and scroll behavior.
- Keep help snippets readable, with horizontal scrolling contained inside code blocks. Include current `col`, color constants, edge styling, and group background syntax.
- Provide visible keyboard focus, usable touch targets (aim for 44px on touch layouts), and accessible names for all controls.
- Verify disclosure and dialog open/close behavior, Escape, and focus return to the triggering control.
- Preserve keyboard escape from the editor and existing live-region announcements without announcing every cursor movement.
- Ensure long diagram names, long errors, and many saved diagrams do not break panel sizing.
- Honor the existing theme toggle; if persisting theme preference, make storage failure harmless and keep first-render colors consistent.

**Done when:** The whole workflow works with keyboard alone and on a 360px-wide screen in both themes.

## Scope and implementation constraints

- Use the existing TypeScript, Vite, CodeMirror, native dialogs, and diagrams.net viewer.
- No framework migration, new component library, or new icon/font dependency is needed.
- Preserve DSL syntax, graph layout/routing, generated XML, storage format, and share-link compatibility.
- Keep changes concentrated in the frontend files above and their browser tests. Add helpers only where they remove genuine duplication.
- Defer draggable panel splitters, command palettes, onboarding tours, and new diagram-rendering controls until separately requested.

## Verification and acceptance

Update `web-tests/app.spec.ts` to open disclosures before interacting with controls now inside them. Prefer accessible roles/names for new interactions; do not weaken assertions to make a redesign pass.

Run:

```bash
npm run check
npm run lint:ts
npm test
npm run web:build
npm run test:web
git diff --check
```

The browser tests use the production build, so build before running them.

Visual review matrix:

- 1440×900 and 1024×768 desktop; 768×1024 tablet; 360×800 mobile.
- Light and dark themes.
- Starter diagram and `examples/example.drawdsl`; a large nested diagram with long identifiers.
- Successful render, invalid DSL with stale preview, viewer-load failure, XML read-only view.
- No saved diagrams, many saved diagrams, long names, unsaved edits, and delete confirmation.
- Folding, typing, selecting, undo/redo, formatting, and switching back from XML.

Use both the stubbed-viewer tests and a manual real-viewer check. Stub tests cannot prove the diagram canvas, zoom toolbar, or dark-mode viewer integration look correct.

Acceptance checklist:

- [ ] Clear hierarchy: editing actions near code; document actions in the toolbar.
- [ ] Consistent typography, spacing, icons, and control states across the app.
- [ ] No viewport-height assumptions, clipped menus, or page-level horizontal overflow at tested sizes.
- [ ] Accessible contrast and focus indicators in both themes.
- [ ] All existing save, share, export, folding, and error-recovery behavior works.
- [ ] Status labels accurately describe current source and preview state.
- [ ] Updated browser tests and all checks pass.
- [ ] Before/after screenshots supplied for desktop and mobile in both themes.

## Handoff deliverable

Implemented the workbench redesign described above. Desktop, 360px mobile, light/dark themes, and the real diagrams.net preview were manually reviewed. Verification passed: `npm run check`, `npm run lint:ts`, `npm test`, `npm run web:build`, `npm run test:web`, and `git diff --check`.
