import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus, StickyNote, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  columnName,
  computeSheet,
  parseSheet,
  parseSlides,
  parseWhiteboard,
  whiteboardSvg,
} from "@/lib/artifact-formats";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

function Problem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

/** Lembar kerja: tab per lembar, kolom A/B/C, nomor baris, baris 1 = judul kolom, rumus dihitung untuk pratinjau. */
export function SheetView({ content }: { content: string }) {
  const sheets = useMemo(() => parseSheet(content), [content]);
  const [active, setActive] = useState(0);
  const sheet = sheets[Math.min(active, sheets.length - 1)];
  const computed = useMemo(() => (sheet ? computeSheet(sheet.rows) : []), [sheet]);
  if (!sheet) return <Problem text="Lembar kerja masih kosong." />;
  const width = sheet.rows[0]?.length ?? 0;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {sheets.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {sheets.map((s, i) => (
            <Button
              key={s.name + i}
              size="xs"
              variant={i === active ? "secondary" : "ghost"}
              onClick={() => setActive(i)}
            >
              {s.name}
            </Button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border bg-card">
        <table className="w-max min-w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 w-10 border-r border-b bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground" />
              {Array.from({ length: width }, (_, c) => (
                <th
                  key={c}
                  className="border-r border-b bg-muted px-2 py-1 text-center text-[11px] font-medium text-muted-foreground"
                >
                  {columnName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {computed.map((row, r) => (
              <tr key={r} className={cn(r === 0 && "bg-primary/5 font-semibold")}>
                <td className="sticky left-0 border-r border-b bg-muted px-2 py-1 text-center text-[11px] text-muted-foreground tabular-nums">
                  {r + 1}
                </td>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    title={cell.kind === "formula" ? cell.formula : undefined}
                    className={cn(
                      "max-w-[22rem] border-r border-b px-2 py-1 align-top whitespace-pre-wrap",
                      cell.numeric !== null && r > 0 && "text-right tabular-nums",
                      cell.kind === "formula" && "bg-[color-mix(in_oklab,var(--brand-cyan)_8%,transparent)]",
                      cell.kind === "formula" && cell.numeric === null && "font-mono text-xs text-muted-foreground",
                    )}
                  >
                    {cell.display}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {sheet.rows.length} baris × {width} kolom · sel berwarna = rumus (dihitung di pratinjau, tetap rumus di Excel)
      </p>
    </div>
  );
}

/** Presentasi 16:9: satu slide besar, navigasi tombol/panah keyboard, deretan miniatur, catatan pembicara. */
export function SlidesView({ content }: { content: string }) {
  const slides = useMemo(() => parseSlides(content), [content]);
  const [index, setIndex] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const current = Math.min(index, Math.max(0, slides.length - 1));
  const slide = slides[current];
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") setIndex((i) => Math.min(i + 1, slides.length - 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setIndex((i) => Math.max(i - 1, 0));
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [slides.length]);
  if (!slide) return <Problem text="Presentasi masih kosong." />;
  return (
    <div ref={box} tabIndex={0} className="flex flex-col gap-3 outline-none">
      <SlideFrame slide={slide} />
      <div className="flex items-center gap-2">
        <Button
          size="icon-sm"
          variant="outline"
          disabled={current === 0}
          onClick={() => setIndex(current - 1)}
          aria-label="Slide sebelumnya"
        >
          <ChevronLeft />
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          Slide {current + 1} / {slides.length}
        </span>
        <Button
          size="icon-sm"
          variant="outline"
          disabled={current >= slides.length - 1}
          onClick={() => setIndex(current + 1)}
          aria-label="Slide berikutnya"
        >
          <ChevronRight />
        </Button>
      </div>
      {slide.notes && (
        <div className="flex gap-2 rounded-xl border bg-muted/40 p-3 text-xs">
          <StickyNote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <p className="whitespace-pre-wrap">{slide.notes}</p>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {slides.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            className={cn(
              "aspect-video overflow-hidden rounded-lg border bg-card p-2 text-left transition hover:border-primary/40",
              i === current && "border-primary ring-1 ring-primary/30",
            )}
          >
            <span className="block text-[10px] text-muted-foreground">{i + 1}</span>
            <span className="line-clamp-2 text-[11px] leading-tight font-semibold">{s.title || "Tanpa judul"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SlideFrame({ slide }: { slide: ReturnType<typeof parseSlides>[number] }) {
  if (slide.cover)
    return (
      <div className="relative flex aspect-video flex-col justify-center overflow-hidden rounded-xl bg-[linear-gradient(135deg,#1d2350,#0f1330)] p-[6%] text-white shadow-sm">
        <div className="absolute inset-x-0 bottom-0 h-1.5 bg-[linear-gradient(90deg,var(--brand-indigo),var(--brand-cyan),var(--brand-lime))]" />
        <h2 className="font-display text-[clamp(1.1rem,3.2vw,2rem)] leading-tight font-bold">{slide.title}</h2>
        {slide.body && (
          <div className="mt-3 text-[clamp(0.75rem,1.6vw,1rem)] opacity-80 [&_p]:m-0">
            <Markdown text={slide.body} />
          </div>
        )}
      </div>
    );
  return (
    <div className="relative flex aspect-video flex-col overflow-hidden rounded-xl border bg-white p-[5%] text-[#1b1f3b] shadow-sm">
      <div className="absolute inset-y-0 left-0 w-1.5 bg-[linear-gradient(180deg,var(--brand-indigo),var(--brand-cyan))]" />
      {slide.title && (
        <h3 className="font-display mb-[3%] text-[clamp(0.95rem,2.4vw,1.5rem)] leading-tight font-bold">
          {slide.title}
        </h3>
      )}
      <div className="akai-slide-body min-h-0 flex-1 overflow-hidden text-[clamp(0.7rem,1.45vw,0.95rem)]">
        <Markdown text={slide.body} />
      </div>
    </div>
  );
}

/** Papan tulis (JSON Canvas): digambar sebagai SVG, bisa diperbesar/diperkecil dan digeser. */
export function WhiteboardView({ content }: { content: string }) {
  const parsed = useMemo(() => parseWhiteboard(content), [content]);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  const drawn = useMemo(() => (parsed.board ? whiteboardSvg(parsed.board, { dark }) : null), [parsed, dark]);
  const [zoom, setZoom] = useState<number | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    obs.observe(el);
    return () => obs.disconnect();
  }, [drawn]);
  if (!drawn) return <Problem text={parsed.error ?? "Papan tidak bisa digambar."} />;
  const fit = boxWidth ? Math.min(1, Math.max(0.2, (boxWidth - 16) / drawn.width)) : 1;
  const scale = zoom ?? fit;
  const setScale = (next: number) => setZoom(Math.max(0.2, Math.min(3, next)));
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1">
        <Button size="icon-xs" variant="outline" onClick={() => setScale(scale - 0.15)} aria-label="Perkecil">
          <Minus />
        </Button>
        <span className="w-12 text-center text-xs text-muted-foreground tabular-nums">{Math.round(scale * 100)}%</span>
        <Button size="icon-xs" variant="outline" onClick={() => setScale(scale + 0.15)} aria-label="Perbesar">
          <Plus />
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setZoom(null)}>
          <Maximize2 data-icon="inline-start" /> Pas layar
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {parsed.board!.nodes.length} kartu · {parsed.board!.edges.length} garis · seret untuk menggeser
        </span>
      </div>
      <div
        ref={viewport}
        className="min-h-[60svh] flex-1 cursor-grab overflow-auto rounded-xl border bg-muted/30 p-2 active:cursor-grabbing"
        onPointerDown={(e) => {
          const el = viewport.current;
          if (!el || e.button !== 0) return;
          drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
          el.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const el = viewport.current;
          if (!el || !drag.current) return;
          el.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
          el.scrollTop = drag.current.top - (e.clientY - drag.current.y);
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <img
          alt="Papan tulis"
          draggable={false}
          className="max-w-none select-none"
          style={{ width: drawn.width * scale, height: drawn.height * scale }}
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.svg)}`}
        />
      </div>
    </div>
  );
}
