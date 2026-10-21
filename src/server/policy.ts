import type { Actor, ActorRole } from "./domain";

export const ACTIONS = [
  "dispute:read",
  "history:read",
  "dispute:import",
  "evidence:edit",
  "dispute:file",
  "decision:propose",
  "decision:approve",
  "decision:reject",
  "export",
  "network:event",
] as const;
export type Action = (typeof ACTIONS)[number];

const ANALYST: readonly Action[] = [
  "dispute:read",
  "history:read",
  "dispute:import",
  "evidence:edit",
  "dispute:file",
  "decision:propose",
];

const GRANTS: Readonly<Record<ActorRole, readonly Action[]>> = {
  analyst: ANALYST,
  lead: [...ANALYST, "decision:approve", "decision:reject"],
  auditor: ["dispute:read", "history:read", "export"],
  system: ["dispute:read", "network:event"],
};

/** Deny by default. The only place roles are compared (R5). */
export function can(user: Actor | null | undefined, action: Action): boolean {
  if (!user) return false;
  if (!Object.prototype.hasOwnProperty.call(GRANTS, user.role)) return false;
  return GRANTS[user.role].includes(action);
}
