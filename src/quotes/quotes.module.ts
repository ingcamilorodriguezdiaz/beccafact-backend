import { Module } from '@nestjs/common';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { MailerModule } from '../common/mailer/mailer.module';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [MailerModule, InvoicesModule],
  controllers: [QuotesController],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
