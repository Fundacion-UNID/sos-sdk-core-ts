# Public-health statistics

Human-health, emergency and animal-health clients share one Communication
contract with three statistical contribution paths. They do not create an
organization-private research dataset or a Digital Twin, and they do not
depend on issuing a SMART Health Card.

Animal-health products contribute animal statistics and human-health products
contribute human statistics. A mixed emergency product may contribute either;
the gateway derives that distinction from its trusted sector and authorized
subject context. A client does not send a subject kind, channel, chaincode,
statistic id or source hash.

## Professional certification

The professional client adds `registerResearchMetadata: true` to the attached
Bundle by calling `requestPublicHealthStatisticsRegistration()`. This value is
only publication intent. The gateway reopens the authenticated creator binding
and verifies the professional attestation, final status, attachment, canonical
code and trusted sector/jurisdiction before it registers anything.

## Later individual clinical report

`prepareIndividualPublicHealthStatisticsReportCommunication(...)` sends only
`reportKind: 'clinical-record'` plus the type and identifier of an existing
private clinical record. The gateway reads that record from the subject-scoped
vault and requires both an authenticated individual member and verified
professional provenance. Self-created or unverified records are rejected.

## Individual self-report

The same builder accepts `reportKind: 'self-report'` plus a canonical code,
section and date, for example a symptom reported directly by the individual.
No private clinical record, professional attestation or Digital Twin is
created by this path.

## Published shape

Each event receives a new random statistic identifier. Only that identifier,
human/animal kind, clinical section, canonical `system|code`, jurisdiction,
coarse date and optional coarse demographics may reach `artifact-sc` in the
manager-selected research channel. Source hashes, signatures and record ids;
subject, clinic, professional and organization identifiers; stable
pseudonyms, free text, attachments and authority assertions remain private.
Separate events cannot be correlated into a clinical history or Digital Twin.

## Planned separate Digital Twin flow

The separate design lets an individual choose a `ResearchStudy`, including one operated
by an organization other than the tenant holding the individual's data index.
Before creating the deidentified study projection, the gateway can verify the
origin and professional provenance of genuine clinical records. That
verification supplies the receiving study with an assurance made before
deidentification, because the projected twin intentionally cannot reveal the
source needed to repeat it. Direct individual reports may also be contributed
to that chosen study, but this consented study flow is not public statistics
and is not implemented by the builders in this document.
