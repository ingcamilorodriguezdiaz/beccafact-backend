import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestQuoteApprovalDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
