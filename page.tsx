"use client";

import { useState } from "react";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { LeadsChart } from "@/components/dashboard/LeadsChart";
import { PipelineFunnel } from "@/components/dashboard/PipelineFunnel";
import { LeadsTable } from "@/components/dashboard/LeadsTable";
import { AddLeadDrawer } from "@/components/dashboard/AddLeadDrawer";

export default function HomePage() {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <DashboardHeader onAddLead={() => setAddOpen(true)} />

      <main className="container mx-auto space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Section 1: Summary Metrics */}
        <section aria-labelledby="summary-heading" className="space-y-3">
          <div>
            <h2 id="summary-heading" className="sr-only">
              Summary
            </h2>
          </div>
          <SummaryCards />
        </section>

        {/* Section 2: Charts (Bar + Pie) */}
        <section aria-labelledby="charts-heading" className="space-y-3">
          <h2
            id="charts-heading"
            className="text-sm font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Visualizations
          </h2>
          <LeadsChart />
        </section>

        {/* Section 3: Pipeline funnel + interactive table */}
        <section
          aria-labelledby="pipeline-heading"
          className="grid grid-cols-1 gap-4 lg:grid-cols-3"
        >
          <h2 id="pipeline-heading" className="sr-only">
            Pipeline & Leads
          </h2>
          <div className="lg:col-span-1">
            <PipelineFunnel />
          </div>
          <div className="lg:col-span-2">
            <LeadsTable />
          </div>
        </section>
      </main>

      <footer className="border-t py-4">
        <div className="container mx-auto px-4 text-center text-xs text-muted-foreground sm:px-6 lg:px-8">
          Leads Dashboard — built with Next.js, Tailwind, shadcn/ui, and Recharts.
          Data persisted to localStorage.
        </div>
      </footer>

      <AddLeadDrawer open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
