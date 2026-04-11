import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class RequestPayrollApprovalDto {
  @IsString()
  actionType: 'SUBMIT' | 'VOID' | 'PREPAYROLL';

  @IsOptional()
  @IsString()
  reason?: string;
}

export class RejectPayrollApprovalDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AddPayrollAttachmentDto {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  fileUrl: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}

export class ReversePayrollDto {
  @IsString()
  tipoAjuste: 'Reemplazar' | 'Eliminar';

  @IsOptional()
  @IsString()
  notes?: string;
}
