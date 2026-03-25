import { Module } from '@nestjs/common';
import { DianTestSetsService } from './dian-test-sets.service';
import { DianTestSetsController } from './dian-test-sets.controller';
import { PrismaModule } from '../config/prisma.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PayrollModule } from '../payroll/payroll.module';

@Module({
  imports: [PrismaModule, InvoicesModule, PayrollModule],
  controllers: [DianTestSetsController],
  providers: [DianTestSetsService],
})
export class DianTestSetsModule {}
