"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLeads } from "@/lib/store";
import { LEAD_STATUSES, type LeadStatus, type NewLeadInput } from "@/lib/types";

type AddLeadDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const DEFAULT_VALUES: NewLeadInput = {
  name: "",
  company: "",
  email: "",
  phone: "",
  status: "New Lead",
  sales_value: 0,
  notes: "",
};

export function AddLeadDrawer({ open, onOpenChange }: AddLeadDrawerProps) {
  const { addLead } = useLeads();
  const [form, setForm] = useState<NewLeadInput>(DEFAULT_VALUES);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof NewLeadInput>(key: K, value: NewLeadInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.company.trim()) {
      setError("Name dan Company wajib diisi.");
      return;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError("Format email tidak valid.");
      return;
    }
    addLead({
      ...form,
      name: form.name.trim(),
      company: form.company.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      notes: form.notes.trim(),
    });
    setForm(DEFAULT_VALUES);
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add New Lead</DialogTitle>
          <DialogDescription>
            Capture kontak baru ke pipeline kamu. Field dengan tanda * wajib diisi.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="name">
                Name <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="name"
                placeholder="Contoh: Andi Saputra"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company">
                Company <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="company"
                placeholder="PT / CV / Nama bisnis"
                value={form.company}
                onChange={(e) => set("company", e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@company.com"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+62 ..."
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => set("status", v as LeadStatus)}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sales">Sales Value (Rp)</Label>
              <Input
                id="sales"
                type="number"
                min={0}
                step={1000000}
                placeholder="0"
                value={Number.isFinite(form.sales_value) ? form.sales_value : 0}
                onChange={(e) =>
                  set("sales_value", Math.max(0, Number(e.target.value) || 0))
                }
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Apa yang sudah dibahas? Next step apa?"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
            />
          </div>

          {error && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-800">
              {error}
            </p>
          )}

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForm(DEFAULT_VALUES);
                setError(null);
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit">Save Lead</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
