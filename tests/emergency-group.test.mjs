// Flow contract: SOSChain stores members only on an enumerated Group, creates a canonical compact-coded ServiceRequest, and fails closed without complete authorization evidence.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEmergencyGroupClaims,
  buildEmergencyServiceRequestEntry,
  readEmergencySubjectReferences,
} from 'sos-data-utils-ts/emergency-group'
import {
  authorizeEmergencyAction,
} from '../dist/emergency-authorization.js'

test('one enumerated Group owns its members while ServiceRequest references only the Group', () => {
  const group = buildEmergencyGroupClaims({
    identifier: 'urn:uuid:00000000-0000-4000-8000-000000000001', displayName: 'Emergency subjects',
    groupType: 'animal', memberSubjectReferences: ['Patient/animal-alpha', 'Patient/animal-beta', 'Patient/animal-alpha'],
  })
  const serviceRequestEntry = buildEmergencyServiceRequestEntry({
    entryId: 'request-one', identifier: 'urn:uuid:00000000-0000-4000-8000-000000000002',
    groupReference: 'Group/emergency-subjects', requesterReference: 'RelatedPerson/requester-one',
    performerReferences: ['HealthcareService/emergency-care'],
    assistanceCode: { system: 'https://example.invalid/fhir/CodeSystem/emergency-assistance', code: 'emergency-care' },
    authoredAt: '2026-08-10T12:01:00.000Z',
  })
  assert.deepEqual(readEmergencySubjectReferences(group), ['Patient/animal-alpha', 'Patient/animal-beta'])
  assert.equal(serviceRequestEntry.claims['ServiceRequest.subject'], 'Group/emergency-subjects')
  assert.equal(serviceRequestEntry.claims['ServiceRequest.code-system'], undefined)
  assert.equal(serviceRequestEntry.claims['ServiceRequest.soschain-member-subject'], undefined)
})

test('calls and requests fail closed unless trusted evidence covers every member', () => {
  const evidence = [{ evidenceId: 'vc-1', issuerId: 'school-1', holderId: 'guardian-1', subjectIds: ['minor-1'], capabilities: ['sos:request'], domains: ['SOS', 'TrainingAndEducation'], relationship: 'guardian', verifiedAt: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z' }]
  assert.deepEqual(authorizeEmergencyAction({ callerId: 'guardian-1', memberSubjectIds: ['minor-1'], capability: 'sos:request', evidence, now: '2026-08-10T12:00:00.000Z' }), ['vc-1'])
  assert.throws(() => authorizeEmergencyAction({ callerId: 'guardian-1', memberSubjectIds: ['minor-1'], capability: 'sos:call', evidence, now: '2026-08-10T12:00:00.000Z' }), /evidence_required/)
})

test('a trusted scan resolver may issue a short-lived incident reporter call grant', () => {
  const evidence = [{ evidenceId: 'scan-grant-1', issuerId: 'soschain-scan-resolver', holderId: 'verified-finder', subjectIds: ['animal-card-1'], capabilities: ['sos:call'], domains: ['SOS'], relationship: 'incident-reporter', verifiedAt: '2026-08-10T12:00:00.000Z', validUntil: '2026-08-10T12:10:00.000Z' }]
  assert.deepEqual(authorizeEmergencyAction({ callerId: 'verified-finder', memberSubjectIds: ['animal-card-1'], capability: 'sos:call', evidence, now: '2026-08-10T12:05:00.000Z' }), ['scan-grant-1'])
  assert.throws(() => authorizeEmergencyAction({ callerId: 'verified-finder', memberSubjectIds: ['animal-card-1'], capability: 'sos:call', evidence, now: '2026-08-10T12:11:00.000Z' }), /evidence_required/)
})

test('does not expose a product-prefixed emergency authorizer alias', async () => {
  const contract = await import('../dist/emergency-authorization.js')
  assert.equal('authorizeSoschainEmergencyAction' in contract, false)
})

test('an emergency group requires at least one subject reference', () => {
  assert.throws(() => buildEmergencyGroupClaims({
    identifier: 'urn:uuid:00000000-0000-4000-8000-000000000001', displayName: 'Emergency subjects',
    groupType: 'animal', memberSubjectReferences: [],
  }), /emergency_group_member_required/)
})
