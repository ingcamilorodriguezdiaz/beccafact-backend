import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DeliverSaleDto {
  @IsOptional()
  @IsString()
  notes?: string;

  /** Si true y la venta está completamente pagada y tiene cliente, genera factura automáticamente. */
  @IsOptional()
  @IsBoolean()
  generateInvoice?: boolean;
}
