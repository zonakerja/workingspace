import { Body, Controller, Delete, Get, HttpCode, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { IsString, MaxLength, MinLength } from "class-validator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import { PinService } from "./pin.service";

class SetPinDto {
  @ApiProperty({ description: "Kata sandi akun LifeOS" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;

  @ApiProperty({ description: "PIN baru, 6 angka" })
  @IsString()
  @MaxLength(6)
  pin: string;
}

class UnlockDto {
  @ApiProperty()
  @IsString()
  @MaxLength(6)
  pin: string;
}

class PasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
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
    return this.pins.setPin(user, dto.password, dto.pin);
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
  remove(@CurrentUser() user: AuthUser, @Body() dto: PasswordDto) {
    return this.pins.removePin(user, dto.password);
  }
}
