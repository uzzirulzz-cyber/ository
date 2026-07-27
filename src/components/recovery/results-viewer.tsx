"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileSearch,
  Ghost,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  formatBytes,
  formatTimestamp,
  messagesToCsv,
  messagesToJson,
} from "@/lib/whatsapp/forensics";
import type { AnalysisResult, RecoveredMessage } from "@/lib/whatsapp/types";
import { useToast } from "@/hooks/use-toast";

interface Props {
  result: AnalysisResult;
  savedSessionId?: string | null;
  onReset: () => void;
}

type SourceFilter = "all" | "table" | "carved";

function senderInitial(label: string | null, fromMe: boolean | null): string {
  if (fromMe) return "Me";
  if (!label) return "?";
  const base = label.split("@")[0];
  // phone numbers -> last 2 digits; names -> first letter
  return /^\d+$/.test(base) ? base.slice(-2) : base.charAt(0).toUpperCase();
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ResultsViewer({ result, savedSessionId, onReset }: Props) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [chat, setChat] = useState<string>("all");
  const [onlyWithTimestamp, setOnlyWithTimestamp] = useState(false);
  const [limit, setLimit] = useState(200);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return result.messages.filter((m) => {
      if (source !== "all" && m.source !== source) return false;
      if (chat !== "all" && m.chat !== chat) return false;
      if (onlyWithTimestamp && m.timestamp === null) return false;
      if (q && !m.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [result.messages, query, source, chat, onlyWithTimestamp]);

  const carvedCount = result.messages.filter((m) => m.source === "carved").length;
  const tableCount = result.messages.length - carvedCount;
  const visible = filtered.slice(0, limit);

  const exportData = (fmt: "json" | "csv") => {
    const base = result.fileName.replace(/\.[^.]+$/, "");
    if (fmt === "json") {
      download(`${base}-recovery.json`, messagesToJson(filtered), "application/json");
    } else {
      download(`${base}-recovery.csv`, messagesToCsv(filtered), "text/csv");
    }
    toast({
      title: "Export ready",
      description: `${filtered.length} message${filtered.length === 1 ? "" : "s"} exported as ${fmt.toUpperCase()}.`,
    });
  };

  const recoveryRate =
    result.existingMessages + result.recoveredFragments > 0
      ? Math.round(
          (result.recoveredFragments /
            (result.existingMessages + result.recoveredFragments)) *
            100,
        )
      : 0;

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Summary header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Recovery results
            </h2>
            {savedSessionId ? (
              <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                <CheckCircle2 className="h-3 w-3" />
                Saved to cloud
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                Not saved
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{result.fileName}</span> ·{" "}
            {formatBytes(result.fileSizeBytes)} ·{" "}
            {result.durationMs < 1000
              ? `${result.durationMs}ms`
              : `${(result.durationMs / 1000).toFixed(1)}s`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcw className="h-4 w-4" />
          {savedSessionId ? "Back to overview" : "Analyse another file"}
        </Button>
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <Alert className="mb-5">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Analysis notes</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Stat cards */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Live messages"
          value={tableCount.toLocaleString()}
          accent="emerald"
        />
        <StatCard
          icon={<Ghost className="h-4 w-4" />}
          label="Recovered (deleted)"
          value={carvedCount.toLocaleString()}
          accent="amber"
          highlight
        />
        <StatCard
          icon={<FileSearch className="h-4 w-4" />}
          label="Chats"
          value={result.chatCount.toLocaleString()}
          accent="teal"
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="Recovery rate"
          value={`${recoveryRate}%`}
          accent="violet"
        />
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="search" className="text-xs">
                Search text
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a word…"
                  className="h-9 pl-8 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as SourceFilter)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All messages</SelectItem>
                  <SelectItem value="table">Live only</SelectItem>
                  <SelectItem value="carved">Recovered only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Chat</Label>
              <Select value={chat} onValueChange={setChat}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All chats</SelectItem>
                  {result.chats.map((c) => (
                    <SelectItem key={c.jid} value={c.jid}>
                      {c.label} ({c.messageCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={onlyWithTimestamp}
                  onCheckedChange={setOnlyWithTimestamp}
                />
                Dated only
              </label>
              <div className="ml-auto flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportData("json")}
                  disabled={filtered.length === 0}
                >
                  <Download className="h-3.5 w-3.5" />
                  JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportData("csv")}
                  disabled={filtered.length === 0}
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Message list */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              Showing{" "}
              <span className="font-medium text-foreground">
                {Math.min(visible.length, filtered.length).toLocaleString()}
              </span>{" "}
              of {filtered.length.toLocaleString()} filtered messages
            </span>
            {filtered.length > limit && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setLimit((l) => l + 200)}
              >
                Load 200 more
              </Button>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Search className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium">No messages match your filters</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Try clearing the search box or switching the source filter to
                &quot;All messages&quot;.
              </p>
            </div>
          ) : (
            <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
              {visible.map((m) => (
                <MessageRow key={m.id} m={m} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {carvedCount === 0 && tableCount > 0 && (
        <Alert className="mt-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>No deleted fragments recovered</AlertTitle>
          <AlertDescription className="text-xs">
            This database has no recoverable text in its free space. This
            usually means WhatsApp has run{" "}
            <code className="font-mono">VACUUM</code> (which overwrites deleted
            data) or the messages were deleted long ago. Recovery is only
            possible while the deleted bytes still physically exist in the file.
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: "emerald" | "amber" | "teal" | "violet";
  highlight?: boolean;
}) {
  const accentMap = {
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    teal: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  };
  return (
    <Card className={highlight ? "border-amber-300 dark:border-amber-800" : ""}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${accentMap[accent]}`}>
            {icon}
          </span>
          {label}
        </div>
        <p className="mt-2 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function MessageRow({ m }: { m: RecoveredMessage }) {
  const isCarved = m.source === "carved";
  return (
    <li className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
      <span
        className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
          isCarved
            ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            : m.fromMe
              ? "bg-emerald-600 text-white"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {isCarved ? <Ghost className="h-4 w-4" /> : senderInitial(m.chat, m.fromMe)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {m.fromMe === null ? "Unknown sender" : m.fromMe ? "Me" : m.chat ? m.chat.split("@")[0] : "Incoming"}
          </span>
          {m.chat && (
            <Badge variant="outline" className="text-[10px] font-normal">
              {m.chat.split("@")[0]}
            </Badge>
          )}
          {isCarved ? (
            <Badge className="gap-1 bg-amber-600 text-[10px] hover:bg-amber-600">
              <Ghost className="h-3 w-3" />
              Recovered
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">
              Live
            </Badge>
          )}
          {m.timestamp && (
            <span className="font-mono text-[11px]">
              {formatTimestamp(m.timestamp)}
            </span>
          )}
          {m.isCaption && (
            <Badge variant="outline" className="text-[10px] font-normal">
              caption
            </Badge>
          )}
          {isCarved && m.confidence !== null && (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px]">
              <Progress
                value={Math.round(m.confidence * 100)}
                className="h-1 w-12 [&>div]:bg-amber-500"
              />
              {Math.round(m.confidence * 100)}%
            </span>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{m.text}</p>
        {isCarved && m.page !== null && (
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            page {m.page}
            {m.offset !== null ? ` · offset ${m.offset}` : ""}
          </p>
        )}
      </div>
    </li>
  );
}
