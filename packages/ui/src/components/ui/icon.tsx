import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";

const paths = {
  dashboard: ["M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"],
  users: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87",
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M16 3.13a4 4 0 0 1 0 7.75",
  ],
  activity: ["M22 12h-4l-3 9-6-18-3 9H2"],
  calendar: [
    "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2",
  ],
  box: ["m12 3 9 5v8l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5"],
  truck: [
    "M1 3h14v13H1zM15 8h4l3 4v4h-7M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  ],
  bag: ["m6 3-3 4v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7l-3-4H6ZM3 7h18M16 11a4 4 0 0 1-8 0"],
  wallet: ["M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6M20 12h-5v5h5"],
  receipt: [
    "M4 3l2 2 2-2 2 2 2-2 2 2 2-2 2 2 2-2v18l-2-2-2 2-2-2-2 2-2-2-2 2-2-2-2 2V3ZM8 9h8M8 13h6",
  ],
  shield: ["M12 22s9-4 9-11V5l-9-3-9 3v6c0 7 9 11 9 11ZM9 12l2 2 4-4"],
  chart: ["M3 3v18h18M8 16v-5M13 16V7M18 16v-8"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"],
  upload: ["M12 16V3M7 8l5-5 5 5M3 15v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5"],
  settings: [
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3l1-1h4l1 1v2l2 1 2-1 2 3-1 2v4l1 2-2 3-2-1-2 1v2l-1 1h-4l-1-1v-2l-2-1-2 1-2-3 1-2v-4L3 8l2-3 2 1 2-1V3Z",
  ],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35"],
  plus: ["M12 5v14M5 12h14"],
  arrow: ["M7 17 17 7M7 7h10v10"],
  chevron: ["m9 5 7 7-7 7"],
  menu: ["M4 6h16M4 12h16M4 18h16"],
  close: ["m6 6 12 12M6 18 18 6"],
  logout: ["M9 21H4V3h5M9 12h12M17 8l4 4-4 4"],
  check: ["m5 12 4 4L19 6"],
  alert: ["m12 3 10 18H2L12 3ZM12 9v4M12 17h.01"],
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className, ...props }: ComponentProps<"svg"> & { name: IconName }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      {...props}
    >
      {paths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
