"use client";
import { useEffect } from "react";
import { safeStaffReturnPath } from "@/lib/staff-return-path";
let current: { owner: symbol; source: string; target: string } | undefined;
/** Same-document resource references only; no draft data or browser storage. */
export function useStaffResumeTarget(target: string | undefined): void {
  useEffect(() => {
    if (!target) return;
    const owner = Symbol();
    current = { owner, source: window.location.pathname, target: safeStaffReturnPath(target) };
    return () => {
      if (current?.owner === owner) current = undefined;
    };
  }, [target]);
}
export function staffResumeTarget(): string {
  return current?.source === window.location.pathname
    ? current.target
    : safeStaffReturnPath(window.location.pathname + window.location.search + window.location.hash);
}
