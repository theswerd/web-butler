/** Namespace for stable element identity across remounts and navigations. */
export const IDENTITY_NAMESPACE = 'web-butler';

export type ElementIdentity = `${typeof IDENTITY_NAMESPACE}:${string}`;

/** Build a namespaced logical id, e.g. web-butler:panel */
export function identity(key: string): ElementIdentity {
  return `${IDENTITY_NAMESPACE}:${key}`;
}

/** CSS view-transition-name must be a valid <custom-ident> (no colons). */
export function viewTransitionName(key: string): string {
  return `${IDENTITY_NAMESPACE}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function dataIdentityAttr(key: string): Record<string, string> {
  return {
    'data-web-butler-id': identity(key),
  };
}
