"use client";

import { useState } from "react";
import { X, Mail, Lock, User } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/auth-context";

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    setBusy(true); setError("");
    const ok = mode === "login" ? await login(email, password) : await signup(name, email, password);
    if (ok) { onClose(); setBusy(false); }
    else { setError(mode === "login" ? "Invalid email or password" : "Email already registered"); setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-center">{mode === "login" ? "Sign In" : "Create Account"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {mode === "signup" && (
            <div className="relative"><User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" /><Input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" className="pl-8" /></div>
          )}
          <div className="relative"><Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" /><Input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" className="pl-8" /></div>
          <div className="relative"><Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" /><Input value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" type="password" className="pl-8" /></div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <Button onClick={handleSubmit} disabled={busy} className="w-full bg-sky-600 text-white hover:bg-sky-700">{busy ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}</Button>
          <p className="text-center text-xs text-slate-500">
            {mode === "login" ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }} className="font-medium text-sky-600 hover:underline">
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
