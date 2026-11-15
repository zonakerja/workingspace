import { Global, Module } from "@nestjs/common";
import { TrashController } from "./trash.controller";
import { TrashService } from "./trash.service";

/** Global: modul pemilik data (records, uploads, …) mencatat penghapusan & mendaftarkan cara memulihkannya. */
@Global()
@Module({
  controllers: [TrashController],
  providers: [TrashService],
  exports: [TrashService],
})
export class TrashModule {}
