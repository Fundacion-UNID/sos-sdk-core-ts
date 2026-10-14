// Flow contract: SOSChain links a stable subject identifier to a Place or vehicle without merging either identity.
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSoschainCanonicalTargetHash, buildSoschainPlaceCardAssociationClaims } from 'sos-data-utils-ts/place-card-association'

test('builds a flat card-to-Place association without camelCase claim names', () => {
  const canonicalTargetHash = buildSoschainCanonicalTargetHash({ targetType: 'Place', countryCode: 'ES', canonicalValue: 'Calle Mayor 1|28013|Madrid' })
  const claims = buildSoschainPlaceCardAssociationClaims({ associationId: 'association-1', cardId: 'subject-1', canonicalTargetId: 'place-1', canonicalTargetHash, targetType: 'Place', role: 'occupant', createdAt: '2026-08-10T00:00:00.000Z' })
  assert.equal(claims['Basic.subject'], 'subject-1')
  assert.equal(claims['Basic.soschain-target'], 'place-1')
  assert.equal(claims['Basic.soschain-target-hash'], canonicalTargetHash)
  assert.equal(canonicalTargetHash, buildSoschainCanonicalTargetHash({ targetType: 'Place', countryCode: 'es', canonicalValue: '  CALLE MAYOR 1|28013|Madrid  ' }))
  for (const key of Object.keys(claims).filter((key) => key !== '@context')) {
    assert.match(key, /^Basic\.[a-z][a-z0-9-]*$/)
  }
})
