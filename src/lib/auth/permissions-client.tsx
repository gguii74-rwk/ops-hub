"use client";

import { createContext, useContext } from "react";

const PermissionContext = createContext<ReadonlySet<string>>(new Set());

export function PermissionProvider({
  keys,
  children,
}: {
  keys: string[];
  children: React.ReactNode;
}) {
  return <PermissionContext.Provider value={new Set(keys)}>{children}</PermissionContext.Provider>;
}

/** UI 노출 판정. 서버 requirePermission과 동일한 "resource:action" 키를 공유한다(SC-9). */
export function useCan(resource: string, action: string): boolean {
  const keys = useContext(PermissionContext);
  return keys.has(`${resource}:${action}`);
}
