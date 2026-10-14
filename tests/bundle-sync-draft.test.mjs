// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import assert from 'node:assert/strict'
import test from 'node:test'

import { FHIR_ENCOUNTER_TRANSFER_TEST_DATA as fixture } from 'fhir-data-utils-ts'
import {
  BundleSyncKinds,
  BundleSyncStates,
  confirmBundleSyncDraft,
  createBundleSyncDraft,
  markBundleSyncRetryable,
  reconcileBundleSyncSubmission,
} from '../dist/index.js'

const resourceIdentifier = fixture.source.identifier
const resource = Object.freeze({
  resourceType: 'Encounter',
  id: fixture.source.id,
  meta: Object.freeze({ claims: Object.freeze({ 'Encounter.identifier': resourceIdentifier }) }),
})

test('keeps the same draft and optimistic Bundle after a retryable transport failure', () => {
  const draft = createBundleSyncDraft({
    id: fixture.communicationIdentifier,
    kind: BundleSyncKinds.ClinicalDocument,
    subjectReference: fixture.subjectReference,
    changesBundle,
    lastConfirmedBundle,
    optimisticBundle,
    createdAt: fixture.occurredAt,
  })
  const retryable = markBundleSyncRetryable(draft, ['network'], fixture.occurredAt)
  assert.equal(retryable.id, draft.id)
  assert.equal(retryable.visibleBundle, optimisticBundle)
  assert.equal(retryable.state, BundleSyncStates.Retryable)
})
const entry = Object.freeze({ type: 'Encounter', fullUrl: resourceIdentifier, resource })
const changesBundle = Object.freeze({ resourceType: 'Bundle', type: 'batch', total: 1, data: Object.freeze([entry]) })
const lastConfirmedBundle = Object.freeze({ resourceType: 'Bundle', type: 'collection', total: 0, data: Object.freeze([]) })
const optimisticBundle = Object.freeze({ resourceType: 'Bundle', type: 'collection', total: 1, data: Object.freeze([entry]) })

test('retains an optimistic encounter Bundle as a retryable draft when the remote response is ambiguous', () => {
  const draft = createBundleSyncDraft({
    id: fixture.communicationIdentifier,
    kind: BundleSyncKinds.EncounterTransfer,
    subjectReference: fixture.subjectReference,
    changesBundle,
    lastConfirmedBundle,
    optimisticBundle,
    createdAt: fixture.occurredAt,
  })
  const retryable = reconcileBundleSyncSubmission(draft, {
    resourceType: 'Bundle', type: 'batch-response', total: 0, data: [],
  }, fixture.occurredAt)

  assert.equal(retryable.state, BundleSyncStates.Retryable)
  assert.equal(retryable.visibleBundle, optimisticBundle)
  assert.deepEqual(retryable.pendingIdentifiers, [resourceIdentifier])
})

test('discards an optimistic change after a definite remote rejection', () => {
  const draft = createBundleSyncDraft({
    id: fixture.communicationIdentifier,
    kind: BundleSyncKinds.EncounterTransfer,
    subjectReference: fixture.subjectReference,
    changesBundle,
    lastConfirmedBundle,
    optimisticBundle,
    createdAt: fixture.occurredAt,
  })
  const rejected = reconcileBundleSyncSubmission(draft, {
    resourceType: 'Bundle', type: 'batch-response', total: 1, data: [{
      ...entry,
      response: { status: '422', outcome: { issue: [{ severity: 'error', diagnostics: 'Rejected by provider.' }] } },
    }],
  }, fixture.occurredAt)

  assert.equal(rejected.state, BundleSyncStates.Rejected)
  assert.equal(rejected.visibleBundle, lastConfirmedBundle)
  assert.equal(rejected.optimisticBundle, undefined)
})

test('requires authoritative readback after acceptance before confirming the visible Bundle', () => {
  const draft = createBundleSyncDraft({
    id: fixture.communicationIdentifier,
    kind: BundleSyncKinds.ClinicalDocument,
    subjectReference: fixture.subjectReference,
    changesBundle,
    lastConfirmedBundle,
    optimisticBundle,
    createdAt: fixture.occurredAt,
  })
  const reconciling = reconcileBundleSyncSubmission(draft, {
    resourceType: 'Bundle', type: 'batch-response', total: 1, data: [{ ...entry, response: { status: '201 Created' } }],
  }, fixture.occurredAt)
  assert.equal(reconciling.state, BundleSyncStates.Reconciling)
  assert.equal(reconciling.visibleBundle, optimisticBundle)

  const confirmed = confirmBundleSyncDraft(reconciling, optimisticBundle, fixture.occurredAt)
  assert.equal(confirmed.state, BundleSyncStates.Confirmed)
  assert.equal(confirmed.visibleBundle, optimisticBundle)
  assert.equal(confirmed.optimisticBundle, undefined)
})
