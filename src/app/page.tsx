"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Cable, CheckCircle2, Database, Download, Fingerprint,
  Lock, Search, Shield, Smartphone, Zap, User as UserIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth/auth-context";
import { AuthModal } from "@/components/recovery/auth-modal";

const FEATURES = [
  { icon: Search, title: "Deep Scan Engine", desc: "Scans every storage cluster, free block, and unallocated region for deleted data" },
  { icon: Database, title: "SQLite Forensics", desc: "Reads live records and carves deleted entries from database free space" },
  { icon: Fingerprint, title: "Evidence Integrity", desc: "SHA-256 hash chain for court-admissible verification" },
  { icon: Smartphone, title: "Device Connection", desc: "USB device detection with read-only safe scanning" },
  { icon: Download, title: "Multi-Format Export", desc: "CSV, PDF, JSON, vCard — recover to computer or encrypted container" },
  { icon: Shield, title: "Privacy First", desc: "All processing runs in your browser — data never leaves your machine" },
];

export default function Storefront() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 text-slate-800">
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <img src="/logo.png" alt="Advanced Mobile Forensics" className="h-10 w-auto" />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-slate-500" onClick={() => router.push("/admin")}>Admin</Button>
            {user ? (
              <>
                <Button variant="ghost" size="sm" className="text-slate-600" onClick={() => router.push("/profile")}>
                  <UserIcon className="mr-1 h-4 w-4" /> {user.name.split(" ")[0]}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { logout(); }}>Logout</Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" className="text-slate-600" onClick={() => setAuthOpen(true)}>Sign In</Button>
            )}
            <Button size="sm" className="bg-sky-600 text-white hover:bg-sky-700" onClick={() => router.push("/recover")}>
              Launch Recovery <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-40 left-1/2 h-96 w-[40rem] -translate-x-1/2 rounded-full bg-sky-200/30 blur-3xl" />
        </div>
        <div className="mx-auto max-w-4xl px-4 py-20 text-center">
          <Badge variant="outline" className="mb-4 border-sky-200 bg-sky-50 text-sky-600">
            <Zap className="mr-1 h-3 w-3" /> Forensic-Grade Recovery
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
            Recover Deleted Data
            <span className="block bg-gradient-to-r from-sky-500 to-blue-600 bg-clip-text text-transparent">From Any Phone</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base text-slate-600 sm:text-lg">
            Deep scan your device to recover deleted photos, messages, contacts, WhatsApp data, call logs, documents, and more.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" className="h-14 gap-3 bg-gradient-to-r from-sky-500 to-blue-600 px-10 text-base font-bold shadow-lg shadow-sky-500/20" onClick={() => router.push("/recover")}>
              <Cable className="h-5 w-5" /> Start Recovery Now
            </Button>
            {!user && (
              <Button size="lg" variant="outline" className="border-slate-300 text-slate-600" onClick={() => setAuthOpen(true)}>
                Create Free Account
              </Button>
            )}
          </div>
          <div className="mt-6 flex items-center justify-center gap-6 text-xs text-slate-500">
            <span className="flex items-center gap-1"><Lock className="h-3.5 w-3.5 text-sky-500" /> 100% Local</span>
            <span className="flex items-center gap-1"><Shield className="h-3.5 w-3.5 text-sky-500" /> Read-Only</span>
            <span className="flex items-center gap-1"><Fingerprint className="h-3.5 w-3.5 text-sky-500" /> Evidence-Grade</span>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white/60">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-4 px-4 py-6 sm:grid-cols-4">
          {[["13+","Data types"],["6","Scan modes"],["SHA-256","Integrity"],["0","Cloud uploads"]].map(([v,l]) => (
            <div key={l} className="text-center"><p className="text-2xl font-bold text-sky-600">{v}</p><p className="text-xs text-slate-500">{l}</p></div>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">Everything you need to recover data</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title} className="border-slate-200 bg-white/80 shadow-sm backdrop-blur transition-all hover:border-sky-300 hover:shadow-md">
              <CardContent className="p-5">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50"><f.icon className="h-5 w-5 text-sky-500" /></span>
                <h3 className="mt-3 text-sm font-semibold text-slate-800">{f.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white/60">
        <div className="mx-auto max-w-4xl px-4 py-16">
          <h2 className="text-center text-2xl font-bold text-slate-900">3 Steps to Recovery</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {[
              { n: "1", icon: Cable, title: "Connect", desc: "Plug your phone in via USB." },
              { n: "2", icon: Search, title: "Deep Scan", desc: "Every cluster scanned." },
              { n: "3", icon: Download, title: "Restore", desc: "Select and recover files." },
            ].map((s) => (
              <div key={s.n} className="text-center">
                <span className="relative mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 shadow-lg shadow-sky-500/20"><s.icon className="h-6 w-6 text-white" /></span>
                <div className="text-xs font-bold text-sky-500">STEP {s.n}</div>
                <h3 className="mt-1 text-sm font-semibold text-slate-800">{s.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-white/60">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h2 className="text-2xl font-bold text-slate-900">Ready to recover your data?</h2>
          <p className="mt-2 text-sm text-slate-500">{user ? "Launch the recovery tool to get started." : "Create an account to save your recovery history."}</p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button size="lg" className="h-14 gap-3 bg-gradient-to-r from-sky-500 to-blue-600 px-10 text-base font-bold shadow-lg shadow-sky-500/20" onClick={() => router.push("/recover")}>
              <Cable className="h-5 w-5" /> Launch Recovery Tool
            </Button>
            {!user && <Button size="lg" variant="outline" className="border-slate-300 text-slate-600" onClick={() => setAuthOpen(true)}>Sign Up Free</Button>}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-6">
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 text-xs text-slate-400">
          <img src="/logo.png" alt="AMF" className="h-5 w-auto" /> Advanced Mobile Forensics · © {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}
