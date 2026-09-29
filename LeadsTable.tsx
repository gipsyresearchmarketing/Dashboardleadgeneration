"use client";

import { useMemo, useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  Mail,
  MoreHorizontal,
  Phone,
  Search,
  Trash2,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { useLeads } from "@/lib/store";
import { LEAD_STATUSES, type Lead, type LeadStatus } from "@/lib/types";
import { formatDate, formatIDR } from "@/lib/utils";

type SortKey = "name" | "company" | "status" | "sales_value" | "last_contacted_at";
type SortDir = "asc" | "desc";

const STATUS_FILTER_ALL = "all" as const;
type StatusFilter = typeof STATUS_FILTER_ALL | LeadStatus;

export function LeadsTable() {
  const { leads, updateLeadStatus, deleteLead } = useLeads();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    STATUS_FILTER_ALL
  );
  const [sortKey, setSortKey] = useState<SortKey>("last_contacted_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = leads.slice();

    if (statusFilter !== STATUS_FILTER_ALL) {
      rows = rows.filter((l) => l.status === statusFilter);
    }
    if (q) {
      rows = rows.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.company.toLowerCase().includes(q) ||
          l.email.toLowerCase().includes(q)
      );
    }

    rows.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });

    return rows;
  }, [leads, query, statusFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "sales_value" || key === "last_contacted_at" ? "desc" : "asc");
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>Leads</CardTitle>
            <CardDescription>
              {filtered.length} of {leads.length} lead
              {leads.length === 1 ? "" : "s"} shown
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name or company..."
                className="w-full pl-9 sm:w-64"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="justify-between">
                  {statusFilter === STATUS_FILTER_ALL ? "All status" : statusFilter}
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as StatusFilter)}
                >
                  <DropdownMenuRadioItem value={STATUS_FILTER_ALL}>
                    All status
                  </DropdownMenuRadioItem>
                  {LEAD_STATUSES.map((s) => (
                    <DropdownMenuRadioItem key={s} value={s}>
                      {s}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortButton
                    active={sortKey === "name"}
                    dir={sortDir}
                    onClick={() => toggleSort("name")}
                  >
                    Name
                  </SortButton>
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  <SortButton
                    active={sortKey === "company"}
                    dir={sortDir}
                    onClick={() => toggleSort("company")}
                  >
                    Company
                  </SortButton>
                </TableHead>
                <TableHead className="hidden lg:table-cell">Contact</TableHead>
                <TableHead>
                  <SortButton
                    active={sortKey === "status"}
                    dir={sortDir}
                    onClick={() => toggleSort("status")}
                  >
                    Status
                  </SortButton>
                </TableHead>
                <TableHead className="text-right">
                  <SortButton
                    active={sortKey === "sales_value"}
                    dir={sortDir}
                    onClick={() => toggleSort("sales_value")}
                  >
                    Sales Value
                  </SortButton>
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  <SortButton
                    active={sortKey === "last_contacted_at"}
                    dir={sortDir}
                    onClick={() => toggleSort("last_contacted_at")}
                  >
                    Last Contact
                  </SortButton>
                </TableHead>
                <TableHead className="w-12 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-32 text-center text-sm text-muted-foreground"
                  >
                    No leads match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((lead) => <LeadRow key={lead.id} lead={lead} updateLeadStatus={updateLeadStatus} deleteLead={deleteLead} />)
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function SortButton({
  active,
  dir,
  onClick,
  children,
}: {
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
        active ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {children}
      <ArrowUpDown
        className={`h-3 w-3 transition-transform ${active && dir === "asc" ? "rotate-180" : ""}`}
      />
    </button>
  );
}

function LeadRow({
  lead,
  updateLeadStatus,
  deleteLead,
}: {
  lead: Lead;
  updateLeadStatus: (id: string, status: LeadStatus) => void;
  deleteLead: (id: string) => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{lead.name}</div>
        <div className="text-xs text-muted-foreground md:hidden">
          {lead.company}
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {lead.company}
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <div className="flex flex-col gap-1 text-xs">
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <Mail className="h-3 w-3" />
              <span className="truncate">{lead.email}</span>
            </a>
          )}
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <Phone className="h-3 w-3" />
              {lead.phone}
            </a>
          )}
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={lead.status} />
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {formatIDR(lead.sales_value)}
      </TableCell>
      <TableCell className="hidden md:table-cell text-muted-foreground">
        {formatDate(lead.last_contacted_at)}
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Update status</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={lead.status}
              onValueChange={(v) => updateLeadStatus(lead.id, v as LeadStatus)}
            >
              {LEAD_STATUSES.map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  {s}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => deleteLead(lead.id)}
              className="text-rose-600 focus:bg-rose-50 focus:text-rose-700 dark:focus:bg-rose-950/40"
            >
              <Trash2 className="h-4 w-4" />
              Delete lead
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
