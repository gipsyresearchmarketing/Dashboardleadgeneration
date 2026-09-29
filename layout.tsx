import type { Metadata } from "next";
import "./globals.css";
import { LeadsProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "Leads Dashboard — Sales Pipeline",
  description:
    "Track your sales pipeline from first contact to closed deal. Built with Next.js, Tailwind, and Recharts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans">
        <LeadsProvider>{children}</LeadsProvider>
      </body>
    </html>
  );
}
