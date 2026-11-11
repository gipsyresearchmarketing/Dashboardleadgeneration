"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { MOCK_LEADS } from "./mock-data";
import type { Lead, LeadStatus, NewLeadInput } from "./types";
import { generateLeadId } from "./utils";

const STORAGE_KEY = "leads-dashboard:v1";

type LeadsContextValue = {
  leads: Lead[];
  addLead: (input: NewLeadInput) => void;
  updateLeadStatus: (id: string, status: LeadStatus) => void;
  deleteLead: (id: string) => void;
  resetToMock: () => void;
};

const LeadsContext = createContext<LeadsContextValue | null>(null);

function loadInitial(): Lead[] {
  if (typeof window === "undefined") return MOCK_LEADS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return MOCK_LEADS;
    const parsed = JSON.parse(raw) as Lead[];
    if (!Array.isArray(parsed)) return MOCK_LEADS;
    return parsed;
  } catch {
    return MOCK_LEADS;
  }
}

export function LeadsProvider({ children }: { children: ReactNode }) {
  const [leads, setLeads] = useState<Lead[]>(MOCK_LEADS);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount (client only).
  useEffect(() => {
    setLeads(loadInitial());
    setHydrated(true);
  }, []);

  // Persist whenever leads change, after hydration.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
    } catch {
      // ignore quota / privacy-mode failures
    }
  }, [leads, hydrated]);

  const addLead = useCallback((input: NewLeadInput) => {
    setLeads((prev) => [
      {
        ...input,
        id: generateLeadId(),
        last_contacted_at: new Date().toISOString(),
      },
      ...prev,
    ]);
  }, []);

  const updateLeadStatus = useCallback((id: string, status: LeadStatus) => {
    setLeads((prev) =>
      prev.map((l) =>
        l.id === id
          ? {
              ...l,
              status,
              last_contacted_at: new Date().toISOString(),
            }
          : l
      )
    );
  }, []);

  const deleteLead = useCallback((id: string) => {
    setLeads((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const resetToMock = useCallback(() => {
    setLeads(MOCK_LEADS);
  }, []);

  const value = useMemo<LeadsContextValue>(
    () => ({ leads, addLead, updateLeadStatus, deleteLead, resetToMock }),
    [leads, addLead, updateLeadStatus, deleteLead, resetToMock]
  );

  return <LeadsContext.Provider value={value}>{children}</LeadsContext.Provider>;
}

export function useLeads(): LeadsContextValue {
  const ctx = useContext(LeadsContext);
  if (!ctx) {
    throw new Error("useLeads must be used inside <LeadsProvider>");
  }
  return ctx;
}
