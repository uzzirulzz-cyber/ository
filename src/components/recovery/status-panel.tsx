"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Clock, Database, FileSearch, HardDrive, Search, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

interface StatusPanelProps {
  active: boolean;
  phase: string;
  progress: number;
  filesScanned: number;
  totalFiles: number;
  itemsFound: number;
  currentFile: string;
  startedAt: number | null;
}

export function StatusPanel({
  active,
  phase,
  progress,
  filesScanned,
  totalFiles,
  itemsFound,
  currentFile,
  startedAt,
}: StatusPanelProps) {
  const [elapsed, setElapsed] = useState(0);
  const [eta, setEta] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active || !startedAt) return;
    const interval = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(sec);
      if (progress > 0 && progress < 100) {
        const totalEstimate = (sec / progress) * 100;
        setEta(Math.max(0, Math.round(totalEstimate - sec)));
      } else if (progress >= 100) {
        setEta(0);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [active, startedAt, progress]);

  if (!active) return null;

  const formatTime = (s: number): string => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}m ${rem}s`;
  };

  const speed = elapsed > 0 ? Math.round((filesScanned / elapsed) * 10) / 10 : 0;

  return (
    <Card className="border-sky-200 bg-white/95 shadow-lg backdrop-blur">
      <CardContent className="p-5">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-sky-500" />
            </span>
            <span className="text-sm font-bold text-slate-700">{phase}</span>
          </div>
          <Badge variant="outline" className="border-sky-200 bg-sky-50 text-[10px] text-sky-600">
            <Activity className="mr-1 h-3 w-3 animate-pulse" /> LIVE
          </Badge>
        </div>

        {/* Big progress percentage */}
        <div className="mb-2 flex items-end justify-between">
          <span className="text-5xl font-bold tabular-nums text-sky-600">{progress}%</span>
          <div className="text-right">
            <p className="text-xs text-slate-400">Elapsed</p>
            <p className="font-mono text-lg font-semibold text-slate-600">{formatTime(elapsed)}</p>
          </div>
        </div>

        {/* Progress bar */}
        <Progress value={progress} className="h-3 mb-4 [&>div]:bg-gradient-to-r [&>div]:from-sky-400 [&>div]:to-blue-500 [&>div]:transition-all [&>div]:duration-500" />

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Files scanned */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <FileSearch className="h-3 w-3" /> FILES
            </div>
            <p className="mt-1 text-xl font-bold text-slate-700">
              {filesScanned}<span className="text-sm text-slate-400">/{totalFiles}</span>
            </p>
          </div>

          {/* Items found */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-500">
              <Database className="h-3 w-3" /> FOUND
            </div>
            <p className="mt-1 text-xl font-bold text-emerald-600">{itemsFound}</p>
          </div>

          {/* ETA */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-1.5 text-[10px] text-amber-500">
              <Clock className="h-3 w-3" /> ETA
            </div>
            <p className="mt-1 font-mono text-xl font-bold text-amber-600">
              {eta !== null ? formatTime(eta) : "—"}
            </p>
          </div>

          {/* Speed */}
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
            <div className="flex items-center gap-1.5 text-[10px] text-violet-500">
              <Zap className="h-3 w-3" /> SPEED
            </div>
            <p className="mt-1 text-xl font-bold text-violet-600">
              {speed}<span className="text-xs text-slate-400">/s</span>
            </p>
          </div>
        </div>

        {/* Current file */}
        {currentFile && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <HardDrive className="h-3.5 w-3.5 shrink-0 text-sky-500" />
            <span className="truncate text-xs text-slate-500">
              Scanning: <span className="font-mono font-medium text-slate-700">{currentFile}</span>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
