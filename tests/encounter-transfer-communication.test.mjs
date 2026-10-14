// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EncounterClaim,
  EncounterHistoryClaim,
  EncounterStatusR5,
  FHIR_ENCOUNTER_TRANSFER_TEST_DATA as fixture,
} from 'fhir-data-utils-ts'
import { CareJourneyMovementKind } from 'sos-data-utils-ts/encounter-communication-audience'
import {
  CommunicationBundleReader,
  prepareEncounterTransferOrchestration,
  prepareEncounterTransferProjectionCommunication,
} from '../dist/index.js'

const sourceDepartmentReference = fixture.senderReference
const destinationDepartmentReference = `Organization/destination-${fixture.destination.id}`
const sourceMedicalGroupReference = `Group/source-medical-${fixture.source.id}`
const sourceNursingGroupReference = `Group/source-nursing-${fixture.source.id}`
const destinationMedicalGroupReference = `Group/destination-medical-${fixture.destination.id}`
const destinationNursingGroupReference = `Group/destination-nursing-${fixture.destination.id}`

const sourceAssignments = Object.freeze([
  {
    groupReference: sourceMedicalGroupReference,
    departmentOrganizationReference: sourceDepartmentReference,
    healthcareServiceReference: fixture.source.serviceReference,
  },
  {
    groupReference: sourceNursingGroupReference,
    departmentOrganizationReference: sourceDepartmentReference,
    healthcareServiceReference: fixture.source.serviceReference,
  },
])
const destinationAssignments = Object.freeze([
  {
    groupReference: destinationMedicalGroupReference,
    departmentOrganizationReference: destinationDepartmentReference,
    healthcareServiceReference: fixture.destination.serviceReference,
  },
  {
    groupReference: destinationNursingGroupReference,
    departmentOrganizationReference: destinationDepartmentReference,
    healthcareServiceReference: fixture.destination.serviceReference,
  },
])

function encounterResource(stage, status) {
  return {
    resourceType: 'Encounter',
    id: stage.id,
    meta: { claims: {
      [EncounterClaim.Identifier]: stage.identifier,
      [EncounterClaim.Status]: status,
      [EncounterClaim.Subject]: fixture.subjectReference,
      [EncounterClaim.ServiceType]: stage.serviceReference,
      [EncounterClaim.ServiceProvider]: fixture.senderReference,
      [EncounterClaim.Location]: stage.locationReference,
      [EncounterClaim.ActualPeriodStart]: fixture.occurredAt,
    } },
  }
}

function prepare(sourceDisposition) {
  return prepareEncounterTransferProjectionCommunication(projectionInput(sourceDisposition))
}

function projectionInput(sourceDisposition) {
  return {
    communicationIdentifier: fixture.communicationIdentifier,
    subjectReference: fixture.subjectReference,
    departmentSenderReference: fixture.senderReference,
    indexRecipientReferences: [fixture.indexRecipientReference],
    occurredAt: fixture.occurredAt,
    sourceDisposition,
    sourceEncounter: encounterResource(fixture.source, EncounterStatusR5.InProgress),
    destinationEncounter: encounterResource(fixture.destination, EncounterStatusR5.Planned),
    sourceHistoryIdentifier: fixture.sourceHistory.identifier,
    destinationHistoryIdentifier: fixture.destinationHistory.identifier,
    encounterClass: fixture.class,
  }
}

test('projects a return transfer as source on-hold, destination in-progress and matching EncounterHistory milestones', () => {
  const message = new CommunicationBundleReader(prepare('returning')).openCommunication(0)
  const encounters = message.getResourcesByType('Encounter')
  const histories = message.getResourcesByType('EncounterHistory')
  const entries = message.getEntries()

  assert.equal(message.getInnerBundleType(), 'batch')
  assert.equal(message.getSender(), fixture.senderReference)
  assert.deepEqual(message.getRecipients(), [fixture.indexRecipientReference])
  assert.deepEqual(encounters.map(resource => resource.meta.claims[EncounterClaim.Status]), [EncounterStatusR5.OnHold, EncounterStatusR5.InProgress])
  assert.deepEqual(histories.map(resource => resource.meta.claims[EncounterHistoryClaim.Status]), [EncounterStatusR5.OnHold, EncounterStatusR5.InProgress])
  assert.deepEqual(entries.map(entry => entry.request.method), ['POST', 'POST', 'POST', 'POST'])
  assert.deepEqual(entries.map(entry => entry.request.url), [
    'Encounter',
    'EncounterHistory',
    'Encounter',
    'EncounterHistory',
  ])
  assert.deepEqual(entries.map(entry => entry.resource.id), [
    fixture.source.id,
    fixture.sourceHistory.id,
    fixture.destination.id,
    fixture.destinationHistory.id,
  ])
})

test('projects a definitive departure as completed rather than discharged', () => {
  const message = new CommunicationBundleReader(prepare('not-returning')).openCommunication(0)
  assert.equal(message.getResourcesByType('Encounter')[0].meta.claims[EncounterClaim.Status], EncounterStatusR5.Completed)
  assert.equal(message.getResourcesByType('EncounterHistory')[0].meta.claims[EncounterHistoryClaim.Status], EncounterStatusR5.Completed)
})

test('rejects a transfer that has no explicit HealthcareService or reuses the same Encounter', () => {
  const source = encounterResource(fixture.source, EncounterStatusR5.InProgress)
  delete source.meta.claims[EncounterClaim.ServiceType]
  assert.throws(() => prepareEncounterTransferProjectionCommunication({
    communicationIdentifier: fixture.communicationIdentifier,
    subjectReference: fixture.subjectReference,
    departmentSenderReference: fixture.senderReference,
    indexRecipientReferences: [fixture.indexRecipientReference],
    occurredAt: fixture.occurredAt,
    sourceDisposition: 'returning',
    sourceEncounter: source,
    destinationEncounter: { ...source, meta: { claims: { ...source.meta.claims } } },
    sourceHistoryIdentifier: fixture.sourceHistory.identifier,
    destinationHistoryIdentifier: fixture.destinationHistory.identifier,
    encounterClass: fixture.class,
  }), /encounter_service_required|distinct_encounters_required/)
})

test('prepares the Encounter projection and future channel audience from one accepted temporary handover', () => {
  const orchestration = prepareEncounterTransferOrchestration({
    ...projectionInput('returning'),
    communicationThreadId: fixture.communicationIdentifier,
    movementKind: CareJourneyMovementKind.TemporaryTransfer,
    sourceAssignments,
    destinationAssignments,
    currentProfessionalGroupReferences: [sourceMedicalGroupReference, sourceNursingGroupReference],
    handoverAccepted: true,
  })
  const projection = new CommunicationBundleReader(orchestration.projectionCommunication).openCommunication(0)

  assert.deepEqual(
    projection.getResourcesByType('Encounter').map(resource => resource.meta.claims[EncounterClaim.Status]),
    [EncounterStatusR5.OnHold, EncounterStatusR5.InProgress],
  )
  assert.deepEqual(orchestration.audienceReconciliation.retainedProfessionalGroupReferences, [
    sourceMedicalGroupReference,
    sourceNursingGroupReference,
  ])
  assert.deepEqual(orchestration.audienceReconciliation.addedProfessionalGroupReferences, [
    destinationMedicalGroupReference,
    destinationNursingGroupReference,
  ])
  assert.equal('professionalGroupReferences' in orchestration.audienceReconciliation.familyJourneyEvent, false)
})

test('rejects an audience movement that contradicts the projected source Encounter status', () => {
  assert.throws(() => prepareEncounterTransferOrchestration({
    ...projectionInput('not-returning'),
    communicationThreadId: fixture.communicationIdentifier,
    movementKind: CareJourneyMovementKind.TemporaryTransfer,
    sourceAssignments,
    destinationAssignments,
    currentProfessionalGroupReferences: [sourceMedicalGroupReference, sourceNursingGroupReference],
    handoverAccepted: true,
  }), /encounter_transfer_movement_disposition_mismatch/)
})
