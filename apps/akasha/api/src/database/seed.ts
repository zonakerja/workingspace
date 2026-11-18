/**
 * Seed data awal: pengaturan aplikasi saja. Akun Akasha tidak dibuat di sini — akun dibuat otomatis saat pemilik pertama kali
 * masuk lewat SSO workingspace.id (nama, email, role dari akun Workingspace; super admin ekosistem = Super Admin Akasha).
 *
 * Idempoten. Dev:  npm run prisma:seed   |   Produksi/container:  node dist/database/seed.js
 */
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { createPrismaAdapter } from "../prisma/prisma-adapter";

const prisma = new PrismaClient({ adapter: createPrismaAdapter(process.env.DATABASE_URL ?? "") });

async function main() {
  await prisma.appSettings.upsert({ where: { id: "global" }, create: {}, update: {} });
  console.log("✓ pengaturan aplikasi");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
