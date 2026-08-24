import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names and resolve Tailwind class conflicts.
 * Shared by all UI primitives so token utilities compose predictably.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
