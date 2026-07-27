// WebUSB device capture + ADB handshake.
// Attempts to connect to a phone over USB, identify it, and (if USB debugging
// is enabled) perform an ADB handshake to pull accessible database files.
//
// Honest limitation: browsers cannot mount a phone's filesystem. WebUSB gives
// raw USB endpoints. If the phone has USB debugging enabled AND the ADB
// interface is exposed, we can attempt the ADB protocol handshake. In practice
// most phones need a companion desktop ADB bridge for full file access — but
// we detect the device, identify it, and try the real handshake here.

export interface UsbDeviceInfo {
  vendorId: number;
  productId: number;
  manufacturer: string;
  productName: string;
  serialNumber: string;
  vendorName: string;
  isLikelyPhone: boolean;
  hasAdbInterface: boolean;
}

export interface CapturedFile {
  name: string;
  size: number;
  /** Source: pulled via ADB, or manually provided */
  source: "adb" | "manual";
  /** The raw bytes, when available */
  data: Uint8Array | null;
}

export interface CaptureResult {
  device: UsbDeviceInfo | null;
  files: CapturedFile[];
  adbConnected: boolean;
  warnings: string[];
  log: string[];
}

interface USBEndpointLike {
  endpointNumber: number;
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "iso" | "control";
}

interface USBAlternateLike {
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
  endpoints: USBEndpointLike[];
}

interface USBDeviceLike {
  vendorId: number;
  productId: number;
  manufacturerName?: string;
  productName?: string;
  serialNumber?: string;
  configurationValue?: number;
  interfaceNumber?: number;
  alternateSetting?: number;
  open: () => Promise<void>;
  close: () => Promise<void>;
  selectConfiguration: (n: number) => Promise<void>;
  claimInterface: (n: number) => Promise<void>;
  selectAlternateInterface: (ifaceNum: number, altSetting: number) => Promise<void>;
  transferOut: (endpoint: number, data: BufferSource) => Promise<{ status: string; bytesWritten: number }>;
  transferIn: (endpoint: number, length: number) => Promise<{ status: string; data: Uint8Array }>;
  configurations?: Array<{
    configurationValue: number;
    interfaces: Array<{
      interfaceNumber: number;
      alternates: USBAlternateLike[];
      alternate: USBAlternateLike;
    }>;
  }>;
}

interface NavigatorUSBLike {
  usb?: {
    requestDevice: (opts: { filters: unknown[] }) => Promise<USBDeviceLike>;
  };
}

function getNavUSB(): NavigatorUSBLike["usb"] | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as unknown as NavigatorUSBLike).usb;
}

export function isWebUsbSupported(): boolean {
  return !!getNavUSB();
}

// Well-known USB vendor IDs for phone manufacturers
const PHONE_VENDORS: Record<number, string> = {
  0x18d1: "Google (Android)",
  0x04e8: "Samsung",
  0x22b8: "Motorola",
  0x0bb4: "HTC",
  0x1004: "LG",
  0x2717: "Xiaomi",
  0x2a70: "OnePlus",
  0x19d2: "ZTE",
  0x12d1: "Huawei",
  0x2237: "Realme",
  0x0fce: "Sony",
  0x0a5c: "Broadcom (various)",
  0x05c6: "Qualcomm (various)",
};

// ADB USB interface class/subclass/protocol
const ADB_CLASS = 0xff;
const ADB_SUBCLASS = 0x42;
const ADB_PROTOCOL = 0x01;

/**
 * Capture a phone via WebUSB: detect the device, identify it, and attempt
 * an ADB handshake if USB debugging is enabled.
 */
export async function capturePhoneViaUsb(
  onLog: (msg: string) => void,
): Promise<CaptureResult> {
  const usb = getNavUSB();
  const log: string[] = [];
  const warnings: string[] = [];
  const files: CapturedFile[] = [];

  const addLog = (msg: string) => {
    log.push(msg);
    onLog(msg);
  };

  if (!usb) {
    warnings.push("WebUSB is not supported in this browser. Use Chrome/Edge on desktop, or upload files manually.");
    return { device: null, files, adbConnected: false, warnings, log };
  }

  addLog("Requesting USB device…");
  let raw: USBDeviceLike;
  try {
    raw = await usb.requestDevice({ filters: [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No device") || msg.includes("cancelled")) {
      warnings.push("No device selected. Connect a phone and try again, or upload files manually.");
    } else {
      warnings.push(`USB request failed: ${msg}`);
    }
    return { device: null, files, adbConnected: false, warnings, log };
  }

  const vendorName = PHONE_VENDORS[raw.vendorId] ?? raw.manufacturerName ?? "Unknown";
  const isLikelyPhone = raw.vendorId in PHONE_VENDORS || (raw.manufacturerName ?? "").toLowerCase().includes("android") || (raw.productName ?? "").toLowerCase().includes("android");

  // If this is clearly not a phone, reject early with clear instructions
  if (!isLikelyPhone && !hasAdbInterface) {
    addLog(`Device: ${raw.productName ?? "Unknown"} (${raw.manufacturerName ?? "Unknown"})`);
    addLog(`VID: 0x${raw.vendorId.toString(16)} · PID: 0x${raw.productId.toString(16)}`);
    addLog("✗ This is NOT a phone — it's a USB device (mouse, keyboard, etc.)");
    addLog("✗ When the USB device picker opens, select your PHONE, not other USB devices.");
    addLog("✗ Look for 'SAMSUNG_Android' or your phone model in the picker.");
    warnings.push("Wrong device selected — this is not a phone. Select your phone in the USB picker (look for 'SAMSUNG_Android' or similar).");
    return { device: null, files, adbConnected: false, warnings, log };
  }

  // Check for ADB interface and discover its endpoints
  let hasAdbInterface = false;
  let adbInterfaceNumber = -1;
  let adbOutEndpoint = -1;
  let adbInEndpoint = -1;
  let adbAltSetting = 0;
  if (raw.configurations) {
    for (const config of raw.configurations) {
      for (const iface of config.interfaces) {
        const alt = iface.alternate ?? iface.alternates?.[0];
        if (
          alt &&
          alt.interfaceClass === ADB_CLASS &&
          alt.interfaceSubclass === ADB_SUBCLASS &&
          alt.interfaceProtocol === ADB_PROTOCOL
        ) {
          hasAdbInterface = true;
          adbInterfaceNumber = iface.interfaceNumber;
          adbAltSetting = iface.alternateSetting ?? 0;
          // Discover bulk IN and OUT endpoints from this interface.
          // WebUSB transferIn/transferOut take the endpoint NUMBER (0-15),
          // NOT the USB endpoint address (which ORs 0x80 for IN direction).
          const endpoints = alt.endpoints ?? [];
          for (const ep of endpoints) {
            if (ep.type === "bulk") {
              if (ep.direction === "out" && adbOutEndpoint < 0) {
                adbOutEndpoint = ep.endpointNumber;
              } else if (ep.direction === "in" && adbInEndpoint < 0) {
                adbInEndpoint = ep.endpointNumber;
              }
            }
          }
          addLog(`ADB endpoints: OUT=${adbOutEndpoint}, IN=${adbInEndpoint} (endpoint numbers 0-15)`);
          break;
        }
      }
      if (hasAdbInterface) break;
    }
  }

  const device: UsbDeviceInfo = {
    vendorId: raw.vendorId,
    productId: raw.productId,
    manufacturer: raw.manufacturerName ?? vendorName,
    productName: raw.productName ?? `${vendorName} device`,
    serialNumber: raw.serialNumber ?? "—",
    vendorName,
    isLikelyPhone,
    hasAdbInterface,
  };

  addLog(`Device: ${device.productName} (${device.manufacturer})`);
  addLog(`VID: 0x${raw.vendorId.toString(16)} · PID: 0x${raw.productId.toString(16)}`);
  addLog(`Serial: ${device.serialNumber}`);
  addLog(`Likely phone: ${isLikelyPhone ? "Yes" : "No"}`);
  addLog(`ADB interface detected: ${hasAdbInterface ? "Yes" : "No"}`);

  // Attempt to open the device
  try {
    await raw.open();
    addLog("USB device opened.");
  } catch (err) {
    warnings.push(`Could not open USB device: ${err instanceof Error ? err.message : String(err)}`);
    return { device, files, adbConnected: false, warnings, log };
  }

  // If ADB interface is present, attempt ADB handshake
  let adbConnected = false;
  if (hasAdbInterface) {
    addLog("Attempting ADB handshake…");
    try {
      const config = raw.configurations?.find(
        (c) => c.interfaces.some((i) => i.interfaceNumber === adbInterfaceNumber),
      ) ?? raw.configurations?.[0];
      if (config) {
        await raw.selectConfiguration(config.configurationValue);
        addLog(`Selected configuration ${config.configurationValue}`);
      }
      // Select the alternate interface (needed before claiming)
      try {
        await raw.selectAlternateInterface(adbInterfaceNumber, adbAltSetting);
        addLog(`Selected alternate ${adbAltSetting} on interface ${adbInterfaceNumber}`);
      } catch {
        // Some devices don't need explicit alternate selection
      }
      await raw.claimInterface(adbInterfaceNumber);
      addLog(`Claimed interface ${adbInterfaceNumber}`);
      // Use discovered endpoints (fallback to defaults if discovery failed)
      const outEp = adbOutEndpoint >= 0 ? adbOutEndpoint : 1;
      const inEp = adbInEndpoint >= 0 ? adbInEndpoint : 1;
      adbConnected = await attemptAdbHandshake(raw, outEp, inEp, addLog);
      if (adbConnected) {
        addLog("ADB handshake successful! Attempting to pull accessible databases…");
        const pulledFiles = await tryPullFilesViaAdb(raw, outEp, inEp, addLog);
        files.push(...pulledFiles);
      }
    } catch (err) {
      warnings.push(`ADB handshake failed: ${err instanceof Error ? err.message : String(err)}`);
      addLog(`ADB handshake failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    addLog("No ADB interface. To pull databases, enable USB debugging on the phone (Settings → Developer Options → USB Debugging), authorize this computer, and retry.");
    warnings.push("No ADB interface found. Enable USB debugging on the phone to capture databases directly, or upload files manually.");
  }

  try {
    await raw.close();
  } catch {
    /* ignore */
  }

  if (!adbConnected) {
    addLog("Device captured but direct file pull not available. Upload database files manually — see the extraction guide for each source.");
  }

  return { device, files, adbConnected, warnings, log };
}

// ---- ADB protocol (minimal, over WebUSB) ----
// The ADB protocol uses a 24-byte header: "CNXN"/"OPEN"/"WRTE"/"OKAY"/"CLSE" + args + payload.

const ADB_HEADER = "host:"; // ADB CNXN message

function stringToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum = (sum + data[i]) & 0xffffffff;
  return sum;
}

function buildAdbMessage(command: string, arg0: number, arg1: number, payload: Uint8Array): Uint8Array {
  const cmdBytes = stringToBytes(command);
  const msg = new Uint8Array(24 + payload.length);
  // command (4 bytes)
  msg.set(cmdBytes, 0);
  // arg0 (4 bytes LE)
  new DataView(msg.buffer).setUint32(4, arg0, true);
  // arg1 (4 bytes LE)
  new DataView(msg.buffer).setUint32(8, arg1, true);
  // payload length (4 bytes LE)
  new DataView(msg.buffer).setUint32(12, payload.length, true);
  // checksum (4 bytes LE)
  new DataView(msg.buffer).setUint32(16, checksum(payload), true);
  // magic (command ^ 0xffffffff, 4 bytes LE)
  const cmdNum = (cmdBytes[0] | (cmdBytes[1] << 8) | (cmdBytes[2] << 16) | (cmdBytes[3] << 24)) >>> 0;
  new DataView(msg.buffer).setUint32(20, cmdNum ^ 0xffffffff, true);
  // payload
  msg.set(payload, 24);
  return msg;
}

async function attemptAdbHandshake(
  device: USBDeviceLike,
  outEndpoint: number,
  inEndpoint: number,
  addLog: (msg: string) => void,
): Promise<boolean> {
  try {
    const systemIdentity = "host::RecoverLink\0";
    const cnxnPayload = stringToBytes(systemIdentity);
    const cnxnMsg = buildAdbMessage("CNXN", 0x01000001, 0x100000, cnxnPayload);
    addLog(`Sending CNXN to OUT endpoint ${outEndpoint}…`);
    await device.transferOut(outEndpoint, cnxnMsg);
    addLog("CNXN sent. Waiting for phone response…");

    // Helper: transferIn with timeout so it doesn't block forever
    const transferInWithTimeout = async (timeoutMs: number): Promise<{ status: string; data: Uint8Array } | null> => {
      try {
        const result = await Promise.race([
          device.transferIn(inEndpoint, 4096),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ]);
        return result as { status: string; data: Uint8Array } | null;
      } catch {
        return null;
      }
    };

    // First attempt: short timeout — phone may respond immediately
    addLog("Checking for immediate response…");
    let response = await transferInWithTimeout(3000);

    if (!response || !response.data || response.data.length < 4) {
      // No immediate response — phone is likely showing "Allow USB debugging?" dialog
      addLog("⏳ No response yet — check your phone NOW!");
      addLog("⏳ Tap 'Allow USB debugging' on the phone screen.");
      addLog("⏳ Waiting up to 30 seconds for authorization…");

      // Retry with longer timeouts — user needs time to tap "Allow"
      for (let i = 0; i < 10; i++) {
        addLog(`  Attempt ${i + 1}/10 — waiting for phone…`);
        response = await transferInWithTimeout(3000);
        if (response && response.data && response.data.length >= 4) break;
        // Re-send CNXN every few attempts in case the phone missed it
        if (i === 3 || i === 6) {
          addLog("  Re-sending CNXN…");
          try { await device.transferOut(outEndpoint, cnxnMsg); } catch {}
        }
      }
    }

    if (!response || !response.data || response.data.length < 4) {
      addLog("✗ No response from phone after 30s.");
      addLog("✗ Make sure USB debugging is enabled AND you tapped 'Allow'.");
      addLog("✗ Try: disconnect phone, reconnect, and run capture again.");
      return false;
    }

    const respCmd = new TextDecoder().decode(response.data.slice(0, 4));
    addLog(`✓ Response received: ${respCmd} (${response.data.length} bytes)`);

    // Handle AUTH response (modern ADB sends AUTH before CNXN)
    if (respCmd === "AUTH") {
      addLog("📋 Phone sent AUTH — waiting for authorization to complete…");
      addLog("📋 If you see 'Allow USB debugging' on the phone, tap ALLOW.");
      // After AUTH, the phone sends CNXN once authorized — wait for it
      for (let i = 0; i < 10; i++) {
        const authResp = await transferInWithTimeout(3000);
        if (authResp && authResp.data && authResp.data.length >= 4) {
          const authCmd = new TextDecoder().decode(authResp.data.slice(0, 4));
          addLog(`  Received: ${authCmd}`);
          if (authCmd === "CNXN") {
            addLog("✓ ADB connection established! Phone authorized.");
            return true;
          }
          if (authCmd === "AUTH") {
            // Another AUTH — keep waiting
            continue;
          }
        }
        addLog(`  Waiting ${i + 1}/10…`);
      }
      addLog("✗ Authorization timed out. Tap 'Allow' on the phone and retry.");
      return false;
    }

    if (respCmd === "CNXN") {
      addLog("✓ ADB connection established!");
      return true;
    }

    if (respCmd === "OKAY") {
      addLog("✓ ADB OKAY — connection accepted.");
      return true;
    }

    addLog(`✗ Unexpected response: ${respCmd}`);
    return false;
  } catch (err) {
    addLog(`✗ ADB handshake error: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// Common database paths to pull via ADB
const ADB_DB_PATHS = [
  "/data/data/com.whatsapp/databases/msgstore.db",
  "/data/data/com.whatsapp/databases/wa.db",
  "/data/data/com.android.providers.contacts/databases/contacts2.db",
  "/data/data/com.android.providers.telephony/databases/mmssms.db",
  "/data/data/com.android.providers.settings/databases/settings.db",
  "/data/data/com.android.chrome/app_chrome/Default/History",
  "/data/data/com.google.android.gms/databases/gservices.db",
];

async function tryPullFilesViaAdb(
  device: USBDeviceLike,
  outEndpoint: number,
  inEndpoint: number,
  addLog: (msg: string) => void,
): Promise<CapturedFile[]> {
  const files: CapturedFile[] = [];

  // Open a SYNC channel to the ADB daemon
  // First, OPEN a stream to "shell:sync" (local-id = 1)
  const openPayload = stringToBytes("sync:\0");
  const openMsg = buildAdbMessage("OPEN", 1, 0, openPayload);
  addLog("Opening SYNC channel…");
  await device.transferOut(outEndpoint, openMsg);

  // Read READY response
  let ready = false;
  for (let i = 0; i < 5; i++) {
    try {
      const resp = await device.transferIn(inEndpoint, 4096);
      if (resp && resp.data && resp.data.length >= 4) {
        const cmd = new TextDecoder().decode(resp.data.slice(0, 4));
        if (cmd === "OKAY" || cmd === "READY") {
          ready = true;
          addLog("SYNC channel opened.");
          break;
        }
      }
    } catch { /* retry */ }
  }

  if (!ready) {
    addLog("Could not open SYNC channel. The phone may not have granted shell access.");
    return files;
  }

  // Try to pull each database file
  for (const path of ADB_DB_PATHS) {
    const fileName = path.split("/").pop() ?? path;
    addLog(`Attempting to pull: ${path}`);
    try {
      const fileData = await adbSyncRecv(device, outEndpoint, inEndpoint, 1, path, addLog);
      if (fileData && fileData.length > 0) {
        files.push({ name: fileName, size: fileData.length, source: "adb", data: fileData });
        addLog(`✓ Pulled ${fileName} (${fileData.length} bytes)`);
      }
    } catch (err) {
      addLog(`  ✗ ${fileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return files;
}

// ADB SYNC:RECV protocol — pull a file from the device
async function adbSyncRecv(
  device: USBDeviceLike,
  outEndpoint: number,
  inEndpoint: number,
  localId: number,
  path: string,
  addLog: (msg: string) => void,
): Promise<Uint8Array | null> {
  // Send SYNC RECV command: "RECV" + path length (4 LE) + path
  const pathBytes = stringToBytes(path);
  const recvHeader = new Uint8Array(8 + pathBytes.length);
  recvHeader.set(stringToBytes("RECV"), 0);
  new DataView(recvHeader.buffer).setUint32(4, pathBytes.length, true);
  recvHeader.set(pathBytes, 8);

  const wrteMsg = buildAdbMessage("WRTE", localId, localId, recvHeader);
  await device.transferOut(outEndpoint, wrteMsg);

  // Read response — expect DATA chunks followed by DONE
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  let done = false;
  let retries = 0;

  while (!done && retries < 50) {
    try {
      const resp = await device.transferIn(inEndpoint, 65536);
      if (!resp || !resp.data || resp.data.length < 4) {
        retries++;
        continue;
      }

      // The response is wrapped in an ADB message. Skip the 24-byte ADB
      // header to get to the SYNC payload.
      const data = resp.data;
      if (data.length < 24) { retries++; continue; }

      const adbCmd = new TextDecoder().decode(data.slice(0, 4));
      const payloadLen = new DataView(data.buffer).getUint32(12, true);

      if (adbCmd === "WRTE" && payloadLen >= 8) {
        // SYNC payload starts at offset 24
        const syncPayload = data.slice(24, 24 + payloadLen);
        if (syncPayload.length >= 8) {
          const syncCmd = new TextDecoder().decode(syncPayload.slice(0, 4));
          const chunkLen = new DataView(syncPayload.buffer, syncPayload.byteOffset).getUint32(4, true);

          if (syncCmd === "DATA" && chunkLen > 0) {
            const chunk = syncPayload.slice(8, 8 + chunkLen);
            chunks.push(chunk);
            totalLen += chunk.length;
          } else if (syncCmd === "DONE") {
            done = true;
            addLog(`  RECV complete: ${totalLen} bytes`);
          } else if (syncCmd === "FAIL") {
            const failMsg = new TextDecoder().decode(syncPayload.slice(8, 8 + chunkLen));
            addLog(`  RECV failed: ${failMsg}`);
            return null;
          }
        }

        // Send OKAY acknowledgment
        const okayMsg = buildAdbMessage("OKAY", localId, localId, new Uint8Array(0));
        await device.transferOut(outEndpoint, okayMsg);
      } else if (adbCmd === "CLSE") {
        done = true;
      }
    } catch {
      retries++;
    }
  }

  if (chunks.length === 0) return null;

  // Combine all chunks
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
