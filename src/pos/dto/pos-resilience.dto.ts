import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreatePosConfigDeploymentDto {
  @IsString()
  @IsNotEmpty()
  deploymentType: string;

  @IsString()
  @IsNotEmpty()
  scope: string;

  @IsOptional()
  @IsString()
  versionLabel?: string;

  @IsOptional()
  @IsUUID()
  terminalId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  branchIds?: string[];
}

export class ResolvePosOperationalIncidentDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
