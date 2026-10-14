// Copyright 2026 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.
import {
  OrganizationWorkflowGroupKinds,
  buildOrganizationControllerWorkflowAssignment,
  buildOrganizationSubjectRegisterCapability,
} from 'sos-data-utils-ts/organization-workflow-access'
import {
  ORGANIZATION_SUBJECT_GROUP_ACCESS_TEST_DATA,
  OrganizationSubjectGroupCapabilities,
  buildOrganizationGroupMemberManageCapability,
  buildOrganizationSubjectGroupGraph,
  buildOrganizationSubjectGroupPermissionBundle,
  readOrganizationSubjectGroupPermissionBundle,
} from 'sos-data-utils-ts/organization-subject-group-access'

type OrganizationController = Readonly<{
  authorityKind: string
  organizationReference: string
  accountId: string
}>

type OrganizationMember = Readonly<{
  accountId: string
  practitionerRoleReference: string
  role: string
}>

/**
 * Prepares the ordered, persistence-neutral municipality/farm/zoo subject
 * management plan. The BFF remains responsible for profile resolution,
 * optimistic versions, persistence and authoritative readback.
 */
export function orchestrateOrganizationSubjectGroupManagement(input: Readonly<{
  controller: OrganizationController
  member: OrganizationMember
  managerGroupReference: string
  subjectGroupReference: string
  subjectType: 'animal' | 'person'
  subjectGroupName: string
  memberReferences: readonly string[]
  consentId: string
  assignedAt: string
}>) {
  const employeeAssignment = buildOrganizationControllerWorkflowAssignment({
    networkKind: 'resolved-controller',
    controller: input.controller,
    member: input.member,
    groupKind: OrganizationWorkflowGroupKinds.SubjectRegistration,
    groupReference: input.managerGroupReference,
    capabilities: [
      buildOrganizationSubjectRegisterCapability(input.controller.organizationReference),
    ],
    assignedAt: input.assignedAt,
  })
  const subjectGraph = buildOrganizationSubjectGroupGraph({
    groupReference: input.subjectGroupReference,
    managingOrganizationReference: input.controller.organizationReference,
    subjectType: input.subjectType,
    name: input.subjectGroupName,
    memberReferences: input.memberReferences,
  })
  const permissionBundle = buildOrganizationSubjectGroupPermissionBundle({
    consentId: input.consentId,
    subjectGroupReference: input.subjectGroupReference,
    actorGroupReference: input.managerGroupReference,
    grantorOrganizationReference: input.controller.organizationReference,
    purpose: ORGANIZATION_SUBJECT_GROUP_ACCESS_TEST_DATA.operationsPurpose,
    capabilities: [buildOrganizationGroupMemberManageCapability(
      input.subjectGroupReference,
      input.controller.organizationReference,
    )],
    date: input.assignedAt,
  })
  return Object.freeze({
    employeeAssignment,
    subjectGroup: subjectGraph.group,
    subjectMemberships: subjectGraph.memberships,
    groupPermissionBundle: permissionBundle,
    groupPermission: readOrganizationSubjectGroupPermissionBundle(permissionBundle),
  })
}

/**
 * Prepares a read-only IPS immunization projection for one passenger-transport
 * actor Group. Emergency/break-glass remains a separate SOS orchestration.
 */
export function orchestratePassengerTransportSubjectGroupAccess(input: Readonly<{
  controllerOrganizationReference: string
  subjectGroupReference: string
  subjectType: 'animal' | 'person'
  subjectGroupName: string
  memberReferences: readonly string[]
  actorGroupReference: string
  consentId: string
  authorizedAt: string
}>) {
  const subjectGraph = buildOrganizationSubjectGroupGraph({
    groupReference: input.subjectGroupReference,
    managingOrganizationReference: input.controllerOrganizationReference,
    subjectType: input.subjectType,
    name: input.subjectGroupName,
    memberReferences: input.memberReferences,
  })
  const permissionBundle = buildOrganizationSubjectGroupPermissionBundle({
    consentId: input.consentId,
    subjectGroupReference: input.subjectGroupReference,
    actorGroupReference: input.actorGroupReference,
    grantorOrganizationReference: input.controllerOrganizationReference,
    purpose: ORGANIZATION_SUBJECT_GROUP_ACCESS_TEST_DATA.patientAdministrationPurpose,
    capabilities: [OrganizationSubjectGroupCapabilities.ReadImmunizationSection],
    date: input.authorizedAt,
  })
  return Object.freeze({
    subjectGroup: subjectGraph.group,
    subjectMemberships: subjectGraph.memberships,
    groupPermissionBundle: permissionBundle,
    groupPermission: readOrganizationSubjectGroupPermissionBundle(permissionBundle),
  })
}
