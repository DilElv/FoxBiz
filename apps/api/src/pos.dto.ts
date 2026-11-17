import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class CartItemDto {
  @IsUUID() productId!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,7})(\.\d{1,3})?$/) quantity!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/) expectedPrice!: string;
}
export class CartDto {
  @IsUUID() outletId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CartItemDto) items!: CartItemDto[];
}
export class CheckoutDto extends CartDto {
  @IsUUID('4') idempotencyKey!: string;
  @IsIn(['cash', 'edc']) method!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/) tendered!: string;
  @IsBoolean() manualConfirmed!: boolean;
  @IsOptional() @IsUUID() holdId?: string;
  @IsOptional() @IsInt() @Min(1) holdVersion?: number;
  @IsOptional() @IsUUID() customerId?: string;
}
export class HoldDto extends CartDto {
  @IsString() @MinLength(1) @MaxLength(80) label!: string;
  @IsOptional() @IsUUID() customerId?: string;
}
