import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SharingModule } from "../sharing/sharing.module";
import { LockService } from "./lock.service";
import { PinService } from "./pin.service";
import { SecurityController } from "./security.controller";

/** PIN keamanan & item terkunci — dipakai Records, Uploads, indeks RAG, Notebook, cermin Obsidian. */
@Global()
@Module({
  // AuthModule: SsoService (PIN akun SSO diperiksa SSO workingspace.id)
  imports: [SharingModule, AuthModule],
  controllers: [SecurityController],
  providers: [LockService, PinService],
  exports: [LockService, PinService],
})
export class SecurityModule {}
