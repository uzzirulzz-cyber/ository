"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface User { id: string; name: string; email: string; }
interface AuthCtx {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (name: string, email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => {
    if (typeof window === "undefined") return true;
    return !localStorage.getItem("amf_token");
  });

  useEffect(() => {
    const saved = localStorage.getItem("amf_token");
    if (!saved) return;
    let cancelled = false;
    fetch("/api/auth/verify", { headers: { authorization: `Bearer ${saved}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        if (data?.valid) { setUser(data.user); setToken(saved); }
        else localStorage.removeItem("amf_token");
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setToken(data.token); setUser(data.user);
    localStorage.setItem("amf_token", data.token);
    return true;
  };

  const signup = async (name: string, email: string, password: string) => {
    const res = await fetch("/api/auth/signup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setToken(data.token); setUser(data.user);
    localStorage.setItem("amf_token", data.token);
    return true;
  };

  const logout = () => { setUser(null); setToken(null); localStorage.removeItem("amf_token"); };

  return <Ctx.Provider value={{ user, token, loading, login, signup, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() { return useContext(Ctx); }
