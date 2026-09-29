"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLeads } from "@/lib/store";
import { STATUS_META, STATUS_ORDER } from "@/lib/status-meta";

type ChartDatum = {
  status: string;
  count: number;
  color: string;
};

function useChartData(): ChartDatum[] {
  const { leads } = useLeads();
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of STATUS_ORDER) counts[s] = 0;
    for (const l of leads) {
      counts[l.status] = (counts[l.status] ?? 0) + 1;
    }
    return STATUS_ORDER.map((status) => ({
      status,
      count: counts[status] ?? 0,
      color: STATUS_META[status].chartColor,
    }));
  }, [leads]);
}

function BarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{item.status}</div>
      <div className="text-muted-foreground">
        {item.count} lead{item.count === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function PieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartDatum; value: number }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const total = payload.reduce((sum, p) => sum + (p.value ?? 0), 0);
  const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0";
  return (
    <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{item.payload.status}</div>
      <div className="text-muted-foreground">
        {item.value} leads • {pct}%
      </div>
    </div>
  );
}

export function LeadsChart() {
  const data = useChartData();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader className="pb-2">
          <CardTitle>Lead Distribution by Status</CardTitle>
          <CardDescription>
            How many leads sit at each stage of your pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 16, right: 16, left: 0, bottom: 8 }}
              barCategoryGap={18}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="status"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                interval={0}
                angle={-15}
                textAnchor="end"
                height={60}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={11}
                allowDecimals={false}
                stroke="hsl(var(--muted-foreground))"
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                content={<BarTooltip />}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
                {data.map((entry) => (
                  <Cell key={entry.status} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle>Status Share</CardTitle>
          <CardDescription>
            Percentage of leads per status.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip content={<PieTooltip />} />
              <Legend
                verticalAlign="bottom"
                height={36}
                iconType="circle"
                wrapperStyle={{ fontSize: 11 }}
              />
              <Pie
                data={data}
                dataKey="count"
                nameKey="status"
                cx="50%"
                cy="46%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                stroke="hsl(var(--background))"
                strokeWidth={2}
              >
                {data.map((entry) => (
                  <Cell key={entry.status} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
