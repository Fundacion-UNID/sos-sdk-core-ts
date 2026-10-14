# FHIR scheduling interoperability

`sos-sdk-core-ts/fhir-scheduling` is the product-neutral SOS scheduling
boundary. It discovers the remote
`CapabilityStatement` before using `Schedule`, `Slot` or `Appointment` and
fails closed when the provider does not advertise the required interaction.

Portal, telephone, chatbot and other channel adapters call the same client.
They must not introduce human- or animal-prefixed Appointment types. Sector
policy decides who may search or write; the FHIR resource contract stays the
same.

An appointment message is authored with
`AppointmentCommunicationBundleEditor`. The outer transport is a Bundle of
FHIR `Communication` resources. Each Communication carries one inner document,
batch or collection Bundle; an optional calendar file is a `DocumentReference`
inside that inner Bundle, never a bare `text/calendar` Communication payload.

`analyzeBundleChangesResponse(changesBundle, responseBundle)` correlates a GW
response by stable identifiers. Missing, malformed or ambiguous responses stay
pending until the caller performs an authoritative resource search; array
position is never treated as identity.

Executable contracts:

- `tests/fhir-scheduling.test.mjs`
- `tests/communication-bundle.test.mjs`
- `tests/bundle-changes-response.test.mjs`
