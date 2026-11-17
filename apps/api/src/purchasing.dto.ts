import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class SupplierDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MaxLength(200) contact!: string;
  @IsIn(['active', 'inactive']) status!: string;
}
export class PurchaseItemDto {
  @IsUUID() productId!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,10})(\.\d{1,3})?$/) qtyOrdered!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/) unitCost!: string;
}
export class PurchaseOrderDto {
  @IsUUID('4') idempotencyKey!: string;
  @IsUUID() outletId!: string;
  @IsUUID() supplierId!: string;
  @IsString() @MaxLength(200) note!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PurchaseItemDto) items!: PurchaseItemDto[];
}
export class UpdatePurchaseOrderDto {
  @IsInt() @Min(1) version!: number;
  @IsUUID() supplierId!: string;
  @IsString() @MaxLength(200) note!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PurchaseItemDto) items!: PurchaseItemDto[];
}
export class PurchaseActionDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) reason?: string;
}
export class ReceiptItemDto {
  @IsUUID() productId!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,10})(\.\d{1,3})?$/) qtyReceived!: string;
}
export class GoodsReceiptDto {
  @IsUUID('4') idempotencyKey!: string;
  @IsUUID() outletId!: string;
  @IsUUID() purchaseOrderId!: string;
  @IsString() @MinLength(3) @MaxLength(200) note!: string;
  @IsString() @MaxLength(100) externalReference!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ReceiptItemDto) items!: ReceiptItemDto[];
}
