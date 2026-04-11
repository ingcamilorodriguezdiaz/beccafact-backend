import { IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class QueuePayrollReprocessDto {
  @IsString()
  @IsIn(['SUBMIT_DIAN', 'QUERY_DIAN_STATUS'])
  actionType: 'SUBMIT_DIAN' | 'QUERY_DIAN_STATUS';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class BulkPayrollReprocessDto {
  @IsString()
  @IsIn(['SUBMIT_DIAN', 'QUERY_DIAN_STATUS'])
  actionType: 'SUBMIT_DIAN' | 'QUERY_DIAN_STATUS';

  @IsOptional()
  @IsUUID('4')
  payrollBatchId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  payrollRecordIds?: string[];
}
