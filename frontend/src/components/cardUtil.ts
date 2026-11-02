export { Badge, Dot, cx } from './ui';
import type { Role } from '../lib/types';

/** Tooltip text for controls gated by role; undefined when allowed. */
export function roleTip(allowed: boolean, needed: Role): string | undefined {
  return allowed ? undefined : `Requires the ${needed} role`;
}
