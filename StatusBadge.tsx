import { cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/status-meta";
import type { LeadStatus } from "@/lib/types";

type StatusBadgeProps = {
  status: LeadStatus;
  className?: string;
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        meta.badgeClass,
        className
      )}
    >
      {meta.label}
    </span>
  );
}
