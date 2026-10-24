# Shared SOS SDK Core

Copyright 2026 Connecting Solution & Applications Ltd.
Licensed under the Apache License, Version 2.0; see [`NOTICE`](NOTICE).

## Public source history

The public repository begins from a clean 2026 source snapshot. The retained
[`CHANGELOG.md`](CHANGELOG.md) records package releases without republishing
the former Git push history.

Shared SOS orchestration includes [equipment calibration and operating authorization](docs/EQUIPMENT_COMPLIANCE.md) without embedding product roles or persistence plumbing.
## Blocking local-first SDK release

The canonical contract is [`SDK_LAYERING.md`](https://github.com/Fundacion-UNID/sos-data-utils-ts/blob/main/docs/SDK_LAYERING.md).
Merge and push validated shared dependency sources to `main`, create immutable
unpublished tarballs from those main commits with `npm pack`, and install them
temporarily with `--no-save`. Prove the real local SOS channel (portal, phone
service, chatbot or other supported channel) -> BFF or channel service ->
high-level SDK -> configured gateway journey without skips. Then merge the consumer source
to `main`, publish the exact commits bottom-up, pin exact registry versions and
lockfiles, repeat affected local gates, and only then promote to staging.
Never commit a tarball or `file:`, Git or workspace dependency.


Runtime-neutral shared SDK for SOSCHAIN. Deterministic shared record types and
builders come from `sos-data-utils-ts`; this SDK
owns reusable authorization and orchestration without Node, browser, gateway or
product-specific behavior.

The canonical architecture keeps both shared layers visible:

```text
gdc-* frozen
    ↓
sos-data-utils-ts
    ↓
sos-sdk-core-ts
    └──→ sos-sdk-node-ts
```

Consumers may also depend directly on `sos-data-utils-ts` when they import or
expose its types. `sos-sdk-core-ts` never depends on or reexports a downstream
product SDK. `sos-sdk-node-ts` owns SOSCHAIN-specific Node transport,
persistence and jobs; those adapters do not belong here.

Git, workspace, vendored and `file:` dependencies are forbidden in committed
or deployed dependency state.

The cross-product Bundle/Communication editor and reader are owned here as
high-level extensions of the existing `gdc-common-utils-ts` `BundleEditor`,
`BundleReader` and `CommunicationAttachedBundleSession`. They preserve those
APIs instead of duplicating their attachment or claims-first lifecycle, while
`fhir-data-utils-ts` supplies neutral import, projection and validation tools.
Follow the
[clinical accessor adoption matrix](https://github.com/Fundacion-UNID/sos-data-utils-ts/blob/main/docs/CLINICAL_TYPED_ACCESSOR_ADOPTION.md)
before changing dependencies: unaffected portals and assistants are not forced
to upgrade merely because a lower package published a newer editor.

All cross-participant exchanges use the established claims-first outer batch
Bundle containing one or more Communication resources. Each Communication
contains exactly one inner document, batch or collection Bundle in its
`application/fhir+json` attachment claims. Binary files such as PDF, image,
audio or `text/calendar` are DocumentReference entries inside the inner Bundle.
Native FHIR R4/R5 is materialized only at an explicit adapter boundary. See
[Communication Bundle editor and reader](docs/COMMUNICATION_BUNDLE_EDITOR_READER.md).

Anonymous public-health contributions use the same shared Communication
contract for human and animal products. See
[public-health statistics](docs/PUBLIC_HEALTH_STATISTICS.md).
The shared scheduling and response-correlation boundary is documented in
[FHIR scheduling interoperability](docs/FHIR_SCHEDULING_INTEROPERABILITY.md).
Source-to-destination care movement and subject-index projection are documented
in [Encounter transfer projection](docs/ENCOUNTER_TRANSFER_PROJECTION.md).

`BundleSyncDraft` is the shared serializable state for editors that must keep a
local clinical document, Consent, emergency-contact or Encounter mutation
visible while its provider write is pending. A successful HTTP response is not
confirmation: the draft becomes `confirmed` only after authoritative provider
readback. Ambiguous and transport failures remain `retryable`; definite remote
rejections restore the last confirmed Bundle.

The emergency-group contract stores subject references only on an enumerated
FHIR Group. A group assistance request references that Group from one standard,
compact-coded ServiceRequest; it never copies members or persists split coding
claims. Flat claims remain the canonical storage representation and native
FHIR is projected only at an explicit boundary.

`authorizeEmergencyAction` separately checks trusted evidence for every
member and for `sos:call` or `sos:request`. Identity verification alone never
grants an emergency capability. Regional/local delivery is represented by
`EmergencyDeliveryTarget`; transport and tenant routing stay outside FHIR.
The `incident-reporter` relationship represents a short-lived grant issued by
a trusted scan resolver to an already verified person at the scene; it does
not imply guardianship, control or professional status.

Emergency evidence, Group records and card-to-Place associations are imported
directly from `sos-data-utils-ts`; this orchestration package does not retain
temporary reexport subpaths or product-prefixed authorization aliases.

## Care, emergency and alert orchestration

`sos-sdk-core-ts/care-emergency-alert-orchestration` supplies the shared,
runtime-neutral plans for Appointment-to-Encounter continuity, protected
pre-publication calls/messages, resilient emergency ServiceRequest plus triage
Task creation/transition/responder callback authorization, and governed
donation/public-risk campaigns. Transport,
persistence, authorization evidence acquisition and product policy remain in
the channel service, Node adapter and downstream application layers.

Emergency triage starts with a professional Group owner and changes to the
accepting PractitionerRole. The Group remains a reply queue, never the
clinical-document author or human Communication sender; those identities stay
separate from the professional attester and transport audit evidence.

See [docs/CARE_EMERGENCY_AND_ALERT_ORCHESTRATION.md](docs/CARE_EMERGENCY_AND_ALERT_ORCHESTRATION.md)
for lifecycle, authorization and persistence invariants.

## Multi-recipient secure messages

`sos-sdk-core-ts/secure-message-crypto` protects written and binary-audio
messages with the same runtime-neutral byte API. It derives one AES-256 content
key from one random 32-byte message seed, encrypts the content once, and wraps
that CEK independently for each ML-KEM-768 recipient. The ML-KEM shared secret
is recipient-specific; the resulting content key and ciphertext are common to
all authorized recipients.

`updateRecipients(...)` rewraps the existing CEK for added device/channel keys
and can remove obsolete or temporary service entries without changing the
stored ciphertext, IV or authentication tag. The caller remains responsible
for proving authorization to change recipients. Runtime packages inject only
`SecureRandomSource`; Node, Expo and browser crypto adapters must not duplicate
ML-KEM, HKDF or AES logic. See [docs/SECURE_MESSAGES.md](docs/SECURE_MESSAGES.md).

```bash
npm install
npm run check
```
