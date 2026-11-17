import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class StockItemDto {
  @IsUUID() productId!: string;
  @IsString() @Matches(/^-?(0|[1-9]\d{0,10})(\.\d{1,3})?$/) quantity!: string;
}
export class StockDocumentDto {
  @IsUUID('4') idempotencyKey!: string;
  @IsUUID() outletId!: string;
  @IsIn(['adjustment', 'receiving', 'transfer']) kind!: 'adjustment' | 'receiving' | 'transfer';
  @IsOptional() @IsUUID() destinationOutletId?: string;
  @IsString() @MinLength(3) @MaxLength(200) note!: string;
  @IsOptional() @IsString() @MaxLength(100) externalReference?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => StockItemDto) items!: StockItemDto[];
}
