import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PERMISSIONS } from './permissions';

export class OrganizationDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MaxLength(500) address!: string;
  @IsIn(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'UTC']) timezone!: string;
}
export class OutletDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @Matches(/^[A-Z0-9_-]{1,30}$/) code!: string;
  @IsString() @MaxLength(500) address!: string;
  @IsIn(['active', 'inactive']) status!: string;
}
export class RoleDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsArray() @ArrayUnique() @ArrayMaxSize(PERMISSIONS.length) @IsIn(PERMISSIONS, { each: true }) permissions!: string[];
}
export class UserDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsEmail() @MaxLength(254) email!: string;
  @IsOptional() @IsString() @MinLength(12) @MaxLength(72) password?: string;
  @IsUUID() roleId!: string;
  @IsBoolean() allOutlets!: boolean;
  @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsUUID('4', { each: true }) outletIds!: string[];
  @IsIn(['active', 'inactive']) status!: string;
}
export class CategoryDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsIn(['active', 'inactive']) status!: string;
}
export class ProductDto {
  @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @IsString() @Matches(/^[A-Z0-9._-]{1,64}$/) sku!: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9._-]{1,80}$/) barcode?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsString() @MinLength(1) @MaxLength(20) unit!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/) sellingPrice!: string;
  @IsIn(['active', 'inactive']) status!: string;
}
export class OpeningStockDto {
  @IsUUID() outletId!: string;
  @IsUUID() productId!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,10})(\.\d{1,3})?$/) quantity!: string;
  @IsString() @MinLength(3) @MaxLength(200) note!: string;
}
export class ThresholdDto {
  @IsUUID() outletId!: string;
  @IsUUID() productId!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,10})(\.\d{1,3})?$/) lowStockThreshold!: string;
}
