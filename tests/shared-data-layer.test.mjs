// Copyright 2026 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.
// Flow contract: SOS SDK orchestrates shared records from sos-data-utils-ts instead of redefining their types and builders.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('depends on the shared data layer and established GDC editor base without inheriting another product SDK', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const lockfile = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
  const installedDataManifest = JSON.parse(await readFile(new URL('../node_modules/sos-data-utils-ts/package.json', import.meta.url), 'utf8'))
  const installedFhirManifest = JSON.parse(await readFile(new URL('../node_modules/fhir-data-utils-ts/package.json', import.meta.url), 'utf8'))
  const installedCommonManifest = JSON.parse(await readFile(new URL('../node_modules/gdc-common-utils-ts/package.json', import.meta.url), 'utf8'))
  const indexSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  const careWorkflowGuide = await readFile(new URL('../docs/CARE_EMERGENCY_AND_ALERT_ORCHESTRATION.md', import.meta.url), 'utf8')

  assert.equal(manifest.dependencies['sos-data-utils-ts'], lockfile.packages['node_modules/sos-data-utils-ts'].version)
  assert.equal(manifest.dependencies['fhir-data-utils-ts'], lockfile.packages['node_modules/fhir-data-utils-ts'].version)
  assert.equal(installedDataManifest.version, process.env.SOS_DATA_UTILS_TEST_VERSION ?? manifest.dependencies['sos-data-utils-ts'])
  assert.doesNotMatch(JSON.stringify(manifest.dependencies), /(?:file:|git(?:hub)?:|workspace:|\.tgz)/)
  assert.equal(manifest.dependencies['uhc-sdk-core-ts'], undefined)
  assert.equal(manifest.dependencies['vet-sdk-core-ts'], undefined)
  assert.equal(manifest.dependencies['gdc-common-utils-ts'], lockfile.packages['node_modules/gdc-common-utils-ts'].version)
  assert.equal(installedFhirManifest.version, manifest.dependencies['fhir-data-utils-ts'])
  assert.equal(installedCommonManifest.version, manifest.dependencies['gdc-common-utils-ts'])
  assert.doesNotMatch(indexSource, /(?:uhc|vet)-sdk-core-ts/)
  assert.equal(manifest.exports['./emergency-group'], undefined)
  assert.equal(manifest.exports['./place-card-association'], undefined)
  assert.match(readme, /portal, phone\s+service, chatbot or other supported channel/)
  assert.doesNotMatch(readme, /identifiers are projected into a single service request/i)
  assert.match(careWorkflowGuide, /Appointment `fulfilled` -> Encounter/)
  assert.match(careWorkflowGuide, /HealthcareService or\s+its owning Organization/)
  assert.match(careWorkflowGuide, /`blood-donation` and `public-risk`/)
  assert.match(careWorkflowGuide, /must not publish, attest or update the subject\s+index/i)
})
