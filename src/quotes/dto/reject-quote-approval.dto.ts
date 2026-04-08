import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectQuoteApprovalDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
