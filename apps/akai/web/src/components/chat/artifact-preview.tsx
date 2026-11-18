import { Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Artifact } from "@/lib/artifacts";
import { SheetView, SlidesView, WhiteboardView } from "./artifact-views";
import { Markdown } from "./markdown";

/**
 * HTML buatan model dijalankan di iframe `sandbox="allow-scripts"` (asal buram: tanpa cookie, penyimpanan, atau akses API Akai)
 * yang memuat `/artifact-frame.html`; isi dikirim lewat postMessage setelah bingkai siap.
 */
function HtmlFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  // Cadangan: bingkai tidak memberi tanda siap dalam 1,5 dtk (peramban yang tidak menjalankan skrip di bingkai ber-sandbox yang
  // dimuat lewat jaringan) → srcdoc ber-sandbox. Di produksi srcdoc mewarisi CSP Akai web (skrip sebaris diblokir, tampilan tetap).
  const [inline, setInline] = useState<string | null>(null);
  useEffect(() => {
    const frame = ref.current;
    let ready = false;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame?.contentWindow || (event.data as { type?: string })?.type !== "akai-artifact-ready")
        return;
      ready = true;
      frame?.contentWindow?.postMessage({ type: "akai-artifact", html }, "*");
    };
    window.addEventListener("message", onMessage);
    const timer = setTimeout(() => {
      if (!ready) setInline(html);
    }, 1500);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
  }, [html]);
  const className = "h-full min-h-[60svh] w-full rounded-xl border bg-white";
  const sandbox = "allow-scripts allow-forms allow-modals allow-popups";
  if (inline === html) return <iframe title="Pratinjau HTML" srcDoc={html} sandbox={sandbox} className={className} />;
  return (
    <iframe
      ref={ref}
      key={html}
      title="Pratinjau HTML"
      src="/artifact-frame.html"
      sandbox={sandbox}
      className={className}
    />
  );
}

let mermaidLoader: Promise<typeof import("mermaid").default> | null = null;
const loadMermaid = () => {
  mermaidLoader ??= import("mermaid").then((m) => m.default);
  return mermaidLoader;
};

/** Diagram Mermaid (pustaka dimuat malas, mode ketat: label HTML/skrip dibuang). */
function MermaidView({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [result, setResult] = useState<{ code: string; svg?: string; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void loadMermaid()
      .then(async (mermaid) => {
        // Selalu tema terang di atas kertas putih: warna kotak (classDef) buatan model dirancang untuk latar terang, dan
        // hasilnya sama dengan berkas ekspor PNG/SVG/PDF
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
        const { svg } = await mermaid.render(`akai-mmd-${id}-${Date.now()}`, code);
        if (alive) setResult({ code, svg });
      })
      .catch(
        (error: unknown) => alive && setResult({ code, error: error instanceof Error ? error.message : String(error) }),
      );
    return () => {
      alive = false;
    };
  }, [code, id]);
  if (!result || result.code !== code)
    return <Loader2 className="mx-auto mt-10 size-5 animate-spin text-muted-foreground" />;
  if (result.error)
    return (
      <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>Diagram tidak bisa digambar: {result.error.slice(0, 300)}</span>
      </div>
    );
  return (
    <div
      className="flex justify-center overflow-auto rounded-xl border bg-white p-3 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: result.svg! }}
    />
  );
}

/** Pratinjau artifact menurut jenisnya. Artifact yang belum selesai ditulis ditampilkan sebagai kode yang terus bertambah. */
export function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  // Dokumen, lembar kerja, dan slide sudah bisa ditampilkan sambil ditulis; jenis lain menunggu tag penutup
  const progressive = artifact.type === "markdown" || artifact.type === "sheet" || artifact.type === "slides";
  if (!artifact.complete && !progressive) return <ArtifactCode artifact={artifact} />;
  switch (artifact.type) {
    case "markdown":
      return <Markdown text={artifact.content} />;
    case "html":
      return <HtmlFrame html={artifact.content} />;
    case "svg":
      return (
        <img
          alt={artifact.title}
          className="mx-auto max-w-full"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(artifact.content)}`}
        />
      );
    case "mermaid":
      return <MermaidView code={artifact.content} />;
    case "sheet":
      return <SheetView content={artifact.content} />;
    case "slides":
      return <SlidesView content={artifact.content} />;
    case "whiteboard":
      return <WhiteboardView content={artifact.content} />;
    default:
      return <ArtifactCode artifact={artifact} />;
  }
}

export function ArtifactCode({ artifact }: { artifact: Artifact }) {
  return (
    <pre className="overflow-auto rounded-xl border bg-muted p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre">
      {artifact.content}
    </pre>
  );
}
