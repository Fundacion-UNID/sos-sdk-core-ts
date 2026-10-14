// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('documents department, professional and Group communication actors without conflating them', async () => {
  const guide = await readFile(new URL('../docs/CARE_EMERGENCY_AND_ALERT_ORCHESTRATION.md', import.meta.url), 'utf8')
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

  assert.match(guide, /department Organization is the FHIR `Communication\.sender`/)
  assert.match(guide, /PractitionerRole is the authenticated transport actor/)
  assert.match(guide, /Group remains the reply queue/)
  assert.doesNotMatch(guide, /PractitionerRole[^.\n]*Communication\/call sender/)
  assert.doesNotMatch(changelog, /PractitionerRole as Task owner and actual\s+callback\/message sender/)
})
