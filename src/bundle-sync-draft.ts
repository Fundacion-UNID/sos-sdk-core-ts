// Copyright 2026 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.

import type { BundleEntry, BundleJsonApi } from 'gdc-common-utils-ts/models/bundle'
import { analyzeBundleChangesResponse } from './bundle-changes-response.js'

export const BundleSyncKinds = Object.freeze({
  ClinicalDocument: 'clinical-document',
  EncounterTransfer: 'encounter-transfer',
  Consent: 'consent',
  EmergencyContact: 'emergency-contact',
} as const)

export type BundleSyncKind = typeof BundleSyncKinds[keyof typeof BundleSyncKinds]

export const BundleSyncStates = Object.freeze({
  Pending: 'pending',
  Submitting: 'submitting',
  Retryable: 'retryable',
  Reconciling: 'reconciling',
  Confirmed: 'confirmed',
  Rejected: 'rejected',
} as const)

export type BundleSyncState = typeof BundleSyncStates[keyof typeof BundleSyncStates]
export type BundleSyncPayload = BundleJsonApi<BundleEntry>

export type BundleSyncDraft = Readonly<{
  id: string
  kind: BundleSyncKind
  subjectReference: string
  state: BundleSyncState
  changesBundle: BundleSyncPayload
  lastConfirmedBundle: BundleSyncPayload
  optimisticBundle?: BundleSyncPayload
  visibleBundle: BundleSyncPayload
  pendingIdentifiers: readonly string[]
  diagnostics: readonly string[]
  createdAt: string
  updatedAt: string
}>

export type CreateBundleSyncDraftInput = Readonly<{
  id: string
  kind: BundleSyncKind
  subjectReference: string
  changesBundle: BundleSyncPayload
  lastConfirmedBundle: BundleSyncPayload
  optimisticBundle: BundleSyncPayload
  createdAt: string
}>

/**
 * Creates the portable, serializable state shown while the BFF owns delivery.
 * The optimistic Bundle remains visibly marked by `state`; it is never proof
 * of provider persistence.
 */
export function createBundleSyncDraft(input: CreateBundleSyncDraftInput): BundleSyncDraft {
  requireText(input.id, 'bundle_sync_id_required')
  requireText(input.subjectReference, 'bundle_sync_subject_required')
  requireText(input.createdAt, 'bundle_sync_created_at_required')
  if (!Object.values(BundleSyncKinds).includes(input.kind)) throw new TypeError('bundle_sync_kind_invalid')
  return Object.freeze({
    ...input,
    state: BundleSyncStates.Pending,
    visibleBundle: input.optimisticBundle,
    pendingIdentifiers: Object.freeze([]),
    diagnostics: Object.freeze([]),
    updatedAt: input.createdAt,
  })
}

/** Marks a durable draft as actively submitted without changing its preview. */
export function submitBundleSyncDraft(draft: BundleSyncDraft, updatedAt: string): BundleSyncDraft {
  if (![BundleSyncStates.Pending, BundleSyncStates.Retryable].includes(draft.state as never)) {
    throw new TypeError('bundle_sync_not_submittable')
  }
  return Object.freeze({ ...draft, state: BundleSyncStates.Submitting, updatedAt })
}

/** Retains the exact optimistic draft after a transient transport failure. */
export function markBundleSyncRetryable(
  draft: BundleSyncDraft,
  diagnostics: readonly string[],
  updatedAt: string,
): BundleSyncDraft {
  if ([BundleSyncStates.Confirmed, BundleSyncStates.Rejected].includes(draft.state as never)) {
    throw new TypeError('bundle_sync_retry_not_allowed')
  }
  return Object.freeze({
    ...draft,
    state: BundleSyncStates.Retryable,
    diagnostics: Object.freeze([...diagnostics]),
    updatedAt,
  })
}

/**
 * Interprets the correlated remote Bundle response.
 *
 * Missing or ambiguous results keep the optimistic Bundle as a retryable
 * draft. A definite rejection removes it. Successful submission moves to
 * reconciling and still requires an authoritative provider readback.
 */
export function reconcileBundleSyncSubmission(
  draft: BundleSyncDraft,
  responseBundle: BundleSyncPayload,
  updatedAt: string,
): BundleSyncDraft {
  if (![BundleSyncStates.Pending, BundleSyncStates.Submitting, BundleSyncStates.Retryable].includes(draft.state as never)) {
    throw new TypeError('bundle_sync_response_not_expected')
  }
  const analysis = analyzeBundleChangesResponse(draft.changesBundle, responseBundle)
  if (analysis.failedIdentifiers.length) {
    return Object.freeze({
      ...draft,
      state: BundleSyncStates.Rejected,
      optimisticBundle: undefined,
      visibleBundle: draft.lastConfirmedBundle,
      pendingIdentifiers: Object.freeze([]),
      diagnostics: Object.freeze([...analysis.diagnostics, ...analysis.entries.flatMap(({ diagnostics }) => diagnostics)]),
      updatedAt,
    })
  }
  if (analysis.pendingIdentifiers.length) {
    return Object.freeze({
      ...draft,
      state: BundleSyncStates.Retryable,
      pendingIdentifiers: Object.freeze([...analysis.pendingIdentifiers]),
      diagnostics: Object.freeze([...analysis.diagnostics]),
      updatedAt,
    })
  }
  return Object.freeze({
    ...draft,
    state: BundleSyncStates.Reconciling,
    pendingIdentifiers: Object.freeze([]),
    diagnostics: Object.freeze([...analysis.diagnostics]),
    updatedAt,
  })
}

/** Replaces the preview only after exact provider readback succeeds. */
export function confirmBundleSyncDraft(
  draft: BundleSyncDraft,
  authoritativeBundle: BundleSyncPayload,
  updatedAt: string,
): BundleSyncDraft {
  if (draft.state !== BundleSyncStates.Reconciling) throw new TypeError('bundle_sync_readback_not_expected')
  return Object.freeze({
    ...draft,
    state: BundleSyncStates.Confirmed,
    lastConfirmedBundle: authoritativeBundle,
    optimisticBundle: undefined,
    visibleBundle: authoritativeBundle,
    pendingIdentifiers: Object.freeze([]),
    diagnostics: Object.freeze([]),
    updatedAt,
  })
}

function requireText(value: string, issue: string): string {
  if (!value.trim()) throw new TypeError(issue)
  return value
}
