// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import assert from 'node:assert/strict'
import test from 'node:test'

import { EquipmentComplianceManager } from '../dist/equipment-compliance-orchestration.js'

const calibration = Object.freeze({
  procedureId: 'calibration-procedure',
  procedureIdentifier: 'urn:uuid:11111111-1111-4111-8111-111111111111',
  procedureCode: 'http://snomed.info/sct|129265001',
  deviceReference: 'Device/apheresis-device',
  metricId: 'calibration-metric',
  metricIdentifier: 'urn:uuid:22222222-2222-4222-8222-222222222222',
  metricType: 'http://loinc.org|11850-8',
  calibrationType: 'two-point',
  calibrationState: 'calibrated',
  calibrationTime: '2026-09-29T16:00:00Z',
  performerReferences: ['PractitionerRole/maintenance-technician'],
})

test('requires an explicit product authorization decision before preparing calibration evidence', () => {
  const manager = new EquipmentComplianceManager({ authorize: () => false })
  assert.throws(() => manager.prepareCalibration(calibration), /equipment_calibration_forbidden/)
})

test('keeps calibration and public operating authorization as independent claims-first records', () => {
  const decisions = []
  const manager = new EquipmentComplianceManager({ authorize: decision => (decisions.push(decision), true) })
  const actorContext = {
    actorReference: 'PractitionerRole/donor-care-associate',
    departmentReference: 'Organization/blood-donation-department',
  }
  const calibrationGraph = manager.prepareCalibration(calibration, actorContext)
  const authorization = manager.prepareOperatingAuthorization({
    authorizationId: 'operating-authorization',
    identifier: 'urn:uuid:33333333-3333-4333-8333-333333333333',
    subjectReference: 'Location/apheresis-station',
    holderReference: 'Organization/blood-bank',
    regulatorReference: 'Organization/public-health-authority',
    type: 'http://terminology.hl7.org/CodeSystem/v3-ActCode|OPERAT',
    status: 'active',
    statusDate: '2026-09-29T16:00:00Z',
    validityPeriod: { start: '2026-09-29', end: '2027-09-29' },
    region: 'urn:iso:std:iso:3166|CA',
    basis: 'http://terminology.hl7.org/CodeSystem/v3-ActCode|AUTH',
  }, actorContext)
  assert.deepEqual(decisions, [
    { action: 'record-calibration', ...actorContext },
    { action: 'publish-operating-authorization', ...actorContext },
  ])
  assert.equal(calibrationGraph[0].resourceType, 'Procedure')
  assert.equal(calibrationGraph[1].resourceType, 'DeviceMetric')
  assert.equal(authorization.resourceType, 'RegulatedAuthorization')
  for (const entry of [...calibrationGraph, authorization]) {
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'meta', 'resourceType'])
  }
})
