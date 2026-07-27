"use client";

import { Database, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
            <Database className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold tracking-tight">
                RecoverLink
              </span>
              <Badge
                variant="secondary"
                className="hidden text-[10px] font-medium sm:inline-flex"
              >
                WhatsApp Forensics
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Deleted message recovery lab
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">100% local</span>
            <span className="sm:hidden">Local</span>
          </span>
        </div>
      </div>
    </header>
  );
}
