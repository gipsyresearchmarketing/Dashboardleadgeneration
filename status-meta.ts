import type { LeadStatus } from "./types";

/**
 * Single source of truth for status styling + chart colors.
 *
 * The status palette is RESERVED (good/warning/serious/critical) per the
 * dataviz skill — these colors signal pipeline state, not chart series.
 *
 * For the bar/pie charts we use a *categorical* palette so identity
 * (which slice) stays distinct from meaning (what it means for the lead).
 */
export type StatusMeta = {
  label: LeadStatus;
  badgeClass: string; // tailwind classes for the badge
  chartColor: string; // hex color for chart fills (categorical, fixed order)
  order: number; // funnel/funnel order, lower = earlier in pipeline
  isTerminal: boolean; // terminal state (Won/Lost)
};

export const STATUS_META: Record<LeadStatus, StatusMeta> = {
  "New Lead": {
    label: "New Lead",
    badgeClass:
      "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800",
    chartColor: "#6366f1", // indigo-500
    order: 0,
    isTerminal: false,
  },
  "Followed Up (WhatsApp)": {
    label: "Followed Up (WhatsApp)",
    badgeClass:
      "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800",
    chartColor: "#06b6d4", // cyan-500
    order: 1,
    isTerminal: false,
  },
  "Followed Up (Email)": {
    label: "Followed Up (Email)",
    badgeClass:
      "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-800",
    chartColor: "#8b5cf6", // violet-500
    order: 2,
    isTerminal: false,
  },
  "In Negotiation": {
    label: "In Negotiation",
    badgeClass:
      "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800",
    chartColor: "#f59e0b", // amber-500
    order: 3,
    isTerminal: false,
  },
  "Won/Sales": {
    label: "Won/Sales",
    badgeClass:
      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800",
    chartColor: "#10b981", // emerald-500
    order: 4,
    isTerminal: true,
  },
  Lost: {
    label: "Lost",
    badgeClass:
      "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800",
    chartColor: "#f43f5e", // rose-500
    order: 5,
    isTerminal: true,
  },
};

export const STATUS_ORDER = (Object.values(STATUS_META) as StatusMeta[])
  .sort((a, b) => a.order - b.order)
  .map((m) => m.label);
