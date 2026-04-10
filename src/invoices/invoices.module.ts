import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { CompaniesModule } from '../companies/companies.module';
import { ProductsService } from '@/products/products.service';
import { ProductsModule } from '@/products/products.module';
import { AccountingModule } from '../accounting/accounting.module';
import { CarteraModule } from '../cartera/cartera.module';

@Module({
  imports: [CompaniesModule, ProductsModule, AccountingModule, CarteraModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
