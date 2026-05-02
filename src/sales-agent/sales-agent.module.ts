import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SalesAgentService } from './sales-agent.service';

@Module({
  imports: [ConfigModule],
  providers: [SalesAgentService],
  exports: [SalesAgentService],
})
export class SalesAgentModule {}
