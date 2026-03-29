import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { CompaniesModule } from '../companies/companies.module';
import { ProductsService } from '@/products/products.service';
import { ProductsModule } from '@/products/products.module';

@Module({
  imports: [CompaniesModule,ProductsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
