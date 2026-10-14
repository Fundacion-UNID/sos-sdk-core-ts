import { BundleEditor, BundleOperations, BundleTypes } from 'gdc-common-utils-ts/utils/bundle-editor'
import { BundleReader } from 'gdc-common-utils-ts/utils/bundle-reader'
import {
  CommunicationAttachedBundleSession,
  CommunicationClaimsContext,
} from 'gdc-common-utils-ts/utils/communication-attached-bundle-session'
import { decodeAttachedBundleFromCommunicationClaims } from 'gdc-common-utils-ts/utils/communication-didcomm-payload'
import { CommunicationClaim } from 'gdc-common-utils-ts/models/interoperable-claims/communication-claims'
import { AppointmentClaim, DocumentReferenceClaim, type FhirResource } from 'fhir-data-utils-ts'

export type CommunicationInnerBundleType = 'document' | 'batch' | 'collection'

export type AttachmentDocumentInput = Readonly<{
  identifier: string
  subjectReference: string
  contentType: string
  dataBase64?: string
  url?: string
  title?: string
  description?: string
  date?: string
  authorReferences?: readonly string[]
  eventReferences?: readonly string[]
}>

export type AppointmentCommunicationBundleInput = Readonly<{
  communicationIdentifier: string
  status: string
  category?: string | readonly string[]
  topic?: string
  text?: string
  subjectReference: string
  senderReference: string
  recipientReferences: readonly string[]
  sent?: string
  appointment: FhirResource & Readonly<{ resourceType: 'Appointment'; id: string }>
  calendarDocument?: Readonly<{
    identifier: string
    contentType: 'text/calendar'
    dataBase64?: string
    url?: string
    title?: string
  }>
}>

/**
 * SOS/Vet/UHC extension of the existing GDC BundleEditor.
 *
 * The inherited editor owns the canonical outer claims-first batch. Each
 * staged message is a CommunicationAttachedBundleSession, so the existing
 * attachment synchronization and Bundle lifecycle remain the source of truth.
 * FHIR data utilities are used only at import/materialization boundaries.
 */
export class CommunicationBundleEditor extends BundleEditor {
  readonly #messages: CommunicationMessageEditor[] = []
  #committed = false

  constructor() {
    super()
    this.setBundleOperation(BundleOperations.create)
      .setBundleType(BundleTypes.batch)
      .setAllowedResourceType('Communication')
  }

  newCommunication(): CommunicationMessageEditor {
    if (this.#committed) throw new TypeError('communication_bundle_already_built')
    const message = new CommunicationMessageEditor(this)
    this.#messages.push(message)
    return message
  }

  /** Builds the inherited claims-first outer batch after validating every attached Bundle. */
  override build(): ReturnType<BundleEditor['build']> {
    if (!this.#messages.length) throw new TypeError('communication_required')
    if (!this.#committed) {
      for (const message of this.#messages) this.#commitCommunication(message)
      this.#committed = true
    }
    return super.build()
  }

  #commitCommunication(message: CommunicationMessageEditor): void {
    message.validateForBuild()
    const claims = message.getCompleteCommunicationClaims()
    const identifier = requireText(claims[CommunicationClaim.Identifier], 'communication_identifier_required')
    const entry = this.newEntry(identifier)
    for (const [claim, value] of Object.entries(claims)) entry.setClaim(claim, value)
    entry.create()
  }
}

/**
 * Authors the standard FHIR Appointment delivery flow for every sector.
 *
 * Product SDKs use this class directly. They must not introduce human or
 * veterinary Appointment wrappers unless they add a genuinely sector-owned
 * rule that is absent from the FHIR and shared data contracts.
 */
export class AppointmentCommunicationBundleEditor extends CommunicationBundleEditor {
  addAppointmentCommunication(input: AppointmentCommunicationBundleInput): this {
    if (input.appointment.resourceType !== 'Appointment') throw new TypeError('fhir_appointment_required')
    const appointment = normalizeAppointmentIdentifier(input.appointment)
    const message = this.newCommunication()
      .setIdentifier(input.communicationIdentifier)
      .setStatus(input.status)
      .setSubject(input.subjectReference)
      .setSender(input.senderReference)
      .setRecipients(input.recipientReferences)
      .setAttachmentTitle('appointment-bundle.json')
      .setInnerBundleType('collection')
      .addResource(appointment)
    if (input.category) message.setCommunicationCategory(input.category)
    if (input.topic) message.setCommunicationTopic(input.topic)
    if (input.text) message.setCommunicationText(input.text)
    if (input.sent) message.setSent(input.sent)
    if (input.calendarDocument) {
      message.addAttachmentDocument({
        ...input.calendarDocument,
        subjectReference: input.subjectReference,
        eventReferences: [`Appointment/${input.appointment.id}`],
      })
    }
    message.doneCommunication()
    return this
  }
}

/** Authors one standard Appointment delivery without a product-specific wrapper. */
export function prepareAppointmentCommunicationBundle(
  input: AppointmentCommunicationBundleInput,
): Record<string, unknown> {
  return new AppointmentCommunicationBundleEditor()
    .addAppointmentCommunication(input)
    .build() as Record<string, unknown>
}

/** High-level message editor extending the established attached-Bundle session. */
export class CommunicationMessageEditor extends CommunicationAttachedBundleSession {
  readonly #parent: CommunicationBundleEditor
  #status?: string
  #sender?: string
  #recipients: string[] = []
  #sent?: string
  #attachmentTitle?: string

  constructor(parent: CommunicationBundleEditor) {
    super({
      communicationClaims: { '@context': CommunicationClaimsContext },
      initialBundle: { resourceType: 'Bundle', type: 'batch', data: [] },
    })
    this.#parent = parent
  }

  setIdentifier(value: string): this { this.setCommunicationIdentifier(value); return this }
  getIdentifier(): string | undefined { return optionalText(this.getCommunicationIdentifier()) }
  setStatus(value: string): this { this.#status = requireText(value, 'communication_status_required'); return this }
  getStatus(): string | undefined { return this.#status }
  setSubject(value: string): this { this.setCommunicationSubject(value); return this }
  getSubject(): string | undefined { return optionalText(this.getCommunicationSubject()) }
  setSender(value: string): this { this.#sender = requireText(value, 'communication_sender_required'); return this }
  getSender(): string | undefined { return this.#sender }
  setRecipients(values: readonly string[]): this { this.#recipients = uniqueReferences(values, 'communication_recipient_required'); return this }
  getRecipients(): readonly string[] { return Object.freeze([...this.#recipients]) }
  setSent(value: string): this { this.#sent = requireText(value, 'communication_sent_required'); return this }
  getSent(): string | undefined { return this.#sent }
  setAttachmentTitle(value: string): this { this.#attachmentTitle = requireText(value, 'communication_attachment_title_required'); return this }
  getAttachmentTitle(): string | undefined { return this.#attachmentTitle }
  setInnerBundleType(value: CommunicationInnerBundleType): this {
    if (!['document', 'batch', 'collection'].includes(value)) throw new TypeError('fhir_inner_bundle_type_invalid')
    this.setAttachedBundle({ ...this.getAttachedBundle(), type: value })
    return this
  }
  getInnerBundleType(): CommunicationInnerBundleType { return this.getAttachedBundle().type as CommunicationInnerBundleType }

  /** Adds one canonical claims-first resource to the existing attached-Bundle session. */
  addResource(resource: FhirResource, request?: Readonly<{ method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'GET'; url: string; ifMatch?: string }>): this {
    const claims = claimsFromResource(resource)
    const identifier = resourceIdentifier(resource, claims)
    this.upsertActiveEntry({
      resourceType: resource.resourceType,
      claims,
      fullUrl: `urn:uuid:${identifier}`,
      ...(request ? { request } : {}),
    })
    const activePosition = this.getActiveEntryPosition()
    if (activePosition === null) throw new TypeError('communication_bundle_active_entry_required')
    const bundle = this.getAttachedBundle()
    const activeResource = bundle.data[activePosition]?.resource
    if (!activeResource) throw new TypeError('communication_bundle_active_resource_required')
    activeResource.id = identifier
    this.setAttachedBundle(bundle).saveAndReleaseActiveEntry()
    return this
  }

  /** Adds a PDF, image, audio or calendar file as an inner DocumentReference. */
  addAttachmentDocument(input: AttachmentDocumentInput): this {
    const identifier = requireText(input.identifier, 'document_reference_identifier_required')
    const subjectReference = requireText(input.subjectReference, 'document_reference_subject_required')
    const contentType = requireText(input.contentType, 'document_reference_content_type_required')
    if (!input.dataBase64 && !input.url) throw new TypeError('document_reference_content_required')
    const claims = compactClaims({
      '@context': CommunicationClaimsContext,
      [DocumentReferenceClaim.Identifier]: identifier,
      [DocumentReferenceClaim.Subject]: subjectReference,
      [DocumentReferenceClaim.ContentType]: contentType,
      [DocumentReferenceClaim.ContentData]: input.dataBase64,
      [DocumentReferenceClaim.Location]: input.url,
      [DocumentReferenceClaim.Description]: input.description || input.title,
      [DocumentReferenceClaim.Date]: input.date,
      [DocumentReferenceClaim.Author]: input.authorReferences?.join(','),
      [DocumentReferenceClaim.EventReference]: input.eventReferences?.join(','),
    })
    this.upsertActiveDocumentReferenceEntry({ claims, fullUrl: `urn:uuid:${identifier}` }).saveAndReleaseActiveEntry()
    return this
  }

  doneCommunication(): CommunicationBundleEditor { return this.#parent }

  /** @internal */
  validateForBuild(): void {
    requireText(this.getCommunicationIdentifier(), 'communication_identifier_required')
    requireText(this.#status, 'communication_status_required')
    requireText(this.getCommunicationSubject(), 'communication_subject_required')
    validateAttachedBundle(this.getAttachedBundle())
  }

  /** @internal */
  getCompleteCommunicationClaims(): Record<string, unknown> {
    return compactClaims({
      ...this.getCommunicationClaims(),
      [CommunicationClaim.Status]: this.#status,
      [CommunicationClaim.Sender]: this.#sender,
      [CommunicationClaim.Recipient]: this.#recipients.length ? this.#recipients.join(',') : undefined,
      [CommunicationClaim.Sent]: this.#sent,
      [CommunicationClaim.ContentAttachmentTitle]: this.#attachmentTitle,
    })
  }
}

/** Read-only extension of the established BundleReader for an outer Communication batch. */
export class CommunicationBundleReader extends BundleReader {
  readonly #communicationEntries: readonly Record<string, unknown>[]

  constructor(outerBatch: Record<string, unknown>) {
    super(outerBatch)
    if (this.getBundleType() !== 'batch') throw new TypeError('fhir_batch_bundle_required')
    this.#communicationEntries = Object.freeze(this.getEntries().filter(entry =>
      (entry.resource as Record<string, unknown> | undefined)?.resourceType === 'Communication'))
    if (!this.#communicationEntries.length) throw new TypeError('fhir_communication_required')
  }

  getCommunicationCount(): number { return this.#communicationEntries.length }

  openCommunication(index: number): CommunicationMessageReader {
    if (!Number.isInteger(index) || index < 0 || index >= this.#communicationEntries.length) throw new RangeError('communication_index_invalid')
    return new CommunicationMessageReader(this.#communicationEntries[index])
  }
}

/** High-level getters over one claims-first Communication and its attached Bundle. */
export class CommunicationMessageReader extends BundleReader {
  readonly #resource: FhirResource
  readonly #claims: Record<string, unknown>

  constructor(entry: Record<string, unknown>) {
    const resource = entry.resource as FhirResource | undefined
    if (resource?.resourceType !== 'Communication') throw new TypeError('fhir_communication_required')
    const claims = claimsFromResource(resource)
    const attachedBundle = decodeAttachedBundleFromCommunicationClaims(claims)
    super(attachedBundle)
    validateAttachedBundle(attachedBundle)
    this.#resource = clone(resource)
    this.#claims = clone(claims)
  }

  getCommunication(): FhirResource { return clone(this.#resource) }
  getInnerBundle(): Record<string, unknown> { return clone(decodeAttachedBundleFromCommunicationClaims(this.#claims)) }
  getIdentifier(): string { return requireText(this.#claims[CommunicationClaim.Identifier], 'communication_identifier_required') }
  getStatus(): string | undefined { return optionalText(this.#claims[CommunicationClaim.Status]) }
  getSubject(): string | undefined { return optionalText(this.#claims[CommunicationClaim.Subject]) }
  getSender(): string | undefined { return optionalText(this.#claims[CommunicationClaim.Sender]) }
  getRecipients(): readonly string[] { return csv(this.#claims[CommunicationClaim.Recipient]) }
  getSent(): string | undefined { return optionalText(this.#claims[CommunicationClaim.Sent]) }
  getAttachmentTitle(): string | undefined { return optionalText(this.#claims[CommunicationClaim.ContentAttachmentTitle]) }
  getInnerBundleType(): string | undefined { return this.getBundleType() }
  getResourcesByType<TResource extends FhirResource = FhirResource>(resourceType: string): readonly TResource[] {
    return Object.freeze(this.getEntries().flatMap(entry => {
      const resource = entry.resource as TResource | undefined
      return resource?.resourceType === resourceType ? [clone(resource)] : []
    }))
  }
  getAppointments(): readonly FhirResource[] { return this.getResourcesByType('Appointment') }
  getDocumentReferences(): readonly FhirResource[] { return this.getResourcesByType('DocumentReference') }
}

function claimsFromResource(resource: FhirResource): Record<string, unknown> {
  const meta = resource.meta
  const claims = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>).claims : undefined
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new TypeError('claims_first_resource_required')
  return clone(claims as Record<string, unknown>)
}

function resourceIdentifier(resource: FhirResource, claims: Record<string, unknown>): string {
  return requireText(resource.id || claims[`${resource.resourceType}.identifier`], 'resource_identifier_required')
}

function normalizeAppointmentIdentifier(
  appointment: AppointmentCommunicationBundleInput['appointment'],
): AppointmentCommunicationBundleInput['appointment'] {
  const meta = appointment.meta as Record<string, unknown> | undefined
  const claims = meta?.claims && typeof meta.claims === 'object' && !Array.isArray(meta.claims)
    ? meta.claims as Record<string, unknown>
    : undefined
  if (!claims) throw new TypeError('claims_first_resource_required')
  if (claims[AppointmentClaim.Identifier] !== undefined) return appointment
  return {
    ...appointment,
    meta: {
      ...meta,
      claims: { ...claims, [AppointmentClaim.Identifier]: [appointment.id] },
    },
  }
}

function validateAttachedBundle(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('fhir_bundle_required')
  const bundle = value as Record<string, unknown>
  if (bundle.resourceType !== 'Bundle') throw new TypeError('fhir_bundle_required')
  const type = optionalText(bundle.type)
  if (!type || !['document', 'batch', 'collection'].includes(type)) throw new TypeError('fhir_inner_bundle_type_invalid')
  const entries = Array.isArray(bundle.data) ? bundle.data as readonly Record<string, unknown>[] : []
  if (type === 'document' && (entries[0]?.resource as FhirResource | undefined)?.resourceType !== 'Composition') throw new TypeError('fhir_document_composition_first_required')
  if (type === 'batch' && entries.some(entry => {
    const request = entry.request as Record<string, unknown> | undefined
    return !optionalText(request?.method) || !optionalText(request?.url)
  })) throw new TypeError('fhir_batch_request_required')
}

function csv(value: unknown): readonly string[] {
  if (Array.isArray(value)) return Object.freeze(value.map(String).map(item => item.trim()).filter(Boolean))
  const normalized = optionalText(value)
  return Object.freeze(normalized ? normalized.split(',').map(item => item.trim()).filter(Boolean) : [])
}

function uniqueReferences(values: readonly string[], error: string): string[] { return [...new Set(values.map(value => requireText(value, error)))] }
function compactClaims(input: Readonly<Record<string, unknown>>): Record<string, unknown> { return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== '')) }
function optionalText(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function requireText(value: unknown, error: string): string { const normalized = optionalText(value); if (!normalized) throw new TypeError(error); return normalized }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
