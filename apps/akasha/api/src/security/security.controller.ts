import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from "class-validator";
import { PIN_AUTO_LOCK_OPTIONS } from "./lock-logic";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import { PinService } from "./pin.service";

class SetPinDto {
  @ApiProperty({ description: "PIN baru, 6 angka" })
  @IsString()
  @MaxLength(6)
  pin: string;

  @ApiPropertyOptional({ description: "PIN lama (wajib saat mengganti PIN)" })
  @IsOptional()
  @IsString()
  @MaxLength(6)
  currentPin?: string;
}

class UnlockDto {
  @ApiProperty()
  @IsString()
  @MaxLength(6)
  pin: string;
}

class AutoLockDto {
  @ApiProperty({
    nullable: true,
    enum: PIN_AUTO_LOCK_OPTIONS,
    description: "Menit tanpa aktivitas; null = sampai logout",
  })
  @ValidateIf((_, value) => value !== null)
  @IsIn([...PIN_AUTO_LOCK_OPTIONS])
  minutes: number | null;
}

/** PIN keamanan: membuka item terkunci (Area, Project, Resource, Catatan, List, Notebook) selama sesi login. */
@ApiTags("security")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("security/pin")
export class SecurityController {
  constructor(private readonly pins: PinService) {}

  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.pins.status(user);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Put()
  set(@CurrentUser() user: AuthUser, @Body() dto: SetPinDto) {
    return this.pins.setPin(user, dto.pin, dto.currentPin);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(200)
  @Post("unlock")
  unlock(@CurrentUser() user: AuthUser, @Body() dto: UnlockDto) {
    return this.pins.unlock(user, dto.pin);
  }

  @Patch("auto-lock")
  autoLock(@CurrentUser() user: AuthUser, @Body() dto: AutoLockDto) {
    return this.pins.setAutoLock(user, dto.minutes ?? null);
  }

  @HttpCode(200)
  @Post("lock")
  lock(@CurrentUser() user: AuthUser) {
    return this.pins.lock(user);
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Delete()
  remove(@CurrentUser() user: AuthUser, @Body() dto: UnlockDto) {
    return this.pins.removePin(user, dto.pin);
  }
}
