import {
  type CallHandler,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { from, switchMap } from "rxjs";
import type { AuthUser } from "../common/types/auth-user";
import { allowedWhileReadOnly, READ_ONLY_MESSAGE } from "./access-state";
import { AccessStateService } from "./access-state.service";

/**
 * Masa akses habis → semua permintaan tulis ditolak 403 `ACCESS_READ_ONLY` (dipasang global, berjalan setelah guard login
 * sehingga `req.user` sudah ada). Permintaan tanpa user (publik, webhook, callback ONLYOFFICE) tidak disentuh.
 */
@Injectable()
export class ReadOnlyInterceptor implements NestInterceptor {
  constructor(private readonly access: AccessStateService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== "http") return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const userId = req.user?.id;
    if (!userId || allowedWhileReadOnly(req.method, req.originalUrl ?? req.url)) return next.handle();
    return from(this.access.isReadOnly(userId)).pipe(
      switchMap((readOnly) => {
        if (readOnly) throw new ForbiddenException({ message: READ_ONLY_MESSAGE, code: "ACCESS_READ_ONLY" });
        return next.handle();
      }),
    );
  }
}
