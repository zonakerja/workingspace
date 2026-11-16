import { Global, Module } from "@nestjs/common";
import { AkaiService } from "./akai.service";

/** Klien Akai (gateway model ekosistem) — global agar AI & Auth memakainya tanpa impor melingkar. */
@Global()
@Module({
  providers: [AkaiService],
  exports: [AkaiService],
})
export class AkaiModule {}
