import {
  createSubjectCardProviderDescriptor,
  type SubjectCardProviderDescriptor,
  type SubjectCardProviderOperation,
} from 'sos-data-utils-ts/subject-card-directory'

export type SubjectCardProviderDiscoveryFilter = Readonly<{
  subjectKind: 'human' | 'animal'
  operation: SubjectCardProviderOperation
}>

/** Filters a verified catalog without turning its order into write authority. */
export function discoverSubjectCardProviders(
  catalog: readonly SubjectCardProviderDescriptor[],
  filter: SubjectCardProviderDiscoveryFilter,
): readonly SubjectCardProviderDescriptor[] {
  const providers = new Map<string, SubjectCardProviderDescriptor>()
  for (const candidate of catalog) {
    const provider = createSubjectCardProviderDescriptor(candidate)
    const existing = providers.get(provider.providerId)
    if (existing && JSON.stringify(existing) !== JSON.stringify(provider)) {
      throw new Error('provider_catalog_conflict')
    }
    providers.set(provider.providerId, provider)
  }
  return Object.freeze([...providers.values()].filter(provider =>
    provider.subjectKinds.includes(filter.subjectKind)
      && provider.operations.includes(filter.operation)))
}

/** Resolves only an exact server-verified provider selection. */
export function selectSubjectCardProvider(
  catalog: readonly SubjectCardProviderDescriptor[],
  input: SubjectCardProviderDiscoveryFilter & Readonly<{ providerId: string }>,
): SubjectCardProviderDescriptor {
  const providerId = String(input.providerId || '').trim()
  const provider = discoverSubjectCardProviders(catalog, input)
    .find(candidate => candidate.providerId === providerId)
  if (!provider) throw new Error('provider_not_available')
  return provider
}
