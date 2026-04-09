import { IsInt, IsObject, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class HeartbeatPosTerminalDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  cartCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  pendingOrders?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  pendingSyncCount?: number;

  @IsOptional()
  @IsString()
  currentView?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;

  @IsOptional()
  @IsObject()
  recoverySnapshot?: Record<string, unknown>;
}
