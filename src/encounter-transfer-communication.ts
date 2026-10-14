import {
  EncounterClaim,
  EncounterHistoryClaim,
  EncounterStatusR5,
  buildEncounterHistoryR5FlatEntry,
  type ClinicalCoding,
  type FhirResource,
} from 'fhir-data-utils-ts'
import {
  CareJourneyMovementKind,
  reconcileEncounterCommunicationAudience,
  type CareJourneyMovementKindValue,
  type EncounterCommunicationAudienceReconciliation,
} from 'sos-data-utils-ts/encounter-communication-audience'
import type { ProfessionalServiceGroupAssignment } from 'sos-data-utils-ts/organization-service-catalog'
import { CommunicationBundleEditor } from './communication-bundle.js'

export { CareJourneyMovementKind } from 'sos-data-utils-ts/encounter-communication-audience'
export type {
  CareJourneyMovementKindValue,
  EncounterCommunicationAudienceReconciliation,
} from 'sos-data-utils-ts/encounter-communication-audience'

export type EncounterTransferSourceDisposition = 'returning' | 'not-returning'

export type EncounterTransferProjectionInput = Readonly<{
  communicationIdentifier: string
  subjectReference: string
  /** Department Organization that performed and communicates the transfer. */
  departmentSenderReference: string
  /** Owning subject-index provider, not the emergency contact recipient. */
  indexRecipientReferences: readonly string[]
  occurredAt: string
  sourceDisposition: EncounterTransferSourceDisposition
  sourceEncounter: FhirResource & Readonly<{ resourceType: 'Encounter'; id: string }>
  destinationEncounter: FhirResource & Readonly<{ resourceType: 'Encounter'; id: string }>
  sourceHistoryIdentifier: string
  destinationHistoryIdentifier: string
  encounterClass: ClinicalCoding
}>

export type EncounterTransferOrchestrationInput = EncounterTransferProjectionInput & Readonly<{
  communicationThreadId: string
  movementKind: CareJourneyMovementKindValue
  sourceAssignments: readonly ProfessionalServiceGroupAssignment[]
  destinationAssignments: readonly ProfessionalServiceGroupAssignment[]
  currentProfessionalGroupReferences: readonly string[]
  handoverAccepted: boolean
}>

export type EncounterTransferOrchestration = Readonly<{
  projectionCommunication: Record<string, unknown>
  audienceReconciliation: EncounterCommunicationAudienceReconciliation
}>

/**
 * Builds the completed Communication used to project an already-committed
 * provider transfer to the subject index.
 *
 * This helper is not the provider transaction itself. The authorized provider
 * first persists the two Encounter updates and two EncounterHistory milestones;
 * only then may this Communication be marked `completed`. If the person will
 * return, the source Encounter becomes `on-hold`; otherwise it becomes
 * `completed`. `discharged` is reserved for the distinct clinical discharge
 * stage and is never inferred merely from movement. The destination becomes
 * `in-progress` on arrival.
 *
 * `Communication.sender` remains the department Organization. The authenticated
 * professional/device is transport audit evidence and must not be substituted
 * into the FHIR sender, author or attester fields.
 */
export function prepareEncounterTransferProjectionCommunication(
  input: EncounterTransferProjectionInput,
): Record<string, unknown> {
  requireDateTime(input.occurredAt)
  const source = normalizeEncounter(input.sourceEncounter, input.subjectReference)
  const destination = normalizeEncounter(input.destinationEncounter, input.subjectReference)
  if (source.id === destination.id) throw new TypeError('distinct_encounters_required')

  const sourceStatus = input.sourceDisposition === 'returning'
    ? EncounterStatusR5.OnHold
    : input.sourceDisposition === 'not-returning'
      ? EncounterStatusR5.Completed
      : (() => { throw new TypeError('source_disposition_invalid') })()
  const sourceUpdated = withEncounterStatus(source, sourceStatus, input.occurredAt)
  const destinationUpdated = withEncounterStatus(destination, EncounterStatusR5.InProgress, input.occurredAt)
  const sourceHistory = historyResource({
    identifier: input.sourceHistoryIdentifier,
    encounter: sourceUpdated,
    status: sourceStatus,
    occurredAt: input.occurredAt,
    encounterClass: input.encounterClass,
  })
  const destinationHistory = historyResource({
    identifier: input.destinationHistoryIdentifier,
    encounter: destinationUpdated,
    status: EncounterStatusR5.InProgress,
    occurredAt: input.occurredAt,
    encounterClass: input.encounterClass,
  })

  const editor = new CommunicationBundleEditor()
  editor.newCommunication()
    .setIdentifier(input.communicationIdentifier)
    .setStatus('completed')
    .setSubject(input.subjectReference)
    .setSender(input.departmentSenderReference)
    .setRecipients(input.indexRecipientReferences)
    .setSent(input.occurredAt)
    .setAttachmentTitle('encounter-transfer-bundle.json')
    .setInnerBundleType('batch')
    .addResource(sourceUpdated, { method: 'POST', url: 'Encounter' })
    .addResource(sourceHistory, { method: 'POST', url: 'EncounterHistory' })
    .addResource(destinationUpdated, { method: 'POST', url: 'Encounter' })
    .addResource(destinationHistory, { method: 'POST', url: 'EncounterHistory' })
    .doneCommunication()
  return editor.build() as Record<string, unknown>
}

/**
 * Prepare one runtime-neutral transfer plan after the destination accepts
 * handover.
 *
 * The product BFF authorizes the actor and resolves current service Group
 * assignments before this call. Its persistence adapter then commits the
 * Encounter/EncounterHistory transaction, the new future channel audience and
 * the family-safe journey event under the same idempotency key. Historical
 * Communication recipients remain immutable. This SDK neither stores state
 * nor interprets Group membership as access authority.
 */
export function prepareEncounterTransferOrchestration(
  input: EncounterTransferOrchestrationInput,
): EncounterTransferOrchestration {
  assertMovementMatchesDisposition(input.movementKind, input.sourceDisposition)
  const source = normalizeEncounter(input.sourceEncounter, input.subjectReference)
  const destination = normalizeEncounter(input.destinationEncounter, input.subjectReference)
  const sourceStatus = input.sourceDisposition === 'returning'
    ? EncounterStatusR5.OnHold
    : EncounterStatusR5.Completed
  const projectionCommunication = prepareEncounterTransferProjectionCommunication(input)
  const audienceReconciliation = reconcileEncounterCommunicationAudience({
    idempotencyKey: input.communicationIdentifier,
    communicationThreadId: input.communicationThreadId,
    subjectReference: input.subjectReference,
    movementKind: input.movementKind,
    sourceEncounterReference: `Encounter/${source.id}`,
    sourceEncounterStatus: sourceStatus,
    sourceHealthcareServiceReference: text(claimsOf(source)[EncounterClaim.ServiceType]) as string,
    sourceAssignments: input.sourceAssignments,
    destinationEncounterReference: `Encounter/${destination.id}`,
    destinationEncounterStatus: EncounterStatusR5.InProgress,
    destinationHealthcareServiceReference: text(claimsOf(destination)[EncounterClaim.ServiceType]) as string,
    destinationAssignments: input.destinationAssignments,
    currentProfessionalGroupReferences: input.currentProfessionalGroupReferences,
    occurredAt: input.occurredAt,
    handoverAccepted: input.handoverAccepted,
  })
  return Object.freeze({ projectionCommunication, audienceReconciliation })
}

function assertMovementMatchesDisposition(
  movementKind: CareJourneyMovementKindValue,
  sourceDisposition: EncounterTransferSourceDisposition,
): void {
  const matches = movementKind === CareJourneyMovementKind.TemporaryTransfer
    ? sourceDisposition === 'returning'
    : (movementKind === CareJourneyMovementKind.PermanentTransfer
      || movementKind === CareJourneyMovementKind.ReturnTransfer)
      && sourceDisposition === 'not-returning'
  if (!matches) throw new TypeError('encounter_transfer_movement_disposition_mismatch')
}

function normalizeEncounter(
  resource: EncounterTransferProjectionInput['sourceEncounter'],
  subjectReference: string,
): EncounterTransferProjectionInput['sourceEncounter'] {
  if (resource.resourceType !== 'Encounter') throw new TypeError('fhir_encounter_required')
  const claims = claimsOf(resource)
  if (claims[EncounterClaim.Subject] !== subjectReference) throw new TypeError('encounter_subject_mismatch')
  if (!text(claims[EncounterClaim.ServiceType])) throw new TypeError('encounter_service_required')
  return clone(resource)
}

function withEncounterStatus(
  resource: EncounterTransferProjectionInput['sourceEncounter'],
  status: EncounterStatusR5,
  occurredAt: string,
): EncounterTransferProjectionInput['sourceEncounter'] {
  const claims = claimsOf(resource)
  const nextClaims = {
    ...claims,
    [EncounterClaim.Status]: status,
    ...(status === EncounterStatusR5.Completed ? { [EncounterClaim.ActualPeriodEnd]: occurredAt } : {}),
    ...(status === EncounterStatusR5.InProgress && !claims[EncounterClaim.ActualPeriodStart]
      ? { [EncounterClaim.ActualPeriodStart]: occurredAt }
      : {}),
  }
  return { ...clone(resource), meta: { ...(resource.meta as Record<string, unknown>), claims: nextClaims } }
}

function historyResource(input: Readonly<{
  identifier: string
  encounter: EncounterTransferProjectionInput['sourceEncounter']
  status: EncounterStatusR5
  occurredAt: string
  encounterClass: ClinicalCoding
}>): FhirResource & Readonly<{ resourceType: 'EncounterHistory'; id: string }> {
  const encounterClaims = claimsOf(input.encounter)
  const id = uuidIdentifier(input.identifier)
  const entry = buildEncounterHistoryR5FlatEntry({
    entryId: id,
    identifier: input.identifier,
    encounterReference: `Encounter/${input.encounter.id}`,
    status: input.status,
    class: input.encounterClass,
    serviceReference: text(encounterClaims[EncounterClaim.ServiceType]),
    subjectReference: text(encounterClaims[EncounterClaim.Subject]),
    actualPeriodStart: input.occurredAt,
    locationReference: text(encounterClaims[EncounterClaim.Location]),
  })
  if (entry.claims[EncounterHistoryClaim.Status] !== input.status) throw new TypeError('encounter_history_status_mismatch')
  return { resourceType: 'EncounterHistory', id, meta: { claims: entry.claims } }
}

function claimsOf(resource: FhirResource): Record<string, unknown> {
  const meta = resource.meta as Record<string, unknown> | undefined
  if (!meta?.claims || typeof meta.claims !== 'object' || Array.isArray(meta.claims)) throw new TypeError('claims_first_resource_required')
  return clone(meta.claims as Record<string, unknown>)
}

function uuidIdentifier(value: string): string {
  const normalized = text(value)
  if (!normalized?.startsWith('urn:uuid:') || normalized.length <= 'urn:uuid:'.length) throw new TypeError('encounter_history_identifier_invalid')
  return normalized.slice('urn:uuid:'.length)
}

function requireDateTime(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) throw new TypeError('transfer_occurred_at_invalid')
}

function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
