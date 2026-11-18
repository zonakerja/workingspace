import { Body, Controller, Delete, Get, HttpCode, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { IsOptional, IsString, MaxLength } from "class-validator";
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
