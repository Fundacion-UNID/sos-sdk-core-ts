# Communication Bundle editor and reader

`sos-sdk-core-ts` owns the high-level SOS extension. It extends the existing
`gdc-common-utils-ts` `BundleEditor`,
`BundleReader` and `CommunicationAttachedBundleSession`; it does not create a
parallel editor lifecycle. `fhir-data-utils-ts` owns neutral FHIR types,
import/materialization, validation and flat-claim projections.

The invariant is always:

```text
outer Bundle[type=batch, entry[]]
└── Communication resource.meta.claims
    └── Communication.content-attachment-data[application/fhir+json]
        └── inner Bundle[type=document|batch|collection, data[]]
            ├── Appointment / Observation / ... flat claims
            └── DocumentReference[PDF | image | audio | text/calendar] flat claims
```

Use `document` only when the first resource is Composition. Use `batch` only
when every inner entry carries its executable request. Use `collection` for an
unordered group such as an Appointment and its calendar attachment.

## Author

```ts
import { AppointmentCommunicationBundleEditor } from 'sos-sdk-core-ts'

const outerBatch = new AppointmentCommunicationBundleEditor()
  .addAppointmentCommunication({
    communicationIdentifier,
    status: 'completed',
    subjectReference,
    senderReference: departmentOrganizationReference,
    recipientReferences,
    appointment,
    calendarDocument: {
      identifier: calendarDocumentIdentifier,
      contentType: 'text/calendar',
      dataBase64: calendarDataBase64,
      title: 'appointment.ics',
    },
  })
  .build()
```

`addAttachmentDocument(...)` deliberately has no direct-Communication mode.
The only Communication attachment is the serialized inner Bundle. At an
explicit FHIR R4/R5 wire boundary, `fhir-data-utils-ts` materializes these
canonical claims as native `Communication.payload.contentAttachment` and native
inner resources; the editor itself remains release-neutral and claims-first.

## Read

```ts
import { CommunicationBundleReader } from 'sos-sdk-core-ts'

const message = new CommunicationBundleReader(receivedOuterBatch)
  .openCommunication(0)

const appointment = message.getAppointments()[0]
const calendarDocument = message.getDocumentReferences()[0]
const sender = message.getSender()
const recipients = message.getRecipients()
```

The reader fails closed for a bare Appointment, a direct PDF/calendar/audio
payload, an invalid document order, a batch entry without a request, or an
outer resource that is not a batch Bundle.

## Boundaries

- The department Organization may be the FHIR Communication sender; the
  authenticated professional/device remains separate transport evidence.
- DIDComm, ML-KEM recipient encryption, WebRTC signaling, endpoint resolution,
  retry and persistence stay in runtime packages.
- GW persistence receives independently projected flat-claim resources. Direct
  claims CRUD is an internal storage boundary, not the participant wire format.
- The SOS editor subclasses the established GDC Bundle editor/reader and the
  attached-Bundle session. A future shared implementation can replace that
  base behind this SOS API without migrating each downstream consumer separately.
- `AppointmentCommunicationBundleEditor` and `FhirSchedulingClient` are named
  after their FHIR responsibilities. Product packages must not introduce
  `HumanAppointment`, `VeterinaryAppointment`, `HumanCommunication` or similar
  wrappers for standard resources.
