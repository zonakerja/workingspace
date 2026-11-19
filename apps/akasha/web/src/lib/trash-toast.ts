import { toast } from "sonner";
import { queryClient } from "@/app/query-client";
import { errorMessage, request } from "@/lib/api/client";

/**
 * Notifikasi "dipindah ke Sampah" dengan tombol Pulihkan, dipicu lapisan API saat respons hapus membawa `batchId`.
 * Hapus beruntun (mis. project + action + berkasnya) digabung menjadi satu notifikasi per kelompok.
 */
const GATHER_MS = 700;
const pending = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Data yang mungkin berubah setelah pemulihan. */
const REFRESH_KEYS = [
  ["records"],
  ["uploads"],
  ["trash"],
  ["requests"],
  ["notebooks"],
  ["knowledge"],
  ["agent", "conversations"],
  ["agent-actions"],
];

async function restore(batchId: string) {
  try {
    const result = await request<{ restored: string[]; failed: { title: string; message: string }[] }>(
      "/trash/restore",
      { method: "POST", body: { batchId } },
    );
    for (const key of REFRESH_KEYS) void queryClient.invalidateQueries({ queryKey: key });
    if (result.restored.length) toast.success(`${result.restored.length} item dipulihkan.`);
    for (const failure of result.failed) toast.error(`${failure.title}: ${failure.message}`);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

function flush() {
  for (const [batchId, count] of pending) {
    toast(`${count} item dipindah ke Sampah`, {
      id: `trash-${batchId}`,
      description: "Bisa dipulihkan dari Tools → Sampah selama 30 hari.",
      duration: 8000,
      action: { label: "Pulihkan", onClick: () => void restore(batchId) },
    });
  }
  pending.clear();
}

/** Catat satu penghapusan yang masuk Sampah (respons hapus dengan `batchId`); null = tidak masuk Sampah. */
function notifyTrashed(batchId: string | null | undefined) {
  if (!batchId) return;
  pending.set(batchId, (pending.get(batchId) ?? 0) + 1);
  clearTimeout(timer);
  timer = setTimeout(flush, GATHER_MS);
}

/** Bungkus panggilan hapus: respons dikembalikan apa adanya, `batchId`-nya memicu notifikasi. */
export function withTrashToast<T extends { batchId?: string | null }>(promise: Promise<T>) {
  return promise.then((result) => {
    notifyTrashed(result?.batchId);
    return result;
  });
}
