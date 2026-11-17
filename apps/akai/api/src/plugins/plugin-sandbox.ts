import {
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
  getQuickJS,
  shouldInterruptAfterDeadline,
} from "quickjs-emscripten";
import { PLUGIN_LIMITS, PRELUDE } from "./plugin-logic";

/** `fetch` milik host: menerima URL & init (JSON) dari plugin, mengembalikan JSON `{ status, url, headers, body }`. */
export type HostFetch = (url: string, initJson: string) => Promise<string>;

let quickjs: Promise<QuickJSWASMModule> | null = null;
const engine = () => (quickjs ??= getQuickJS());

/** Pesan galat dari nilai galat QuickJS (Error → "Nama: pesan", lainnya → teks). */
function errorMessage(vm: QuickJSContext, handle: QuickJSHandle) {
  const value = vm.dump(handle) as unknown;
  if (value && typeof value === "object" && "message" in value) {
    const { name, message } = value as { name?: string; message?: string };
    if (message === "interrupted") return "Plugin dihentikan: melewati batas waktu.";
    if (message === "out of memory" || (name === "InternalError" && /memory/i.test(String(message))))
      return "Plugin dihentikan: melewati batas memori.";
    return `${name ?? "Error"}: ${message ?? ""}`;
  }
  return String(value);
}

class PluginError extends Error {}

/**
 * Satu eksekusi sandbox: runtime QuickJS baru (memori & waktu dibatasi) berisi prelude + kode plugin. Kode plugin tidak punya
 * akses ke berkas, proses, modul Node, atau jaringan — selain `akai.fetch` yang diteruskan host dengan pemeriksaan izin.
 */
class Sandbox {
  readonly logs: string[] = [];
  private readonly deferreds = new Set<QuickJSDeferredPromise>();
  private alive = true;

  private constructor(
    readonly rt: QuickJSRuntime,
    readonly vm: QuickJSContext,
  ) {}

  static async open(code: string, deadlineMs: number, fetcher?: HostFetch) {
    const module = await engine();
    const rt = module.newRuntime();
    rt.setMemoryLimit(PLUGIN_LIMITS.memoryBytes);
    rt.setMaxStackSize(1024 * 1024);
    rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + deadlineMs));
    const box = new Sandbox(rt, rt.newContext());
    try {
      box.installHost(fetcher);
      box.evalOrThrow(PRELUDE, "prelude.js");
      box.evalOrThrow(code, "plugin.js");
    } catch (error) {
      box.close();
      throw error;
    }
    return box;
  }

  private installHost(fetcher?: HostFetch) {
    const { vm } = this;
    const log = vm.newFunction("__hostLog", (arg) => {
      if (this.logs.length < PLUGIN_LIMITS.logLines) this.logs.push(vm.getString(arg).slice(0, 500));
    });
    vm.setProp(vm.global, "__hostLog", log);
    log.dispose();
    const fetch = vm.newFunction("__hostFetch", (urlHandle, initHandle) => {
      const deferred = vm.newPromise();
      this.deferreds.add(deferred);
      const url = vm.getString(urlHandle);
      const init = initHandle ? vm.getString(initHandle) : "{}";
      const settle = (ok: boolean, text: string) => {
        if (!this.alive) return;
        const value = ok ? vm.newString(text) : vm.newError(text);
        if (ok) deferred.resolve(value);
        else deferred.reject(value);
        value.dispose();
        this.deferreds.delete(deferred);
        deferred.dispose();
        this.rt.executePendingJobs();
      };
      if (!fetcher) settle(false, "Jaringan tidak tersedia saat memuat plugin.");
      else
        fetcher(url, init).then(
          (text) => settle(true, text),
          (error: unknown) => settle(false, error instanceof Error ? error.message : String(error)),
        );
      return deferred.handle;
    });
    vm.setProp(vm.global, "__hostFetch", fetch);
    fetch.dispose();
  }

  evalOrThrow(code: string, filename: string) {
    const result = this.vm.evalCode(code, filename);
    if (result.error) {
      const message = errorMessage(this.vm, result.error);
      result.error.dispose();
      throw new PluginError(message);
    }
    return result.value;
  }

  /** Nilai string dari ekspresi (sinkron). */
  evalString(code: string) {
    const handle = this.evalOrThrow(code, "call.js");
    try {
      return this.vm.getString(handle);
    } finally {
      handle.dispose();
    }
  }

  /** Jalankan ekspresi yang menghasilkan Promise<string>; selesai, gagal, atau melewati `timeoutMs`. */
  async evalAsyncString(code: string, timeoutMs: number) {
    const handle = this.evalOrThrow(code, "call.js");
    const settled = this.vm.resolvePromise(handle);
    handle.dispose();
    this.rt.executePendingJobs();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PluginError("Plugin dihentikan: melewati batas waktu.")), timeoutMs);
    });
    try {
      const result = await Promise.race([settled, timeout]);
      if (result.error) {
        const message = errorMessage(this.vm, result.error);
        result.error.dispose();
        throw new PluginError(message);
      }
      try {
        return this.vm.getString(result.value);
      } finally {
        result.value.dispose();
      }
    } finally {
      clearTimeout(timer);
    }
  }

  close() {
    if (!this.alive) return;
    this.alive = false;
    for (const d of this.deferreds) {
      try {
        d.dispose();
      } catch {
        // abaikan
      }
    }
    this.deferreds.clear();
    try {
      this.vm.dispose();
      this.rt.dispose();
    } catch {
      // Runtime yang dihentikan di tengah jalan bisa menyisakan objek; dibiarkan dibuang pengumpul sampah WASM
    }
  }
}

/**
 * Batas sandbox yang berjalan bersamaan di satu proses (memori WASM tiap runtime ± 32 MB): maks. 4 berjalan, maks. 32 antre;
 * lebih dari itu ditolak agar banyak pemanggilan sekaligus tidak menghabiskan memori Akai API.
 */
const MAX_ACTIVE = 4;
const MAX_WAITING = 32;
let active = 0;
const waiting: (() => void)[] = [];

async function acquireSlot(): Promise<() => void> {
  if (active >= MAX_ACTIVE) {
    if (waiting.length >= MAX_WAITING)
      throw new PluginError("Plugin sedang sibuk (terlalu banyak yang berjalan). Coba lagi sebentar.");
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
}

/** Muat kode plugin lalu baca manifest mentahnya (tanpa jaringan). Galat kode = Error berisi pesan untuk pemilik. */
export async function inspectPlugin(code: string): Promise<unknown> {
  const release = await acquireSlot();
  try {
    const box = await Sandbox.open(code, PLUGIN_LIMITS.inspectMs);
    try {
      return JSON.parse(box.evalString("__akaiManifest()")) as unknown;
    } finally {
      box.close();
    }
  } finally {
    release();
  }
}

export interface PluginRunResult {
  isError: boolean;
  text: string;
  logs: string[];
  ms: number;
}

/** Jalankan satu alat plugin di sandbox baru. Galat plugin dikembalikan sebagai hasil (`isError`), bukan dilempar. */
export async function runPluginTool(
  code: string,
  tool: string,
  input: Record<string, unknown>,
  config: Record<string, string>,
  fetcher: HostFetch,
): Promise<PluginRunResult> {
  const started = Date.now();
  let box: Sandbox | null = null;
  let release: (() => void) | null = null;
  try {
    release = await acquireSlot();
    box = await Sandbox.open(code, PLUGIN_LIMITS.runMs, fetcher);
    const call = `__akaiRun(${JSON.stringify(tool)}, ${JSON.stringify(JSON.stringify(input))}, ${JSON.stringify(JSON.stringify(config))})`;
    const text = await box.evalAsyncString(call, PLUGIN_LIMITS.runMs);
    return {
      isError: false,
      text: text.length > PLUGIN_LIMITS.resultChars ? `${text.slice(0, PLUGIN_LIMITS.resultChars)}…` : text,
      logs: box.logs,
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      isError: true,
      text: error instanceof Error ? error.message : String(error),
      logs: box?.logs ?? [],
      ms: Date.now() - started,
    };
  } finally {
    box?.close();
    release?.();
  }
}
