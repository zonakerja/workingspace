import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "admin@workingspace.id" })
  @IsEmail({}, { message: "Format email tidak valid." })
  email: string;

  @ApiProperty({ example: "123" })
  @IsString()
  @MinLength(1)
  password: string;
}
