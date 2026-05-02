import { Module } from '@nestjs/common';
import { SalesChatController } from './sales-chat.controller';
import { SalesChatService } from './sales-chat.service';
import { SalesAgentModule } from '../sales-agent/sales-agent.module';
import { PaymentIntentsModule } from '../payment-intents/payment-intents.module';

@Module({
  imports: [SalesAgentModule, PaymentIntentsModule],
  controllers: [SalesChatController],
  providers: [SalesChatService],
  exports: [SalesChatService],
})
export class SalesChatModule {}
