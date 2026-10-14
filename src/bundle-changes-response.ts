// Copyright 2026 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.

import type { BundleEntry, BundleJsonApi } from 'gdc-common-utils-ts/models/bundle';

export const BundleChangeResponseStates = Object.freeze({
  Successful: 'successful',
  Failed: 'failed',
  Pending: 'pending',
} as const);

export type BundleChangeResponseState =
  typeof BundleChangeResponseStates[keyof typeof BundleChangeResponseStates];

export type BundleChangeResponseItem = Readonly<{
  identifier: string;
  changeEntryIndex: number;
  responseEntryIndex?: number;
  state: BundleChangeResponseState;
  responseStatus?: string;
  diagnostics: readonly string[];
}>;

export type BundleChangesResponseAnalysis = Readonly<{
  entries: readonly BundleChangeResponseItem[];
  successfulIdentifiers: readonly string[];
  failedIdentifiers: readonly string[];
  pendingIdentifiers: readonly string[];
  diagnostics: readonly string[];
}>;

type IndexedResponseEntry = Readonly<{
  entry: BundleEntry;
  index: number;
  identifiers: readonly string[];
}>;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function appendIdentifier(target: string[], value: unknown): void {
  const identifier = asNonEmptyString(value);
  if (identifier && !target.includes(identifier)) target.push(identifier);
}

function appendClaimIdentifiers(target: string[], claims: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(claims)) {
    if (name === 'identifier' || name.endsWith('.identifier') || name.endsWith('.identifier.value')) {
      appendIdentifier(target, value);
    }
  }
}

/** Reads every stable identifier carried by one Bundle entry in preference order. */
export function readBundleEntryCorrelationIdentifiers(entry: BundleEntry): readonly string[] {
  const identifiers: string[] = [];
  const resource = asRecord(entry.resource);
  const resourceMeta = asRecord(resource.meta);
  const entryMeta = asRecord(entry.meta);

  appendIdentifier(identifiers, entry.fullUrl);
  appendIdentifier(identifiers, resource.id);
  appendIdentifier(identifiers, entry.id);
  appendClaimIdentifiers(identifiers, asRecord(resourceMeta.claims));
  appendClaimIdentifiers(identifiers, asRecord(entryMeta.claims));
  return identifiers;
}

function readBundleEntryResponseOutcome(entry: BundleEntry): Readonly<{
  status?: string;
  severities: readonly string[];
  diagnostics: readonly string[];
}> {
  const response = asRecord(entry.response);
  const outcome = asRecord(response.outcome);
  const issues = Array.isArray(outcome.issue) ? outcome.issue.map(asRecord) : [];
  const severities: string[] = [];
  const diagnostics: string[] = [];

  for (const issue of issues) {
    const severity = asNonEmptyString(issue.severity)?.toLowerCase();
    if (severity) severities.push(severity);
    const diagnostic = asNonEmptyString(issue.diagnostics)
      ?? asNonEmptyString(asRecord(issue.details).text);
    if (diagnostic) diagnostics.push(diagnostic);
  }

  const status = asNonEmptyString(response.status);
  return { ...(status ? { status } : {}), severities, diagnostics };
}

function isSuccessfulStatus(status: string | undefined): boolean {
  return !!status && /^2\d\d(?:\s|$)/.test(status);
}

/**
 * Correlates the submitted changes Bundle with the GW Bundle response.
 *
 * Correlation uses stable identifiers only, never array position. A missing,
 * malformed or ambiguous response remains pending until the caller performs
 * the resource-specific authoritative search.
 */
export function analyzeBundleChangesResponse(
  changesBundle: BundleJsonApi<BundleEntry>,
  responseBundle: BundleJsonApi<BundleEntry>,
): BundleChangesResponseAnalysis {
  const responseEntries: IndexedResponseEntry[] = responseBundle.data.map((entry, index) => ({
    entry,
    index,
    identifiers: readBundleEntryCorrelationIdentifiers(entry),
  }));
  const seenChangeIdentifiers = new Set<string>();
  const claimedResponseIndexes = new Set<number>();
  const diagnostics: string[] = [];
  const entries: BundleChangeResponseItem[] = [];

  const changes = changesBundle.data.map((changeEntry, changeEntryIndex) => {
    const identifiers = readBundleEntryCorrelationIdentifiers(changeEntry);
    const identifier = identifiers[0];
    if (!identifier) {
      throw new Error(`Changes Bundle entry ${changeEntryIndex} requires a stable fullUrl, resource.id, entry.id or identifier claim.`);
    }
    if (seenChangeIdentifiers.has(identifier)) {
      throw new Error(`Changes Bundle contains duplicate primary identifier '${identifier}'.`);
    }
    seenChangeIdentifiers.add(identifier);
    return {
      index: changeEntryIndex,
      identifier,
      matchingResponses: responseEntries.filter((candidate) =>
        candidate.identifiers.some((candidateIdentifier) => identifiers.includes(candidateIdentifier))),
    };
  });

  const responseMatchCounts = new Map<number, number>();
  changes.forEach(({ matchingResponses }) => matchingResponses.forEach(({ index }) => {
    responseMatchCounts.set(index, (responseMatchCounts.get(index) ?? 0) + 1);
  }));

  changes.forEach(({ identifier, index: changeEntryIndex, matchingResponses }) => {
    if (matchingResponses.length !== 1) {
      const message = matchingResponses.length === 0
        ? `No response entry carries a stable identifier for change '${identifier}'.`
        : `More than one response entry matches change '${identifier}'.`;
      diagnostics.push(message);
      entries.push({ identifier, changeEntryIndex, state: BundleChangeResponseStates.Pending, diagnostics: [message] });
      return;
    }

    const match = matchingResponses[0];
    if ((responseMatchCounts.get(match.index) ?? 0) > 1) {
      const message = `Response entry ${match.index} ambiguously matches more than one submitted change.`;
      diagnostics.push(message);
      entries.push({
        identifier,
        changeEntryIndex,
        responseEntryIndex: match.index,
        state: BundleChangeResponseStates.Pending,
        diagnostics: [message],
      });
      return;
    }
    claimedResponseIndexes.add(match.index);

    const outcome = readBundleEntryResponseOutcome(match.entry);
    const hasError = outcome.severities.some((severity) => severity === 'fatal' || severity === 'error');
    const state = !outcome.status
      ? BundleChangeResponseStates.Pending
      : isSuccessfulStatus(outcome.status) && !hasError
        ? BundleChangeResponseStates.Successful
        : BundleChangeResponseStates.Failed;
    const itemDiagnostics = [...outcome.diagnostics];
    if (!outcome.status) itemDiagnostics.push(`Response entry ${match.index} has no status.`);
    entries.push({
      identifier,
      changeEntryIndex,
      responseEntryIndex: match.index,
      state,
      ...(outcome.status ? { responseStatus: outcome.status } : {}),
      diagnostics: itemDiagnostics,
    });
  });

  responseEntries.forEach(({ index }) => {
    if (!claimedResponseIndexes.has(index)) {
      diagnostics.push(`Response entry ${index} does not correlate with one submitted change.`);
    }
  });

  return {
    entries,
    successfulIdentifiers: entries.filter(({ state }) => state === BundleChangeResponseStates.Successful).map(({ identifier }) => identifier),
    failedIdentifiers: entries.filter(({ state }) => state === BundleChangeResponseStates.Failed).map(({ identifier }) => identifier),
    pendingIdentifiers: entries.filter(({ state }) => state === BundleChangeResponseStates.Pending).map(({ identifier }) => identifier),
    diagnostics,
  };
}
