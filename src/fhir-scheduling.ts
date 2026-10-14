export const FHIR_SCHEDULING_REQUEST_TIMEOUT_MS = 3_000

export type FhirSchedulingResourceType =
  | 'Appointment'
  | 'AppointmentResponse'
  | 'Schedule'
  | 'Slot'
  | 'Subscription'

export type FhirSchedulingResourceCapability = Readonly<{
  resourceType: FhirSchedulingResourceType
  supported: boolean
  interactions: readonly string[]
}>

export type FhirSchedulingCapabilitySummary = Readonly<{
  fhirVersion: string
  softwareName?: string
  resources: readonly FhirSchedulingResourceCapability[]
}>

export type FhirAccessTokenProvider = Readonly<{
  getAccessToken(): Promise<string>
}>

export type FhirFetchResponse = Readonly<{
  ok: boolean
  status: number
  text(): Promise<string>
}>

export type FhirFetch = (
  url: string,
  init?: Readonly<Record<string, unknown>>,
) => Promise<FhirFetchResponse>

export type FhirSchedulingClientOptions = Readonly<{
  baseUrl: string
  fetchFn?: FhirFetch
  accessTokenProvider?: FhirAccessTokenProvider
  timeoutMs?: number
  accept?: string
}>

const schedulingResourceTypes: readonly FhirSchedulingResourceType[] = Object.freeze([
  'Appointment',
  'AppointmentResponse',
  'Schedule',
  'Slot',
  'Subscription',
])

/** Capability-driven FHIR scheduling client shared by every sector. */
export class FhirSchedulingClient {
  readonly baseUrl: string
  readonly #fetchFn: FhirFetch
  readonly #timeoutMs: number
  #capability?: FhirSchedulingCapabilitySummary

  constructor(private readonly options: FhirSchedulingClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.#fetchFn = options.fetchFn ?? (globalThis.fetch as unknown as FhirFetch)
    this.#timeoutMs = requireSchedulingTimeout(options.timeoutMs)
  }

  async discoverCapabilities(): Promise<FhirSchedulingCapabilitySummary> {
    const metadata = await this.#request('metadata')
    if (metadata.resourceType !== 'CapabilityStatement') {
      throw new TypeError('fhir_capability_statement_required')
    }
    const resources = array(metadata.rest).flatMap(rest => array(record(rest).resource))
    this.#capability = Object.freeze({
      fhirVersion: text(metadata.fhirVersion),
      ...(optionalText(record(metadata.software).name)
        ? { softwareName: optionalText(record(metadata.software).name) }
        : {}),
      resources: Object.freeze(schedulingResourceTypes.map(resourceType => {
        const resource = resources.map(record).find(candidate => candidate.type === resourceType)
        return Object.freeze({
          resourceType,
          supported: Boolean(resource),
          interactions: Object.freeze(array(resource?.interaction).map(item => text(record(item).code))),
        })
      })),
    })
    return this.#capability
  }

  async searchAppointments(parameters: Readonly<Record<string, string>>): Promise<Record<string, unknown>> {
    await this.#requireInteraction('Appointment', 'search-type')
    return this.#search('Appointment', parameters)
  }

  async searchSlots(parameters: Readonly<Record<string, string>>): Promise<Record<string, unknown>> {
    await this.#requireInteraction('Slot', 'search-type')
    return this.#search('Slot', parameters)
  }

  async createAppointment(appointment: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    await this.#requireInteraction('Appointment', 'create')
    return this.#request('Appointment', { method: 'POST', body: JSON.stringify(appointment) })
  }

  async createAppointmentResponse(response: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    await this.#requireInteraction('AppointmentResponse', 'create')
    return this.#request('AppointmentResponse', { method: 'POST', body: JSON.stringify(response) })
  }

  async #search(resourceType: string, parameters: Readonly<Record<string, string>>): Promise<Record<string, unknown>> {
    return this.#request(`${resourceType}?${new URLSearchParams(parameters)}`)
  }

  async #requireInteraction(resourceType: FhirSchedulingResourceType, interaction: string): Promise<void> {
    const capability = this.#capability ?? await this.discoverCapabilities()
    const resource = capability.resources.find(candidate => candidate.resourceType === resourceType)
    if (!resource?.supported || !resource.interactions.includes(interaction)) {
      throw new TypeError(`Configured FHIR server does not advertise ${resourceType}.${interaction}.`)
    }
  }

  async #request(path: string, init: Readonly<Record<string, unknown>> = {}): Promise<Record<string, unknown>> {
    const token = this.options.accessTokenProvider
      ? await this.options.accessTokenProvider.getAccessToken()
      : undefined
    const response = await this.#fetchFn(`${this.baseUrl}/${path}`, {
      ...init,
      signal: AbortSignal.timeout(this.#timeoutMs),
      headers: {
        accept: this.options.accept ?? 'application/fhir+json',
        ...(init.body ? { 'content-type': 'application/fhir+json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    })
    const responseText = await response.text()
    const body = parseResponseBody(responseText)
    if (!response.ok) throw new Error(`FHIR scheduling request failed (${response.status}).`)
    return record(body)
  }
}

function normalizeBaseUrl(value: string): string {
  const baseUrl = String(value ?? '').trim().replace(/\/+$/u, '')
  if (!baseUrl) throw new TypeError('fhir_base_url_required')
  return baseUrl
}

function requireSchedulingTimeout(value: number | undefined): number {
  const timeoutMs = value ?? FHIR_SCHEDULING_REQUEST_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > FHIR_SCHEDULING_REQUEST_TIMEOUT_MS) {
    throw new RangeError(`FHIR scheduling timeout must be between 1 and ${FHIR_SCHEDULING_REQUEST_TIMEOUT_MS} ms.`)
  }
  return timeoutMs
}

function parseResponseBody(value: string): unknown {
  if (!value) return {}
  try { return JSON.parse(value) as unknown } catch { return { text: value } }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function array(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
function optionalText(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function text(value: unknown): string { return optionalText(value) ?? '' }
