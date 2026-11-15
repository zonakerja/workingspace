import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { AuthUser } from "../common/types/auth-user";
import { LockService } from "../security/lock.service";

/** Semua rute `/notebooks/:id/…`: notebook terkunci hanya terbuka di sesi yang sudah memasukkan PIN (PIN_REQUIRED). */
@Injectable()
export class NotebookLockGuard implements CanActivate {
  constructor(private readonly locks: LockService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const id = req.params?.id;
    if (typeof id !== "string" || !req.user) return true;
    await this.locks.assertNotebookOpen(req.user, id);
    return true;
  }
}
