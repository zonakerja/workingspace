import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { type Model, type Source, type TaskRoute, api, errorText } from "./api";

export interface SettingsData {
  sources: Source[];
  models: Model[];
  tasks: TaskRoute[];
}

async function loadSettings(): Promise<SettingsData> {
  const [sources, models, tasks] = await Promise.all([api.sources(), api.models(), api.tasks()]);
  return { sources, models, tasks };
}

/** Sumber, model, dan pembagian tugas akun (dimuat bersama; `reload` setelah setiap perubahan). */
export function useSettings() {
  const [data, setData] = useState<SettingsData | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await loadSettings());
    } catch (error) {
      toast.error(errorText(error));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    loadSettings()
      .then((value) => alive && setData(value))
      .catch((error: unknown) => alive && toast.error(errorText(error)));
    return () => {
      alive = false;
    };
  }, []);

  return { data, reload };
}

/** Jalankan aksi dengan toast galat; `true` bila berhasil. */
export async function attempt(action: () => Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await action();
    if (success) toast.success(success);
    return true;
  } catch (error) {
    toast.error(errorText(error));
    return false;
  }
}
