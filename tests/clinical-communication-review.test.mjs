// Flow contract: 1) an authorized administrative or clinical preparer creates a subject-scoped CommunicationRequest draft for exact recipients; 2) a separate PractitionerRole owns the review Task; 3) only that reviewer can require a call, approve or reject; 4) approval alone enables one actual Communication plan. Authorization invariant: preparation, clinical attestation, review, transport sender and recipients remain distinct. Persistence invariant: rejected or on-hold requests cannot produce a Communication and prior recipient snapshots never expand implicitly.
import assert from 'node:assert/strict'
import test from 'node:test'

import { CommunicationClaim, CommunicationRequestClaim } from 'fhir-data-utils-ts'
import { REPOSITORY_SAFE_EXAMPLES } from 'sos-data-utils-ts/repository-privacy'
import { TaskClaim, TaskStatus } from 'sos-data-utils-ts/task-artifact-schema'
import {
  authorizeReviewedClinicalCommunicationDelivery,
  prepareClinicalCommunicationReview,
  transitionClinicalCommunicationReview,
} from '../dist/clinical-communication-review.js'

const fixture = Object.freeze({
  requestEntryId: `request-${REPOSITORY_SAFE_EXAMPLES.resourceUuid}`,
  taskEntryId: `task-${REPOSITORY_SAFE_EXAMPLES.resourceUuid}`,
  communicationEntryId: `communication-${REPOSITORY_SAFE_EXAMPLES.resourceUuid}`,
  requestIdentifier: `urn:uuid:${REPOSITORY_SAFE_EXAMPLES.resourceUuid}`,
  communicationIdentifier: `urn:uuid:${REPOSITORY_SAFE_EXAMPLES.organizationScopedResources.serviceUuid}`,
  subject: `Patient/${REPOSITORY_SAFE_EXAMPLES.resourceUuid}`,
  encounter: `Encounter/${REPOSITORY_SAFE_EXAMPLES.organizationScopedResources.departmentUuid}`,
  preparer: `PractitionerRole/${REPOSITORY_SAFE_EXAMPLES.organizationScopedResources.scheduleUuid}`,
  reviewer: `PractitionerRole/${REPOSITORY_SAFE_EXAMPLES.organizationScopedResources.serviceUuid}`,
  otherReviewer: `PractitionerRole/${REPOSITORY_SAFE_EXAMPLES.organizationScopedResources.placeUuid}`,
  organization: `Organization/${REPOSITORY_SAFE_EXAMPLES.organizationScopedResources.departmentUuid}`,
  recipients: Object.freeze([
    `Patient/${REPOSITORY_SAFE_EXAMPLES.resourceUuid}`,
    REPOSITORY_SAFE_EXAMPLES.firstContactIdentifier,
  ]),
  payload: `DocumentReference/${REPOSITORY_SAFE_EXAMPLES.organizationScopedResources.placeUuid}`,
  authoredAt: REPOSITORY_SAFE_EXAMPLES.organizationScopedResources.slotStart,
  reviewedAt: REPOSITORY_SAFE_EXAMPLES.organizationScopedResources.slotEnd,
})

test('keeps the preparer, reviewer, exact recipients and clinical payload separate', () => {
  const plan = prepareClinicalCommunicationReview({
    communicationRequestEntryId: fixture.requestEntryId,
    reviewTaskEntryId: fixture.taskEntryId,
    communicationRequestIdentifier: fixture.requestIdentifier,
    subjectReference: fixture.subject,
    encounterReference: fixture.encounter,
    preparerReference: fixture.preparer,
    reviewerReference: fixture.reviewer,
    recipientReferences: fixture.recipients,
    payloadReference: fixture.payload,
    authoredAt: fixture.authoredAt,
  })

  assert.equal(plan.communicationRequestEntry.claims[CommunicationRequestClaim.Status], 'draft')
  assert.equal(plan.communicationRequestEntry.claims[CommunicationRequestClaim.Requester], fixture.preparer)
  assert.equal(plan.communicationRequestEntry.claims[CommunicationRequestClaim.Recipient], fixture.recipients.join(','))
  assert.equal(plan.communicationRequestEntry.claims[CommunicationRequestClaim.PayloadReference], fixture.payload)
  assert.equal(plan.reviewTaskEntry.claims[TaskClaim.Status], TaskStatus.Requested)
  assert.equal(plan.reviewTaskEntry.claims[TaskClaim.Owner], fixture.reviewer)
  assert.equal(plan.reviewTaskEntry.claims[TaskClaim.Focus], plan.communicationRequestEntry.reference)
})

test('allows only the assigned clinician to hold, approve or reject the request', () => {
  const prepared = prepareClinicalCommunicationReview({
    communicationRequestEntryId: fixture.requestEntryId,
    reviewTaskEntryId: fixture.taskEntryId,
    communicationRequestIdentifier: fixture.requestIdentifier,
    subjectReference: fixture.subject,
    encounterReference: fixture.encounter,
    preparerReference: fixture.preparer,
    reviewerReference: fixture.reviewer,
    recipientReferences: fixture.recipients,
    payloadReference: fixture.payload,
    authoredAt: fixture.authoredAt,
  })

  assert.throws(() => transitionClinicalCommunicationReview({
    ...prepared,
    reviewerReference: fixture.otherReviewer,
    decision: 'approve',
    reviewedAt: fixture.reviewedAt,
  }), /clinical_communication_reviewer_mismatch/u)

  const onHold = transitionClinicalCommunicationReview({
    ...prepared,
    reviewerReference: fixture.reviewer,
    decision: 'require-call',
    reviewedAt: fixture.reviewedAt,
  })
  assert.equal(onHold.communicationRequestEntry.claims[CommunicationRequestClaim.Status], 'on-hold')
  assert.equal(onHold.reviewTaskEntry.claims[TaskClaim.Status], TaskStatus.OnHold)
  assert.throws(() => authorizeReviewedClinicalCommunicationDelivery({
    ...onHold,
    reviewerReference: fixture.reviewer,
    senderOrganizationReference: fixture.organization,
    transportActorReference: fixture.reviewer,
    communicationEntryId: fixture.communicationEntryId,
    communicationIdentifier: fixture.communicationIdentifier,
    sentAt: fixture.reviewedAt,
  }), /clinical_communication_approval_required/u)

  const rejected = transitionClinicalCommunicationReview({
    ...prepared,
    reviewerReference: fixture.reviewer,
    decision: 'reject',
    reviewedAt: fixture.reviewedAt,
  })
  assert.equal(rejected.communicationRequestEntry.claims[CommunicationRequestClaim.Status], 'revoked')
  assert.equal(rejected.reviewTaskEntry.claims[TaskClaim.Status], TaskStatus.Rejected)
})

test('creates one actual Communication plan only after exact-owner approval', () => {
  const prepared = prepareClinicalCommunicationReview({
    communicationRequestEntryId: fixture.requestEntryId,
    reviewTaskEntryId: fixture.taskEntryId,
    communicationRequestIdentifier: fixture.requestIdentifier,
    subjectReference: fixture.subject,
    encounterReference: fixture.encounter,
    preparerReference: fixture.preparer,
    reviewerReference: fixture.reviewer,
    recipientReferences: fixture.recipients,
    payloadReference: fixture.payload,
    authoredAt: fixture.authoredAt,
  })
  const approved = transitionClinicalCommunicationReview({
    ...prepared,
    reviewerReference: fixture.reviewer,
    decision: 'approve',
    reviewedAt: fixture.reviewedAt,
  })
  const delivery = authorizeReviewedClinicalCommunicationDelivery({
    ...approved,
    reviewerReference: fixture.reviewer,
    senderOrganizationReference: fixture.organization,
    transportActorReference: fixture.reviewer,
    communicationEntryId: fixture.communicationEntryId,
    communicationIdentifier: fixture.communicationIdentifier,
    sentAt: fixture.reviewedAt,
  })

  assert.equal(delivery.communicationEntry.claims[CommunicationClaim.Status], 'in-progress')
  assert.equal(delivery.communicationEntry.claims[CommunicationClaim.BasedOn], approved.communicationRequestEntry.reference)
  assert.equal(delivery.communicationEntry.claims[CommunicationClaim.Sender], fixture.organization)
  assert.equal(delivery.communicationEntry.claims[CommunicationClaim.Recipient], fixture.recipients.join(','))
  assert.equal(delivery.communicationEntry.claims[CommunicationClaim.ContentReference], fixture.payload)
  assert.equal(delivery.transportActorReference, fixture.reviewer)
  assert.equal('attester' in delivery, false)
})
