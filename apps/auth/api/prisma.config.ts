import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7: URL datasource & shadow DB diatur di sini; dibaca dari process.env agar `prisma generate` jalan tanpa DATABASE_URL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx src/database/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
