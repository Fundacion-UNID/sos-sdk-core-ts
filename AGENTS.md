# Shared SOS SDK Core agent contract
## Blocking local-first SDK release

The canonical contract is [`SDK_LAYERING.md`](https://github.com/Fundacion-UNID/sos-data-utils-ts/blob/main/docs/SDK_LAYERING.md).
Merge validated shared dependencies to `main`, build immutable unpublished
tarballs from those commits with `npm pack`, install them temporarily with
`--no-save`, and prove the real local Vet channel (portal, phone service,
chatbot or other supported channel) -> BFF/service -> high-level SDK -> GW VET
without skips. Then merge consumer source to `main`, publish exact commits
bottom-up, pin registry versions and lockfiles, repeat affected local gates,
and only then stage. Never commit a local package reference or tarball.


## Mandatory TDD

Use red-green-refactor TDD for every behavior change. Begin each test file with
a `Flow contract:` comment and prove positive, negative and compatibility
behavior where an alias is retained.

## Product boundary

- Consume deterministic contracts from `sos-data-utils-ts`.
- Keep only runtime-neutral authorization and orchestration reusable by SOS,
  Vet and UHC here.
- Never depend on or reexport `uhc-sdk-core-ts` or `vet-sdk-core-ts`; those
  product SDKs consume this common layer.
- Keep SOSChain-specific Node transport, persistence and jobs in
  `sos-sdk-node-ts`.
- Do not move new behavior into frozen GW CORE v1 or a `gdc-*` package.
- Reuse canonical UHC subject identifiers. SOSChain is a client/resolver and
  never appears inside a stable subject URN.
- Keep older `Soschain*` names only as deprecated aliases of one neutral
  implementation, with positive and compatibility tests.
- Commit only exact registry dependencies. Git, workspace, vendored and
  `file:` dependencies are forbidden.
