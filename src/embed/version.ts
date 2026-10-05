/**
 * Version of the embeddable runtime. Bump it whenever the runtime's output changes:
 * the CDN URL is pinned to the git tag `embed-v<VERSION>`, and published versions
 * must never change underneath the sites that use them (CI enforces this).
 */
export const VERSION = '1.0.0';
