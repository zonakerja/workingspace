import { Activity, Boxes, Cpu, Route } from "lucide-react";
import { useSearchParams } from "react-router";
import { ModelsTab } from "@/components/models-tab";
import { SourcesTab } from "@/components/sources-tab";
import { TasksTab } from "@/components/tasks-tab";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UsageTab } from "@/components/usage-tab";
import { useSettings } from "@/lib/use-settings";

const TABS = [
  { key: "sources", label: "Sumber", icon: Boxes },
  { key: "models", label: "Model", icon: Cpu },
  { key: "tasks", label: "Pembagian tugas", icon: Route },
  { key: "usage", label: "Pemakaian", icon: Activity },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Pengaturan Model Akai (docs/AKAI.md §4): sumber → model yang dinyalakan → tugas + cadangan → pemakaian. Tab = `?tab=`. */
export function ModelsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : "sources";
  const { data, reload } = useSettings();

  const counts: Partial<Record<TabKey, number>> = data
    ? { sources: data.sources.length, models: data.models.filter((m) => m.enabled).length }
    : {};

  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-3xl bg-aurora px-5 py-5 text-ink-foreground md:px-7">
        <div className="pointer-events-none absolute inset-0 bg-grid" />
        <div className="relative">
          <h1 className="font-display text-xl font-bold md:text-2xl">Model AI</h1>
          <p className="mt-1 max-w-2xl text-sm opacity-80">
            Router & API key Anda tersimpan terenkripsi di Akai dan dipakai semua aplikasi workingspace.id. Atur sumber,
            nyalakan model, lalu pilih model per tugas beserta cadangannya.
          </p>
        </div>
      </section>

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value }, { replace: true })}>
        <div className="-mx-4 overflow-x-auto px-4">
          <TabsList>
            {TABS.map(({ key, label, icon: Icon }) => (
              <TabsTrigger key={key} value={key}>
                <Icon />
                {label}
                {counts[key] !== undefined && <span className="text-xs opacity-60">{counts[key]}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {!data ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-6" />
          </div>
        ) : (
          <>
            <TabsContent value="sources" className="mt-4">
              <SourcesTab data={data} reload={reload} onOpenModels={() => setParams({ tab: "models" })} />
            </TabsContent>
            <TabsContent value="models" className="mt-4">
              <ModelsTab data={data} reload={reload} />
            </TabsContent>
            <TabsContent value="tasks" className="mt-4">
              <TasksTab data={data} reload={reload} />
            </TabsContent>
            <TabsContent value="usage" className="mt-4">
              <UsageTab />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
