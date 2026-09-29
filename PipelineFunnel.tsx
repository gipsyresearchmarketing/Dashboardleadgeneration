"use client";

import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLeads } from "@/lib/store";
import { STATUS_META, STATUS_ORDER } from "@/lib/status-meta";

export function PipelineFunnel() {
  const { leads } = useLeads();

  const { max, rows } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of STATUS_ORDER) counts.set(s, 0);
    for (const l of leads) counts.set(l.status, (counts.get(l.status) ?? 0) + 1);

    const rows = STATUS_ORDER.map((status) => ({
      status,
      count: counts.get(status) ?? 0,
      meta: STATUS_META[status],
    }));
    const max = Math.max(1, ...rows.map((r) => r.count));
    return { max, rows };
  }, [leads]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Sales Pipeline</CardTitle>
        <CardDescription>
          Visual funnel of leads as they move toward a closed deal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row, idx) => {
          const widthPct = Math.max(8, Math.round((row.count / max) * 100));
          // Slight funnel taper — each step slightly narrower than previous
          const taper = Math.max(60, 100 - idx * 6);
          const finalWidth = Math.min(100, Math.round((widthPct * taper) / 100));

          return (
            <div key={row.status} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{row.status}</span>
                <span className="text-muted-foreground">
                  {row.count} lead{row.count === 1 ? "" : "s"}
                </span>
              </div>
              <div className="relative h-9 w-full overflow-hidden rounded-md bg-muted">
                <div
                  className="flex h-full items-center justify-between rounded-md px-3 text-xs font-medium text-white shadow-sm transition-all"
                  style={{
                    width: `${finalWidth}%`,
                    backgroundColor: row.meta.chartColor,
                  }}
                >
                  <span className="truncate">{row.meta.label}</span>
                  {row.count > 0 && <span>{row.count}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
