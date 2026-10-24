// Flow contract: every client uses one shared Communication contract to request professional statistics at certification or later report either stored clinical evidence or a coded self-report; clients never submit authority, subject kind, jurisdiction or ledger identity.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CommunicationBundleEditor,
  CommunicationBundleReader,
  prepareIndividualPublicHealthStatisticsReportCommunication,
} from '../dist/index.js'

const subjectReference = 'did:web:example.invalid:subjects:one'

test('marks a professional clinical batch only with publication intent', () => {
  const editor = new CommunicationBundleEditor()
  editor.newCommunication()
    .setIdentifier('professional-statistics-communication')
    .setStatus('completed')
    .setSubject(subjectReference)
    .setInnerBundleType('batch')
    .requestPublicHealthStatisticsRegistration()
    .addResource({
      resourceType: 'Observation',
      id: 'coded-observation',
      meta: { claims: {
        'Observation.subject': subjectReference,
        'Observation.status': 'final',
        'Observation.code': 'http://snomed.info/sct|386661006',
      } },
    }, { method: 'POST', url: 'Observation' })
    .doneCommunication()

  const inner = new CommunicationBundleReader(editor.build()).openCommunication(0).getInnerBundle()
  assert.equal(inner.meta.claims.registerResearchMetadata, true)
  assert.equal(JSON.stringify(inner).includes('qualifiedCreator'), false)
  assert.equal(JSON.stringify(inner).includes('reviewAttested'), false)
})

test('builds a later individual report as a reference to private evidence, not browser-authored evidence', () => {
  const outer = prepareIndividualPublicHealthStatisticsReportCommunication({
    communicationIdentifier: 'individual-statistics-communication',
    subjectReference,
    senderReference: 'did:web:example.invalid:members:one',
    reportKind: 'clinical-record',
    resourceType: 'Observation',
    resourceId: 'clinic-observation-one',
  })
  const inner = new CommunicationBundleReader(outer).openCommunication(0).getInnerBundle()
  assert.equal(inner.data[0].request.method, 'POST')
  assert.equal(inner.data[0].request.url, 'PublicHealthStatistic/$report')
  assert.deepEqual(inner.data[0].resource.meta.claims, {
    'Parameters.reportKind': 'clinical-record',
    'Parameters.resourceType': 'Observation',
    'Parameters.resourceId': 'clinic-observation-one',
  })
  assert.equal(JSON.stringify(inner).includes('clinicOriginVerified'), false)
  assert.equal(JSON.stringify(inner).includes('individualAuthorized'), false)
  assert.equal(JSON.stringify(inner).includes('clinicalStatus'), false)
})

test('builds a coded individual self-report without source hash or ledger identity', () => {
  const outer = prepareIndividualPublicHealthStatisticsReportCommunication({
    communicationIdentifier: 'individual-self-report',
    subjectReference,
    reportKind: 'self-report',
    section: 'http://loinc.org|11450-4',
    codingSystem: 'http://snomed.info/sct',
    code: '386661006',
    occurredOn: '2026-10-23',
    ageBand: '40-49',
  })
  const claims = new CommunicationBundleReader(outer).openCommunication(0).getInnerBundle().data[0].resource.meta.claims
  assert.deepEqual(claims, {
    'Parameters.reportKind': 'self-report',
    'Parameters.section': 'http://loinc.org|11450-4',
    'Parameters.codingSystem': 'http://snomed.info/sct',
    'Parameters.code': '386661006',
    'Parameters.occurredOn': '2026-10-23',
    'Parameters.ageBand': '40-49',
  })
  assert.equal(JSON.stringify(claims).includes('Hash'), false)
  assert.equal(JSON.stringify(claims).includes('statisticId'), false)
})

test('rejects incomplete later-report references', () => {
  assert.throws(() => prepareIndividualPublicHealthStatisticsReportCommunication({
    communicationIdentifier: 'individual-statistics-communication',
    subjectReference,
    reportKind: 'clinical-record',
    resourceType: 'Observation',
    resourceId: '',
  }), /public_health_statistics_resource_id_required/)
})
