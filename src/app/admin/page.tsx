"use client";

import { useEffect, useState } from "react";
import {
  Activity, ArrowLeft, CheckCircle2, Clock, Database,
  HardDrive, Shield, Eye, Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useRouter } from "next/navigation";

interface Session {
  id: string; sourceType: string; fileName: string; fileSizeBytes: number;
  existingItems: number; recoveredFragments: number; categoryCount: number;
  durationMs: number; status: string; fileHash: string | null; note: string | null;
  createdAt: string;
}
interface Stats {
  totalSessions: number; totalLiveItems: number; totalRecoveredFragments: number; lastRecoveryAt: string | null;
}

export default function AdminPanel() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/recovery", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/stats", { cache: "no-store" }).then(r => r.json()),
    ]).then(([sessData, statsData]) => {
      setSessions(sessData.items ?? []);
      setStats(statsData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    await fetch(`/api/recovery/${id}`, { method: "DELETE" });
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 text-slate-800">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="text-slate-500" onClick={() => router.push("/")}><ArrowLeft className="h-4 w-4" /></Button>
            <img src="/logo.png" alt="AMF" className="h-8 w-auto" />
            <Badge variant="outline" className="border-sky-200 bg-sky-50 text-[10px] text-sky-600">ADMIN</Badge>
          </div>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-600"><Shield className="mr-1 h-3 w-3" />ADMIN ACCESS</Badge>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={<Database className="h-4 w-4" />} label="Total Sessions" value={String(stats?.totalSessions ?? 0)} sub="all time" color="sky" />
          <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Live Items" value={String(stats?.totalLiveItems ?? 0)} sub="recovered" color="emerald" />
          <StatCard icon={<HardDrive className="h-4 w-4" />} label="Recovered Fragments" value={String(stats?.totalRecoveredFragments ?? 0)} sub="deleted data" color="violet" />
          <StatCard icon={<Clock className="h-4 w-4" />} label="Last Recovery" value={stats?.lastRecoveryAt ? new Date(stats.lastRecoveryAt).toLocaleDateString() : "—"} sub={stats?.lastRecoveryAt ? new Date(stats.lastRecoveryAt).toLocaleTimeString() : "no sessions"} color="amber" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Sessions table */}
          <div className="lg:col-span-2">
            <Card className="border-slate-200 bg-white/90 shadow-sm">
              <CardHeader className="border-b border-slate-200 pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-sm text-slate-700"><Activity className="h-4 w-4 text-sky-500" /> Recovery Sessions</CardTitle>
                  <Badge variant="outline" className="border-slate-200 text-[10px] text-slate-500">{sessions.length} total</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
                ) : sessions.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-400">No sessions yet. <Button variant="link" className="p-0 text-sky-500" onClick={() => router.push("/recover")}>Run a scan</Button></div>
                ) : (
                  <ScrollArea className="h-[400px]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 border-b border-slate-200 bg-white text-[10px] uppercase text-slate-400">
                        <tr>
                          <th className="px-3 py-2 text-left">ID</th>
                          <th className="px-3 py-2 text-left">File</th>
                          <th className="px-3 py-2 text-right">Live</th>
                          <th className="px-3 py-2 text-right">Recovered</th>
                          <th className="px-3 py-2 text-right">Categories</th>
                          <th className="px-3 py-2 text-left">Date</th>
                          <th className="px-3 py-2 text-left">Status</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sessions.map(s => (
                          <tr key={s.id} className="hover:bg-sky-50">
                            <td className="px-3 py-2 font-mono text-sky-600">{s.id.slice(0, 12)}…</td>
                            <td className="px-3 py-2 text-slate-600">{s.fileName}</td>
                            <td className="px-3 py-2 text-right font-mono text-slate-500">{s.existingItems}</td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-emerald-600">{s.recoveredFragments}</td>
                            <td className="px-3 py-2 text-right font-mono text-slate-500">{s.categoryCount}</td>
                            <td className="px-3 py-2 text-slate-400">{new Date(s.createdAt).toLocaleString()}</td>
                            <td className="px-3 py-2"><Badge variant="outline" className={`text-[9px] ${s.status==="completed"?"border-emerald-200 text-emerald-600":s.status==="partial"?"border-amber-200 text-amber-600":"border-red-200 text-red-500"}`}>{s.status}</Badge></td>
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
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <Card className="border-slate-200 bg-white/90 shadow-sm">
              <CardHeader className="border-b border-slate-200 pb-2"><CardTitle className="flex items-center gap-2 text-sm text-slate-700"><Shield className="h-4 w-4 text-sky-500" /> System Health</CardTitle></CardHeader>
              <CardContent className="space-y-3 p-4 text-xs">
                <HealthRow label="API" value="ONLINE" color="text-emerald-500" />
                <HealthRow label="Database" value="CONNECTED" color="text-emerald-500" />
                <HealthRow label="Encryption" value="AES-256" color="text-sky-500" />
                <HealthRow label="Mode" value="READ-ONLY" color="text-amber-500" />
                <Separator className="bg-slate-200" />
                <div><div className="mb-1 flex justify-between text-slate-500"><span>CPU</span><span className="font-mono text-slate-600">23%</span></div><Progress value={23} className="h-1.5 [&>div]:bg-sky-500" /></div>
                <div><div className="mb-1 flex justify-between text-slate-500"><span>Memory</span><span className="font-mono text-slate-600">47%</span></div><Progress value={47} className="h-1.5 [&>div]:bg-emerald-500" /></div>
                <div><div className="mb-1 flex justify-between text-slate-500"><span>Storage</span><span className="font-mono text-slate-600">68%</span></div><Progress value={68} className="h-1.5 [&>div]:bg-amber-500" /></div>
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white/90 shadow-sm">
              <CardHeader className="border-b border-slate-200 pb-2"><CardTitle className="flex items-center gap-2 text-sm text-slate-700"><Clock className="h-4 w-4 text-sky-500" /> Recent Activity</CardTitle></CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-40">
                  <div className="divide-y divide-slate-100 p-2 font-mono text-[10px]">
                    {sessions.slice(0, 5).map(s => (
                      <div key={s.id} className="flex gap-2 py-1">
                        <span className="shrink-0 text-slate-400">[{new Date(s.createdAt).toLocaleTimeString(undefined, { hour12: false })}]</span>
                        <span className="text-slate-600">{s.recoveredFragments} files recovered from {s.fileName}</span>
                      </div>
                    ))}
                    {sessions.length === 0 && <div className="p-2 text-slate-400">No activity yet</div>}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub: string; color: "sky" | "emerald" | "amber" | "violet" }) {
  const colors = { sky: "border-sky-200 bg-sky-50 text-sky-600", emerald: "border-emerald-200 bg-emerald-50 text-emerald-600", amber: "border-amber-200 bg-amber-50 text-amber-600", violet: "border-violet-200 bg-violet-50 text-violet-600" };
  return (<div className={`rounded-xl border p-4 ${colors[color]}`}><div className="flex items-center gap-2 text-xs opacity-80">{icon} {label}</div><p className="mt-1.5 text-3xl font-bold">{value}</p><p className="text-[10px] opacity-60">{sub}</p></div>);
}
function HealthRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (<div className="flex items-center justify-between"><span className="text-slate-500">{label}</span><span className={`font-mono font-medium ${color}`}>{value}</span></div>);
}
