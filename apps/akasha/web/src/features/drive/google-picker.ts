import type { DrivePickerConfig } from "@/types/api";

/** Bentuk minimum Google Picker API yang dipakai (https://developers.google.com/drive/picker). */
interface PickerBuilder {
  addView(view: unknown): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setLocale(locale: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(cb: (data: { action: string; docs?: { id: string }[] }) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
interface PickerNamespace {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: unknown) => { setIncludeFolders(v: boolean): unknown };
  ViewId: { DOCS: unknown };
  Action: { PICKED: string; CANCEL: string };
}
interface GoogleWindow {
  gapi?: { load(name: string, options: { callback: () => void; onerror: () => void }): void };
  google?: { picker?: PickerNamespace };
}

let loading: Promise<PickerNamespace> | null = null;

/** Muat skrip Google (apis.google.com, diizinkan CSP produksi) lalu modul picker. Sekali per halaman. */
function loadPicker() {
  loading ??= new Promise<PickerNamespace>((resolve, reject) => {
    const w = window as unknown as GoogleWindow;
    const ready = () =>
      w.gapi!.load("picker", {
        callback: () =>
          w.google?.picker ? resolve(w.google.picker) : reject(new Error("Picker Google tidak dimuat.")),
        onerror: () => reject(new Error("Picker Google gagal dimuat.")),
      });
    if (w.gapi) return ready();
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = ready;
    script.onerror = () => {
      loading = null;
      reject(new Error("Skrip Google gagal dimuat. Periksa koneksi internet."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Buka Google Picker; hasil = ID berkas yang dipilih, null bila dibatalkan. */
export async function pickGoogleFile(config: DrivePickerConfig): Promise<string | null> {
  const picker = await loadPicker();
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS);
    view.setIncludeFolders(true);
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(config.accessToken)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setLocale("id")
      .setTitle("Pilih berkas untuk Akasha")
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs?.[0]?.id ?? null);
        else if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
