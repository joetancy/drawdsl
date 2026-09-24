# DrawDSL connection layers plan

Base revision: `3fe157d3c4f2ba2e898146c70166588fc2735ec6`.
Branch: `feat/flow-layers`.

The earlier improvement backlog is preserved without changes in [IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md).

## Scope

Add connection layers to the standalone DrawDSL editor and native `.drawio` export. Keep one shared architecture. Do not implement or extend the draw.io plugin. Existing plugin files are outside this task.

Nodes and containers stay on the Architecture layer. Each edge belongs to exactly one connection layer. Unassigned edges use the Connections layer. Named layers describe different data flows. Layers are metadata scopes, not containers or ELK ranks.

## Language contract

```text
color requestsColor = #2563EB

aws:apigw api "API Gateway"
aws:lambda handler "Handler"
aws:dynamodb data "Data"

layer requests "Request flow" [color=requestsColor, width=2] {
    api --> handler : HTTPS
    handler --> data : Read / write
}

layer events "Event flow" [visible=false] {
    data -.-> handler : Change event
}
```

Also support `api --> handler [layer=requests] : HTTPS` outside a layer block. Resolve named layers after parsing so forward references work. An explicit edge style overrides its layer default. Reject duplicate or unknown layer IDs, invalid options, nested layers, nodes inside layer blocks, and conflicting layer assignments. Chained edges inherit their containing layer. Reserve `connections` for the implicit default layer. A node ID may equal a layer ID because exported layer IDs use a separate namespace.

## Invariants

- Position all nodes and route all edges together, including initially hidden layers.
- Changing layer visibility must not run the compiler, ELK, or libavoid again.
- Preserve node coordinates, waypoints, labels, container ownership, and cross-layer endpoints.
- Use native root-level draw.io layer cells; never duplicate nodes or edges for an All flows control.
- Preserve existing DSL inputs, saved diagrams, share links, and CLI commands.
- Initial visibility is part of the DSL. Preview switches are view state and must not silently rewrite source or the canonical export.
- Keep view switches stable through a source recompile where the same layers remain. Reset them when another diagram is loaded. Preserve the last successful preview on errors.
- Do not add a renderer, framework, or new runtime dependency.

## Commit sequence

Commit and push this plan before implementation. For each step below, update its checkbox and verification notes in the same commit as the implementation, then push the branch before starting the next step. Record any later corrections in separate commits.

- [x] P00: Publish this plan and preserve the previous backlog.
- [x] L1: Add the layer model, parser, validation, formatter/folding support, editor syntax support, and focused language tests.
- [x] L1a: Correct the test lint issue found by CI and simplify the escaped-label fixture.
- [ ] L2: Carry layer metadata through compilation; export Architecture, Connections, and named layers; test geometry and endpoint preservation.
- [ ] L3: Add standalone preview controls for individual layers, All flows, Architecture only, and default visibility. Switch visibility without recompilation and cover view-state transitions.
- [ ] L4: Document the syntax and export contract, add a multi-flow example, run integration and browser regressions, and record the final results.

## Verification

Use the existing Node 24 toolchain and test commands:

- `npm test`
- `npm run check`
- `npm run lint:ts`
- `npm run web:build`
- `npm run test:web`

Add focused tests with each step. Verify unknown references and malformed input, chain inheritance, style precedence, escaping and ID collisions, hidden-layer geometry invariance, nested containers, parallel flows, and layer state changes. Browser checks must cover toggling without another compile, labels hiding with edges, accessible controls, saved/shared diagrams, stale-preview errors, and a narrow viewport.

Where the local environment cannot install the repository dependencies, use the repository CI and report its actual result. Do not report unrun checks as passed. Final delivery must name the branch, commit sequence, and any checks that could not complete.

## Progress and results

### P00

Plan published before implementation in commit `0f611d3`. The previous `PLAN.md` is preserved as `IMPROVEMENT_PLAN.md`. No implementation files changed in this step. Baseline CI run `35999385459` passed.

### L1

Commit `4c186ae` added separate layer definitions, default Connections membership, top-level edge-only blocks, inline references, forward resolution, style inheritance, and line-aware validation. The existing formatter and folding code now recognize layer blocks through the shared parser helper. Added editor highlighting and 11 focused language tests.

CI run `35999813051` passed TypeScript checks but stopped at `no-regex-spaces` in one new test. Unit tests, build, and browser tests did not run in that attempt.

### L1a

Replaced the indentation regex with an exact string check and simplified the escaped-label fixture with `String.raw`. CI reruns after this commit. Local dependency installation remains blocked by network name resolution; no unrun check is reported as passed.
