import { Wordmark } from "@workingspace/ui/brand";
import { ThemeToggle } from "@workingspace/ui/theme-toggle";
import { cn } from "cn";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CalendarCheck,
  Check,
  ChevronDown,
  Fingerprint,
  FolderArchive,
  GraduationCap,
  KeyRound,
  Languages,
  LayoutDashboard,
  LayoutGrid,
  LibraryBig,
  LockKeyhole,
  LogOut,
  MailCheck,
  NotebookPen,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Waypoints,
} from "lucide-react";
import type { ReactNode } from "react";
import { AKASHA_URL, AUTH_URL, ssoLinks } from "./config";
import { type SsoStatus, useSsoStatus } from "./use-sso-status";

const links = ssoLinks(AUTH_URL);

const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-full bg-lime px-6 py-3 text-sm font-semibold text-ink shadow-soft transition-all hover:-translate-y-0.5 hover:bg-lime/90 hover:shadow-lift [&_svg]:size-4";
const BTN_GHOST_DARK =
  "inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-6 py-3 text-sm font-semibold text-white ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-white/15 [&_svg]:size-4";

const NAV = [
  { href: "#aplikasi", label: "Aplikasi" },
  { href: "#keunggulan", label: "Keunggulan" },
  { href: "#akasha", label: "Akasha" },
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
        <Apps />
        <Features />
        <AkashaSpotlight signedIn={signedIn} />
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
        <nav className="hidden items-center gap-1 md:flex">
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
        <div className="pointer-events-none absolute -right-24 -bottom-40 size-[28rem] rounded-full bg-lime/20 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 py-16 sm:px-10 md:py-24 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-white/20">
              <Sparkles className="size-3.5 text-lime" /> Ekosistem ruang kerja berbahasa Indonesia
            </span>
            <h1 className="mt-6 text-4xl leading-[1.05] font-bold sm:text-5xl lg:text-6xl">
              Satu akun, <span className="text-gradient">semua ruang kerja</span> Anda.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed opacity-80 sm:text-lg">
              Rencanakan hari, kelola proyek & arsip, tulis catatan, dan bekerja bersama asisten AI — di
              aplikasi-aplikasi workingspace.id yang terhubung lewat satu akun aman.
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
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm opacity-80">
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
            <span className="font-display flex size-9 items-center justify-center rounded-xl bg-linear-135 from-indigo to-cyan text-sm font-bold">
              A
            </span>
            <span>
              <span className="block text-sm font-semibold">Akasha</span>
              <span className="block text-[11px] opacity-60">Hari ini · 3 agenda</span>
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
            { time: "08.00", title: "Rapat koordinasi", tone: "bg-cyan" },
            { time: "10.30", title: "Telaah pengajuan", tone: "bg-lime" },
            { time: "14.00", title: "Penataan arsip", tone: "bg-coral" },
          ].map((row) => (
            <div key={row.time} className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-3 py-2.5">
              <span className={cn("h-8 w-1 rounded-full", row.tone)} />
              <span className="text-xs font-medium opacity-60 tabular-nums">{row.time}</span>
              <span className="text-sm font-medium">{row.title}</span>
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

      <div className="absolute -bottom-8 -left-4 w-56 rounded-2xl bg-card p-3.5 text-card-foreground shadow-lift ring-1 ring-border sm:-left-10">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className="flex size-6 items-center justify-center rounded-lg bg-linear-135 from-coral to-indigo text-white">
            <Bot className="size-3.5" />
          </span>
          Akai
        </div>
        <p className="mt-2 rounded-xl bg-muted px-3 py-2 text-xs leading-snug">
          Ringkasan notulen rapat sudah saya simpan ke catatan Anda.
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

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-bold sm:text-4xl">{title}</h2>
      {children && <p className="mt-4 text-base text-muted-foreground">{children}</p>}
    </div>
  );
}

const APPS = [
  {
    key: "akasha",
    name: "Akasha",
    tagline: "Sistem operasi pribadi untuk kerja harian",
    description:
      "Planner, catatan, Working Space metode PARA, kearsipan, basis pengetahuan, dan agen AI dalam satu tempat.",
    icon: LayoutGrid,
    available: true,
    href: AKASHA_URL,
  },
  {
    key: "akai",
    name: "Akai",
    tagline: "Asisten AI untuk semua aplikasi",
    description:
      "Chat & agen yang bisa bekerja dengan data Anda di aplikasi workingspace.id, dengan banyak pilihan model.",
    icon: Bot,
    available: false,
  },
  {
    key: "cendekia",
    name: "Cendekia",
    tagline: "Ruang belajar & pengetahuan",
    description: "Tempat menyusun materi, belajar, dan berbagi pengetahuan secara terstruktur.",
    icon: GraduationCap,
    available: false,
  },
];

function Apps() {
  return (
    <section id="aplikasi" className="scroll-mt-20 px-4 py-20 sm:px-6 md:py-28">
      <SectionHeading eyebrow="Aplikasi" title="Satu ekosistem, aplikasi yang saling terhubung">
        Daftar sekali di workingspace.id, lalu buka aplikasi mana pun yang Anda butuhkan tanpa login ulang.
      </SectionHeading>
      <div className="mx-auto mt-12 grid max-w-6xl grid-cols-1 gap-5 md:grid-cols-3">
        {APPS.map((app) => {
          const Icon = app.icon;
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <span
                  className={cn(
                    "flex size-14 items-center justify-center rounded-2xl",
                    app.available ? "bg-aurora text-ink-foreground shadow-soft" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-6" />
                </span>
                {app.available ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2.5 py-1 text-[11px] font-semibold text-success ring-1 ring-success/25">
                    <span className="size-1.5 rounded-full bg-success" /> Tersedia
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-info/12 px-2.5 py-1 text-[11px] font-semibold text-info ring-1 ring-info/25">
                    <Sparkles className="size-3" /> Segera hadir
                  </span>
                )}
              </div>
              <h3 className="mt-6 text-2xl font-bold">{app.name}</h3>
              <p className="mt-1 text-sm font-semibold text-primary">{app.tagline}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{app.description}</p>
              {app.available && (
                <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  Buka {app.name}
                  <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              )}
            </>
          );
          return app.available ? (
            <a
              key={app.key}
              href={app.href}
              className="group ring-aurora flex flex-col rounded-3xl p-6 shadow-soft transition-all hover:-translate-y-1 hover:shadow-lift"
            >
              {body}
            </a>
          ) : (
            <div key={app.key} className="flex flex-col rounded-3xl border border-dashed bg-surface/60 p-6">
              {body}
            </div>
          );
        })}
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
    text: "Pilih penyedia model sendiri; kunci API disimpan terenkripsi dan hanya dipakai dari server.",
  },
];

function Features() {
  return (
    <section id="keunggulan" className="scroll-mt-20 bg-surface px-4 py-20 sm:px-6 md:py-28">
      <SectionHeading eyebrow="Keunggulan" title={<>Aman sejak pintu masuk</>}>
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
                  {["Akasha", "Akai", "Cendekia"].map((name) => (
                    <span key={name} className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                      {name}
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
  { icon: Bot, name: "AI Agent", text: "Agen yang menyiapkan pekerjaan, Anda yang menyetujui." },
];

function AkashaSpotlight({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="akasha" className="scroll-mt-20 px-4 py-20 sm:px-6 md:py-28">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">Tersedia sekarang</p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
            Akasha, <span className="text-gradient">ruang kerja pribadi</span> Anda
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Semua yang Anda kerjakan setiap hari — jadwal, catatan, proyek, arsip, dan pengetahuan — tersusun rapi dan
            saling terhubung, dengan AI yang membantu tanpa mengambil alih keputusan.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={AKASHA_URL}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift"
            >
              Buka Akasha <ArrowUpRight className="size-4" />
            </a>
            <a
              href={signedIn ? links.account : links.register}
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold ring-1 ring-border transition-colors hover:bg-accent"
            >
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

const STEPS = [
  { icon: UserPlus, title: "Daftar", text: "Isi nama, email, dan kata sandi di halaman akun workingspace.id." },
  { icon: MailCheck, title: "Verifikasi email", text: "Klik tautan yang kami kirim dari noreply@workingspace.id." },
  { icon: LayoutGrid, title: "Buka aplikasi", text: "Pilih aplikasi dari halaman akun Anda — tanpa login ulang." },
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
    </section>
  );
}

const FAQ = [
  {
    q: "Apakah satu akun berlaku untuk semua aplikasi?",
    a: "Ya. Akun workingspace.id dipakai untuk Akasha dan aplikasi lain di ekosistem ini. Akses per aplikasi bisa diatur oleh admin.",
  },
  {
    q: "Siapa yang bisa melihat data pekerjaan saya?",
    a: "Hanya Anda dan orang yang Anda beri akses (berbagi). Admin hanya mengelola akun dan akses aplikasi, tidak membaca isi data.",
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
          <h2 className="text-3xl font-bold sm:text-5xl">
            Siap merapikan <span className="text-gradient">ruang kerja</span> Anda?
          </h2>
          <p className="mt-4 text-base opacity-80">
            {signedIn
              ? "Lanjutkan pekerjaan Anda dari dashboard akun."
              : "Buat akun sekarang dan buka Akasha dalam hitungan menit."}
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
    <footer className="px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Wordmark subtitle="Satu akun, semua ruang kerja" />
          <p className="mt-3 text-xs text-muted-foreground">© 2026 workingspace.id</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
          <a href={AKASHA_URL} className="hover:text-foreground">
            Akasha
          </a>
          {signedIn ? (
            <a href={links.account} className="hover:text-foreground">
              Dashboard
            </a>
          ) : (
            <>
              <a href={links.login} className="hover:text-foreground">
                Masuk
              </a>
              <a href={links.register} className="hover:text-foreground">
                Daftar
              </a>
            </>
          )}
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
