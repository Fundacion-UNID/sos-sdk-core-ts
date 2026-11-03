// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  discoverSubjectCardProviders,
  selectSubjectCardProvider,
} from '../dist/subject-card-provider-discovery.js'
import { REPOSITORY_SAFE_EXAMPLES } from 'sos-data-utils-ts/repository-privacy'

const provider = (suffix, subjectKinds, operations) => ({
  indexProviderDid: `${REPOSITORY_SAFE_EXAMPLES.didWeb}:${suffix}`,
  displayName: `${REPOSITORY_SAFE_EXAMPLES.organizationLegalName} ${suffix}`,
  directoryRoute: `${REPOSITORY_SAFE_EXAMPLES.httpsBaseUrl}/${REPOSITORY_SAFE_EXAMPLES.tenantId}-${suffix}/cds-CA/v1/${REPOSITORY_SAFE_EXAMPLES.sector}`,
  subjectKinds,
  operations,
  ...(operations.includes('create') ? { providerCode9: REPOSITORY_SAFE_EXAMPLES.organizationBusinessNumber } : {}),
  ...(operations.includes('create') ? { cardDidHost: 'cards.example.invalid' } : {}),
})

test('discovers every compatible provider without using list order as write authority', () => {
  const catalog = [
    provider('human', ['human'], ['directory', 'create']),
    provider('animal-one', ['animal'], ['directory', 'create']),
    provider('animal-two', ['animal'], ['directory', 'create']),
  ]

  const discovered = discoverSubjectCardProviders(catalog, { subjectKind: 'animal', operation: 'create' })

  assert.deepEqual(discovered.map(item => item.providerId), [
    `${REPOSITORY_SAFE_EXAMPLES.didWeb}:animal-one`,
    `${REPOSITORY_SAFE_EXAMPLES.didWeb}:animal-two`,
  ])
})

test('selects only the exact compatible provider and rejects browser tampering', () => {
  const animal = provider('animal', ['animal'], ['directory', 'create'])
  const human = provider('human', ['human'], ['directory', 'create'])

  assert.equal(selectSubjectCardProvider([animal, human], {
    providerId: animal.indexProviderDid,
    subjectKind: 'animal',
    operation: 'create',
  }).providerId, animal.indexProviderDid)
  assert.throws(() => selectSubjectCardProvider([animal, human], {
    providerId: `${REPOSITORY_SAFE_EXAMPLES.didWeb}:unknown`,
    subjectKind: 'animal',
    operation: 'create',
  }), /provider_not_available/)
  assert.throws(() => selectSubjectCardProvider([animal, human], {
    providerId: human.indexProviderDid,
    subjectKind: 'animal',
    operation: 'create',
  }), /provider_not_available/)
})
