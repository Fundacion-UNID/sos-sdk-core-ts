// Flow contract: 1) create an idempotent Encounter from a fulfilled Appointment, 2) allow protected pre-publication contact without indexing draft clinical data, 3) create separate emergency ServiceRequest and triage Task, and 4) deliver a governed alert only to a currently authorized member of the frozen cohort.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authorizeEncounterCommunication,
  orchestrateEmergencyRequest,
  prepareEmergencyResponderCallback,
  readEmergencyTriageTask,
  transitionEmergencyTriageTask,
  orchestrateFulfilledAppointment,
  prepareGovernedAlertCampaign,
  prepareGovernedAlertDelivery,
} from '../dist/care-emergency-alert-orchestration.js'

test('creates a parent Encounter once and preserves its Appointment and Location', () => {
  const createdEncounter = orchestrateFulfilledAppointment({
    transition: {
      idempotencyKey: 'appointment-fulfilled-one', appointmentReference: 'Appointment/appointment-one',
      encounterEntryId: 'encounter-one', subjectReference: 'Patient/animal-one',
      serviceProviderReference: 'Organization/hospital-one', locationReference: 'Location/admission',
      occurredAt: '2026-09-26T08:00:00Z',
    },
    encounterIdentifier: 'urn:uuid:00000000-0000-4000-8000-000000000001',
  })
  assert.equal(createdEncounter.created, true)
  assert.equal(createdEncounter.encounterEntry.claims['Encounter.appointment'], 'Appointment/appointment-one')
  assert.equal(createdEncounter.encounterEntry.claims['Encounter.location'], 'Location/admission')

  const existingEncounter = orchestrateFulfilledAppointment({
    transition: {
      idempotencyKey: 'appointment-fulfilled-one', appointmentReference: 'Appointment/appointment-one',
      encounterEntryId: 'encounter-one', subjectReference: 'Patient/animal-one',
      serviceProviderReference: 'Organization/hospital-one', locationReference: 'Location/admission',
      occurredAt: '2026-09-26T08:00:00Z',
    },
    encounterIdentifier: 'urn:uuid:00000000-0000-4000-8000-000000000001',
    existingEncounterReference: 'Encounter/encounter-one',
  })
  assert.deepEqual(existingEncounter, { created: false, encounterReference: 'Encounter/encounter-one' })
})

test('allows protected contact before publication while blocking draft index updates', () => {
  const encryptedMessageAuthorization = authorizeEncounterCommunication({
    encounterReference: 'Encounter/encounter-one', actorReference: 'PractitionerRole/veterinarian-one',
    recipientReferences: ['RelatedPerson/controller-one'], actorCanCommunicate: true, encounterActive: true,
    channel: 'encrypted-message', includesClinicalBundle: true, clinicalStatus: 'preliminary', updateIndex: false,
  })
  assert.equal(encryptedMessageAuthorization.updateIndex, false)
  assert.equal(encryptedMessageAuthorization.channel, 'encrypted-message')

  assert.throws(() => authorizeEncounterCommunication({
    encounterReference: 'Encounter/encounter-one', actorReference: 'PractitionerRole/veterinarian-one',
    recipientReferences: ['RelatedPerson/controller-one'], actorCanCommunicate: true, encounterActive: true,
    channel: 'encrypted-message', includesClinicalBundle: true, clinicalStatus: 'preliminary', updateIndex: true,
  }), /preliminary_clinical_index_update_forbidden/)
})

test('creates separate emergency request and triage Task resources', () => {
  const emergencyPlan = orchestrateEmergencyRequest({
    intake: {
      idempotencyKey: 'emergency-request-one', serviceRequestEntryId: 'service-request-one',
      triageTaskEntryId: 'triage-task-one', subjectReference: 'Patient/animal-one',
      requesterReference: 'RelatedPerson/requester-one', targetServiceReference: 'HealthcareService/emergency-one',
      triageOwnerReference: 'Group/dispatch-one', jurisdiction: 'CA-BC', receivedAt: '2026-09-26T09:00:00Z',
      communicationThreadId: 'thread-one',
    },
    serviceRequestIdentifier: 'urn:uuid:00000000-0000-4000-8000-000000000002',
    triageTaskIdentifier: 'urn:uuid:00000000-0000-4000-8000-000000000003',
    assistanceCode: { system: 'https://example.invalid/fhir/CodeSystem/emergency-assistance', code: 'emergency-care', text: 'Emergency care' },
  })
  assert.equal(emergencyPlan.serviceRequestEntry.resourceType, 'ServiceRequest')
  assert.equal(emergencyPlan.triageTaskEntry.resourceType, 'Task')
  assert.equal(emergencyPlan.triageTaskEntry.claims['Task.focus'], emergencyPlan.serviceRequestEntry.reference)

  assert.throws(() => orchestrateEmergencyRequest({
    intake: {
      ...emergencyPlan.intake,
      triageOwnerReference: 'Organization/hospital-one',
    },
    serviceRequestIdentifier: 'urn:uuid:00000000-0000-4000-8000-000000000031',
    triageTaskIdentifier: 'urn:uuid:00000000-0000-4000-8000-000000000032',
    assistanceCode: { system: 'https://example.invalid/fhir/CodeSystem/emergency-assistance', code: 'emergency-care' },
  }), /emergency_intake_triage_group_reference_invalid/)
})

test('allows resilient emergency routing to the owning Organization when no service is reachable', () => {
  const emergencyPlan = orchestrateEmergencyRequest({
    intake: {
      idempotencyKey: 'emergency-request-organization', serviceRequestEntryId: 'service-request-organization',
      triageTaskEntryId: 'triage-task-organization', subjectReference: 'Patient/animal-one',
      requesterReference: 'RelatedPerson/requester-one', targetServiceReference: 'Organization/hospital-one',
      triageOwnerReference: 'Group/dispatch-one', jurisdiction: 'CA-BC', receivedAt: '2026-09-26T09:00:00Z',
      communicationThreadId: 'thread-organization',
    },
    serviceRequestIdentifier: 'urn:uuid:00000000-0000-4000-8000-000000000012',
    triageTaskIdentifier: 'urn:uuid:00000000-0000-4000-8000-000000000013',
    assistanceCode: { system: 'https://example.invalid/fhir/CodeSystem/emergency-assistance', code: 'emergency-care' },
  })
  assert.equal(emergencyPlan.serviceRequestEntry.claims['ServiceRequest.performer'], 'Organization/hospital-one')
})

test('reads and acknowledges a requested emergency triage Task without rewriting its ServiceRequest', () => {
  const emergencyPlan = orchestrateEmergencyRequest({
    intake: {
      idempotencyKey: 'emergency-request-triage', serviceRequestEntryId: 'service-request-triage',
      triageTaskEntryId: 'triage-task-triage', subjectReference: 'Patient/animal-one',
      requesterReference: 'RelatedPerson/requester-one', targetServiceReference: 'HealthcareService/emergency-one',
      triageOwnerReference: 'Group/dispatch-one', jurisdiction: 'CA-BC',
      receivedAt: '2026-09-27T20:00:00.000Z', communicationThreadId: 'thread-triage-one',
    },
    serviceRequestIdentifier: 'urn:uuid:00000000-0000-4000-8000-000000000021',
    triageTaskIdentifier: 'urn:uuid:00000000-0000-4000-8000-000000000022',
    assistanceCode: { system: 'https://example.invalid/fhir/CodeSystem/emergency-assistance', code: 'emergency-care' },
  })

  assert.deepEqual(readEmergencyTriageTask(emergencyPlan.triageTaskEntry), {
    taskReference: 'Task/triage-task-triage', status: 'requested',
    focusReference: 'ServiceRequest/service-request-triage', subjectReference: 'Patient/animal-one',
    requesterReference: 'RelatedPerson/requester-one', ownerReference: 'Group/dispatch-one',
    authoredAt: '2026-09-27T20:00:00.000Z',
    communicationThreadId: 'thread-triage-one',
  })

  const acknowledged = transitionEmergencyTriageTask({
    taskEntry: emergencyPlan.triageTaskEntry,
    action: 'acknowledge', responderReference: 'PractitionerRole/responder-one',
    occurredAt: '2026-09-27T20:01:00.000Z',
  })
  assert.equal(acknowledged.claims['Task.status'], 'accepted')
  assert.equal(acknowledged.claims['Task.owner'], 'PractitionerRole/responder-one')
  assert.equal(acknowledged.claims['Task.focus'], emergencyPlan.serviceRequestEntry.reference)
  assert.equal(acknowledged.claims['Task.last-modified'], '2026-09-27T20:01:00.000Z')
})

test('escalates only an active triage Task to a server-resolved owner', () => {
  const taskEntry = {
    entryId: 'triage-task-one', reference: 'Task/triage-task-one', resourceType: 'Task',
    claims: {
      'Task.identifier': 'urn:uuid:00000000-0000-4000-8000-000000000023',
      'Task.status': 'accepted', 'Task.intent': 'order',
      'Task.focus': 'ServiceRequest/service-request-one', 'Task.for': 'Patient/animal-one',
      'Task.requester': 'RelatedPerson/requester-one', 'Task.owner': 'PractitionerRole/responder-one',
      'Task.authored-on': '2026-09-27T20:00:00.000Z',
    },
  }
  const escalated = transitionEmergencyTriageTask({
    taskEntry, action: 'escalate', responderReference: 'PractitionerRole/responder-one',
    escalationOwnerReference: 'Group/regional-dispatch', occurredAt: '2026-09-27T20:02:00.000Z',
  })
  assert.equal(escalated.claims['Task.status'], 'requested')
  assert.equal(escalated.claims['Task.owner'], 'Group/regional-dispatch')
  assert.equal(escalated.claims['Task.escalation-recipient'], 'Group/regional-dispatch')
  assert.throws(() => transitionEmergencyTriageTask({
    taskEntry: escalated, action: 'complete', responderReference: 'PractitionerRole/responder-one',
    occurredAt: '2026-09-27T20:03:00.000Z',
  }), /emergency_triage_transition_invalid/)
})

test('authorizes responder callback only for the accepted Task owner and preserves the protected thread correlation', () => {
  const acceptedTask = {
    entryId: 'triage-task-callback', reference: 'Task/triage-task-callback', resourceType: 'Task',
    claims: {
      'Task.identifier': 'urn:uuid:00000000-0000-4000-8000-000000000024',
      'Task.status': 'accepted', 'Task.intent': 'order',
      'Task.group-identifier': 'thread-callback-one',
      'Task.focus': 'ServiceRequest/service-request-callback', 'Task.for': 'Patient/animal-one',
      'Task.requester': 'RelatedPerson/requester-one', 'Task.owner': 'PractitionerRole/responder-one',
      'Task.authored-on': '2026-09-27T20:00:00.000Z',
    },
  }
  assert.deepEqual(prepareEmergencyResponderCallback({
    taskEntry: acceptedTask, responderReference: 'PractitionerRole/responder-one', media: 'audio',
  }), {
    taskReference: 'Task/triage-task-callback',
    serviceRequestReference: 'ServiceRequest/service-request-callback',
    subjectReference: 'Patient/animal-one', requesterReference: 'RelatedPerson/requester-one',
    responderReference: 'PractitionerRole/responder-one', communicationThreadId: 'thread-callback-one', media: 'audio',
  })
  assert.throws(() => prepareEmergencyResponderCallback({
    taskEntry: acceptedTask, responderReference: 'PractitionerRole/other-responder', media: 'audio',
  }), /emergency_callback_task_owner_required/)
})

test('binds a campaign request to its frozen Group and rejects delivery outside that snapshot', () => {
  const campaignPlan = prepareGovernedAlertCampaign({
    campaign: {
      campaignId: 'campaign-one', campaignKind: 'blood-donation', groupDefinitionReference: 'Group/eligible-donors-definition',
      requesterReference: 'Organization/blood-service-one', requiredSubscriptionTopicReference: 'SubscriptionTopic/blood-donation-alerts',
      jurisdiction: 'CA-BC', bloodGroupCodes: ['http://loinc.org|882-1'], minimumDaysSinceLastDonation: 56,
      excludedSubjectReferences: [], preferredLanguages: ['en-CA'],
    },
    snapshotGroupReference: 'Group/campaign-one-snapshot', evaluatedAt: '2026-09-26T10:00:00Z',
    evaluationFingerprint: 'sha256:cohort-one', eligibleSubjectReferences: ['Patient/donor-one'],
    communicationRequestEntryId: 'communication-request-one',
    communicationRequestIdentifier: 'urn:uuid:00000000-0000-4000-8000-000000000004',
    category: { system: 'https://example.invalid/fhir/CodeSystem/communication-category', code: 'notification' },
  })
  assert.equal(campaignPlan.communicationRequestEntry.claims['CommunicationRequest.subject'], 'Group/campaign-one-snapshot')

  assert.throws(() => prepareGovernedAlertDelivery({
    campaignPlan, recipientReference: 'Patient/not-in-snapshot', communicationReference: 'Communication/delivery-one',
    evaluatedAt: '2026-09-26T10:01:00Z', eligibilityCurrent: true, exclusionCurrent: true,
    consentReference: 'Consent/campaign-one', channelAuthorizationReference: 'Consent/channel-one', outcome: 'sent',
  }), /alert_delivery_recipient_not_in_snapshot/)
})

test('accepts a public-risk campaign only with governed FHIR SearchParameter criteria', () => {
  const campaignPlan = prepareGovernedAlertCampaign({
    campaign: {
      campaignId: 'campaign-risk-one', campaignKind: 'public-risk',
      groupDefinitionReference: 'Group/public-risk-definition', requesterReference: 'Organization/public-health-one',
      requiredSubscriptionTopicReference: 'SubscriptionTopic/public-risk-alerts', jurisdiction: 'CA-BC',
      eligibilityCriteria: [{ resourceType: 'Observation', searchParameter: 'code', value: 'http://loinc.org|94500-6' }],
      excludedSubjectReferences: [], preferredLanguages: ['en-CA'],
    },
    snapshotGroupReference: 'Group/public-risk-snapshot', evaluatedAt: '2026-09-26T11:00:00Z',
    evaluationFingerprint: 'sha256:risk-one', eligibleSubjectReferences: ['Patient/subject-one'],
    communicationRequestEntryId: 'communication-request-risk-one',
    communicationRequestIdentifier: 'urn:uuid:00000000-0000-4000-8000-000000000014',
    category: { system: 'https://example.invalid/fhir/CodeSystem/communication-category', code: 'notification' },
  })
  assert.equal(campaignPlan.campaign.campaignKind, 'public-risk')
  assert.deepEqual(campaignPlan.campaign.eligibilityCriteria, [
    { resourceType: 'Observation', searchParameter: 'code', value: 'http://loinc.org|94500-6' },
  ])

  assert.throws(() => prepareGovernedAlertCampaign({
    campaign: {
      campaignId: 'campaign-risk-invalid', campaignKind: 'public-risk',
      groupDefinitionReference: 'Group/public-risk-definition', requesterReference: 'Organization/public-health-one',
      requiredSubscriptionTopicReference: 'SubscriptionTopic/public-risk-alerts', jurisdiction: 'CA-BC',
      excludedSubjectReferences: [], preferredLanguages: ['en-CA'],
    },
    snapshotGroupReference: 'Group/public-risk-invalid-snapshot', evaluatedAt: '2026-09-26T11:00:00Z',
    evaluationFingerprint: 'sha256:risk-invalid', eligibleSubjectReferences: ['Patient/subject-one'],
    communicationRequestEntryId: 'communication-request-risk-invalid',
    communicationRequestIdentifier: 'urn:uuid:00000000-0000-4000-8000-000000000015',
    category: { system: 'https://example.invalid/fhir/CodeSystem/communication-category', code: 'notification' },
  }), /alert_campaign_eligibility_criteria_required/)
})
