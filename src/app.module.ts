import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CompaniesModule } from './companies/companies.module';
import { PlansModule } from './plans/plans.module';
import { ProductsModule } from './products/products.module';
import { InvoicesModule } from './invoices/invoices.module';
import { CustomersModule } from './customers/customers.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { ImportModule } from './import/import.module';
import { ReportsModule } from './reports/reports.module';
import { CarteraModule } from './cartera/cartera.module';
import { PayrollModule } from './payroll/payroll.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { PrismaModule } from './config/prisma.module';
import { CategoriesModule } from './categories/categories.module';
import { LocationModule } from './location/location.module';
import { ParametersModule } from './parameter/parameters.module';
import { BanksModule } from './banks/banks.module';
import { PosModule } from './pos/pos.module';
import { DianTestSetsModule } from './dian-test-sets/dian-test-sets.module';

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),

    // Rate limiting
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'medium', ttl: 10000, limit: 50 },
      { name: 'long', ttl: 60000, limit: 200 },
    ]),

    // BullMQ Queue
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD'),
        },
      }),
    }),

    // App Modules
    PrismaModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    PlansModule,
    ProductsModule,
    InvoicesModule,
    CustomersModule,
    IntegrationsModule,
    ImportModule,
    ReportsModule,
    SuperAdminModule,
    CarteraModule,
    PayrollModule,
    CategoriesModule,
    LocationModule,
    ParametersModule,
    BanksModule,
    PosModule,
    DianTestSetsModule,
  ],
})
export class AppModule {}
