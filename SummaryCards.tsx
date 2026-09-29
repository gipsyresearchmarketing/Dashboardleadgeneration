"use client";

import { useMemo } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Flame,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useLeads } from "@/lib/store";
import { formatIDR, isToday } from "@/lib/utils";
import type { Lead } from "@/lib/types";

type MetricCardProps = {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: "default" | "positive" | "negative";
};

function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: MetricCardProps) {
  const toneRing =
    tone === "positive"
      ? "from-emerald-500/15 to-emerald-500/0 text-emerald-600"
      : tone === "negative"
      ? "from-rose-500/15 to-rose-500/0 text-rose-600"
      : "from-indigo-500/15 to-indigo-500/0 text-indigo-600";

  return (
    <Card className="relative overflow-hidden">
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${toneRing}`}
        aria-hidden
      />
      <CardContent className="relative flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            {label}
          </span>
          <div className="grid h-9 w-9 place-items-center rounded-md bg-background shadow-sm ring-1 ring-border">
            {icon}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-2xl font-semibold tracking-tight">{value}</div>
          {hint && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {hint}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function computeMetrics(leads: Lead[]) {
  const total = leads.length;
  const won = leads.filter((l) => l.status === "Won/Sales");
  const wonCount = won.length;
  const wonValue = won.reduce((sum, l) => sum + l.sales_value, 0);

  // "Need follow-up today" = New Leads + any active follow-up last touched today
  const needFollowUpToday = leads.filter((l) => {
    if (l.status === "Won/Sales" || l.status === "Lost") return false;
    return isToday(l.last_contacted_at);
  }).length;

  const conversionRate = total > 0 ? (wonCount / total) * 100 : 0;

  return { total, wonCount, wonValue, needFollowUpToday, conversionRate };
}

export function SummaryCards() {
  const { leads } = useLeads();

  const metrics = useMemo(() => computeMetrics(leads), [leads]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        label="Total Leads"
        value={metrics.total.toLocaleString("id-ID")}
        hint={
          <span className="inline-flex items-center gap-1">
            <ArrowUpRight className="h-3 w-3 text-emerald-600" />
            All statuses combined
          </span>
        }
        icon={<Users className="h-4 w-4" />}
      />
      <MetricCard
        label="Sales Won"
        value={`${metrics.wonCount} • ${formatIDR(metrics.wonValue)}`}
        hint={
          <span className="inline-flex items-center gap-1">
            <Trophy className="h-3 w-3 text-emerald-600" />
            Closed deals this dataset
          </span>
        }
        icon={<Trophy className="h-4 w-4" />}
        tone="positive"
      />
      <MetricCard
        label="Need Follow-up Today"
        value={metrics.needFollowUpToday.toLocaleString("id-ID")}
        hint={
          <span className="inline-flex items-center gap-1">
            <Flame className="h-3 w-3 text-amber-500" />
            Touched today, not closed
          </span>
        }
        icon={<Flame className="h-4 w-4" />}
      />
      <MetricCard
        label="Conversion Rate"
        value={`${metrics.conversionRate.toFixed(1)}%`}
        hint={
          <span className="inline-flex items-center gap-1">
            {metrics.conversionRate >= 10 ? (
              <ArrowUpRight className="h-3 w-3 text-emerald-600" />
            ) : (
              <ArrowDownRight className="h-3 w-3 text-rose-600" />
            )}
            Won / Total
          </span>
        }
        icon={<Target className="h-4 w-4" />}
      />
    </div>
  );
}
