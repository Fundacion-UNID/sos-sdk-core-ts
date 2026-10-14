# Care, Emergency and Alert Orchestration

This package owns runtime-neutral SOS authorization and orchestration. FHIR flat-claim builders belong to
`fhir-data-utils-ts`; deterministic records belong to `sos-data-utils-ts`;
transport and persistence belong to BFF/channel and Node services; animal and
human policy stays in downstream applications.

## 1. Care continuity and protected contact

1. Appointment `fulfilled` -> Encounter is an idempotent transition.
2. The Encounter preserves the selected subject, Appointment, service-provider
   Organization, start time and current Location.
3. Admission, diagnostics, intensive care, ward and discharge are represented
   by Encounter/location continuity. Controllers see only what current Consent
   and actor/subject authorization permit.
4. Accepted service handover reconciles the future professional audience from
   exact HealthcareService Group assignments. Temporary movement retains the
   source Groups; definitive movement removes them. Historical Communication
   recipients are immutable.
5. An authorized practitioner may start voice/video contact or send an
   encrypted message to the controller or permitted related recipients before
   publishing stressful results.
6. Voice/video signaling carries no clinical Bundle. A preliminary clinical
   Bundle may be delivered by encrypted message only with `updateIndex=false`.
   A call or preliminary message must not publish, attest or update the subject
   index. Final clinical publication is a separate workflow.
7. A missed call may create an encrypted text/audio message in the same thread;
   its recipients and thread authorization are revalidated by the service.

The orchestrator returns a plan. The persistence owner must enforce the
idempotency key and must not treat a returned plan as authorization evidence.

## 2. Resilient emergency assistance

When normal telephone service is unavailable, an authenticated controller or
authorized requester submits an emergency request to a HealthcareService or
its owning Organization. The BFF resolves the official target and creates two
independent resources:

- a compact-coded ServiceRequest containing the care request, requester,
  subject and performer target;
- a Task containing durable intake/triage ownership and linking back through
  `Task.focus`. Its initial owner is the professional Group assigned to the
  target department/service.

The emergency console can claim and update the Task, then open an authorized
voice/video callback or encrypted thread. Raw phone/email destinations,
WebRTC SDP/ICE/TURN state and encryption keys never enter either FHIR resource.
The request grants no read access by itself; subject access still requires the
current emergency or ordinary authorization contract.

The high-level API keeps reads and writes explicit:

```ts
const triageTask = readEmergencyTriageTask(claimsFirstTaskEntry)
const acceptedTaskEntry = transitionEmergencyTriageTask({
  taskEntry: claimsFirstTaskEntry,
  action: 'acknowledge',
  responderReference: authenticatedPractitionerRoleReference,
  occurredAt: serverTime,
})
const callback = prepareEmergencyResponderCallback({
  taskEntry: acceptedTaskEntry,
  responderReference: authenticatedPractitionerRoleReference,
  media: 'audio',
})
```

`transitionEmergencyTriageTask(...)` changes only the Task. It never rewrites
the ServiceRequest. Acknowledgement assigns the authenticated responder;
escalation requires a server-resolved owner and returns the Task to
`requested`. Callback authorization requires the accepted/in-progress Task
owner and returns only stable references plus the protected thread
correlation. The product server must still resolve the current encrypted
recipient endpoints and signaling transport.

The department Organization is the FHIR `Communication.sender`. Once accepted,
`Task.owner` is the acting `PractitionerRole`. The PractitionerRole is the authenticated transport actor
and call initiator, not the FHIR sender. The
Group remains the reply queue retained by the protected thread, never the
sender. The legal parent Organization remains the author of any later clinical
document, and its professional attester remains separate from every transport
coordinate.

## 3. Governed alerts

The common flow supports both `blood-donation` and `public-risk` campaigns.
The server evaluates a governed definitional Group, freezes an enumerated Group
snapshot and binds a CommunicationRequest to that snapshot. Subscription wakes
evaluation; it is not Consent, cohort-query authority or send authority.

Blood-donation campaigns require compact `system|code` blood-group filters and
the minimum elapsed days since the last donation. Public-risk campaigns require
server-authorized FHIR `resourceType`, `searchParameter` and `value` criteria;
clients cannot submit executable queries.

Immediately before each delivery, the service must verify snapshot membership,
current eligibility, current exclusions, Consent and channel authorization.
Only then may it create/send the Communication and record the audit. Group and
CommunicationRequest resources never replace those per-recipient checks.

## Release proof

Merge validated shared dependency sources to `main`, create immutable
unpublished tarballs from those commits, and install them temporarily with
`--no-save`. Prove the affected real local SOS channel (portal, phone service,
chatbot or another supported channel) -> BFF/channel service -> high-level SDK
-> configured gateway journey without skips. Merge the validated consumer source to
`main`, publish exact packages bottom-up, pin registry versions, repeat affected
local gates, and only then promote to staging. Never commit local tarballs or
local dependency references.
