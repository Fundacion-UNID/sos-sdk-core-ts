import {
  freezeGovernedAlertCohort,
  normalizeCareJourneyTransition,
  normalizeEmergencyIntake,
  normalizeGovernedAlertCampaign,
  recordGovernedAlertDelivery,
  type CareJourneyTransition,
  type EmergencyIntake,
  type GovernedAlertCampaign,
  type GovernedAlertCohortSnapshot,
  type GovernedAlertDeliveryAudit,
} from 'sos-data-utils-ts/care-emergency-alert-records'
import { TaskClaim, TaskStatus } from 'sos-data-utils-ts/task-artifact-schema'
import {
  buildCohortCommunicationRequestFlatEntry,
  buildEncounterCareJourneyFlatGraph,
  buildServiceRequestFlatEntry,
  buildServiceRequestTriageTaskFlatEntry,
  type ClinicalCoding,
} from 'fhir-data-utils-ts/care-emergency-alert'
import type { FlatClaimResourceEntry } from 'fhir-data-utils-ts/flat-claim-resource-graph'

export type FulfilledAppointmentEncounterPlan =
  | Readonly<{ created: false; encounterReference: string }>
  | Readonly<{ created: true; encounterReference: string; encounterEntry: FlatClaimResourceEntry }>

/**
 * Plans one idempotent Appointment-to-Encounter transition. Persistence must
 * enforce `idempotencyKey`; an existing reference suppresses duplicate writes.
 */
export function orchestrateFulfilledAppointment(input: Readonly<{
  transition: CareJourneyTransition
  encounterIdentifier: string
  existingEncounterReference?: string
}>): FulfilledAppointmentEncounterPlan {
  const transition = normalizeCareJourneyTransition(input.transition)
  if (input.existingEncounterReference) {
    return Object.freeze({
      created: false,
      encounterReference: reference(input.existingEncounterReference, 'Encounter', 'existing_encounter_reference_invalid'),
    })
  }
  const encounterEntry = buildEncounterCareJourneyFlatGraph({
    parent: {
      entryId: transition.encounterEntryId,
      identifier: input.encounterIdentifier,
      status: 'in-progress',
      subjectReference: transition.subjectReference,
      appointmentReference: transition.appointmentReference,
      serviceProviderReference: transition.serviceProviderReference,
      periodStart: transition.occurredAt,
      locationReference: transition.locationReference,
    },
  })[0]
  return Object.freeze({ created: true, encounterReference: encounterEntry.reference, encounterEntry })
}

export type EncounterCommunicationAuthorization = Readonly<{
  encounterReference: string
  actorReference: string
  recipientReferences: readonly string[]
  channel: 'voice' | 'video' | 'encrypted-message'
  includesClinicalBundle: boolean
  clinicalStatus?: 'preliminary' | 'final'
  updateIndex: boolean
}>

/**
 * Authorizes only the channel boundary. It never attests clinical data.
 * Preliminary encrypted Bundles may be delivered directly but cannot update
 * the subject index; voice/video signaling cannot carry a clinical Bundle.
 */
export function authorizeEncounterCommunication(input: Readonly<{
  encounterReference: string
  actorReference: string
  recipientReferences: readonly string[]
  actorCanCommunicate: boolean
  encounterActive: boolean
  channel: EncounterCommunicationAuthorization['channel']
  includesClinicalBundle: boolean
  clinicalStatus?: 'preliminary' | 'final'
  updateIndex: boolean
}>): EncounterCommunicationAuthorization {
  if (!input.actorCanCommunicate) throw new Error('encounter_communication_actor_forbidden')
  if (!input.encounterActive) throw new Error('encounter_communication_inactive_encounter')
  if ((input.channel === 'voice' || input.channel === 'video') && input.includesClinicalBundle) {
    throw new Error('encounter_call_clinical_bundle_forbidden')
  }
  if (input.includesClinicalBundle && !input.clinicalStatus) throw new Error('encounter_communication_clinical_status_required')
  if (input.clinicalStatus === 'preliminary' && input.updateIndex) throw new Error('preliminary_clinical_index_update_forbidden')
  const recipientReferences = uniqueReferences(input.recipientReferences, 'encounter_communication_recipient_required')
  return Object.freeze({
    encounterReference: reference(input.encounterReference, 'Encounter', 'encounter_communication_encounter_reference_invalid'),
    actorReference: reference(input.actorReference, undefined, 'encounter_communication_actor_reference_invalid'),
    recipientReferences,
    channel: input.channel,
    includesClinicalBundle: input.includesClinicalBundle,
    ...(input.clinicalStatus ? { clinicalStatus: input.clinicalStatus } : {}),
    updateIndex: input.updateIndex,
  })
}

/** Creates independent standard ServiceRequest and durable triage Task entries. */
export function orchestrateEmergencyRequest(input: Readonly<{
  intake: EmergencyIntake
  serviceRequestIdentifier: string
  triageTaskIdentifier: string
  assistanceCode: ClinicalCoding
}>): Readonly<{
  intake: EmergencyIntake
  serviceRequestEntry: FlatClaimResourceEntry
  triageTaskEntry: FlatClaimResourceEntry
}> {
  const intake = normalizeEmergencyIntake(input.intake)
  const triageGroupReference = reference(
    intake.triageOwnerReference,
    'Group',
    'emergency_triage_group_owner_required',
  )
  const serviceRequestEntry = buildServiceRequestFlatEntry({
    entryId: intake.serviceRequestEntryId,
    identifier: input.serviceRequestIdentifier,
    status: 'active',
    intent: 'order',
    priority: 'stat',
    code: input.assistanceCode,
    subjectReference: intake.subjectReference,
    requesterReference: intake.requesterReference,
    performerReferences: [intake.targetServiceReference],
    authoredAt: intake.receivedAt,
  })
  const baseTriageTaskEntry = buildServiceRequestTriageTaskFlatEntry({
    entryId: intake.triageTaskEntryId,
    identifier: input.triageTaskIdentifier,
    serviceRequestReference: serviceRequestEntry.reference,
    subjectReference: intake.subjectReference,
    requesterReference: intake.requesterReference,
    ownerReference: triageGroupReference,
    authoredAt: intake.receivedAt,
  })
  const triageTaskEntry = Object.freeze({
    ...baseTriageTaskEntry,
    claims: Object.freeze({
      ...baseTriageTaskEntry.claims,
      [TaskClaim.GroupIdentifier]: intake.communicationThreadId,
    }),
  })
  return Object.freeze({ intake, serviceRequestEntry, triageTaskEntry })
}

export type EmergencyTriageAction = 'acknowledge' | 'start' | 'escalate' | 'reject' | 'complete'

export type EmergencyTriageTask = Readonly<{
  taskReference: string
  status: string
  focusReference: string
  subjectReference: string
  requesterReference: string
  ownerReference: string
  authoredAt: string
  communicationThreadId?: string
  lastModified?: string
}>

/**
 * Reads only the standard, claims-first coordinates required by a responder
 * console. It does not resolve contact endpoints or grant callback authority.
 */
export function readEmergencyTriageTask(taskEntry: FlatClaimResourceEntry): EmergencyTriageTask {
  if (taskEntry.resourceType !== 'Task' || taskEntry.reference !== `Task/${taskEntry.entryId}`) {
    throw new TypeError('emergency_triage_task_invalid')
  }
  const claims = taskEntry.claims
  const status = scalarClaim(claims[TaskClaim.Status], 'emergency_triage_status_required')
  if (!Object.values(TaskStatus).includes(status as (typeof TaskStatus)[keyof typeof TaskStatus])) {
    throw new TypeError('emergency_triage_status_invalid')
  }
  return Object.freeze({
    taskReference: taskEntry.reference,
    status,
    focusReference: reference(scalarClaim(claims[TaskClaim.Focus], 'emergency_triage_focus_required'), 'ServiceRequest', 'emergency_triage_focus_invalid'),
    subjectReference: reference(scalarClaim(claims[TaskClaim.For], 'emergency_triage_subject_required'), undefined, 'emergency_triage_subject_invalid'),
    requesterReference: reference(scalarClaim(claims[TaskClaim.Requester], 'emergency_triage_requester_required'), undefined, 'emergency_triage_requester_invalid'),
    ownerReference: reference(scalarClaim(claims[TaskClaim.Owner], 'emergency_triage_owner_required'), undefined, 'emergency_triage_owner_invalid'),
    authoredAt: dateTime(scalarClaim(claims[TaskClaim.AuthoredOn], 'emergency_triage_authored_on_required'), 'emergency_triage_authored_on_invalid'),
    ...(claims[TaskClaim.GroupIdentifier]
      ? { communicationThreadId: scalarClaim(claims[TaskClaim.GroupIdentifier], 'emergency_triage_thread_invalid') }
      : {}),
    ...(claims[TaskClaim.LastModified]
      ? { lastModified: dateTime(scalarClaim(claims[TaskClaim.LastModified], 'emergency_triage_last_modified_invalid'), 'emergency_triage_last_modified_invalid') }
      : {}),
  })
}

/**
 * Applies one deterministic responder transition to the Task only. The
 * ServiceRequest remains immutable; callers must authorize the responder and
 * resolve any escalation owner before invoking this function.
 */
export function transitionEmergencyTriageTask(input: Readonly<{
  taskEntry: FlatClaimResourceEntry
  action: EmergencyTriageAction
  responderReference: string
  escalationOwnerReference?: string
  occurredAt: string
}>): FlatClaimResourceEntry {
  const current = readEmergencyTriageTask(input.taskEntry)
  const responderReference = reference(input.responderReference, 'PractitionerRole', 'emergency_triage_responder_invalid')
  const transition = emergencyTriageTransition(current.status, input.action)
  const ownerReference = input.action === 'escalate'
    ? reference(input.escalationOwnerReference, undefined, 'emergency_triage_escalation_owner_required')
    : input.action === 'acknowledge'
      ? responderReference
      : current.ownerReference
  const claims = {
    ...input.taskEntry.claims,
    [TaskClaim.Status]: transition,
    [TaskClaim.Owner]: ownerReference,
    [TaskClaim.LastModified]: dateTime(input.occurredAt, 'emergency_triage_occurred_at_invalid'),
    ...(input.action === 'escalate' ? { [TaskClaim.EscalationRecipient]: ownerReference } : {}),
  }
  return Object.freeze({ ...input.taskEntry, claims: Object.freeze(claims) })
}

export type EmergencyResponderCallback = Readonly<{
  taskReference: string
  serviceRequestReference: string
  subjectReference: string
  requesterReference: string
  responderReference: string
  communicationThreadId: string
  media: 'audio' | 'video'
}>

/**
 * Authorizes callback correlation for the current Task owner. Protected
 * endpoint resolution and WebRTC signaling remain in the product server.
 */
export function prepareEmergencyResponderCallback(input: Readonly<{
  taskEntry: FlatClaimResourceEntry
  responderReference: string
  media: 'audio' | 'video'
}>): EmergencyResponderCallback {
  const task = readEmergencyTriageTask(input.taskEntry)
  const responderReference = reference(input.responderReference, 'PractitionerRole', 'emergency_callback_responder_invalid')
  if (task.ownerReference !== responderReference) throw new TypeError('emergency_callback_task_owner_required')
  if (task.status !== TaskStatus.Accepted && task.status !== TaskStatus.InProgress) {
    throw new TypeError('emergency_callback_active_task_required')
  }
  if (!task.communicationThreadId) throw new TypeError('emergency_callback_thread_required')
  if (input.media !== 'audio' && input.media !== 'video') throw new TypeError('emergency_callback_media_invalid')
  return Object.freeze({
    taskReference: task.taskReference,
    serviceRequestReference: task.focusReference,
    subjectReference: task.subjectReference,
    requesterReference: task.requesterReference,
    responderReference,
    communicationThreadId: task.communicationThreadId,
    media: input.media,
  })
}

function emergencyTriageTransition(currentStatus: string, action: EmergencyTriageAction): string {
  const transitions: Readonly<Record<EmergencyTriageAction, Readonly<Record<string, string>>>> = {
    acknowledge: { [TaskStatus.Requested]: TaskStatus.Accepted, [TaskStatus.Received]: TaskStatus.Accepted },
    start: { [TaskStatus.Accepted]: TaskStatus.InProgress, [TaskStatus.Ready]: TaskStatus.InProgress },
    escalate: {
      [TaskStatus.Requested]: TaskStatus.Requested,
      [TaskStatus.Received]: TaskStatus.Requested,
      [TaskStatus.Accepted]: TaskStatus.Requested,
      [TaskStatus.InProgress]: TaskStatus.Requested,
    },
    reject: {
      [TaskStatus.Requested]: TaskStatus.Rejected,
      [TaskStatus.Received]: TaskStatus.Rejected,
      [TaskStatus.Accepted]: TaskStatus.Rejected,
    },
    complete: { [TaskStatus.InProgress]: TaskStatus.Completed },
  }
  const nextStatus = transitions[action]?.[currentStatus]
  if (!nextStatus) throw new TypeError('emergency_triage_transition_invalid')
  return nextStatus
}

export type GovernedAlertCampaignPlan = Readonly<{
  campaign: GovernedAlertCampaign
  cohortSnapshot: GovernedAlertCohortSnapshot
  communicationRequestEntry: FlatClaimResourceEntry
}>

/** Builds one campaign request bound to the frozen evaluated Group snapshot. */
export function prepareGovernedAlertCampaign(input: Readonly<{
  campaign: GovernedAlertCampaign
  snapshotGroupReference: string
  evaluatedAt: string
  evaluationFingerprint: string
  eligibleSubjectReferences: readonly string[]
  communicationRequestEntryId: string
  communicationRequestIdentifier: string
  category: ClinicalCoding
}>): GovernedAlertCampaignPlan {
  const campaign = normalizeGovernedAlertCampaign(input.campaign)
  const cohortSnapshot = freezeGovernedAlertCohort({
    campaign,
    snapshotGroupReference: input.snapshotGroupReference,
    evaluatedAt: input.evaluatedAt,
    evaluationFingerprint: input.evaluationFingerprint,
    eligibleSubjectReferences: input.eligibleSubjectReferences,
  })
  const communicationRequestEntry = buildCohortCommunicationRequestFlatEntry({
    entryId: input.communicationRequestEntryId,
    identifier: input.communicationRequestIdentifier,
    status: 'active',
    priority: 'routine',
    category: input.category,
    subjectReference: cohortSnapshot.snapshotGroupReference,
    requesterReference: campaign.requesterReference,
    authoredAt: cohortSnapshot.evaluatedAt,
    reasonReferences: [campaign.groupDefinitionReference],
  })
  return Object.freeze({ campaign, cohortSnapshot, communicationRequestEntry })
}

/** Rechecks frozen membership before recording the data-layer delivery audit. */
export function prepareGovernedAlertDelivery(input: Readonly<{
  campaignPlan: GovernedAlertCampaignPlan
  recipientReference: string
  communicationReference: string
  evaluatedAt: string
  eligibilityCurrent: boolean
  exclusionCurrent: boolean
  consentReference?: string
  channelAuthorizationReference?: string
  outcome: 'sent' | 'suppressed'
}>): GovernedAlertDeliveryAudit {
  const recipientReference = reference(input.recipientReference, undefined, 'alert_delivery_recipient_reference_invalid')
  if (!input.campaignPlan.cohortSnapshot.eligibleSubjectReferences.includes(recipientReference)) {
    throw new Error('alert_delivery_recipient_not_in_snapshot')
  }
  return recordGovernedAlertDelivery({
    campaignId: input.campaignPlan.campaign.campaignId,
    snapshotGroupReference: input.campaignPlan.cohortSnapshot.snapshotGroupReference,
    recipientReference,
    communicationReference: input.communicationReference,
    evaluatedAt: input.evaluatedAt,
    eligibilityCurrent: input.eligibilityCurrent,
    exclusionCurrent: input.exclusionCurrent,
    consentReference: input.consentReference,
    channelAuthorizationReference: input.channelAuthorizationReference,
    outcome: input.outcome,
  })
}

function scalarClaim(value: unknown, error: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(error)
  return value.trim()
}

function dateTime(value: unknown, error: string): string {
  const normalized = scalarClaim(value, error)
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw new TypeError(error)
  }
  return normalized
}

function uniqueReferences(values: readonly string[], error: string): readonly string[] {
  const references = [...new Set(values.map(value => reference(value, undefined, error)))]
  if (!references.length) throw new TypeError(error)
  return Object.freeze(references)
}

function reference(value: unknown, expectedType: string | undefined, error: string): string {
  if (typeof value !== 'string') throw new TypeError(error)
  const normalized = value.trim()
  const match = /^([A-Z][A-Za-z0-9]+)\/([A-Za-z0-9.-]{1,128})$/.exec(normalized)
  if (!match || (expectedType && match[1] !== expectedType)) throw new TypeError(error)
  return normalized
}
