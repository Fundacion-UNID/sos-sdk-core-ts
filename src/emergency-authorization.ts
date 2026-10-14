import type {
  EmergencyAuthorizationEvidence,
  EmergencyCapability,
  EvidenceDomain,
} from 'sos-data-utils-ts/emergency-evidence'

export type {
  EmergencyAuthorizationEvidence,
  EmergencyCapability,
  EvidenceDomain,
} from 'sos-data-utils-ts/emergency-evidence'

/** Runtime-neutral endpoint selected after authorization succeeds. */
export type EmergencyDeliveryTarget = Readonly<{
  tenantId: string
  jurisdiction: string
  locality?: string
  endpointId: string
}>

/**
 * Requires current trusted evidence for every affected subject and capability.
 * Identifier syntax and the legal meaning of each issuer remain policy concerns.
 */
export function authorizeEmergencyAction(input: Readonly<{
  callerId: string
  memberSubjectIds: readonly string[]
  capability: EmergencyCapability
  evidence: readonly EmergencyAuthorizationEvidence[]
  now?: string
}>): readonly string[] {
  const at = Date.parse(input.now ?? new Date().toISOString())
  const evidenceIds = new Set<string>()
  for (const subjectId of input.memberSubjectIds) {
    const accepted = input.evidence.find((item) =>
      item.holderId === input.callerId &&
      item.subjectIds.includes(subjectId) &&
      item.capabilities.includes(input.capability) &&
      Number.isFinite(Date.parse(item.verifiedAt)) && Date.parse(item.verifiedAt) <= at &&
      (!item.validUntil || Date.parse(item.validUntil) >= at))
    if (!accepted) throw new Error(`emergency_authorization_evidence_required:${subjectId}:${input.capability}`)
    evidenceIds.add(accepted.evidenceId)
  }
  return [...evidenceIds]
}
