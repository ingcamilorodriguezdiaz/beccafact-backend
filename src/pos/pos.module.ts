import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { CarteraModule } from '../cartera/cartera.module';

@Module({
  imports: [InvoicesModule, AccountingModule, PurchasingModule, CarteraModule],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
