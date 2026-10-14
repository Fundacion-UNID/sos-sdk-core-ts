# Equipment compliance orchestration

`EquipmentComplianceManager` is the shared SOS application boundary for equipment records.

- `prepareCalibration(...)` creates a claims-first FHIR R5 graph: a completed `Procedure`, the resulting `DeviceMetric` calibration state, and an optional hashed `DocumentReference`.
- `prepareOperatingAuthorization(...)` creates a separate claims-first `RegulatedAuthorization` issued by the competent authority.
- The caller supplies an authorization adapter. The SDK does not infer permission from occupation labels; products evaluate the authenticated organization, assignment, group and jurisdictional policy.
- These methods prepare records only. A BFF sends them through the high-level SDK to the GW; native FHIR is materialized only at an explicit export boundary.

```ts
const equipmentCompliance = new EquipmentComplianceManager({
  authorize: action => authorizationPolicy.allows(authenticatedAssignment, action),
})

const calibrationRecords = equipmentCompliance.prepareCalibration(calibrationInput, {
  actorReference: authenticatedAssignment.practitionerRoleReference,
  departmentReference: authenticatedAssignment.departmentReference,
})
```

A `Device` is an optional `Schedule.actor` only when the service capacity really
depends on that specific machine, such as an apheresis station. Most schedules
need only the `HealthcareService` and independently reservable `Location` or
professional capacity. Device failure is an equipment event/state change; the
booking workflow separately marks only the affected future slots unavailable
and reconciles their appointments. It must not cancel unrelated schedules.

## Deferred blood-bank product work

The following is backlog for downstream applications when an organization has
a blood-bank or blood-donation department. It is not part of this SDK release:

- product policy for trained nurses and Canadian `Donor Care Associate`
  assignments to record governed calibration checks;
- department panels for calibrating apheresis machines and donation scales;
- collection-sample labels and blood/plasma product labels using the applicable
  ISBT 128 data structures and official ICCBBA tables;
- separate `Specimen` and `BiologicallyDerivedProduct` projections, scanning,
  printing, chain-of-identity and audit tests.

`Donor Care Associate` is retained as the employer/assignment role and is not
silently mapped to nurse or nursing assistant. Authorization depends on the
verified assignment, training and department policy.
