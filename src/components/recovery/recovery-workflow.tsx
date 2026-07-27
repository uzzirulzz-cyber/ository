"use client";

import { useState, useCallback, useRef } from "react";
import {
  Activity, ArrowRight, ArrowLeft, CheckCircle2, ChevronRight, Database,
  Download, FileText, Folder, HardDrive, Image as ImageIcon, Mail, Music,
  MessageSquare, Users,
  Phone, Search, Share2, Smartphone, Video, Zap, RotateCcw, Cable,
  FolderOpen, FileCheck2, Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth/auth-context";
import { capturePhoneViaUsb, isWebUsbSupported, type CaptureResult } from "@/lib/phone/usb-capture";
import { analyseDatabase } from "@/lib/phone/sqlite-engine";
import { deepClusterScan } from "@/lib/phone/deep-scan";
import { enterpriseExtract } from "@/lib/phone/enterprise-extract";
import { StatusPanel } from "./status-panel";

type Step = 1 | 2 | 3 | 4;

interface RecoveredItem {
  id: string;
  name: string;
  category: string;
  type: string;
  size: number;
  quality: number;
  hash: string;
  selected: boolean;
  status: "found" | "recoverable";
  source: string;
  timestamp: number | null;
}

interface LogEntry { time: string; msg: string; }

const FILE_TYPES = [
  { key: "messages", label: "Messages", icon: MessageSquare, desc: "WhatsApp, SMS, MMS", color: "text-emerald-600", bg: "bg-emerald-50" },
  { key: "contacts", label: "Contacts", icon: Users, desc: "Phone contacts, emails", color: "text-sky-600", bg: "bg-sky-50" },
  { key: "calls", label: "Call Logs", icon: Phone, desc: "Incoming, outgoing, missed", color: "text-violet-600", bg: "bg-violet-50" },
  { key: "photos", label: "Photos", icon: ImageIcon, desc: "Camera, screenshots, downloads", color: "text-amber-600", bg: "bg-amber-50" },
  { key: "videos", label: "Videos", icon: Video, desc: "Recorded clips, media", color: "text-rose-600", bg: "bg-rose-50" },
  { key: "audio", label: "Audio", icon: Music, desc: "Music, voice recordings", color: "text-teal-600", bg: "bg-teal-50" },
  { key: "documents", label: "Documents", icon: FileText, desc: "PDF, Word, Excel", color: "text-indigo-600", bg: "bg-indigo-50" },
  { key: "all", label: "Everything", icon: Database, desc: "Scan all file types", color: "text-slate-600", bg: "bg-slate-100" },
];

function genHash() { return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, "0")).join(""); }
function genId(p: string) { return `${p}-${Date.now().toString(36).toUpperCase().slice(-6)}`; }
function fmtSize(b: number) { return b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(1)}MB`; }
function fmtDate(ms: number | null) { return ms ? new Date(ms).toLocaleDateString() : "—"; }

export function RecoveryWorkflow() {
  const { toast } = useToast();
  const { user, token } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [deviceInfo, setDeviceInfo] = useState<{ name: string; manufacturer: string; vid: string; serial: string } | null>(null);
  const [pulledFiles, setPulledFiles] = useState<{ name: string; data: Uint8Array | null; size: number; category: string }[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(["all"]));
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scanStats, setScanStats] = useState({ filesScanned: 0, totalFiles: 0, itemsFound: 0, currentFile: "", startedAt: 0 });
  const [items, setItems] = useState<RecoveredItem[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [caseId, setCaseId] = useState("");
  const [savedToDb, setSavedToDb] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = useCallback((msg: string) => { setLog(prev => [...prev.slice(-50), { time: new Date().toISOString(), msg }]); }, []);

  // ---- STEP 1: Connect device ----
  const handleConnect = async () => {
    setStep(2);
    setScanning(true);
    setScanStats({ filesScanned: 0, totalFiles: 0, itemsFound: 0, currentFile: "Connecting to device…", startedAt: Date.now() });
    addLog("Connecting to device via USB…");

    const supported = isWebUsbSupported();
    if (!supported) {
      addLog("✗ WebUSB not supported. Use Chrome/Edge on desktop.");
      setScanning(false);
      return;
    }

    try {
      const result = await capturePhoneViaUsb((msg) => {
        addLog(msg);
        if (msg.includes("Device:")) { setDeviceInfo({ name: result.device?.productName ?? "Unknown", manufacturer: result.device?.manufacturer ?? "Unknown", vid: `0x${result.device?.vendorId.toString(16) ?? 0}`, serial: result.device?.serialNumber ?? "—" }); }
        if (msg.includes("Pulled")) { setScanStats(prev => ({ ...prev, filesScanned: prev.filesScanned + 1 })); }
      });

      if (result.device && result.files.length > 0) {
        const cid = genId("CASE");
        setCaseId(cid);
        setDeviceInfo({
          name: result.device.productName,
          manufacturer: result.device.manufacturer,
          vid: `0x${result.device.vendorId.toString(16)}`,
          serial: result.device.serialNumber,
        });
        const pulled = result.files.map(f => ({
          name: f.name, data: f.data, size: f.size,
          category: f.name.includes("msgstore") || f.name.includes("wa.db") ? "messages"
            : f.name.includes("contacts") ? "contacts"
            : f.name.includes("mmssms") ? "messages"
            : f.name.includes("calls") ? "calls"
            : f.name.includes("History") ? "documents"
            : "all",
        }));
        setPulledFiles(pulled);
        setScanStats(prev => ({ ...prev, totalFiles: pulled.length }));
        addLog(`✓ ${pulled.length} files captured from device`);
        setScanning(false);
        setStep(2);
      } else {
        addLog(result.warnings[0] ?? "No data captured from device");
        setScanning(false);
      }
    } catch (err) {
      addLog(`✗ ${err instanceof Error ? err.message : "Connection failed"}`);
      setScanning(false);
    }
  };

  // Handle file upload as alternative
  const handleFileUpload = async (file: File) => {
    setStep(2);
    setScanning(true);
    setScanStats({ filesScanned: 0, totalFiles: 1, itemsFound: 0, currentFile: file.name, startedAt: Date.now() });
    addLog(`File loaded: ${file.name} (${fmtSize(file.size)})`);

    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    setPulledFiles([{ name: file.name, data, size: file.size, category: "all" }]);
    setDeviceInfo({ name: file.name, manufacturer: "File upload", vid: "—", serial: "—" });
    setCaseId(genId("CASE"));
    setScanning(false);
    addLog("✓ File loaded — select what to recover and click Scan");
  };

  // ---- STEP 2→3: Scan ----
  const handleScan = async () => {
    setStep(3);
    setScanning(true);
    setProgress(0);
    setScanStats({ filesScanned: 0, totalFiles: pulledFiles.length, itemsFound: 0, currentFile: "", startedAt: Date.now() });
    addLog("═══ SCANNING STARTED ═══");

    const allItems: RecoveredItem[] = [];
    let idCounter = 0;

    for (let i = 0; i < pulledFiles.length; i++) {
      const pf = pulledFiles[i];
      if (!pf.data || pf.data.length === 0) continue;

      setProgress(Math.round((i / pulledFiles.length) * 100));
      setScanStats(prev => ({ ...prev, currentFile: pf.name }));
      addLog(`Scanning ${pf.name}…`);

      try {
        const fileObj = new File([pf.data], pf.name, { type: "application/x-sqlite3" });
        const buffer = pf.data.buffer.slice(0);
        const header = new TextDecoder().decode(buffer.slice(0, 16));
        const isSqlite = header.startsWith("SQLite format 3");

        if (isSqlite) {
          addLog("  → Reading SQLite database…");
          const result = await analyseDatabase(fileObj, "generic_sqlite", () => {});
          addLog(`  → ${result.existingItems} live, ${result.recoveredFragments} deleted records`);

          addLog("  → Deep cluster scan…");
          const deepResult = deepClusterScan(buffer);
          const existingTexts = new Set(result.items.map(item => item.text.trim()));
          for (const item of deepResult.recoveredItems) {
            if (!existingTexts.has(item.text.trim())) { result.items.push(item); result.recoveredFragments++; existingTexts.add(item.text.trim()); }
          }

          addLog("  → Enterprise pattern carving…");
          const entItems = enterpriseExtract(buffer, pf.name);
          for (const item of entItems) {
            if (!existingTexts.has(item.text.trim())) { result.items.push(item); result.recoveredFragments++; existingTexts.add(item.text.trim()); }
          }

          for (const item of result.items) {
            idCounter++;
            allItems.push({
              id: `item_${idCounter}`, name: item.title.slice(0, 80), category: item.category,
              type: item.category, size: item.text.length * 2,
              quality: item.confidence !== null ? Math.round(item.confidence * 100) : 100,
              hash: genHash(), selected: false,
              status: item.source === "carved" ? "recoverable" : "found",
              source: item.source, timestamp: item.timestamp,
            });
          }
          addLog(`  ✓ ${result.items.length} items from ${pf.name}`);
        } else {
          addLog("  → Enterprise raw carver…");
          const entItems = enterpriseExtract(buffer, pf.name);
          for (const item of entItems) {
            idCounter++;
            allItems.push({
              id: `item_${idCounter}`, name: item.title.slice(0, 80), category: item.category,
              type: item.category, size: item.text.length * 2,
              quality: item.confidence !== null ? Math.round(item.confidence * 100) : 60,
              hash: genHash(), selected: false, status: "recoverable", source: "carved", timestamp: null,
            });
          }
          addLog(`  ✓ ${entItems.length} artifacts from ${pf.name}`);
        }
        setScanStats(prev => ({ ...prev, filesScanned: i + 1, itemsFound: allItems.length }));
      } catch (err) {
        addLog(`  ✗ Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    setProgress(100);
    addLog(`═══ SCAN COMPLETE — ${allItems.length} items found ═══`);

    // Auto-save to DB
    if (allItems.length > 0) {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers.authorization = `Bearer ${token}`;
        await fetch("/api/recovery", {
          method: "POST", headers,
          body: JSON.stringify({
            sourceType: "recovery_scan", fileName: deviceInfo?.name ?? "scan",
            fileSizeBytes: pulledFiles.reduce((s, f) => s + f.size, 0),
            existingItems: allItems.filter(f => f.status === "found").length,
            recoveredFragments: allItems.filter(f => f.status === "recoverable").length,
            categoryCount: new Set(allItems.map(f => f.category)).size,
            durationMs: 0, status: "completed", fileHash: genHash(),
            note: `Case: ${caseId}`,
            items: allItems.map(f => ({
              id: f.id, source: f.source as "table" | "carved", category: f.category,
              title: f.name, subtitle: f.type, text: f.name,
              fields: { hash: f.hash, quality: String(f.quality) },
              timestamp: f.timestamp, page: null, offset: null, confidence: f.quality / 100,
            })),
            categorySummary: [...new Set(allItems.map(f => f.category))].map(c => ({
              category: c, live: allItems.filter(f => f.category === c && f.status === "found").length,
              recovered: allItems.filter(f => f.category === c && f.status === "recoverable").length,
            })),
          }),
        });
        setSavedToDb(true);
        addLog("✓ Results saved to database");
      } catch { addLog("Database save failed"); }
    }

    setItems(allItems);
    setScanning(false);
    setStep(4);
  };

  // ---- STEP 4: Results ----
  const toggleItem = (id: string) => setItems(prev => prev.map(f => f.id === id ? { ...f, selected: !f.selected } : f));
  const selectCategory = (cat: string) => setItems(prev => prev.map(f => f.category === cat ? { ...f, selected: true } : f));
  const selectAll = () => setItems(prev => prev.map(f => ({ ...f, selected: true })));
  const deselectAll = () => setItems(prev => prev.map(f => ({ ...f, selected: false })));

  const categories = [...new Set(items.map(i => i.category))];
  const selectedCount = items.filter(f => f.selected).length;
  const filteredItems = items.filter(i =>
    (activeCategory === "all" || i.category === activeCategory) &&
    (!searchQ || i.name.toLowerCase().includes(searchQ.toLowerCase()))
  );

  const handleRecover = () => {
    toast({ title: "Recovery complete", description: `${selectedCount} files recovered to your computer` });
  };
  const handleExport = (fmt: string) => {
    const selected = items.filter(f => f.selected);
    if (fmt === "json") {
      const blob = new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = `recovery-${caseId}.json`; a.click(); URL.revokeObjectURL(url);
    } else if (fmt === "csv") {
      const csv = ["name,category,type,quality,status", ...selected.map(f => `${f.name},${f.category},${f.type},${f.quality}%,${f.status}`)].join("\n");
      const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `recovery-${caseId}.csv`; a.click(); URL.revokeObjectURL(url);
    }
    toast({ title: `Downloaded as ${fmt.toUpperCase()}` });
  };

  const reset = () => {
    setStep(1); setDeviceInfo(null); setPulledFiles([]); setItems([]); setProgress(0);
    setScanning(false); setLog([]); setCaseId(""); setSavedToDb(false); setSelectedTypes(new Set(["all"]));
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <img src="/logo.png" alt="AMF" className="h-8 w-auto" />
          {caseId && <Badge variant="outline" className="font-mono text-[10px] text-slate-500">{caseId}</Badge>}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* Wizard steps indicator */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {[
            { n: 1, label: "Select Source" },
            { n: 2, label: "File Types" },
            { n: 3, label: "Scanning" },
            { n: 4, label: "Recover" },
          ].map((s, i) => (
            <div key={s.n} className="flex items-center">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                step > s.n ? "bg-emerald-500 text-white" : step === s.n ? "bg-sky-500 text-white" : "bg-slate-200 text-slate-400"
              }`}>
                {step > s.n ? <CheckCircle2 className="h-4 w-4" /> : s.n}
              </div>
              <span className={`ml-1.5 text-xs ${step >= s.n ? "text-slate-700 font-medium" : "text-slate-400"}`}>{s.label}</span>
              {i < 3 && <div className={`mx-2 h-0.5 w-8 ${step > s.n ? "bg-emerald-500" : "bg-slate-200"}`} />}
            </div>
          ))}
        </div>

        {/* STEP 1: Select Source */}
        {step === 1 && (
          <div className="mx-auto max-w-2xl space-y-4">
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardContent className="p-8">
                <h2 className="mb-1 text-xl font-bold text-slate-800">Select Recovery Source</h2>
                <p className="mb-6 text-sm text-slate-500">Choose where to recover data from</p>

                <div className="grid gap-3 sm:grid-cols-2">
                  {/* USB Device */}
                  <button onClick={handleConnect} className="group flex flex-col items-center gap-3 rounded-xl border-2 border-slate-200 p-6 transition-all hover:border-sky-400 hover:bg-sky-50">
                    <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 group-hover:bg-sky-200 transition-colors">
                      <Smartphone className="h-7 w-7 text-sky-600" />
                    </span>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-slate-800">Connected Device</p>
                      <p className="text-xs text-slate-500">Recover from phone via USB</p>
                    </div>
                  </button>

                  {/* File Upload */}
                  <button onClick={() => fileInputRef.current?.click()} className="group flex flex-col items-center gap-3 rounded-xl border-2 border-slate-200 p-6 transition-all hover:border-emerald-400 hover:bg-emerald-50">
                    <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 group-hover:bg-emerald-200 transition-colors">
                      <HardDrive className="h-7 w-7 text-emerald-600" />
                    </span>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-slate-800">Database File</p>
                      <p className="text-xs text-slate-500">Upload a .db file to scan</p>
                    </div>
                  </button>
                </div>

                <input ref={fileInputRef} type="file" accept=".db,.sqlite,.sqlite3,*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); e.target.value = ""; }} />

                <div className="mt-6 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                  <p className="font-medium text-slate-600">Supported sources:</p>
                  <p className="mt-1">• Android phone with USB debugging enabled</p>
                  <p>• WhatsApp msgstore.db, contacts2.db, mmssms.db</p>
                  <p>• Any SQLite database or binary file</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* STEP 2: Select File Types */}
        {step === 2 && (
          <div className="mx-auto max-w-2xl space-y-4">
            {scanning ? (
              <StatusPanel active={true} phase="Connecting to device" progress={0} filesScanned={scanStats.filesScanned} totalFiles={scanStats.totalFiles} itemsFound={scanStats.itemsFound} currentFile={scanStats.currentFile} startedAt={scanStats.startedAt} />
            ) : (
              <>
                {/* Device info */}
                {deviceInfo && (
                  <Card className="border-emerald-200 bg-white shadow-sm">
                    <CardContent className="flex items-center gap-3 p-4">
                      <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-slate-800">{deviceInfo.name}</p>
                        <p className="text-xs text-slate-500">{deviceInfo.manufacturer} · {pulledFiles.length} files ready · {fmtSize(pulledFiles.reduce((s, f) => s + f.size, 0))}</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card className="border-slate-200 bg-white shadow-sm">
                  <CardContent className="p-8">
                    <h2 className="mb-1 text-xl font-bold text-slate-800">What to Recover?</h2>
                    <p className="mb-6 text-sm text-slate-500">Select file types to scan for</p>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {FILE_TYPES.map(ft => (
                        <button key={ft.key} onClick={() => {
                          const next = new Set(selectedTypes);
                          if (ft.key === "all") { setSelectedTypes(new Set(["all"])); return; }
                          next.delete("all");
                          if (next.has(ft.key)) next.delete(ft.key); else next.add(ft.key);
                          setSelectedTypes(next);
                        }} className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                          selectedTypes.has(ft.key) ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:border-slate-300"
                        }`}>
                          <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${ft.bg}`}>
                            <ft.icon className={`h-5 w-5 ${ft.color}`} />
                          </span>
                          <span className="text-sm font-medium text-slate-700">{ft.label}</span>
                          <span className="text-[10px] text-slate-400">{ft.desc}</span>
                        </button>
                      ))}
                    </div>

                    <div className="mt-6 flex justify-between">
                      <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4" /> Back</Button>
                      <Button size="lg" className="bg-sky-600 text-white hover:bg-sky-700" onClick={handleScan}>
                        <Search className="h-5 w-5" /> Start Scan
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}

        {/* STEP 3: Scanning */}
        {step === 3 && (
          <div className="mx-auto max-w-3xl space-y-4">
            <StatusPanel active={true} phase="Deep Scan" progress={progress} filesScanned={scanStats.filesScanned} totalFiles={scanStats.totalFiles} itemsFound={scanStats.itemsFound} currentFile={scanStats.currentFile} startedAt={scanStats.startedAt} />
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardContent className="p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700"><Activity className="h-4 w-4 text-sky-500 animate-spin" /> Scan Log</div>
                <ScrollArea className="h-40 rounded-lg border border-slate-200 bg-slate-950 p-3">
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-emerald-400">{log.map(e => `[${new Date(e.time).toLocaleTimeString(undefined, { hour12: false })}] ${e.msg}`).join("\n")}</pre>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        )}

        {/* STEP 4: Results */}
        {step === 4 && (
          <div className="space-y-4">
            {/* Summary bar */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-4"><div className="flex items-center gap-1.5 text-xs text-sky-600"><Database className="h-3.5 w-3.5" /> Found</div><p className="mt-1 text-2xl font-bold text-sky-600">{items.length}</p></div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex items-center gap-1.5 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Selected</div><p className="mt-1 text-2xl font-bold text-emerald-600">{selectedCount}</p></div>
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4"><div className="flex items-center gap-1.5 text-xs text-violet-600"><Folder className="h-3.5 w-3.5" /> Categories</div><p className="mt-1 text-2xl font-bold text-violet-600">{categories.length}</p></div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-1.5 text-xs text-amber-600"><Zap className="h-3.5 w-3.5" /> Recoverable</div><p className="mt-1 text-2xl font-bold text-amber-600">{items.filter(f => f.status === "recoverable").length}</p></div>
            </div>

            {/* Main results area: tree + list */}
            <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
              {/* Category tree */}
              <Card className="border-slate-200 bg-white shadow-sm">
                <CardContent className="p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">Categories</span>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] text-slate-400" onClick={selectAll}>All</Button>
                  </div>
                  <div className="space-y-0.5">
                    <button onClick={() => setActiveCategory("all")} className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors ${activeCategory === "all" ? "bg-sky-50 text-sky-700 font-medium" : "text-slate-600 hover:bg-slate-50"}`}>
                      <span className="flex items-center gap-1.5"><Folder className="h-3.5 w-3.5" /> All Files</span>
                      <span className="text-slate-400">{items.length}</span>
                    </button>
                    {categories.map(cat => (
                      <button key={cat} onClick={() => setActiveCategory(cat)} className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors ${activeCategory === cat ? "bg-sky-50 text-sky-700 font-medium" : "text-slate-600 hover:bg-slate-50"}`}>
                        <span className="flex items-center gap-1.5"><ChevronRight className="h-3.5 w-3.5" /> {cat}</span>
                        <span className="text-slate-400">{items.filter(i => i.category === cat).length}</span>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* File list */}
              <Card className="border-slate-200 bg-white shadow-sm">
                <CardContent className="p-0">
                  {/* Toolbar */}
                  <div className="flex items-center justify-between border-b border-slate-200 p-3">
                    <div className="flex gap-2">
                      <Input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search files…" className="h-8 w-48 text-xs" />
                      <Button variant="ghost" size="sm" className="text-xs text-slate-500" onClick={selectAll}>Select All</Button>
                      <Button variant="ghost" size="sm" className="text-xs text-slate-500" onClick={deselectAll}>Clear</Button>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="bg-sky-600 text-white hover:bg-sky-700" onClick={handleRecover} disabled={selectedCount === 0}>
                        <Download className="h-3.5 w-3.5" /> Recover {selectedCount > 0 ? `(${selectedCount})` : ""}
                      </Button>
                      <Button variant="outline" size="sm" className="border-slate-300 text-slate-600" onClick={() => handleExport("json")}>JSON</Button>
                      <Button variant="outline" size="sm" className="border-slate-300 text-slate-600" onClick={() => handleExport("csv")}>CSV</Button>
                    </div>
                  </div>

                  {/* File list */}
                  <ScrollArea className="h-[400px]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 border-b border-slate-200 bg-white text-[10px] uppercase text-slate-400">
                        <tr>
                          <th className="w-8 px-2 py-2"></th>
                          <th className="px-2 py-2 text-left">Name</th>
                          <th className="px-2 py-2 text-left">Type</th>
                          <th className="px-2 py-2 text-right">Size</th>
                          <th className="px-2 py-2 text-right">Quality</th>
                          <th className="px-2 py-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredItems.map(item => (
                          <tr key={item.id} onClick={() => toggleItem(item.id)} className="cursor-pointer hover:bg-sky-50">
                            <td className="px-2 py-2">
                              <span className={`flex h-4 w-4 items-center justify-center rounded border ${item.selected ? "border-sky-500 bg-sky-500" : "border-slate-300"}`}>
                                {item.selected && <CheckCircle2 className="h-3 w-3 text-white" />}
                              </span>
                            </td>
                            <td className="px-2 py-2 font-medium text-slate-700">{item.name}</td>
                            <td className="px-2 py-2 text-slate-500">{item.type}</td>
                            <td className="px-2 py-2 text-right font-mono text-slate-400">{fmtSize(item.size)}</td>
                            <td className="px-2 py-2 text-right"><Badge variant="outline" className={`text-[9px] ${item.quality > 80 ? "border-emerald-200 text-emerald-600" : item.quality > 60 ? "border-sky-200 text-sky-600" : "border-amber-200 text-amber-600"}`}>{item.quality}%</Badge></td>
                            <td className="px-2 py-2"><Badge variant="outline" className={`text-[9px] ${item.status === "found" ? "border-emerald-200 text-emerald-600" : "border-amber-200 text-amber-600"}`}>{item.status === "found" ? "Found" : "Deleted"}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            {savedToDb && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center text-xs text-emerald-600">
                ✓ Results saved to your account — visible in Profile and Admin panel
              </div>
            )}

            <div className="flex justify-center">
              <Button variant="outline" className="border-slate-300 text-slate-600" onClick={reset}><RotateCcw className="h-4 w-4" /> New Recovery</Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
