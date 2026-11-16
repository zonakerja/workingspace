/** Ringkasan log pemakaian gateway (logika murni, diuji di usage-logic.spec.ts). docs/AKAI.md §4. */

export interface UsageRow {
  modelId: string | null;
  task: string | null;
  clientId: string;
  ok: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  currency: string | null;
}

export interface UsageGroup {
  key: string;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  /** Biaya per mata uang (model tanpa harga tidak dihitung). */
  cost: Record<string, number>;
}

const empty = (key: string): UsageGroup => ({ key, calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, cost: {} });

function add(group: UsageGroup, row: UsageRow) {
  group.calls++;
  if (!row.ok) group.failed++;
  group.inputTokens += row.inputTokens ?? 0;
  group.outputTokens += row.outputTokens ?? 0;
  if (row.cost !== null && row.cost > 0) {
    const currency = row.currency || "USD";
    group.cost[currency] = (group.cost[currency] ?? 0) + row.cost;
  }
}

/** Total + per model + per tugas + per aplikasi, diurutkan dari pemakaian terbanyak. */
export function summarizeUsage(rows: UsageRow[]) {
  const total = empty("total");
  const groups = {
    model: new Map<string, UsageGroup>(),
    task: new Map<string, UsageGroup>(),
    app: new Map<string, UsageGroup>(),
  };
  for (const row of rows) {
    add(total, row);
    const keys = { model: row.modelId ?? "-", task: row.task ?? "-", app: row.clientId };
    for (const kind of ["model", "task", "app"] as const) {
      const map = groups[kind];
      const key = keys[kind];
      if (!map.has(key)) map.set(key, empty(key));
      add(map.get(key)!, row);
    }
  }
  const sorted = (map: Map<string, UsageGroup>) => [...map.values()].sort((a, b) => b.calls - a.calls);
  return { total, byModel: sorted(groups.model), byTask: sorted(groups.task), byApp: sorted(groups.app) };
}

/** Rentang hari yang boleh diminta (1–90, bawaan 30). */
export function usageDays(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30;
  return Math.min(90, Math.max(1, Math.round(n)));
}
