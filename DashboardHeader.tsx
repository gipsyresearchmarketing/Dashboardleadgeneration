"use client";

import { Plus, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLeads } from "@/lib/store";

type DashboardHeaderProps = {
  onAddLead: () => void;
};

export function DashboardHeader({ onAddLead }: DashboardHeaderProps) {
  const { resetToMock } = useLeads();

  return (
    <header className="flex flex-col gap-3 border-b bg-background/60 px-6 py-5 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md">
            <span className="text-sm font-bold">L</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Leads Dashboard
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Track your sales pipeline from first contact to closed deal.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={resetToMock}>
          <RefreshCcw className="h-4 w-4" />
          Reset data
        </Button>
        <Button size="sm" onClick={onAddLead}>
          <Plus className="h-4 w-4" />
          Add Lead
        </Button>
      </div>
    </header>
  );
}
