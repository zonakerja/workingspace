import { Check, Copy } from "lucide-react";
import { memo, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Tautan dari jawaban model: hanya http/https/mailto, dibuka di tab baru. */
function SafeLink({ href, children }: ComponentProps<"a">) {
  const safe = typeof href === "string" && /^(https?:|mailto:)/i.test(href);
  if (!safe) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const className = (child as { props?: { className?: string } } | undefined)?.props?.className ?? "";
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? "";
  const text = String((child as { props?: { children?: unknown } } | undefined)?.props?.children ?? "").replace(
    /\n$/,
    "",
  );
  return (
    <div className="akai-code group/code">
      <div className="akai-code-head">
        <span>{language || "kode"}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          aria-label="Salin kode"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Disalin" : "Salin"}
        </button>
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}

function Table(props: ComponentProps<"table">) {
  return (
    <div className="akai-table">
      <table {...props} />
    </div>
  );
}

/** Jawaban Akai dalam Markdown (GFM). Komponen tingkat modul agar tidak dipasang ulang setiap potongan stream. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="akai-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: SafeLink, pre: CodeBlock, table: Table }}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
