<!-- Copyright 2026 Connecting Solution & Applications Ltd under the Apache License, Version 2.0. -->
# Changelog

## Unreleased

- Add one product-neutral public-health statistics Communication contract.
  Professional flows express publication intent while certifying coded
  evidence; individuals may later reference a stored professional-origin
  record or submit a code-only self-report. The SDK never asserts
  qualification, provenance, authorization, routing or ledger identity.
- Add the 2026 development-owner notice and re-establish the public repository
  from a clean source snapshot while
  retaining this changelog as the package release record.

- Add runtime-neutral clinical Communication review orchestration that keeps
  preparation, assigned review, sender, transport actor, recipients and
  clinical payload distinct, and permits delivery only after approval.
- Add runtime-neutral orchestration for organization-managed subject Groups:
  municipal subject registration/membership management and read-only
  passenger-transport immunization verification remain separate plans.

## 0.5.2 - 2026-10-04

- Add runtime-neutral accepted-handover orchestration that prepares the
  Encounter/EncounterHistory projection together with the retained, added and
  removed professional Group audience and a family-safe journey event.
- Preserve every inner resource identifier and project both provider-owned
  Encounter snapshots with idempotent creates, so a subject index does not
  require a prior copy of the source Encounter.
- Consume the neutral emergency Group builders and remove the obsolete
  product-prefixed helper names from SDK tests and examples.

## 0.5.1 - 2026-10-04

- Add the shared Bundle synchronization draft contract for clinical documents,
  Consent, emergency contacts and Encounter transfers. Optimistic records stay
  visibly pending after ambiguous or transient provider failures, definite
  rejections restore the last confirmed Bundle, and only authoritative
  provider readback marks a mutation as confirmed.

- Add the claims-first Encounter transfer projection helper. It keeps a
  returning source `on-hold`, completes a definitive source departure, starts
  the destination `in-progress`, records both `EncounterHistory` milestones,
  and sends the already-committed result to the subject index in one completed
  Communication batch.
- Document that movement does not imply `discharged`, that department sender,
  HealthcareService and authenticated audit actor remain distinct, and that
  emergency-contact files stay DocumentReference resources inside the Bundle.

- Add the neutral `bundle-changes-response` contract and publish its scheduling
  ownership guide. UHC consumers no longer expose a provisional copy.

- Move the standard Appointment-in-Communication authoring flow and the
  capability-driven FHIR scheduling client into the shared SOS/Vet/UHC layer.
  Product packages no longer need human or veterinary wrappers for standard
  FHIR resources.
- Remove temporary SOSChain-prefixed emergency authorization aliases and data
  reexport subpaths. Emergency Group and card-to-Place records now come from
  their single owner, `sos-data-utils-ts@0.6.0`.
- Consume the complete shared Task status vocabulary directly instead of
  maintaining a local compatibility overlay.

## 0.4.0 - 2026-09-29

- Add the shared high-level Communication Bundle editor and reader for SOS,
  Vet and UHC. Author an outer batch Bundle of Communications, validate each
  attached inner document/batch/collection Bundle with
  `fhir-data-utils-ts@0.6.0`, and keep PDF, image, audio and calendar files as
  inner DocumentReference resources.
- Pin `sos-data-utils-ts@0.5.1` and extend the existing
  `gdc-common-utils-ts@2.9.21` Bundle editor, reader and attached-Bundle session
  rather than introducing a parallel high-level implementation.

- Add runtime-neutral, department-aware equipment calibration and operating-authorization orchestration; blood-bank labeling remains explicitly deferred.

- Link the coordinated SOS/Vet/UHC clinical accessor adoption boundary so
  shared orchestration is added only with an actual multichannel workflow.

- Require the initial emergency triage Task owner to be a professional Group,
  while keeping the accepting PractitionerRole as Task owner and authenticated
  transport actor after acknowledgement.
- Define the department Organization as the FHIR Communication sender and keep
  the professional Group solely as the stable reply queue.
- Clarify that Group reply routing never replaces the legal Organization
  document author, professional attester or authenticated transport actor.

## 0.3.1 - 2026-09-27

- Pin the latest already-published `sos-data-utils-ts@0.4.2` baseline while
  grouped unreleased Task lifecycle changes continue through immutable local
  tarballs.
- Add high-level emergency triage Task readers and deterministic
  acknowledge/start/escalate/reject/complete transitions without rewriting the
  originating ServiceRequest.
- Preserve the protected communication-thread correlation on the Task and
  authorize responder callbacks only for the accepted or in-progress Task
  owner; endpoint resolution and signaling remain product-server concerns.

## 0.3.0 - 2026-09-26

- Pin `sos-data-utils-ts@0.4.1`, which owns the Organization fallback target
  and governed public-risk campaign criteria used by this release.
- Add idempotent fulfilled-Appointment to Encounter orchestration with
  Appointment, subject, service provider and current Location continuity.
- Add fail-closed authorization for encounter-related voice, video and secure
  messages. Calls never carry clinical Bundles, and preliminary Bundles may be
  delivered only without updating the subject index.
- Create independent compact-coded emergency ServiceRequest and triage Task
  entries targeting a HealthcareService or its owning Organization.
- Add frozen-cohort CommunicationRequest orchestration and per-recipient
  delivery checks for blood-donation and governed FHIR SearchParameter
  public-risk campaigns.
- Replace copied emergency Group members and split coding claims with the
  canonical Group-reference and compact-code contract.
- Document the immutable main-tarball local Vet proof required before npm
  publication and staging.

## 0.2.2 - 2026-09-25

- Add runtime-neutral ML-KEM-768 multi-recipient encryption for written and
  binary-audio messages with one SHA3-256-derived AES-256-GCM content key and
  one independently protected CEK entry per recipient.
- Preserve the historical deterministic 32-byte message-seed derivation
  contract and add recipient updates that rewrap the CEK without changing the
  stored ciphertext, IV or authentication tag.
- Fail closed for duplicate or unknown recipients, malformed envelopes,
  invalid random-source output and authenticated-ciphertext tampering.

## 0.2.1

- Link the shared runtime layer to the blocking local-first release order: complete local proof, merge validated branches to main, publish bottom-up, pin exact registry artifacts, then stage.

## 0.2.0

- Redefine `sos-sdk-core-ts` as the runtime-neutral orchestration layer consumed
  by SOSChain, Vet and UHC, above `sos-data-utils-ts` and below product SDKs.
- Remove the accidental dependency on and root reexport of `uhc-sdk-core-ts`.
- Add neutral `authorizeEmergencyAction` and `EmergencyDeliveryTarget` APIs;
  retain the older `Soschain*` names as deprecated compatibility aliases.
- Consume emergency evidence, Group/ServiceRequest and card-target contracts
  from `sos-data-utils-ts@0.3.0` instead of maintaining SDK-local copies.
- Preserve the existing SDK root and subpath exports as compatibility aliases.

## 0.1.5

- Add the short-lived `incident-reporter` evidence relationship used when a
  verified person scans an SOSChain/UHC/VetChain card at an incident without
  claiming to be the subject's guardian, controller or professional.

## 0.1.4

- Add the deliberate public deterministic SHA3-384/CID target hash used by
  smart contracts to return an existing Place or vehicle instead of duplicating it.

## 0.1.3

- Add flat claims for UHC/VetChain card associations to canonical SOSChain
  Place or vehicle identities and explicit created/existing match results.

## 0.1.2

- Replace premature FHIR resource objects with canonical flat
  `resource.meta.claims` contracts using kebab-case FHIR claim names.

## 0.1.1

- Add fail-closed emergency authorization evidence and regional/local delivery target contracts.
- Name emergency groups explicitly.

## 0.1.0

- Add opaque SOSChain emergency-group claims.
- Add the FHIR R5 `ServiceRequest` projection for group assistance.
