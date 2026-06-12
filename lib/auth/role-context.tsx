"use client";

/**
 * Client-side membership role, provided once by the shop layout (server reads it
 * from requireTenant) so any page/nav can hide money + settings for non-OWNER
 * (Dave DoD §7). This is UI convenience only — the security guarantee is the
 * server-side redaction in lib/auth/money-visibility.ts; never rely on this hook
 * to protect data.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { Role } from "@/lib/auth/money-visibility";

// Default MEMBER = least privilege: if a provider is ever missing, money hides.
const RoleContext = createContext<Role>("MEMBER");

export function RoleProvider({ role, children }: { role: Role; children: ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): Role {
  return useContext(RoleContext);
}

export function useIsOwner(): boolean {
  return useContext(RoleContext) === "OWNER";
}
