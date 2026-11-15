import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "../generated/prisma/client";
import { normalizeEmail, passwordProblem } from "../accounts/password-policy";
import { createPrismaAdapter } from "../prisma/prisma-adapter";

/**
 * Seed SSO.
 * - development: aplikasi ekosistem + akun demo `admin@workingspace.id` (super admin) & `user@workingspace.id` (member Akasha),
 *   kata sandi `123` (khusus dev, aturan kata sandi dilewati).
 * - production: aplikasi + super admin dari SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (aturan kata sandi berlaku).
 * Aman dijalankan ulang (upsert; kata sandi akun yang sudah ada tidak diubah).
 */
const prisma = new PrismaClient({ adapter: createPrismaAdapter(process.env.DATABASE_URL ?? "") });
const production = process.env.NODE_ENV === "production";

const APPS = [
  {
    key: "akasha",
    name: "Akasha",
    url: process.env.SEED_AKASHA_URL ?? (production ? "https://akasha.workingspace.id" : "http://localhost:5173"),
    description: "Ruang kerja: Planner, Notes, Working Space, File Control, Knowledge, AI Agent",
  },
];

async function account(
  email: string,
  name: string,
  password: string,
  superAdmin: boolean,
  akashaRole?: "admin" | "member",
) {
  const normalized = normalizeEmail(email);
  const row = await prisma.account.upsert({
    where: { email: normalized },
    create: { email: normalized, name, passwordHash: await hash(password), emailVerifiedAt: new Date(), superAdmin },
    update: { superAdmin },
  });
  if (akashaRole)
    await prisma.appMembership.upsert({
      where: { accountId_appKey: { accountId: row.id, appKey: "akasha" } },
      create: { accountId: row.id, appKey: "akasha", role: akashaRole },
      update: {},
    });
  console.log(`akun ${normalized}${superAdmin ? " (super admin)" : ""}`);
}

async function main() {
  for (const app of APPS) {
    await prisma.app.upsert({ where: { key: app.key }, create: app, update: { name: app.name, url: app.url } });
    console.log(`aplikasi ${app.key} → ${app.url}`);
  }
  if (production) {
    const email = process.env.SEED_ADMIN_EMAIL;
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!email || !password)
      throw new Error("SEED_ADMIN_EMAIL dan SEED_ADMIN_PASSWORD wajib diisi untuk seed production.");
    const problem = passwordProblem(password, { email });
    if (problem) throw new Error(`SEED_ADMIN_PASSWORD: ${problem}`);
    await account(email, "Super Admin", password, true, "admin");
    return;
  }
  await account("admin@workingspace.id", "Admin Workingspace", "123", true, "admin");
  await account("user@workingspace.id", "User Workingspace", "123", false, "member");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
