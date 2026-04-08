import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService }    from './payroll.service';
import { PrismaModule }      from '../config/prisma.module';
import { BranchesModule } from '@/branches/branches.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports:     [PrismaModule, BranchesModule, AccountingModule],
  controllers: [PayrollController],
  providers:   [PayrollService],
  exports:     [PayrollService],
})
export class PayrollModule {}
