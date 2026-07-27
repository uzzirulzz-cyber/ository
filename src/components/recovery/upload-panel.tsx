"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  FileWarning,
  FlaskConical,
  Loader2,
  Lock,
  Search,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { analyseWhatsAppDatabase, formatBytes } from "@/lib/whatsapp/forensics";
import { generateSampleDatabase } from "@/lib/whatsapp/sample-db";
import type {
  AnalysisProgress,
  AnalysisResult,
} from "@/lib/whatsapp/types";
import { useToast } from "@/hooks/use-toast";

interface Props {
  onResult: (result: AnalysisResult, savedSessionId: string | null) => void;
  onSessionSaved: () => void;
}

export function UploadPanel({ onResult, onSessionSaved }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setFileName(file.name);
      // Basic sanity check: SQLite file magic is "SQLite format 3\0"
      if (file.size < 100) {
        setError("That file is too small to be a WhatsApp database.");
        return;
      }
      try {
        const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
        const magic = new TextDecoder().decode(head);
        if (!magic.startsWith("SQLite format 3")) {
          setError(
            "This file is not a SQLite database. A WhatsApp msgstore.db starts with the bytes \"SQLite format 3\". See the guide below to obtain one.",
          );
          return;
        }
      } catch {
        /* ignore header read errors */
      }

      setBusy(true);
      setProgress({ phase: "loading", message: "Starting…", percent: 0 });
      try {
        const result = await analyseWhatsAppDatabase(file, (p) =>
          setProgress(p),
        );
        if (result.status === "failed") {
          setError(
            result.warnings[0] ??
              "Analysis failed — the file could not be parsed as a WhatsApp database.",
          );
          setBusy(false);
          setProgress(null);
          return;
        }

        // Persist the FULL result (session metadata + every recovered message)
        // to MongoDB so this recovery can be re-opened later.
        setProgress({
          phase: "finalizing",
          message: `Saving ${result.messages.length} messages to cloud…`,
          percent: 98,
        });
        let savedSessionId: string | null = null;
        try {
          const res = await fetch("/api/recovery", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: result.fileName,
              fileSizeBytes: result.fileSizeBytes,
              existingMessages: result.existingMessages,
              recoveredFragments: result.recoveredFragments,
              chatCount: result.chatCount,
              durationMs: result.durationMs,
              status: result.status,
              fileHash: result.fileHash,
              note: null,
              chats: result.chats,
              messages: result.messages,
            }),
          });
          if (res.ok) {
            const json = await res.json();
            savedSessionId = json.id as string;
            onSessionSaved();
          } else {
            console.warn("Save failed:", await res.text());
          }
        } catch (saveErr) {
          console.warn("Save threw:", saveErr);
        }

        toast({
          title: savedSessionId ? "Recovery complete & saved" : "Recovery complete (not saved)",
          description: `${result.recoveredFragments} deleted fragment${result.recoveredFragments === 1 ? "" : "s"} recovered from ${result.existingMessages} live message${result.existingMessages === 1 ? "" : "s"}.${savedSessionId ? "" : " Cloud save failed — results are still viewable."}`,
        });
        onResult(result, savedSessionId);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Unexpected error during analysis.",
        );
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [onResult, onSessionSaved, toast],
  );

  // Generate a real sample msgstore.db in-browser (with deleted messages to
  // carve) and run it through the same analyzer + save flow.
  const handleSample = useCallback(async () => {
    setError(null);
    setBusy(true);
    setProgress({ phase: "loading", message: "Building sample database…", percent: 10 });
    try {
      const file = await generateSampleDatabase((msg) =>
        setProgress({ phase: "loading", message: msg, percent: 15 }),
      );
      // Feed the generated file to the standard handler (analysis + save).
      await handleFile(file);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not build sample database: ${err.message}`
          : "Could not build sample database.",
      );
      setBusy(false);
      setProgress(null);
    }
  }, [handleFile]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
            <Search className="h-3.5 w-3.5" />
            Forensic deleted-message recovery
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Recover deleted WhatsApp
            <span className="block text-emerald-600 dark:text-emerald-400">
              messages from a msgstore.db
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-sm text-muted-foreground sm:text-base">
            Upload a WhatsApp{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
              msgstore.db
            </code>{" "}
            file. RecoverLink reads your existing messages with the real SQLite
            engine (WebAssembly) and{" "}
            <span className="font-medium text-foreground">
              carves deleted messages out of the database&apos;s free space
            </span>{" "}
            using the same technique forensic tools use. Everything runs in your
            browser — your data never leaves your machine.
          </p>

          <div className="mt-5 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5">
              <Lock className="h-3.5 w-3.5 text-emerald-600" />
              No upload to any server
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              Reads metadata only for history
            </span>
          </div>
        </div>

        {/* Dropzone */}
        <div>
          <Card
            className={`border-2 border-dashed transition-colors ${
              dragOver
                ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30"
                : "border-border"
            }`}
          >
            <CardContent className="p-6">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className="flex flex-col items-center justify-center gap-3 py-6 text-center"
              >
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <UploadCloud className="h-7 w-7" />
                </span>
                <div>
                  <p className="text-sm font-medium">
                    Drag &amp; drop your{" "}
                    <span className="font-mono">msgstore.db</span> here
                  </p>
                  <p className="text-xs text-muted-foreground">
                    or click to browse — SQLite database files only
                  </p>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".db,.sqlite,.sqlite3,application/x-sqlite3"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <UploadCloud className="h-4 w-4" />
                  Select database file
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSample}
                  disabled={busy}
                  className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
                >
                  <FlaskConical className="h-4 w-4" />
                  Try a sample database
                </Button>
              </div>

              {busy && progress && (
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {progress.message}
                    </span>
                    <span className="font-mono">{progress.percent}%</span>
                  </div>
                  <Progress
                    value={progress.percent}
                    className="h-2 [&>div]:bg-emerald-500"
                  />
                  {fileName && (
                    <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                      {fileName}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <Alert variant="destructive" className="mt-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Cannot analyse this file</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* How to obtain the file — honest prerequisite */}
      <Card className="mt-6">
        <CardContent className="p-5 sm:p-6">
          <div className="mb-3 flex items-center gap-2">
            <FileWarning className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold">
              How to get your msgstore.db
            </h2>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            WhatsApp stores messages in an encrypted SQLite database that lives
            inside Android&apos;s app sandbox. A browser cannot reach it over a
            USB cable, so you provide the database file itself. Pick whichever
            route matches your device:
          </p>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="backup">
              <AccordionTrigger className="text-sm">
                From a local backup (.crypt14 / .crypt15)
              </AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">
                Copy{" "}
                <code className="font-mono">
                  /sdcard/WhatsApp/Backups/msgstore.db.crypt15
                </code>{" "}
                to a computer and decrypt it with your 64-digit backup key
                using an open-source tool such as{" "}
                <span className="font-medium">wa-crypt-tools</span> or{" "}
                <span className="font-medium">bkcrack</span>. The decrypted
                output is the plain <code className="font-mono">msgstore.db</code>{" "}
                you drop here. The 64-digit key comes from your Google Drive
                backup settings or the key file on a rooted device.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="root">
              <AccordionTrigger className="text-sm">
                From a rooted phone (most reliable)
              </AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">
                On a rooted device, pull the live database with ADB:
                <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-2 font-mono text-[11px]">
                  adb shell su -c &quot;cat
                  /data/data/com.whatsapp/databases/msgstore.db&quot; &gt;
                  msgstore.db
                </pre>
                This file opens directly here — no decryption needed.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="chat-export">
              <AccordionTrigger className="text-sm">
                I don&apos;t have either — what can I do?
              </AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">
                Without the database file, deleted-message recovery is not
                possible from a browser — no web tool can do it, regardless of
                marketing claims. You can still export your current chats from
                WhatsApp → chat → Export Chat, but those exports only contain
                messages that still exist at export time, not previously deleted
                ones. For genuine deleted-message recovery you need the{" "}
                <code className="font-mono">msgstore.db</code> as described
                above.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </section>
  );
}
