import { AkaiMark, AkashaMark, CendekiaMark, LogoMark, Wordmark } from "@workingspace/ui/brand";
import { ECOSYSTEM, product } from "@workingspace/ui/ecosystem";
import { ThemeToggle } from "@workingspace/ui/theme-toggle";
import { cn } from "cn";
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Bot,
  BrainCircuit,
  CalendarCheck,
  CalendarClock,
  Check,
  ChevronDown,
  FileSpreadsheet,
  Fingerprint,
  FolderArchive,
  FolderKanban,
  GraduationCap,
  KeyRound,
  Languages,
  LayoutDashboard,
  LayoutGrid,
  LibraryBig,
  LockKeyhole,
  LogOut,
  MailCheck,
  MessagesSquare,
  NotebookPen,
  Plug,
  Quote,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UserPlus,
  Waypoints,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { AKAI_URL, AKASHA_URL, AUTH_URL, ssoLinks } from "./config";
import { type SsoStatus, useSsoStatus } from "./use-sso-status";

const links = ssoLinks(AUTH_URL);
const AKASHA = product("akasha");
const AKAI = product("akai");
const CENDEKIA = product("cendekia");

const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-full bg-lime px-6 py-3 text-sm font-semibold text-ink shadow-soft transition-all hover:-translate-y-0.5 hover:bg-lime/90 hover:shadow-lift [&_svg]:size-4";
const BTN_GHOST_DARK =
  "inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-6 py-3 text-sm font-semibold text-white ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-white/15 [&_svg]:size-4";
const BTN_SOLID =
  "inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift [&_svg]:size-4";
const BTN_OUTLINE =
  "inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold ring-1 ring-border transition-colors hover:bg-accent [&_svg]:size-4";

const NAV = [
  { href: "#ekosistem", label: "Ekosistem" },
  { href: "#akasha", label: "Akasha" },
  { href: "#akasha-ai", label: "Akai" },
  { href: "#keamanan", label: "Keamanan" },
  { href: "#tanya", label: "Tanya jawab" },
];

export function LandingPage() {
  const status = useSsoStatus();
  const signedIn = status.state === "signedIn";
  return (
    <div className="min-h-svh overflow-x-clip bg-background">
      <Header status={status} />
      <main>
        <Hero signedIn={signedIn} />
        <ProductStrip />
        <Ecosystem />
        <AkashaSpotlight signedIn={signedIn} />
        <AkashaAiSpotlight />
        <CendekiaTeaser />
        <Features />
        <Vision />
        <Steps />
        <Faq />
        <CallToAction signedIn={signedIn} />
      </main>
      <Footer signedIn={signedIn} />
    </div>
  );
}

/** Tombol ke dashboard SSO (halaman akun: peluncur aplikasi, profil, keamanan) saat sudah masuk. */
const BTN_DASHBOARD =
  "inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-ink-foreground shadow-soft transition-transform hover:-translate-y-0.5 dark:bg-lime dark:text-ink [&_svg]:size-4";

function Header({ status }: { status: SsoStatus }) {
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#" aria-label="workingspace.id — ke atas">
          <Wordmark />
        </a>
        <nav className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          {status.state === "signedIn" ? (
            <a
              href={links.account}
              className={BTN_DASHBOARD}
              title={status.name ? `Masuk sebagai ${status.name}` : undefined}
            >
              <LayoutDashboard /> Dashboard
            </a>
          ) : (
            <>
              <a
                href={links.login}
                className="rounded-full px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
              >
                Masuk
              </a>
              <a href={links.register} className={cn(BTN_DASHBOARD, "hidden sm:inline-flex")}>
                Daftar
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="px-3 pt-3 sm:px-4">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[32px] bg-aurora text-ink-foreground shadow-lift">
        <div className="pointer-events-none absolute inset-0 bg-grid" />
        <div className="pointer-events-none absolute -top-32 -left-24 size-[26rem] rounded-full bg-cyan/20 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 -bottom-40 size-[28rem] rounded-full bg-lime/20 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-6 py-16 sm:px-10 md:py-24 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-white/20">
              <Sparkles className="size-3.5 text-lime" /> The Operating System for Your Potential
            </span>
            <h1 className="mt-6 text-4xl leading-[1.04] font-bold sm:text-5xl lg:text-[64px]">
              One Space.
              <br />
              <span className="text-gradient">Infinite Possibilities.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed opacity-85 sm:text-lg">
              {ECOSYSTEM.lead} Rencanakan dan kerjakan di <b>Akasha</b>, berpikir lebih cepat bersama <b>Akasha AI</b>{" "}
              (selanjutnya disebut <b>Akai</b>), dan bertumbuh lewat <b>Cendekia</b> — semuanya dengan satu akun aman.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {signedIn ? (
                <>
                  <a href={links.account} className={BTN_PRIMARY}>
                    Buka dashboard <ArrowRight />
                  </a>
                  <a href={AKASHA_URL} className={BTN_GHOST_DARK}>
                    Buka Akasha
                  </a>
                </>
              ) : (
                <>
                  <a href={links.register} className={BTN_PRIMARY}>
                    Buat akun gratis <ArrowRight />
                  </a>
                  <a href={links.login} className={BTN_GHOST_DARK}>
                    Saya sudah punya akun
                  </a>
                </>
              )}
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm opacity-85">
              {["Masuk sekali untuk semua aplikasi", "PIN keamanan bersama", "Data tetap milik Anda"].map((point) => (
                <li key={point} className="flex items-center gap-2">
                  <Check className="size-4 text-lime" strokeWidth={3} /> {point}
                </li>
              ))}
            </ul>
          </div>
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}

/** Ilustrasi kartu aplikasi bertumpuk (bukan tangkapan layar; murni CSS). */
function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden="true">
      <div className="relative rounded-3xl bg-white/[0.07] p-5 ring-1 ring-white/15 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2.5">
            <AkashaMark />
            <span>
              <span className="block text-sm font-semibold">Akasha</span>
              <span className="block text-[11px] opacity-60">Hari ini · 3 agenda · 2 to-do</span>
            </span>
          </span>
          <span className="flex gap-1">
            <span className="size-2 rounded-full bg-white/30" />
            <span className="size-2 rounded-full bg-white/30" />
            <span className="size-2 rounded-full bg-lime" />
          </span>
        </div>
        <div className="mt-5 space-y-2.5">
          {[
            { time: "08.00", title: "Rapat koordinasi", tone: "bg-cyan", tag: "Agenda" },
            { time: "10.30", title: "Telaah pengajuan", tone: "bg-lime", tag: "Approval" },
            { time: "14.00", title: "Penataan arsip", tone: "bg-coral", tag: "File Control" },
          ].map((row) => (
            <div key={row.time} className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-3 py-2.5">
              <span className={cn("h-8 w-1 rounded-full", row.tone)} />
              <span className="text-xs font-medium opacity-60 tabular-nums">{row.time}</span>
              <span className="flex-1 truncate text-sm font-medium">{row.title}</span>
              <span className="hidden rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold sm:inline">
                {row.tag}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-5">
          <div className="flex justify-between text-[11px] opacity-70">
            <span>Proyek berjalan</span>
            <span>72%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-[72%] rounded-full bg-linear-90 from-indigo via-cyan to-lime" />
          </div>
        </div>
      </div>

      <div className="absolute -bottom-10 -left-4 w-60 rounded-2xl bg-card p-3.5 text-card-foreground shadow-lift ring-1 ring-border sm:-left-10">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <AkaiMark className="size-6" />
          Akai
          <span className="ml-auto rounded-full bg-success/12 px-1.5 py-0.5 text-[10px] text-success">aktif</span>
        </div>
        <p className="mt-2 rounded-xl bg-muted px-3 py-2 text-xs leading-snug">
          Notulen rapat sudah saya ringkas, dan 3 tindak lanjut masuk ke to-do Anda.
        </p>
      </div>

      <div className="absolute -top-6 -right-3 flex items-center gap-2 rounded-2xl bg-card px-3 py-2 text-xs font-semibold text-card-foreground shadow-lift ring-1 ring-border sm:-right-6">
        <span className="flex size-6 items-center justify-center rounded-full bg-success/15 text-success">
          <ShieldCheck className="size-3.5" />
        </span>
        Masuk sekali, aman di semua aplikasi
      </div>
    </div>
  );
}

const MARKS: Record<string, ComponentType<{ className?: string }>> = {
  akasha: AkashaMark,
  akai: AkaiMark,
  cendekia: CendekiaMark,
};

/** Baris logo produk tepat di bawah hero. */
function ProductStrip() {
  return (
    <section className="px-4 pt-16 sm:px-6">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 sm:grid-cols-3">
        {[AKASHA, AKAI, CENDEKIA].map((p) => {
          const Mark = MARKS[p.key];
          return (
            <a
              key={p.key}
              href={`#${p.key === "akai" ? "akasha-ai" : p.key}`}
              className="group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-surface"
            >
              <Mark className="size-10" />
              <span className="min-w-0">
                <span className="font-display flex items-center gap-1.5 text-base font-bold">
                  {p.name}
                  {!p.available && (
                    <span className="rounded-full bg-info/12 px-1.5 py-0.5 text-[10px] font-semibold text-info">
                      segera
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground italic">{p.tagline}</span>
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-bold sm:text-4xl">{title}</h2>
      {children && <p className="mt-4 text-base text-muted-foreground">{children}</p>}
    </div>
  );
}

const PILLARS = [
  { key: "akasha", word: "Work", label: "Kerja", icon: Target, href: AKASHA_URL },
  { key: "akai", word: "Mind", label: "Pikiran", icon: BrainCircuit, href: AKAI_URL },
  { key: "cendekia", word: "Growth", label: "Bertumbuh", icon: TrendingUp, href: undefined },
] as const;

/** Tiga pilar ekosistem: diagram orbit + kartu produk. */
function Ecosystem() {
  return (
    <section id="ekosistem" className="scroll-mt-20 px-4 py-20 sm:px-6 md:py-28">
      <SectionHeading eyebrow="Ekosistem" title={<>{ECOSYSTEM.motto}</>}>
        Tiga aplikasi dengan satu akun. Akai hidup di aplikasinya sendiri sekaligus menempel di Akasha dan Cendekia.
      </SectionHeading>
      <div className="mx-auto mt-14 grid max-w-6xl grid-cols-1 items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <OrbitDiagram />
        <div className="grid grid-cols-1 gap-4">
          {PILLARS.map((pillar) => {
            const p = product(pillar.key);
            const Mark = MARKS[p.key];
            const Icon = pillar.icon;
            const card = (
              <>
                <div className="flex items-start gap-4">
                  <Mark className="size-12" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-bold">{p.name}</h3>
                      {p.fullName && <span className="text-xs text-muted-foreground">({p.fullName})</span>}
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">
                        <Icon className="size-3" /> {pillar.word} · {pillar.label}
                      </span>
                      {p.available ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-success">
                          <span className="size-1.5 rounded-full bg-success" /> Tersedia
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-info/12 px-2 py-0.5 text-[11px] font-semibold text-info">
                          <Sparkles className="size-3" /> Segera hadir
                        </span>
                      )}
                    </div>
                    <p className="font-display mt-1 text-sm font-semibold text-primary italic">{p.tagline}</p>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.lead}</p>
                  </div>
                  {pillar.href && (
                    <ArrowUpRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                  )}
                </div>
              </>
            );
            return pillar.href ? (
              <a
                key={p.key}
                href={pillar.href}
                className="group ring-aurora rounded-3xl p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift"
              >
                {card}
              </a>
            ) : (
              <div key={p.key} className="rounded-3xl border border-dashed bg-surface/60 p-5">
                {card}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Diagram: workingspace.id di pusat, tiga produk mengorbit dan saling terhubung. */
function OrbitDiagram() {
  const nodes = [
    { key: "akasha", label: "Akasha", sub: "Work", pos: "left-1/2 top-0 -translate-x-1/2" },
    { key: "akai", label: "Akai", sub: "Mind", pos: "bottom-[6%] left-0" },
    { key: "cendekia", label: "Cendekia", sub: "Growth", pos: "right-0 bottom-[6%]" },
  ];
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[22rem] sm:max-w-md" aria-hidden="true">
      <svg viewBox="0 0 400 400" className="absolute inset-0 size-full">
        <circle cx="200" cy="200" r="150" fill="none" className="stroke-border" strokeDasharray="4 8" />
        <circle cx="200" cy="200" r="95" fill="none" className="stroke-border" strokeDasharray="2 6" />
        <path d="M200 62 L72 300 L328 300 Z" fill="none" className="stroke-primary/30" strokeWidth="1.5" />
        <path d="M200 62 L200 200 M72 300 L200 200 M328 300 L200 200" className="stroke-primary/40" strokeWidth="1.5" />
      </svg>
      <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        <span className="rounded-[22px] bg-card p-2 shadow-lift ring-1 ring-border">
          <LogoMark className="size-16" />
        </span>
        <span className="font-display rounded-full bg-card px-3 py-1 text-xs font-bold shadow-soft ring-1 ring-border">
          workingspace<span className="text-gradient">.id</span>
        </span>
      </div>
      {nodes.map((node) => {
        const Mark = MARKS[node.key];
        return (
          <div key={node.key} className={cn("absolute flex flex-col items-center gap-1.5", node.pos)}>
            <span className="rounded-2xl bg-card p-1.5 shadow-lift ring-1 ring-border">
              <Mark className="size-12" />
            </span>
            <span className="rounded-full bg-background px-2.5 py-0.5 text-center leading-tight">
              <span className="block text-sm font-bold">{node.label}</span>
              <span className="block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {node.sub}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

const AKASHA_MODULES = [
  { icon: CalendarCheck, name: "Planner", text: "Agenda, rutinitas, dan to-do harian dengan pengingat." },
  { icon: NotebookPen, name: "Notes Space", text: "Catatan bebas, tulisan tangan, Notes AI, dan notebook bersumber." },
  { icon: LayoutGrid, name: "Working Space", text: "Proyek, area tanggung jawab, dan resource dengan metode PARA." },
  {
    icon: FolderArchive,
    name: "File Control",
    text: "Kearsipan sesuai kaidah Indonesia: klasifikasi, JRA, penyusutan.",
  },
  { icon: LibraryBig, name: "Knowledge", text: "Basis pengetahuan dari vault Obsidian, bisa ditanya AI." },
  { icon: MailCheck, name: "Email & Kalender", text: "Kotak masuk, kalender Google/Outlook, dan Drive tersambung." },
];

function AkashaSpotlight({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="akasha" className="scroll-mt-20 bg-surface px-4 py-20 sm:px-6 md:py-28">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <div className="flex items-center gap-3">
            <AkashaMark className="size-11" />
            <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">Akasha · {AKASHA.role}</p>
          </div>
          <h2 className="mt-5 text-3xl font-bold sm:text-5xl">
            Where Ideas <span className="text-gradient">Find Their Place.</span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">{AKASHA.vision}</p>
          <ul className="mt-6 space-y-2 text-sm">
            {[
              "Agenda, tugas, catatan, dan proyek saling bertaut",
              "Agen menyiapkan pekerjaan — Anda yang menyetujui",
              "Item pribadi bisa dikunci dengan PIN",
            ].map((point) => (
              <li key={point} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={3} /> {point}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={AKASHA_URL} className={BTN_SOLID}>
              Buka Akasha <ArrowUpRight />
            </a>
            <a href={signedIn ? links.account : links.register} className={BTN_OUTLINE}>
              {signedIn ? "Ke dashboard" : "Belum punya akun?"}
            </a>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {AKASHA_MODULES.map((module) => {
            const Icon = module.icon;
            return (
              <div
                key={module.name}
                className="group rounded-2xl border bg-card p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/30"
              >
                <span className="flex size-9 items-center justify-center rounded-xl bg-linear-135 from-indigo/15 to-cyan/15 text-primary">
                  <Icon className="size-[18px]" />
                </span>
                <h3 className="mt-3 text-base font-bold">{module.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{module.text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const AKAI_FEATURES = [
  {
    icon: MessagesSquare,
    name: "Chat banyak model",
    text: "Claude, GPT, Gemini, dan lainnya — satu tempat, pilih sesuai tugas.",
  },
  {
    icon: FolderKanban,
    name: "Proyek & memori",
    text: "Instruksi tetap, dokumen rujukan, dan ingatan lintas percakapan.",
  },
  {
    icon: FileSpreadsheet,
    name: "Dokumen siap pakai",
    text: "Hasil berupa dokumen, tabel, slide, dan diagram — ekspor ke Word, Excel, PowerPoint, PDF.",
  },
  { icon: Plug, name: "Konektor aplikasi", text: "Akasha, Google Workspace, Notion, GitHub, Canva, dan banyak lagi." },
  { icon: Blocks, name: "Skill & plugin", text: "Ajari cara kerja Anda sendiri, tambahkan alat sesuai kebutuhan." },
  {
    icon: CalendarClock,
    name: "Tugas terjadwal",
    text: "Ringkasan pagi, pantauan rutin — hasilnya menunggu di kotak masuk.",
  },
];

/** Sorotan Akai (Akasha AI): latar tinta, mockup percakapan. */
function AkashaAiSpotlight() {
  return (
    <section id="akasha-ai" className="scroll-mt-20 px-3 py-3 sm:px-4">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[32px] bg-ink px-6 py-16 text-ink-foreground shadow-lift sm:px-10 md:py-24">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
        <div className="pointer-events-none absolute -top-40 right-0 size-[30rem] rounded-full bg-indigo/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-20 size-[24rem] rounded-full bg-lime/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <AkaiMark className="size-11" />
              <p className="text-xs font-semibold tracking-[0.18em] text-lime uppercase">Akai · {AKAI.role}</p>
            </div>
            <h2 className="mt-5 text-3xl font-bold sm:text-5xl">
              Intelligence That <span className="text-gradient">Moves With You.</span>
            </h2>
            <p className="mt-4 text-base leading-relaxed opacity-80">{AKAI.vision}</p>
            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {AKAI_FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.name} className="rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
                    <span className="flex items-center gap-2 text-sm font-bold">
                      <Icon className="size-4 text-lime" /> {feature.name}
                    </span>
                    <p className="mt-1.5 text-xs leading-relaxed opacity-70">{feature.text}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={AKAI_URL} className={BTN_PRIMARY}>
                Buka Akai <ArrowUpRight />
              </a>
              <span className="inline-flex items-center gap-2 px-2 text-sm opacity-70">
                <Waypoints className="size-4" /> Juga hadir di dalam Akasha
              </span>
            </div>
          </div>
          <AkaiChatVisual />
        </div>
      </div>
    </section>
  );
}

function AkaiChatVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden="true">
      <div className="rounded-3xl bg-white/[0.06] p-5 ring-1 ring-white/12 backdrop-blur-md">
        <div className="flex items-center gap-2.5 border-b border-white/10 pb-3">
          <AkaiMark className="size-7" />
          <span className="text-sm font-semibold">Akai</span>
          <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold">
            Proyek: Laporan Q4
          </span>
        </div>
        <div className="mt-4 space-y-3 text-sm">
          <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-indigo px-3.5 py-2.5 text-white">
            Buatkan rekap anggaran triwulan dari dokumen proyek, lalu jadwalkan rapat evaluasi minggu depan.
          </div>
          <div className="w-fit max-w-[90%] space-y-2 rounded-2xl rounded-bl-md bg-white/[0.08] px-3.5 py-2.5">
            <p className="flex items-center gap-1.5 text-[11px] opacity-60">
              <Bot className="size-3.5" /> Membaca 3 dokumen · memakai Akasha
            </p>
            <p>Rekap sudah saya susun. Rapat evaluasi saya ajukan Selasa 09.00 — menunggu persetujuan Anda.</p>
            <div className="flex items-center gap-2 rounded-xl bg-white/[0.08] p-2 ring-1 ring-white/10">
              <span className="flex size-8 items-center justify-center rounded-lg bg-success/20 text-success">
                <FileSpreadsheet className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">Rekap anggaran Q4.xlsx</span>
                <span className="block text-[10px] opacity-60">Lembar kerja · 4 kolom berumus</span>
              </span>
              <ArrowUpRight className="size-4 opacity-60" />
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2.5 text-xs opacity-60 ring-1 ring-white/10">
          Tanya apa saja…
          <span className="ml-auto flex size-6 items-center justify-center rounded-full bg-lime text-ink">
            <ArrowRight className="size-3.5" />
          </span>
        </div>
      </div>
      <div className="absolute -right-3 -bottom-6 flex flex-wrap items-center gap-1.5 rounded-2xl bg-card px-3 py-2 text-[11px] font-semibold text-card-foreground shadow-lift ring-1 ring-border sm:-right-8">
        <Plug className="size-3.5 text-primary" />
        {["Akasha", "Google", "Notion", "GitHub"].map((name) => (
          <span key={name} className="rounded-full bg-muted px-2 py-0.5">
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function CendekiaTeaser() {
  return (
    <section id="cendekia" className="scroll-mt-20 px-4 py-20 sm:px-6 md:py-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-8 rounded-[28px] border border-dashed bg-surface/60 p-6 sm:p-10 md:grid-cols-[auto_1fr_auto]">
        <CendekiaMark className="size-16" />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">Cendekia · {CENDEKIA.role}</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-info/12 px-2 py-0.5 text-[11px] font-semibold text-info">
              <Sparkles className="size-3" /> Sedang dibangun
            </span>
          </div>
          <h2 className="mt-2 text-2xl font-bold sm:text-3xl">{CENDEKIA.tagline}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{CENDEKIA.vision}</p>
        </div>
        <ul className="grid grid-cols-1 gap-2 text-sm sm:min-w-56">
          {[
            { icon: GraduationCap, text: "Kuliah & sertifikasi" },
            { icon: Target, text: "Target & progres terukur" },
            { icon: BrainCircuit, text: "Didampingi Akai" },
          ].map((item) => (
            <li
              key={item.text}
              className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 shadow-soft ring-1 ring-border"
            >
              <item.icon className="size-4 text-primary" /> {item.text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: Waypoints,
    title: "Satu akun untuk semua",
    text: "Masuk sekali di workingspace.id, berpindah antaraplikasi tanpa mengetik kata sandi lagi. Keluar sekali, keluar di mana-mana.",
    wide: true,
  },
  {
    icon: Fingerprint,
    title: "PIN keamanan bersama",
    text: "Satu PIN 6 angka untuk membuka item terkunci dan menyetujui tindakan penting di semua aplikasi.",
  },
  {
    icon: LockKeyhole,
    title: "Data tetap milik Anda",
    text: "Isi pekerjaan hanya terlihat oleh Anda dan orang yang Anda beri akses. Admin mengelola akun, bukan membaca data.",
  },
  {
    icon: Languages,
    title: "Berbahasa Indonesia",
    text: "Antarmuka, istilah, dan alur kerja disusun untuk cara kerja kantor dan instansi di Indonesia.",
  },
  {
    icon: KeyRound,
    title: "AI dengan kunci Anda",
    text: "Atur model di Akai sekali, dipakai semua aplikasi. Kunci API disimpan terenkripsi dan hanya dipakai dari server.",
  },
];

function Features() {
  return (
    <section id="keamanan" className="scroll-mt-20 bg-surface px-4 py-20 sm:px-6 md:py-28">
      <SectionHeading eyebrow="Keamanan" title={<>Aman sejak pintu masuk</>}>
        Akun workingspace.id dirancang untuk pekerjaan sungguhan: dokumen kantor, arsip, dan data pribadi.
      </SectionHeading>
      <div className="mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-5 md:grid-cols-3">
        {FEATURES.map((feature, i) => {
          const Icon = feature.icon;
          const highlight = i === 0;
          return (
            <div
              key={feature.title}
              className={cn(
                "relative overflow-hidden rounded-3xl p-6 sm:p-7",
                feature.wide && "md:col-span-2",
                highlight ? "bg-aurora text-ink-foreground shadow-lift" : "border bg-card shadow-soft",
              )}
            >
              {highlight && <div className="pointer-events-none absolute inset-0 bg-grid" />}
              <span
                className={cn(
                  "relative flex size-11 items-center justify-center rounded-2xl",
                  highlight
                    ? "bg-white/12 ring-1 ring-white/20"
                    : "bg-linear-135 from-indigo/15 to-cyan/15 text-primary",
                )}
              >
                <Icon className="size-5" />
              </span>
              <h3 className="relative mt-5 text-xl font-bold">{feature.title}</h3>
              <p
                className={cn(
                  "relative mt-2 max-w-lg text-sm leading-relaxed",
                  highlight ? "opacity-80" : "text-muted-foreground",
                )}
              >
                {feature.text}
              </p>
              {highlight && (
                <div className="relative mt-6 flex flex-wrap items-center gap-2 text-xs font-semibold">
                  {[AKASHA, AKAI, CENDEKIA].map((p) => (
                    <span key={p.key} className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                      {p.name}
                    </span>
                  ))}
                  <span className="flex items-center gap-1 opacity-70">
                    <LogOut className="size-3.5" /> satu sesi
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Pernyataan visi ekosistem. */
function Vision() {
  return (
    <section className="px-4 py-20 sm:px-6 md:py-28">
      <figure className="mx-auto max-w-4xl text-center">
        <Quote className="mx-auto size-10 text-primary/40" />
        <blockquote className="font-display mt-6 text-2xl leading-snug font-semibold sm:text-3xl">
          {ECOSYSTEM.vision}
        </blockquote>
        <figcaption className="mt-6 flex items-center justify-center gap-3 text-sm text-muted-foreground">
          <LogoMark className="size-7" /> Visi workingspace.id
        </figcaption>
      </figure>
    </section>
  );
}

const STEPS = [
  {
    icon: UserPlus,
    title: "Daftar & ajukan akses",
    text: "Isi akun dan data diri (No. HP, pekerjaan, tempat bekerja), lalu pilih aplikasi beserta tujuan pemakaiannya.",
  },
  {
    icon: MailCheck,
    title: "Verifikasi email",
    text: "Klik tautan dari noreply@workingspace.id. Setelah itu pengajuan Anda diteruskan ke admin.",
  },
  {
    icon: ShieldCheck,
    title: "Disetujui, langsung bekerja",
    text: "Admin menyetujui beserta masa aksesnya. Buka Akasha atau Akai dari dashboard — tanpa login ulang.",
  },
];

function Steps() {
  return (
    <section className="bg-surface px-4 py-20 sm:px-6 md:py-28">
      <SectionHeading eyebrow="Mulai" title="Tiga langkah, langsung bekerja" />
      <ol className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-5 md:grid-cols-3">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.title} className="relative rounded-3xl border bg-card p-6 shadow-soft">
              <span className="font-display absolute top-5 right-6 text-5xl font-bold text-muted-foreground/15">
                {i + 1}
              </span>
              <span className="flex size-11 items-center justify-center rounded-2xl bg-aurora text-ink-foreground">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-5 text-lg font-bold">{step.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{step.text}</p>
            </li>
          );
        })}
      </ol>
      <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
        Akses aplikasi diberikan per pengajuan dan bisa berbatas waktu. Perpanjangan diajukan dari halaman akun; bila
        masa akses habis, data tetap bisa dibaca selama 180 hari sebelum dihapus.
      </p>
    </section>
  );
}

const FAQ = [
  {
    q: "Apakah satu akun berlaku untuk semua aplikasi?",
    a: "Ya. Akun workingspace.id dipakai untuk Akasha, Akai, dan aplikasi lain di ekosistem ini. Akses per aplikasi bisa diatur oleh admin.",
  },
  {
    q: "Apa itu Akai?",
    a: "Akai adalah nama panggilan Akasha AI, lapisan kecerdasan ekosistem: aplikasi chat & agen tersendiri yang juga dipakai di dalam Akasha. Model AI diatur sekali di Akai lalu dipakai semua aplikasi.",
  },
  {
    q: "Apakah Akai bisa bertindak tanpa izin saya?",
    a: "Tidak untuk hal penting. Akai menyiapkan pekerjaan — menghapus data, mengirim email, atau mengirim dokumen resmi selalu menunggu persetujuan Anda.",
  },
  {
    q: "Siapa yang bisa melihat data pekerjaan saya?",
    a: "Hanya Anda dan orang yang Anda beri akses (berbagi). Admin hanya mengelola akun dan akses aplikasi, tidak membaca isi data.",
  },
  {
    q: "Bagaimana mendapat akses aplikasi, dan berapa lama?",
    a: "Saat mendaftar (atau dari halaman akun) pilih aplikasi dan tuliskan tujuan pemakaiannya. Admin menyetujui beserta masa aksesnya. Sebelum masa akses habis Anda mendapat email pengingat dan bisa mengajukan perpanjangan; setelah habis data hanya bisa dibaca selama 180 hari, lalu dihapus.",
  },
  {
    q: "Apa itu PIN keamanan?",
    a: "PIN 6 angka yang sama untuk semua aplikasi, dipakai untuk membuka item yang Anda kunci dan menyetujui tindakan penting.",
  },
  {
    q: "Saya lupa kata sandi, bagaimana?",
    a: "Gunakan tautan “Lupa kata sandi” di halaman masuk; kami mengirim tautan untuk membuat kata sandi baru ke email Anda.",
  },
];

function Faq() {
  return (
    <section id="tanya" className="scroll-mt-20 px-4 py-20 sm:px-6 md:py-28">
      <SectionHeading eyebrow="Tanya jawab" title="Yang sering ditanyakan" />
      <div className="mx-auto mt-10 flex max-w-3xl flex-col gap-3">
        {FAQ.map((item) => (
          <details key={item.q} className="group rounded-2xl border bg-card px-5 shadow-soft open:shadow-lift">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left font-semibold [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <p className="pb-5 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function CallToAction({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="px-3 pb-3 sm:px-4">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[32px] bg-aurora px-6 py-16 text-center text-ink-foreground shadow-lift sm:px-10 md:py-20">
        <div className="pointer-events-none absolute inset-0 bg-grid" />
        <div className="relative mx-auto max-w-2xl">
          <div className="flex justify-center gap-2">
            <AkashaMark className="size-10" />
            <AkaiMark className="size-10" />
            <CendekiaMark className="size-10" />
          </div>
          <h2 className="mt-6 text-3xl font-bold sm:text-5xl">
            One Space. <span className="text-gradient">Infinite Possibilities.</span>
          </h2>
          <p className="mt-4 text-base opacity-80">
            {signedIn
              ? "Lanjutkan pekerjaan Anda dari dashboard akun."
              : "Buat akun sekarang dan ajukan akses ke Akasha serta Akai dalam hitungan menit."}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {signedIn ? (
              <a href={links.account} className={BTN_PRIMARY}>
                Buka dashboard <ArrowRight />
              </a>
            ) : (
              <>
                <a href={links.register} className={BTN_PRIMARY}>
                  Buat akun gratis <ArrowRight />
                </a>
                <a href={links.login} className={BTN_GHOST_DARK}>
                  Masuk
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="px-4 py-12 sm:px-6">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Wordmark subtitle={ECOSYSTEM.tagline} />
          <p className="mt-4 max-w-sm text-sm text-muted-foreground">{ECOSYSTEM.motto}</p>
          <p className="mt-4 text-xs text-muted-foreground">© 2026 workingspace.id</p>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">Aplikasi</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a href={AKASHA_URL} className="hover:text-primary">
                Akasha
              </a>
            </li>
            <li>
              <a href={AKAI_URL} className="hover:text-primary">
                Akai
              </a>
            </li>
            <li className="text-muted-foreground">Cendekia · segera</li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">Akun</p>
          <ul className="mt-3 space-y-2 text-sm">
            {signedIn ? (
              <li>
                <a href={links.account} className="hover:text-primary">
                  Dashboard
                </a>
              </li>
            ) : (
              <>
                <li>
                  <a href={links.login} className="hover:text-primary">
                    Masuk
                  </a>
                </li>
                <li>
                  <a href={links.register} className="hover:text-primary">
                    Daftar
                  </a>
                </li>
              </>
            )}
            <li>
              <ThemeToggle />
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
