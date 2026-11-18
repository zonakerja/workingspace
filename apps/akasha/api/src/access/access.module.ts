import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AccessStateService } from "./access-state.service";
import { ReadOnlyInterceptor } from "./read-only.interceptor";

/** Masa akses dari SSO: status per user + penjaga tulis global saat baca saja. */
@Global()
@Module({
  providers: [AccessStateService, { provide: APP_INTERCEPTOR, useClass: ReadOnlyInterceptor }],
  exports: [AccessStateService],
})
export class AccessModule {}
