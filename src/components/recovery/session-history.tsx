"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Cloud,
  FolderOpen,
  Ghost,
  HardDrive,
  Inbox,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes, formatTimestamp } from "@/lib/whatsapp/forensics";
import type {
  RecoverySessionRecord,
  RecoveryStats,
} from "@/lib/whatsapp/types";
import { useToast } from "@/hooks/use-toast";

interface Props {
  refreshKey: number;
  onOpen: (id: string) => Promise<void>;
  activeSessionId?: string | null;
}

export function SessionHistory({ refreshKey, onOpen, activeSessionId }: Props) {
  const [items, setItems] = useState<RecoverySessionRecord[]>([]);
  const [stats, setStats] = useState<RecoveryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        fetch("/api/recovery", { cache: "no-store" }),
        fetch("/api/stats", { cache: "no-store" }),
      ]);
      const listJson = await listRes.json();
      const statsJson = await statsRes.json();
      setItems(Array.isArray(listJson.items) ? listJson.items : []);
      setStats(statsJson ?? null);
    } catch {
      setItems([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const remove = async (id: string) => {
    try {
      await fetch(`/api/recovery/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== id));
      load();
      toast({ title: "Recovery deleted", description: "Session and its messages removed." });
    } catch {
      toast({ title: "Couldn't delete recovery", variant: "destructive" });
    }
  };

  const handleOpen = async (id: string) => {
    setOpeningId(id);
    try {
      await onOpen(id);
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Stats bar */}
      {stats && stats.totalSessions > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            icon={<Cloud className="h-4 w-4" />}
            label="Saved recoveries"
            value={stats.totalSessions.toLocaleString()}
            accent="emerald"
          />
          <StatTile
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Live messages"
            value={stats.totalLiveMessages.toLocaleString()}
            accent="teal"
          />
          <StatTile
            icon={<Ghost className="h-4 w-4" />}
            label="Recovered fragments"
            value={stats.totalRecoveredFragments.toLocaleString()}
            accent="amber"
          />
          <StatTile
            icon={<Clock className="h-4 w-4" />}
            label="Last recovery"
            value={
              stats.lastRecoveryAt
                ? formatTimestamp(new Date(stats.lastRecoveryAt).getTime())
                : "—"
            }
            accent="violet"
          />
        </div>
      )}

      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Saved recoveries
          </h2>
          <p className="text-sm text-muted-foreground">
            Click any row to re-open its recovered messages. Stored in your
            MongoDB.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <Cloud className="h-3.5 w-3.5" />
          {items.length} session{items.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading saved recoveries…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Inbox className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium">No saved recoveries yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Upload a msgstore.db above to run your first forensic recovery.
                Results are saved to your MongoDB automatically.
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead className="text-right">Live</TableHead>
                    <TableHead className="text-right">Recovered</TableHead>
                    <TableHead className="text-right">Chats</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">When</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => {
                    const isActive = it.id === activeSessionId;
                    const isOpening = it.id === openingId;
                    return (
                      <TableRow
                        key={it.id}
                        className={`cursor-pointer transition-colors ${
                          isActive
                            ? "bg-emerald-50 dark:bg-emerald-950/30"
                            : "hover:bg-muted/50"
                        }`}
                        onClick={() => handleOpen(it.id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                              <HardDrive className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {it.fileName}
                              </p>
                              <p className="truncate font-mono text-[10px] text-muted-foreground">
                                {it.fileHash ? it.fileHash.slice(0, 16) + "…" : "—"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {it.existingMessages.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex items-center gap-1 font-mono text-sm font-medium text-amber-700 dark:text-amber-400">
                            <Ghost className="h-3.5 w-3.5" />
                            {it.recoveredFragments.toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {it.chatCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {formatBytes(it.fileSizeBytes)}
                        </TableCell>
                        <TableCell>
                          {it.status === "completed" ? (
                            <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                              <CheckCircle2 className="h-3 w-3" />
                              Done
                            </Badge>
                          ) : it.status === "partial" ? (
                            <Badge variant="secondary" className="gap-1">
                              Partial
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="h-3 w-3" />
                              Failed
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {formatTimestamp(new Date(it.createdAt).getTime())}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpen(it.id);
                              }}
                              aria-label="Open recovery"
                            >
                              {isOpening ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <FolderOpen className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                remove(it.id);
                              }}
                              aria-label="Delete recovery"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function StatTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: "emerald" | "amber" | "teal" | "violet";
}) {
  const accentMap = {
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    teal: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${accentMap[accent]}`}>
            {icon}
          </span>
          {label}
        </div>
        <p className="mt-2 text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
