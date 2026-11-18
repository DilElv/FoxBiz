import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

const pinPattern = /^\d{6}$/;
export class EmployeeDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @Matches(/^[A-Z0-9_-]{1,30}$/) code!: string;
  @IsOptional() @IsString() @MaxLength(80) position?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ValidateIf((value: EmployeeDto) => value.pin !== undefined && value.pin !== '')
  @IsString() @Matches(pinPattern, { message: 'PIN harus 6 digit angka.' }) pin?: string;
  @IsBoolean() allOutlets!: boolean;
  @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsUUID('4', { each: true }) outletIds!: string[];
  @IsIn(['active', 'inactive']) status!: string;
}

export class AttendanceEventDto {
  @IsUUID() employeeId!: string;
  @IsUUID() outletId!: string;
  @IsString() @Matches(pinPattern, { message: 'PIN harus 6 digit angka.' }) pin!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100000) accuracy?: number;
}
