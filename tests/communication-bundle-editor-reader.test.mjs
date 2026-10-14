// Flow contract: 1) SOS, Vet and UHC author one or more delivery Communications through the shared high-level editor, 2) build returns an outer FHIR batch Bundle, 3) every Communication contains exactly one inner document, batch, or collection Bundle, 4) calendar/PDF/image/audio evidence is a DocumentReference inside that Bundle, 5) the shared reader exposes message metadata and inner resources without product or transport assumptions, and 6) malformed document, batch, direct-resource, and direct-file payloads fail closed.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AppointmentClaim,
  CommunicationClaim,
  DocumentReferenceClaim,
  FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA,
  appointmentFhirR4ToFlat,
  documentReferenceFhirR4ToFlat,
} from 'fhir-data-utils-ts'
import { BundleEditor } from 'gdc-common-utils-ts/utils/bundle-editor'
import { BundleReader } from 'gdc-common-utils-ts/utils/bundle-reader'
import { CommunicationAttachedBundleSession } from 'gdc-common-utils-ts/utils/communication-attached-bundle-session'
import {
  AppointmentCommunicationBundleEditor,
  CommunicationBundleEditor,
  CommunicationBundleReader,
  prepareAppointmentCommunicationBundle,
} from '../dist/index.js'

const appointmentResource = Object.freeze({
  resourceType: 'Appointment',
  id: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.appointment.id,
  meta: Object.freeze({ claims: appointmentFhirR4ToFlat(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.appointment) }),
})
const calendarDocumentResource = Object.freeze({
  resourceType: 'DocumentReference',
  id: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.calendarDocument.id,
  meta: Object.freeze({ claims: documentReferenceFhirR4ToFlat(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.calendarDocument) }),
})

test('authors a standard Appointment communication without a human or veterinary class name', () => {
  const outerBatch = new AppointmentCommunicationBundleEditor()
    .addAppointmentCommunication({
      communicationIdentifier: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.communicationId,
      status: 'completed',
      subjectReference: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.subjectReference,
      senderReference: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.senderReference,
      recipientReferences: [FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.recipientReference],
      appointment: appointmentResource,
      calendarDocument: {
        identifier: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.calendarDocument.identifier[0].value,
        contentType: 'text/calendar',
        dataBase64: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.calendarData,
        title: 'appointment.ics',
      },
    })
    .build()

  const message = new CommunicationBundleReader(outerBatch).openCommunication(0)
  assert.equal(message.getAppointments().length, 1)
  assert.equal(message.getDocumentReferences().length, 1)
  assert.equal(
    message.getDocumentReferences()[0].meta.claims[DocumentReferenceClaim.EventReference],
    FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.appointmentReference,
  )
})

test('rejects a sector wrapper trying to pass a non-Appointment resource', () => {
  assert.throws(
    () => new AppointmentCommunicationBundleEditor().addAppointmentCommunication({
      communicationIdentifier: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.communicationId,
      status: 'completed',
      subjectReference: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.subjectReference,
      senderReference: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.senderReference,
      recipientReferences: [FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.recipientReference],
      appointment: { ...appointmentResource, resourceType: 'Encounter' },
    }),
    /fhir_appointment_required/,
  )
})

test('provides the standard Appointment helper from the shared SDK', () => {
  const outerBatch = prepareAppointmentCommunicationBundle({
    communicationIdentifier: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.communicationId,
    status: 'completed',
    subjectReference: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.subjectReference,
    senderReference: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.senderReference,
    recipientReferences: [FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.recipientReference],
    appointment: appointmentResource,
  })

  assert.equal(new CommunicationBundleReader(outerBatch).openCommunication(0).getAppointments().length, 1)
})

test('derives the standard Appointment identifier claim from the resource id', () => {
  const { [AppointmentClaim.Identifier]: _identifier, ...claimsWithoutIdentifier } = appointmentResource.meta.claims
  const outerBatch = prepareAppointmentCommunicationBundle({
    communicationIdentifier: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.communicationId,
    status: 'completed',
    subjectReference: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.subjectReference,
    senderReference: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.senderReference,
    recipientReferences: [FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.recipientReference],
    appointment: { ...appointmentResource, meta: { claims: claimsWithoutIdentifier } },
  })

  const storedAppointment = new CommunicationBundleReader(outerBatch).openCommunication(0).getAppointments()[0]
  assert.deepEqual(storedAppointment.meta.claims[AppointmentClaim.Identifier], [appointmentResource.id])
})

test('authors and reads an appointment plus calendar through one outer Communication batch', () => {
  const editor = new CommunicationBundleEditor()
  const messageEditor = editor.newCommunication()
  assert.ok(editor instanceof BundleEditor)
  assert.ok(messageEditor instanceof CommunicationAttachedBundleSession)
  messageEditor
    .setIdentifier(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.communicationId)
    .setStatus('completed')
    .setSubject(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.subjectReference)
    .setSender(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.senderReference)
    .setRecipients([FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.recipientReference])
    .setAttachmentTitle('appointment-bundle.json')
    .setInnerBundleType('collection')
    .addResource(appointmentResource)
    .addResource(calendarDocumentResource)
    .doneCommunication()

  const outerBatch = editor.build()
  const reader = new CommunicationBundleReader(outerBatch)
  assert.ok(reader instanceof BundleReader)
  const message = reader.openCommunication(0)

  assert.equal(outerBatch.type, 'batch')
  assert.equal(outerBatch.entry.length, 1)
  assert.equal(message.getIdentifier(), FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.communicationId)
  assert.equal(message.getSender(), FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.senderReference)
  assert.deepEqual(message.getRecipients(), [FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.recipientReference])
  assert.equal(message.getInnerBundleType(), 'collection')
  assert.equal(message.getAppointments().length, 1)
  assert.equal(message.getDocumentReferences().length, 1)
  assert.equal(message.getDocumentReferences()[0].meta.claims[DocumentReferenceClaim.ContentType], 'text/calendar')
})

test('authors binary evidence only as a DocumentReference inside the inner Bundle', () => {
  const calendarDocumentIdentifier = FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.calendarDocument.identifier[0].value
  const editor = new CommunicationBundleEditor()
  editor.newCommunication()
    .setIdentifier(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.communicationId)
    .setStatus('completed')
    .setSubject(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.subjectReference)
    .setInnerBundleType('collection')
    .addAttachmentDocument({
      identifier: calendarDocumentIdentifier,
      subjectReference: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.subjectReference,
      contentType: 'text/calendar',
      dataBase64: FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.calendarData,
      title: 'appointment.ics',
      eventReferences: [FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.appointmentReference],
    })
    .doneCommunication()

  const message = new CommunicationBundleReader(editor.build()).openCommunication(0)
  const documentReference = message.getDocumentReferences()[0]
  const communicationClaims = message.getCommunication().meta.claims

  assert.equal(documentReference.resourceType, 'DocumentReference')
  assert.equal(documentReference.meta.claims[DocumentReferenceClaim.EventReference], FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.appointmentReference)
  assert.equal(communicationClaims[CommunicationClaim.ContentAttachmentType], 'application/fhir+json')
  assert.ok(communicationClaims[CommunicationClaim.ContentAttachmentData])
})

test('authors and reads more than one Communication in the same outer batch', () => {
  const editor = new CommunicationBundleEditor()
  for (const communicationIdentifier of [
    FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.communicationId,
    FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.calendarDocument.identifier[0].value,
  ]) {
    editor.newCommunication()
      .setIdentifier(communicationIdentifier)
      .setStatus('completed')
      .setSubject(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.subjectReference)
      .setInnerBundleType('collection')
      .addResource(appointmentResource)
      .doneCommunication()
  }

  const reader = new CommunicationBundleReader(editor.build())
  assert.equal(reader.getCommunicationCount(), 2)
  assert.equal(reader.openCommunication(1).getIdentifier(), FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.calendarDocument.identifier[0].value)
})

test('fails closed when a document starts without Composition or a batch resource has no request', () => {
  const invalidDocument = new CommunicationBundleEditor()
  invalidDocument.newCommunication()
    .setIdentifier(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.communicationId)
    .setStatus('completed')
    .setSubject(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.subjectReference)
    .setInnerBundleType('document')
    .addResource(appointmentResource)
    .doneCommunication()

  const invalidBatch = new CommunicationBundleEditor()
  invalidBatch.newCommunication()
    .setIdentifier(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.communicationId)
    .setStatus('completed')
    .setSubject(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.subjectReference)
    .setInnerBundleType('batch')
    .addResource(appointmentResource)
    .doneCommunication()

  assert.throws(() => invalidDocument.build(), /fhir_document_composition_first_required/)
  assert.throws(() => invalidBatch.build(), /fhir_batch_request_required/)
})

test('reader rejects a bare clinical resource in the Communication attachment', () => {
  const editor = new CommunicationBundleEditor()
  editor.newCommunication()
    .setIdentifier(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.communicationId)
    .setStatus('completed')
    .setSubject(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.subjectReference)
    .setInnerBundleType('collection')
    .addResource(appointmentResource)
    .doneCommunication()
  const invalidOuterBatch = structuredClone(editor.build())
  invalidOuterBatch.entry[0].resource.meta.claims[CommunicationClaim.ContentAttachmentData] = Buffer.from(
    JSON.stringify(FHIR_APPOINTMENT_COMMUNICATION_TEST_DATA.appointment),
  ).toString('base64')

  assert.throws(
    () => new CommunicationBundleReader(invalidOuterBatch).openCommunication(0),
    /fhir_bundle_required/,
  )
})
