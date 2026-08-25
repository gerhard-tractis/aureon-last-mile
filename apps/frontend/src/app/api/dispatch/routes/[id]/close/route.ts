/**
 * `/close` is deprecated in favor of `/seal` (spec-70 phase 3). This alias
 * stays for one release so a cached PWA bundle still on the old route keeps
 * working until it refreshes — remove it once that window has passed.
 */
export { POST } from '../seal/route';
