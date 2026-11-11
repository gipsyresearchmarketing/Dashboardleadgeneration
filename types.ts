export const LEAD_STATUSES = [
  "New Lead",
  "Followed Up (WhatsApp)",
  "Followed Up (Email)",
  "In Negotiation",
  "Won/Sales",
  "Lost",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type Lead = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  status: LeadStatus;
  sales_value: number;
  last_contacted_at: string; // ISO date string
  notes: string;
};

export type NewLeadInput = Omit<Lead, "id" | "last_contacted_at">;
