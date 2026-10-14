# Encounter transfer projection

The care provider owns the authoritative movement transaction. When a person
leaves one operational service and arrives at another, the provider persists:

1. the source `Encounter` as `on-hold` when the person will return, or
   `completed` when the departure is definitive;
2. one source `EncounterHistory` milestone with the same state;
3. the destination `Encounter` as `in-progress` on confirmed arrival; and
4. one destination `EncounterHistory` milestone.

`discharged` is not a movement synonym. It is reserved for the separate
clinical discharge stage. A diagnostic test, operation, ward move or ICU
admission therefore does not automatically discharge the source encounter.

After the provider has committed those four records, it can call
`prepareEncounterTransferProjectionCommunication(...)`. The helper produces a
completed `Communication` whose inner batch Bundle projects the same four
changes to the subject-index provider. The Communication is continuity and
discovery evidence; it is not a substitute for the provider transaction.
Both Encounter snapshots use idempotent `POST Encounter` commands because the
provider may already hold an Encounter that the subject index has never seen.
Their stable resource identifiers let the receiver return create-or-existing
readback without requiring a prior index record. Each milestone uses
`POST EncounterHistory` and retains its own stable identifier.

For a channel that follows the patient's journey, call
`prepareEncounterTransferOrchestration(...)` after the destination accepts the
handover. It returns the same projection Communication together with an
idempotent professional-Group audience reconciliation and a family-safe journey
event:

```ts
const transferPlan = prepareEncounterTransferOrchestration({
  ...encounterProjectionInput,
  communicationThreadId: emergencyThreadId,
  movementKind: patientWillReturn
    ? CareJourneyMovementKind.TemporaryTransfer
    : CareJourneyMovementKind.PermanentTransfer,
  sourceAssignments: authorizedSourceServiceGroups,
  destinationAssignments: authorizedDestinationServiceGroups,
  currentProfessionalGroupReferences,
  handoverAccepted: true,
})
```

The runtime persists the provider Encounter transaction, future channel
audience and journey event under the same idempotency key. A permanent transfer
removes the departed service Groups. A temporary transfer retains them while
adding the temporary destination Groups. Returning is another accepted
movement with the temporary Encounter as source and the resumed Encounter as
destination.

Only future messages use the reconciled audience. Previously sent
Communications keep their original recipient snapshots. Family recipients
receive the separately authorized journey projection, never professional Group
membership or internal clinical messages.

The department Organization is `Communication.sender`. Each Encounter keeps an
explicit `HealthcareService`. The authenticated professional/device remains
separate audit evidence and must not be copied into sender, document author or
attester fields.

Emergency-contact delivery follows the existing Communication Bundle rules:

- written text may be Communication content;
- audio, PDF and calendar files are `DocumentReference` entries;
- an arbitrary FHIR payload must be a validated inner Bundle;
- a live voice or video call is not an `Appointment`;
- a scheduled conversation may carry `Appointment`, later
  `AppointmentResponse`, and an optional `.ics` DocumentReference.

Portals should explain the outcome in plain language first. FHIR resource names
belong in optional technical details, SDK documentation and professional
support material—not in the primary user instruction.
