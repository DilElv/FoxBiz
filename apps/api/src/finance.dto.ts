import { IsIn, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export const FINANCE_CATEGORIES = [
  { code: 'owner_funding', kind: 'income', label: 'Setoran pemilik' },
  { code: 'other_income', kind: 'income', label: 'Pemasukan lainnya' },
  { code: 'operational', kind: 'expense', label: 'Operasional' },
  { code: 'utilities', kind: 'expense', label: 'Listrik, air & internet' },
  { code: 'supplies', kind: 'expense', label: 'Perlengkapan' },
  { code: 'transport', kind: 'expense', label: 'Transportasi' },
  { code: 'other_expense', kind: 'expense', label: 'Pengeluaran lainnya' },
] as const;

export class FinanceEntryDto {
  @IsUUID('4') idempotencyKey!: string;
  @IsUUID() outletId!: string;
  @IsIn(['income', 'expense']) kind!: string;
  @IsIn(FINANCE_CATEGORIES.map((item) => item.code)) category!: string;
  @IsString() @Matches(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/) amount!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) businessDate!: string;
  @IsString() @MinLength(3) @MaxLength(200) note!: string;
}
export class VoidFinanceDto {
  @IsUUID() outletId!: string;
  @IsString() @MinLength(3) @MaxLength(200) reason!: string;
}
