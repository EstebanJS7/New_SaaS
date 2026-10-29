import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

export function Spinner({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-4 shrink-0 animate-spin motion-reduce:animate-none", className)}
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" className="opacity-20" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
