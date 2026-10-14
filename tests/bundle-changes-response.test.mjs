// Flow contract: a channel submits only changed Bundle entries and correlates every GW response by stable identity before refreshing authoritative state.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeBundleChangesResponse,
  BundleChangeResponseStates,
} from '../dist/bundle-changes-response.js';

function bundle(data, type = 'batch') {
  return { resourceType: 'Bundle', type, total: data.length, data };
}

function entry(id, response) {
  return {
    type: 'Observation',
    fullUrl: `urn:uuid:${id}`,
    resource: {
      resourceType: 'Observation',
      id,
      meta: { claims: { 'Observation.identifier': id } },
    },
    ...(response ? { response } : {}),
  };
}

test('correlates reordered Bundle responses by stable identity and preserves failures', () => {
  const responseBundle = bundle([
    { ...entry('failed'), response: {
      status: '422',
      outcome: { issue: [{ severity: 'error', diagnostics: 'Invalid value.' }] },
    } },
    { ...entry('accepted'), response: { status: '201 Created' } },
  ], 'batch-response');

  const analysis = analyzeBundleChangesResponse(
    bundle([entry('accepted'), entry('failed')]),
    responseBundle,
  );

  assert.deepEqual(analysis.successfulIdentifiers, ['urn:uuid:accepted']);
  assert.deepEqual(analysis.failedIdentifiers, ['urn:uuid:failed']);
  assert.deepEqual(analysis.pendingIdentifiers, []);
  assert.equal(analysis.entries[0].state, BundleChangeResponseStates.Successful);
  assert.deepEqual(analysis.entries[1].diagnostics, ['Invalid value.']);
});

test('never treats a missing or ambiguous response as successful', () => {
  const first = entry('first');
  first.resource.id = 'shared';
  const second = entry('second');
  second.resource.id = 'shared';

  const analysis = analyzeBundleChangesResponse(
    bundle([first, second, entry('missing')]),
    bundle([{ ...entry('response'), fullUrl: undefined, resource: { id: 'shared' }, response: { status: '201' } }], 'batch-response'),
  );

  assert.deepEqual(analysis.successfulIdentifiers, []);
  assert.deepEqual(analysis.pendingIdentifiers, [
    'urn:uuid:first',
    'urn:uuid:second',
    'urn:uuid:missing',
  ]);
});
