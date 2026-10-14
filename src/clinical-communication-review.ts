import {
  CommunicationClaim,
  CommunicationRequestClaim,
  buildFlatClaimResourceEntry,
  type FlatClaimResourceEntry,
} from 'fhir-data-utils-ts'
import { TaskClaim, TaskStatus } from 'sos-data-utils-ts/task-artifact-schema'

export type ClinicalCommunicationReviewPlan = Readonly<{
  communicationRequestEntry: FlatClaimResourceEntry
  reviewTaskEntry: FlatClaimResourceEntry
}>

export type ClinicalCommunicationReviewDecision = 'require-call' | 'approve' | 'reject'

/** Prepares a draft request and an independently owned clinical review Task. */
export function prepareClinicalCommunicationReview(input: Readonly<{
  communicationRequestEntryId: string
  reviewTaskEntryId: string
  communicationRequestIdentifier: string
  subjectReference: string
  encounterReference: string
  preparerReference: string
  reviewerReference: string
  recipientReferences: readonly string[]
  payloadReference: string
  authoredAt: string
}>): ClinicalCommunicationReviewPlan {
  const subjectReference = reference(input.subjectReference, undefined, 'clinical_communication_subject_invalid')
  const preparerReference = reference(input.preparerReference, 'PractitionerRole', 'clinical_communication_preparer_invalid')
  const reviewerReference = reference(input.reviewerReference, 'PractitionerRole', 'clinical_communication_reviewer_invalid')
  const authoredAt = dateTime(input.authoredAt, 'clinical_communication_authored_at_invalid')
  const communicationRequestEntry = buildFlatClaimResourceEntry({
    entryId: input.communicationRequestEntryId,
    resourceType: 'CommunicationRequest',
    claims: {
      [CommunicationRequestClaim.Identifier]: token(input.communicationRequestIdentifier, 'clinical_communication_request_identifier_required'),
      [CommunicationRequestClaim.Status]: 'draft',
      [CommunicationRequestClaim.Intent]: 'proposal',
      [CommunicationRequestClaim.Subject]: subjectReference,
      [CommunicationRequestClaim.Encounter]: reference(input.encounterReference, 'Encounter', 'clinical_communication_encounter_invalid'),
      [CommunicationRequestClaim.Requester]: preparerReference,
      [CommunicationRequestClaim.Recipient]: uniqueReferences(input.recipientReferences, 'clinical_communication_recipient_required').join(','),
      [CommunicationRequestClaim.PayloadReference]: reference(input.payloadReference, undefined, 'clinical_communication_payload_invalid'),
      [CommunicationRequestClaim.AuthoredOn]: authoredAt,
    },
  })
  const reviewTaskEntry = buildFlatClaimResourceEntry({
    entryId: input.reviewTaskEntryId,
    resourceType: 'Task',
    claims: {
      [TaskClaim.Identifier]: token(input.reviewTaskEntryId, 'clinical_communication_review_task_identifier_required'),
      [TaskClaim.Status]: TaskStatus.Requested,
      [TaskClaim.Intent]: 'order',
      [TaskClaim.Code]: 'clinical-communication-review',
      [TaskClaim.For]: subjectReference,
      [TaskClaim.Requester]: preparerReference,
      [TaskClaim.Owner]: reviewerReference,
      [TaskClaim.Focus]: communicationRequestEntry.reference,
      [TaskClaim.AuthoredOn]: authoredAt,
    },
  })
  return Object.freeze({ communicationRequestEntry, reviewTaskEntry })
}

/** Applies the assigned reviewer's decision without changing recipients or payload. */
export function transitionClinicalCommunicationReview(input: ClinicalCommunicationReviewPlan & Readonly<{
  reviewerReference: string
  decision: ClinicalCommunicationReviewDecision
  reviewedAt: string
}>): ClinicalCommunicationReviewPlan {
  assertReviewPlan(input)
  const reviewerReference = reference(input.reviewerReference, 'PractitionerRole', 'clinical_communication_reviewer_invalid')
  if (input.reviewTaskEntry.claims[TaskClaim.Owner] !== reviewerReference) {
    throw new Error('clinical_communication_reviewer_mismatch')
  }
  const reviewedAt = dateTime(input.reviewedAt, 'clinical_communication_reviewed_at_invalid')
  const statuses = decisionStatuses(input.decision)
  return Object.freeze({
    communicationRequestEntry: replaceClaims(input.communicationRequestEntry, {
      [CommunicationRequestClaim.Status]: statuses.request,
    }),
    reviewTaskEntry: replaceClaims(input.reviewTaskEntry, {
      [TaskClaim.Status]: statuses.task,
      [TaskClaim.LastModified]: reviewedAt,
    }),
  })
}

/** Creates a delivery plan only from an approved request and completed review. */
export function authorizeReviewedClinicalCommunicationDelivery(input: ClinicalCommunicationReviewPlan & Readonly<{
  reviewerReference: string
  senderOrganizationReference: string
  transportActorReference: string
  communicationEntryId: string
  communicationIdentifier: string
  sentAt: string
}>): Readonly<{
  communicationEntry: FlatClaimResourceEntry
  transportActorReference: string
}> {
  assertReviewPlan(input)
  const reviewerReference = reference(input.reviewerReference, 'PractitionerRole', 'clinical_communication_reviewer_invalid')
  if (input.reviewTaskEntry.claims[TaskClaim.Owner] !== reviewerReference) {
    throw new Error('clinical_communication_reviewer_mismatch')
  }
  if (
    input.communicationRequestEntry.claims[CommunicationRequestClaim.Status] !== 'active'
    || input.reviewTaskEntry.claims[TaskClaim.Status] !== TaskStatus.Completed
  ) {
    throw new Error('clinical_communication_approval_required')
  }
  const requestClaims = input.communicationRequestEntry.claims
  const communicationEntry = buildFlatClaimResourceEntry({
    entryId: input.communicationEntryId,
    resourceType: 'Communication',
    claims: {
      [CommunicationClaim.Identifier]: token(input.communicationIdentifier, 'clinical_communication_identifier_required'),
      [CommunicationClaim.Status]: 'in-progress',
      [CommunicationClaim.BasedOn]: input.communicationRequestEntry.reference,
      [CommunicationClaim.Subject]: requiredClaim(requestClaims[CommunicationRequestClaim.Subject], 'clinical_communication_subject_required'),
      [CommunicationClaim.Sender]: reference(input.senderOrganizationReference, 'Organization', 'clinical_communication_sender_invalid'),
      [CommunicationClaim.Recipient]: requiredClaim(requestClaims[CommunicationRequestClaim.Recipient], 'clinical_communication_recipient_required'),
      [CommunicationClaim.ContentReference]: requiredClaim(requestClaims[CommunicationRequestClaim.PayloadReference], 'clinical_communication_payload_required'),
      [CommunicationClaim.Sent]: dateTime(input.sentAt, 'clinical_communication_sent_at_invalid'),
    },
  })
  return Object.freeze({
    communicationEntry,
    transportActorReference: reference(input.transportActorReference, 'PractitionerRole', 'clinical_communication_transport_actor_invalid'),
  })
}

function assertReviewPlan(plan: ClinicalCommunicationReviewPlan): void {
  if (
    plan.communicationRequestEntry.resourceType !== 'CommunicationRequest'
    || plan.reviewTaskEntry.resourceType !== 'Task'
    || plan.reviewTaskEntry.claims[TaskClaim.Focus] !== plan.communicationRequestEntry.reference
  ) {
    throw new TypeError('clinical_communication_review_plan_invalid')
  }
}

function decisionStatuses(decision: ClinicalCommunicationReviewDecision): Readonly<{ request: string; task: string }> {
  if (decision === 'require-call') return Object.freeze({ request: 'on-hold', task: TaskStatus.OnHold })
  if (decision === 'approve') return Object.freeze({ request: 'active', task: TaskStatus.Completed })
  if (decision === 'reject') return Object.freeze({ request: 'revoked', task: TaskStatus.Rejected })
  throw new TypeError('clinical_communication_review_decision_invalid')
}

function replaceClaims(entry: FlatClaimResourceEntry, changes: Readonly<Record<string, string>>): FlatClaimResourceEntry {
  return buildFlatClaimResourceEntry({
    entryId: entry.entryId,
    resourceType: entry.resourceType,
    claims: { ...entry.claims, ...changes },
  })
}

function uniqueReferences(values: readonly string[], error: string): readonly string[] {
  const references = [...new Set(values.map(value => reference(value, undefined, error)))]
  if (!references.length) throw new TypeError(error)
  return Object.freeze(references)
}

function reference(value: unknown, expectedType: string | undefined, error: string): string {
  if (typeof value !== 'string') throw new TypeError(error)
  const normalized = value.trim()
  const match = /^([A-Z][A-Za-z0-9]+)\/([A-Za-z0-9.-]{1,128})$/u.exec(normalized)
  if (!match || (expectedType && match[1] !== expectedType)) throw new TypeError(error)
  return normalized
}

function requiredClaim(value: unknown, error: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(error)
  return value.trim()
}

function token(value: unknown, error: string): string {
  const normalized = requiredClaim(value, error)
  if (normalized.includes(',')) throw new TypeError(error)
  return normalized
}

function dateTime(value: unknown, error: string): string {
  const normalized = requiredClaim(value, error)
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(normalized) || Number.isNaN(Date.parse(normalized))) throw new TypeError(error)
  return normalized
}
