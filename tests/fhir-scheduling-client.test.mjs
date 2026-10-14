// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import assert from 'node:assert/strict'
import test from 'node:test'

import { REPOSITORY_SAFE_EXAMPLES } from 'sos-data-utils-ts/repository-privacy'
import {
  FHIR_SCHEDULING_REQUEST_TIMEOUT_MS,
  FhirSchedulingClient,
} from '../dist/fhir-scheduling.js'

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
})

test('discovers standard FHIR scheduling capabilities without a sector SDK', async () => {
  const requests = []
  const client = new FhirSchedulingClient({
    baseUrl: `${REPOSITORY_SAFE_EXAMPLES.httpsBaseUrl}/fhir/r4`,
    fetchFn: async (url, init) => {
      requests.push({ url, init })
      if (url.endsWith('/metadata')) {
        return response(200, {
          resourceType: 'CapabilityStatement',
          fhirVersion: '4.0.1',
          software: { name: 'Example EHR' },
          rest: [{ resource: [
            { type: 'Appointment', interaction: [{ code: 'read' }, { code: 'search-type' }] },
            { type: 'Slot', interaction: [{ code: 'search-type' }] },
          ] }],
        })
      }
      return response(200, { resourceType: 'Bundle', type: 'searchset' })
    },
  })

  const capability = await client.discoverCapabilities()
  assert.equal(capability.softwareName, 'Example EHR')
  await client.searchAppointments({ patient: `Patient/${REPOSITORY_SAFE_EXAMPLES.resourceUuid}` })
  assert.match(requests[1].url, /Appointment\?patient=Patient%2F/)
  await assert.rejects(
    client.createAppointmentResponse({ resourceType: 'AppointmentResponse' }),
    /does not advertise AppointmentResponse.create/,
  )
})

test('rejects a scheduling timeout above the shared per-attempt maximum', () => {
  assert.throws(
    () => new FhirSchedulingClient({
      baseUrl: REPOSITORY_SAFE_EXAMPLES.httpsBaseUrl,
      timeoutMs: FHIR_SCHEDULING_REQUEST_TIMEOUT_MS + 1,
    }),
    /between 1 and 3000 ms/,
  )
})
