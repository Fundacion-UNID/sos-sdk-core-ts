import {
  buildDeviceCalibrationFlatGraph,
  buildDeviceOperatingAuthorizationFlatResource,
} from 'fhir-data-utils-ts'

export type EquipmentComplianceAction = 'record-calibration' | 'publish-operating-authorization'
export type EquipmentComplianceActorContext = Readonly<{
  actorReference: string
  departmentReference: string
}>
export type EquipmentComplianceDecision = EquipmentComplianceActorContext & Readonly<{
  action: EquipmentComplianceAction
}>

/**
 * Runtime-neutral authorization boundary for equipment compliance records.
 * Products decide whether the authenticated assignment in its department may perform the action;
 * the shared SDK never infers authority from a job-title string.
 */
export interface EquipmentComplianceAuthorizer {
  authorize(decision: EquipmentComplianceDecision): boolean
}

type CalibrationInput = Parameters<typeof buildDeviceCalibrationFlatGraph>[0]
type OperatingAuthorizationInput = Parameters<typeof buildDeviceOperatingAuthorizationFlatResource>[0]

/** Prepares standard claims-first records after an explicit product authorization decision. */
export class EquipmentComplianceManager {
  constructor(private readonly authorizer: EquipmentComplianceAuthorizer) {}

  prepareCalibration(input: CalibrationInput, actorContext: EquipmentComplianceActorContext) {
    if (!this.authorizer.authorize({ action: 'record-calibration', ...actorContext })) throw new Error('equipment_calibration_forbidden')
    return buildDeviceCalibrationFlatGraph(input)
  }

  prepareOperatingAuthorization(input: OperatingAuthorizationInput, actorContext: EquipmentComplianceActorContext) {
    if (!this.authorizer.authorize({ action: 'publish-operating-authorization', ...actorContext })) {
      throw new Error('equipment_operating_authorization_forbidden')
    }
    return buildDeviceOperatingAuthorizationFlatResource(input)
  }
}
