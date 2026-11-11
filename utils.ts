import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as Indonesian Rupiah.
 * 45000000 -> "Rp 45.000.000"
 */
export function formatIDR(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Short "time ago" helper used in the table.
 * Uses fixed reference so server/client rendering matches.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Generate a stable-ish id for newly created leads.
 * Not crypto-grade — fine for mock data.
 */
export function generateLeadId(): string {
  const random = Math.floor(Math.random() * 9000 + 1000);
  return `L-${random}`;
}

/**
 * Returns true when an ISO date falls on "today" (local time).
 */
export function isToday(iso: string, now = new Date()): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
