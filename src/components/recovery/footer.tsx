"use client";

import { Database, ShieldCheck } from "lucide-react";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-muted/30">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:px-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Database className="h-3.5 w-3.5" />
          </span>
          <span>
            <span className="font-medium text-foreground">RecoverLink</span> ·
            WhatsApp forensic recovery · runs entirely in your browser
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Your data never leaves this device
          </span>
          <span className="hidden sm:inline">© {new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  );
}
