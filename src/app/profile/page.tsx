"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clock, Database, Download, Eye, Trash2, User, Mail, LogOut, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/lib/auth/auth-context";

interface Session {
  id: string; sourceType: string; fileName: string; fileSizeBytes: number;
  existingItems: number; recoveredFragments: number; categoryCount: number;
  status: string; createdAt: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, token, loading, logout } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    if (!loading && !user) { router.push("/"); return; }
    if (token) {
      fetch("/api/recovery", { headers: { authorization: `Bearer ${token}` } })
        .then(r => r.json()).then(data => setSessions(data.items ?? [])).catch(() => {});
    }
  }, [user, token, loading, router]);

  const handleDelete = async (id: string) => {
    await fetch(`/api/recovery/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  if (loading) return <div className="min-h-screen bg-slate-50" />;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 text-slate-800">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => router.push("/")}><ArrowLeft className="h-4 w-4" /></Button>
            <img src="/logo.png" alt="AMF" className="h-8 w-auto" />
          </div>
          <Button variant="ghost" size="sm" onClick={() => { logout(); router.push("/"); }}><LogOut className="h-4 w-4" /> Logout</Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Profile header */}
        <Card className="border-slate-200 bg-white/90 shadow-sm mb-6">
          <CardContent className="flex items-center gap-4 p-6">
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-sky-100">
              <User className="h-8 w-8 text-sky-500" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-slate-900">{user.name}</h1>
              <p className="flex items-center gap-1 text-sm text-slate-500"><Mail className="h-3.5 w-3.5" /> {user.email}</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-2xl font-bold text-sky-600">{sessions.length}</p>
              <p className="text-xs text-slate-500">Recovery Sessions</p>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-center">
            <p className="text-2xl font-bold text-sky-600">{sessions.reduce((s, x) => s + x.existingItems, 0)}</p>
            <p className="text-xs text-slate-500">Live Items</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{sessions.reduce((s, x) => s + x.recoveredFragments, 0)}</p>
            <p className="text-xs text-slate-500">Recovered</p>
          </div>
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-center">
            <p className="text-2xl font-bold text-violet-600">{new Set(sessions.flatMap(s => [])).size || sessions.length}</p>
            <p className="text-xs text-slate-500">Cases</p>
          </div>
        </div>

        {/* History */}
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardHeader className="border-b border-slate-200 pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-slate-700"><Database className="h-4 w-4 text-sky-500" /> Recovery History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {sessions.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                No recovery sessions yet. <Button variant="link" className="p-0 text-sky-500" onClick={() => router.push("/recover")}>Run a scan</Button>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 border-b border-slate-200 bg-white text-[10px] uppercase text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left">File</th>
                      <th className="px-3 py-2 text-right">Live</th>
                      <th className="px-3 py-2 text-right">Recovered</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessions.map(s => (
                      <tr key={s.id} className="hover:bg-sky-50">
                        <td className="px-3 py-2 text-slate-600">{s.fileName}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-500">{s.existingItems}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-emerald-600">{s.recoveredFragments}</td>
                        <td className="px-3 py-2 text-slate-400">{new Date(s.createdAt).toLocaleString()}</td>
                        <td className="px-3 py-2"><Badge variant="outline" className={`text-[9px] ${s.status==="completed"?"border-emerald-200 text-emerald-600":"border-amber-200 text-amber-600"}`}>{s.status}</Badge></td>
                        <td className="px-3 py-2 text-right">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-sky-500"><Eye className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500" onClick={() => handleDelete(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
