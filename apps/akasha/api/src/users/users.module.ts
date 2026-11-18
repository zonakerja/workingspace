import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AccessCleanupService } from "./access-cleanup.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, AccessCleanupService],
  exports: [UsersService],
})
export class UsersModule {}
