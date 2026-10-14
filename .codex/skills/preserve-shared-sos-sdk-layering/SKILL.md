---
name: preserve-shared-sos-sdk-layering
description: Preserve sos-sdk-core-ts as the runtime-neutral common orchestration layer above sos-data-utils-ts and below Vet, UHC and SOSChain Node runtimes. Use when changing emergency authorization, shared workflows, exports, dependencies, compatibility aliases, package diagrams, SDK boundaries or deciding whether code belongs in sos-data-utils-ts, sos-sdk-core-ts, sos-sdk-node-ts, vet-sdk-core-ts or uhc-sdk-core-ts.
---

# Preserve shared SOS SDK layering
## Blocking local-first SDK release

The canonical contract is [`SDK_LAYERING.md`](https://github.com/Fundacion-UNID/sos-data-utils-ts/blob/main/docs/SDK_LAYERING.md).
Merge validated shared dependency sources to `main`, build immutable
unpublished tarballs from those commits with `npm pack`, install them
temporarily using `--no-save`, and prove the real local Vet channel (portal,
phone service, chatbot or other supported channel) -> BFF/service -> high-level
SDK -> GW VET without skips. Then merge consumer source to `main`, publish exact
commits bottom-up, pin exact registry versions and lockfiles, repeat affected
local gates, and only then stage. Never commit a local tarball or `file:`, Git
or workspace dependency.


## Keep both shared layers

```text
gdc-* frozen
    ↓
sos-data-utils-ts
    ↓
sos-sdk-core-ts
    ├──→ vet-sdk-core-ts
    ├──→ uhc-sdk-core-ts
    └──→ sos-sdk-node-ts
```

- Move types, schemas, deterministic builders and validators down to
  `sos-data-utils-ts` before consuming them here.
- Keep only runtime-neutral authorization and orchestration here.
- Own the shared high-level Communication Bundle extension here. Extend the
  existing GDC BundleEditor, BundleReader and
  CommunicationAttachedBundleSession instead of duplicating them; use
  `fhir-data-utils-ts` only for neutral import, projection and validation.
  Files remain DocumentReference resources inside the attached inner Bundle.
- Keep ML-KEM key generation/encapsulation, HKDF recipient wrapping, the
  historical message-seed-to-CEK derivation and AES-GCM content protection
  here. Text and audio are bytes under one envelope; only protected content
  type differs. Runtime packages inject CSPRNG bytes and must not duplicate
  these cryptographic operations.
- Put animal-only and human-only behavior in their product SDKs.
- Put SOSChain Node transport, persistence, credentials and jobs in
  `sos-sdk-node-ts`.
- Compose Encounter/EncounterHistory projection and deterministic future
  channel-audience reconciliation here. The product BFF/Node SDK authorizes
  the handover and atomically persists the Encounter transaction, audience
  revision and family-safe journey event. Never mutate historical
  Communication recipients.
- Never depend on or reexport Vet or UHC from this package.
- Never add new functionality to frozen GW CORE v1 or `gdc-*`.

## Preserve compatibility without duplication

Use neutral names for new shared APIs. Retain a public `Soschain*` name only as
a deprecated alias referencing the same implementation or type. Test the
canonical path, a negative path and alias identity.

Before publication, consume a validated unpublished `sos-data-utils-ts` main
commit only through a temporary immutable `npm pack` plus `--no-save` overlay.
After the full local Vet chain is green, publish and verify
`sos-data-utils-ts`, pin that exact registry version here, repeat the gate, and
only then publish this SDK for product SDKs to pin. Never commit local, Git,
workspace or vendored dependencies.
