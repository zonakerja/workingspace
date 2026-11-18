import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsOptional, ValidateNested } from "class-validator";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthUser } from "../common/types/auth-user";
import { CalendarFeedService } from "./calendar-feed.service";
import { FEED_TIMEZONES } from "./ics-logic";

class FeedIncludeDto {
  @IsOptional() @IsBoolean() agenda?: boolean;
  @IsOptional() @IsBoolean() tasks?: boolean;
  @IsOptional() @IsBoolean() todos?: boolean;
}

export class UpdateCalendarFeedDto {
  @ApiPropertyOptional({ type: FeedIncludeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FeedIncludeDto)
  include?: FeedIncludeDto;

  @ApiPropertyOptional({ enum: Object.keys(FEED_TIMEZONES) })
  @IsOptional()
  @IsIn(Object.keys(FEED_TIMEZONES))
  timezone?: string;
}

@ApiTags("calendar-feed")
@Controller()
export class CalendarFeedController {
  constructor(private readonly feeds: CalendarFeedService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get("calendar-feed")
  status(@CurrentUser() user: AuthUser) {
    return this.feeds.status(user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put("calendar-feed")
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateCalendarFeedDto) {
    return this.feeds.update(user.id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post("calendar-feed/rotate")
  rotate(@CurrentUser() user: AuthUser) {
    return this.feeds.rotate(user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete("calendar-feed")
  remove(@CurrentUser() user: AuthUser) {
    return this.feeds.remove(user.id);
  }

  /** Publik (aplikasi kalender tidak bisa login): token rahasia di alamat. */
  @Get("public/calendar/:token")
  async feed(@Param("token") param: string, @Res() res: Response) {
    const token = param.replace(/\.ics$/i, "");
    const ics = await this.feeds.render(token);
    if (!ics) throw new NotFoundException("Langganan kalender tidak ditemukan.");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="akasha.ics"');
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Robots-Tag", "noindex");
    res.send(ics);
  }
}
