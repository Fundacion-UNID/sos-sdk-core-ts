// Copyright 2026 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.
// Flow contract: 1) a resolved organization controller assigns one exact professional profile to subject management; 2) the SDK builds separate subject Group, membership and Consent operations; 3) passenger transport receives read-only immunization access. Authorization invariant: no Group membership, sector, vehicle Location or shared login grants authority alone. Persistence invariant: this runtime-neutral SDK only returns ordered claims-first plans and never writes or imports a vet-* package.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { HealthcareActorRoles } from 'gdc-common-utils-ts/constants/healthcare'
import {
  ORGANIZATION_SUBJECT_GROUP_ACCESS_TEST_DATA,
  OrganizationSubjectGroupCapabilities,
  buildOrganizationGroupMemberManageCapability,
} from 'sos-data-utils-ts/organization-subject-group-access'
import { REPOSITORY_SAFE_EXAMPLES } from 'sos-data-utils-ts/repository-privacy'
import {
  orchestrateOrganizationSubjectGroupManagement,
  orchestratePassengerTransportSubjectGroupAccess,
} from '../dist/organization-subject-group-orchestration.js'

const organizationReference = `Organization/${REPOSITORY_SAFE_EXAMPLES.resourceUuid}`
const practitionerRoleReference = `PractitionerRole/${REPOSITORY_SAFE_EXAMPLES.resourceUuid}`
const animalReference = `Patient/${REPOSITORY_SAFE_EXAMPLES.resourceUuid}`
const subjectGroupReference = `Group/subjects-${REPOSITORY_SAFE_EXAMPLES.resourceUuid}`
const actorGroupReference = `Group/actors-${REPOSITORY_SAFE_EXAMPLES.resourceUuid}`
const assignedAt = REPOSITORY_SAFE_EXAMPLES.organizationScopedResources.slotStart

const controller = Object.freeze({
  authorityKind: 'organization-controller',
  organizationReference,
  accountId: REPOSITORY_SAFE_EXAMPLES.resourceUuid,
})
const member = Object.freeze({
  accountId: REPOSITORY_SAFE_EXAMPLES.resourceUuid,
  practitionerRoleReference,
  role: HealthcareActorRoles.Veterinarian,
})

test('prepares the municipal subject registration and Group membership plan without clinical read', () => {
  const plan = orchestrateOrganizationSubjectGroupManagement({
    controller,
    member,
    managerGroupReference: actorGroupReference,
    subjectGroupReference,
    subjectType: ORGANIZATION_SUBJECT_GROUP_ACCESS_TEST_DATA.animalGroupType,
    subjectGroupName: REPOSITORY_SAFE_EXAMPLES.organizationLegalName,
    memberReferences: [animalReference],
    consentId: REPOSITORY_SAFE_EXAMPLES.resourceUuid,
    assignedAt,
  })

  assert.equal(plan.employeeAssignment.organizationReference, organizationReference)
  assert.equal(plan.subjectGroup.id, subjectGroupReference.slice('Group/'.length))
  assert.equal(plan.subjectMemberships[0].meta.claims['Group.member'][0], animalReference)
  assert.deepEqual(plan.groupPermission.capabilities, [buildOrganizationGroupMemberManageCapability(
    subjectGroupReference,
    organizationReference,
  )])
  assert.equal(plan.employeeAssignment.capabilities.some(capability => capability.endsWith('.r')), false)
})

test('prepares only read-only immunization access for the passenger-transport actor Group', () => {
  const plan = orchestratePassengerTransportSubjectGroupAccess({
    controllerOrganizationReference: organizationReference,
    subjectGroupReference,
    subjectType: ORGANIZATION_SUBJECT_GROUP_ACCESS_TEST_DATA.animalGroupType,
    subjectGroupName: REPOSITORY_SAFE_EXAMPLES.organizationLegalName,
    memberReferences: [animalReference],
    actorGroupReference,
    consentId: REPOSITORY_SAFE_EXAMPLES.resourceUuid,
    authorizedAt: assignedAt,
  })

  assert.deepEqual(plan.groupPermission.capabilities, [OrganizationSubjectGroupCapabilities.ReadImmunizationSection])
  assert.equal(plan.groupPermission.capabilities.some(capability => capability.includes('Group.u')), false)
})

test('keeps the shared SDK dependency graph acyclic', () => {
  const packageManifest = JSON.parse(readFileSync('package.json', 'utf8'))
  const source = readFileSync('src/organization-subject-group-orchestration.ts', 'utf8')

  assert.equal(Object.keys(packageManifest.dependencies).some(name => name.startsWith('vet-')), false)
  assert.equal(/from ['"]vet-/u.test(source), false)
})
