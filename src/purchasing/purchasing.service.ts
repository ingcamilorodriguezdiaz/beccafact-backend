import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../config/prisma.service';
import { AccountingService } from '../accounting/accounting.service';
import { CreateCustomerDto } from '../customers/dto/create-customer.dto';
import { UpdateCustomerDto } from '../customers/dto/update-customer.dto';
import { CustomersService } from '../customers/customers.service';
import { MailerService } from '../common/mailer/mailer.service';
import { CreatePurchaseOrderDto, CreatePurchaseOrderItemDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto, UpdatePurchaseOrderStatusDto } from './dto/update-purchase-order.dto';
import { PaymentMethod, PurchaseOrderStatus } from '@prisma/client';
import {
  ConvertPurchaseRequestToOrderDto,
  CreatePurchaseRequestDto,
  DecidePurchaseApprovalDto,
  RequestPurchaseApprovalDto,
} from './dto/create-purchase-request.dto';
import { PurchaseRequestStatusValue, UpdatePurchaseRequestDto, UpdatePurchaseRequestStatusDto } from './dto/update-purchase-request.dto';
import { CreatePurchaseReceiptDto } from './dto/create-purchase-receipt.dto';
import { CreatePurchaseInvoiceDto, CreatePurchaseInvoiceItemDto } from './dto/create-purchase-invoice.dto';
import { RegisterPayablePaymentDto } from './dto/register-payable-payment.dto';
import { CreatePurchaseAdjustmentDto, DecidePurchaseAdjustmentDto, PurchaseAdjustmentTypeValue } from './dto/create-purchase-adjustment.dto';
import { AwardPurchaseSupplierQuoteDto, CreatePurchaseSupplierQuoteDto, CreatePurchaseSupplierQuoteItemDto } from './dto/create-purchase-supplier-quote.dto';
import { CreatePurchaseFrameworkAgreementDto } from './dto/create-purchase-framework-agreement.dto';
import { CreatePurchaseBudgetDto, PurchaseBudgetStatusValue, UpdatePurchaseBudgetDto } from './dto/create-purchase-budget.dto';
import { ApplyPurchaseAdvanceDto, CreatePurchaseAdvanceDto } from './dto/create-purchase-advance.dto';
import { CreatePayableScheduleDto } from './dto/create-payable-schedule.dto';

@Injectable()
export class PurchasingService {
  constructor(
    private prisma: PrismaService,
    private customersService: CustomersService,
    private mailerService: MailerService,
    private accountingService: AccountingService,
  ) {}

  private mapCustomerForPurchasing(customer: any) {
    if (!customer) return customer;
    const { creditDays, ...rest } = customer;
    return {
      ...rest,
      creditDays: creditDays ?? null,
      paymentTermDays: creditDays ?? null,
    };
  }

  private mapOrderSupplierToCustomer(order: any) {
    if (!order) return order;
    const {
      customer,
      items,
      number,
      ...rest
    } = order;
    return {
      ...rest,
      orderNumber: number,
      customer: customer
        ? {
            ...customer,
            creditDays: customer.creditDays ?? null,
            paymentTermDays: customer.creditDays ?? null,
          }
        : null,
      lines: Array.isArray(items)
        ? items.map((item) => ({
            ...item,
            taxPercent: Number(item.taxRate ?? 0),
            discountPercent: Number(item.discount ?? 0),
          }))
        : undefined,
    };
  }

  private async ensureCustomerForOrder(companyId: string, customerId: string) {
    return this.customersService.findOne(companyId, customerId);
  }

  private toNumber(value: any): number {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  private async generateSequenceNumber(
    table: string,
    companyId: string,
    prefix: string,
    column = 'number',
  ) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ value: string }>>(
      `
        SELECT "${column}" AS "value"
        FROM "${table}"
        WHERE "companyId" = $1
        ORDER BY "${column}" DESC
        LIMIT 1
      `,
      companyId,
    );
    const current = rows[0]?.value ?? `${prefix}-0000`;
    const parts = current.split('-');
    const lastNumber = parseInt(parts[parts.length - 1] ?? '0', 10);
    return `${prefix}-${String((Number.isFinite(lastNumber) ? lastNumber : 0) + 1).padStart(4, '0')}`;
  }

  private async getLatestRequestApproval(companyId: string, requestId: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT *
        FROM "purchase_request_approvals"
        WHERE "companyId" = $1 AND "requestId" = $2
        ORDER BY "createdAt" DESC
        LIMIT 1
      `,
      companyId,
      requestId,
    );
    return rows[0] ?? null;
  }

  private calcRequestEstimatedTotal(items: Array<{ quantity: any; estimatedUnitPrice?: any }>) {
    return items.reduce((sum, item) => sum + this.sanitizeAmount(item.quantity) * this.sanitizeAmount(item.estimatedUnitPrice), 0);
  }

  private async getPurchaseBudgetUsage(
    companyId: string,
    budgetId: string,
    options?: { excludeRequestId?: string; excludeOrderId?: string },
  ) {
    const { excludeRequestId, excludeOrderId } = options ?? {};
    const requestValues: any[] = [companyId, budgetId];
    let requestExclusionSql = '';
    if (excludeRequestId) {
      requestValues.push(excludeRequestId);
      requestExclusionSql = ` AND pr."id" <> $${requestValues.length}`;
    }

    const orderValues: any[] = [companyId, budgetId];
    let orderExclusionSql = '';
    if (excludeOrderId) {
      orderValues.push(excludeOrderId);
      orderExclusionSql = ` AND po."id" <> $${orderValues.length}`;
    }

    const [requestRows, orderRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ total: any }>>(
        `
          SELECT COALESCE(SUM(COALESCE(pri."quantity", 0) * COALESCE(pri."estimatedUnitPrice", 0)), 0) AS "total"
          FROM "purchase_requests" pr
          INNER JOIN "purchase_request_items" pri ON pri."requestId" = pr."id"
          WHERE pr."companyId" = $1
            AND pr."budgetId" = $2
            AND pr."deletedAt" IS NULL
            AND pr."status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')
            ${requestExclusionSql}
        `,
        ...requestValues,
      ),
      this.prisma.$queryRawUnsafe<Array<{ total: any }>>(
        `
          SELECT COALESCE(SUM(COALESCE(po."total", 0)), 0) AS "total"
          FROM "purchase_orders" po
          WHERE po."companyId" = $1
            AND po."budgetId" = $2
            AND po."deletedAt" IS NULL
            AND po."status" <> 'CANCELLED'
            ${orderExclusionSql}
        `,
        ...orderValues,
      ),
    ]);

    return {
      committed: this.toNumber(requestRows[0]?.total),
      executed: this.toNumber(orderRows[0]?.total),
    };
  }

  private async getPurchaseBudgetOrFail(companyId: string, budgetId: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT *
        FROM "purchase_budgets"
        WHERE "companyId" = $1 AND "id" = $2 AND "deletedAt" IS NULL
        LIMIT 1
      `,
      companyId,
      budgetId,
    );
    const budget = rows[0];
    if (!budget) throw new NotFoundException('Presupuesto de compras no encontrado');
    return budget;
  }

  private async ensurePurchaseBudgetAvailable(
    companyId: string,
    budgetId: string,
    requiredAmount: number,
    documentDate?: string | Date,
    options?: { excludeRequestId?: string; excludeOrderId?: string },
  ) {
    const budget = await this.getPurchaseBudgetOrFail(companyId, budgetId);
    if (budget.status !== 'ACTIVE') {
      throw new ForbiddenException('Solo se pueden usar presupuestos en estado activo');
    }

    const effectiveDate = documentDate ? new Date(documentDate) : new Date();
    if (Number.isNaN(effectiveDate.getTime())) {
      throw new BadRequestException('La fecha del documento no es válida para control presupuestal');
    }
    if (effectiveDate < new Date(budget.startDate) || (budget.endDate && effectiveDate > new Date(budget.endDate))) {
      throw new ForbiddenException('La fecha del documento está fuera de la vigencia del presupuesto seleccionado');
    }

    const usage = await this.getPurchaseBudgetUsage(companyId, budgetId, options);
    const amount = this.toNumber(budget.amount);
    const available = amount - usage.committed - usage.executed;
    if (requiredAmount - available > 0.009) {
      throw new ForbiddenException(`El presupuesto no tiene disponibilidad suficiente. Disponible actual: ${this.formatCurrency(available)}`);
    }

    return {
      ...budget,
      amount,
      committedAmount: usage.committed,
      executedAmount: usage.executed,
      availableAmount: available,
    };
  }

  private mapPurchaseBudget(row: any, usage?: { committed: number; executed: number }) {
    const amount = this.toNumber(row?.amount);
    const committed = usage?.committed ?? this.toNumber(row?.committedAmount);
    const executed = usage?.executed ?? this.toNumber(row?.executedAmount);
    return {
      ...row,
      amount,
      committedAmount: committed,
      executedAmount: executed,
      availableAmount: Math.max(0, amount - committed - executed),
    };
  }

  private async findRequestById(companyId: string, id: string) {
    const requests = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          pr.*,
          pb."id" AS "budget_id",
          pb."number" AS "budget_number",
          pb."title" AS "budget_title",
          c."id" AS "customer_id",
          c."name" AS "customer_name",
          c."documentNumber" AS "customer_document_number"
        FROM "purchase_requests" pr
        LEFT JOIN "purchase_budgets" pb ON pb."id" = pr."budgetId"
        LEFT JOIN "customers" c ON c."id" = pr."customerId"
        WHERE pr."companyId" = $1 AND pr."id" = $2 AND pr."deletedAt" IS NULL
        LIMIT 1
      `,
      companyId,
      id,
    );
    const request = requests[0];
    if (!request) throw new NotFoundException('Solicitud de compra no encontrada');

    const [items, approval, linkedOrders] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `
          SELECT *
          FROM "purchase_request_items"
          WHERE "requestId" = $1
          ORDER BY "position" ASC
        `,
        id,
      ),
      this.getLatestRequestApproval(companyId, id),
      this.prisma.$queryRawUnsafe<any[]>(
        `
          SELECT "id", "number", "status", "issueDate", "total"
          FROM "purchase_orders"
          WHERE "sourceRequestId" = $1 AND "deletedAt" IS NULL
          ORDER BY "createdAt" DESC
        `,
        id,
      ),
    ]);

    return {
      id: request.id,
      number: request.number,
      status: request.status,
      requestDate: request.requestDate,
      neededByDate: request.neededByDate,
      notes: request.notes,
      customerId: request.customerId,
      budgetId: request.budgetId,
      requestingArea: request.requestingArea,
      costCenter: request.costCenter,
      projectCode: request.projectCode,
      budget: request.budget_id
        ? {
            id: request.budget_id,
            number: request.budget_number,
            title: request.budget_title,
          }
        : null,
      customer: request.customer_id
        ? {
            id: request.customer_id,
            name: request.customer_name,
            documentNumber: request.customer_document_number,
          }
        : null,
      items: items.map((item) => ({
        ...item,
        quantity: this.toNumber(item.quantity),
        estimatedUnitPrice: item.estimatedUnitPrice == null ? null : this.toNumber(item.estimatedUnitPrice),
      })),
      approval,
      linkedOrders: linkedOrders.map((order) => ({
        ...order,
        orderNumber: order.number,
        total: this.toNumber(order.total),
      })),
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  private async syncOrderStatusFromReceipts(companyId: string, orderId: string) {
    const orderItems = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT "id", "quantity"
        FROM "purchase_order_items"
        WHERE "orderId" = $1
      `,
      orderId,
    );

    if (!orderItems.length) return;

    const receiptItems = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT ri."orderItemId", SUM(ri."receivedQuantity") AS "receivedQuantity"
        FROM "purchase_order_receipt_items" ri
        INNER JOIN "purchase_order_receipts" r ON r."id" = ri."receiptId"
        WHERE r."companyId" = $1 AND r."orderId" = $2 AND r."deletedAt" IS NULL AND r."status" = 'POSTED'
        GROUP BY ri."orderItemId"
      `,
      companyId,
      orderId,
    );

    const receivedByItem = new Map(receiptItems.map((item) => [item.orderItemId, this.toNumber(item.receivedQuantity)]));
    let totalOrdered = 0;
    let totalReceived = 0;

    for (const item of orderItems) {
      const ordered = this.toNumber(item.quantity);
      const received = receivedByItem.get(item.id) ?? 0;
      totalOrdered += ordered;
      totalReceived += Math.min(received, ordered);
    }

    const nextStatus =
      totalReceived <= 0.0001
        ? PurchaseOrderStatus.SENT
        : totalReceived + 0.0001 >= totalOrdered
          ? PurchaseOrderStatus.RECEIVED
          : PurchaseOrderStatus.PARTIAL;

    await this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: nextStatus },
    });
  }

  private calcPurchaseInvoiceTotals(items: CreatePurchaseInvoiceItemDto[]) {
    let subtotal = 0;
    let taxAmount = 0;

    const computed = items.map((item) => {
      const taxRate = this.sanitizePercent(item.taxRate ?? 19);
      const discount = this.sanitizePercent(item.discount ?? 0);
      const quantity = this.sanitizeAmount(item.quantity);
      const unitPrice = this.sanitizeAmount(item.unitPrice);
      const base = quantity * unitPrice * (1 - discount / 100);
      const tax = base * (taxRate / 100);
      subtotal += base;
      taxAmount += tax;
      return {
        orderItemId: item.orderItemId ?? null,
        description: item.description,
        quantity,
        unitPrice,
        taxRate,
        taxAmount: tax,
        discount,
        total: base + tax,
        position: item.position,
      };
    });

    return { subtotal, taxAmount, total: subtotal + taxAmount, computed };
  }

  private calcSupplierQuoteTotals(items: CreatePurchaseSupplierQuoteItemDto[]) {
    let subtotal = 0;
    let taxAmount = 0;
    const computed = items.map((item) => {
      const quantity = this.sanitizeAmount(item.quantity);
      const unitPrice = this.sanitizeAmount(item.unitPrice);
      const taxRate = this.sanitizePercent(item.taxRate ?? 19);
      const base = quantity * unitPrice;
      const tax = base * (taxRate / 100);
      subtotal += base;
      taxAmount += tax;
      return {
        requestItemId: item.requestItemId ?? null,
        description: item.description,
        quantity,
        unitPrice,
        taxRate,
        taxAmount: tax,
        total: base + tax,
        position: item.position,
      };
    });

    return { subtotal, taxAmount, total: subtotal + taxAmount, computed };
  }

  private sanitizePercent(value: any): number {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.min(100, Math.max(0, numeric));
  }

  private sanitizeAmount(value: any): number {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, numeric);
  }

  private async resolvePurchasingAccountingAccounts(companyId: string, paymentMethod?: PaymentMethod) {
    const accounts = await this.prisma.accountingAccount.findMany({
      where: { companyId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });

    const findByPrefixes = (...prefixes: string[]) =>
      accounts.find((account) => prefixes.some((prefix) => account.code === prefix || account.code.startsWith(prefix)));

    const prefersCash = paymentMethod === PaymentMethod.CASH;

    return {
      payable: findByPrefixes('2205', '220505', '22'),
      inventoryOrExpense: findByPrefixes('1435', '143505', '14', '51', '61'),
      vat: findByPrefixes('2408', '240805', '24'),
      advance: findByPrefixes('1330', '133005', '17', '13'),
      cashLike: prefersCash ? findByPrefixes('1105', '110505', '11') : findByPrefixes('1110', '111005', '11'),
    };
  }

  private async createDefaultPayableSchedule(companyId: string, payableId: string, amount: number, dueDate?: Date | null) {
    const number = await this.generateSequenceNumber('account_payable_schedules', companyId, 'CPXP');
    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "account_payable_schedules" (
          "id", "companyId", "accountPayableId", "number", "dueDate", "amount", "paidAmount", "balance", "status", "notes", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, 0, $6, 'PENDING', $7, NOW(), NOW())
      `,
      randomUUID(),
      companyId,
      payableId,
      number,
      dueDate ?? new Date(),
      amount,
      'Programación automática inicial',
    );
  }

  private async replacePayableSchedules(companyId: string, payableId: string, schedules: Array<{ dueDate: string; amount: number; notes?: string }>) {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "account_payable_schedules" WHERE "companyId" = $1 AND "accountPayableId" = $2`,
      companyId,
      payableId,
    );

    for (const item of schedules) {
      const number = await this.generateSequenceNumber('account_payable_schedules', companyId, 'CPXP');
      const amount = this.sanitizeAmount(item.amount);
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "account_payable_schedules" (
            "id", "companyId", "accountPayableId", "number", "dueDate", "amount", "paidAmount", "balance", "status", "notes", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, 0, $6, 'PENDING', $7, NOW(), NOW())
        `,
        randomUUID(),
        companyId,
        payableId,
        number,
        new Date(item.dueDate),
        amount,
        item.notes ?? null,
      );
    }
  }

  private async syncPayableSchedulesAfterPayment(companyId: string, payableId: string, amount: number) {
    let remaining = amount;
    const schedules = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT *
        FROM "account_payable_schedules"
        WHERE "companyId" = $1 AND "accountPayableId" = $2
        ORDER BY "dueDate" ASC, "createdAt" ASC
      `,
      companyId,
      payableId,
    );

    for (const schedule of schedules) {
      if (remaining <= 0.009) break;
      const currentBalance = this.toNumber(schedule.balance);
      if (currentBalance <= 0.009 || schedule.status === 'CANCELLED') continue;
      const applied = Math.min(currentBalance, remaining);
      const nextPaid = this.toNumber(schedule.paidAmount) + applied;
      const nextBalance = Math.max(0, currentBalance - applied);
      const nextStatus = nextBalance <= 0.009 ? 'PAID' : 'PARTIAL';
      await this.prisma.$executeRawUnsafe(
        `
          UPDATE "account_payable_schedules"
          SET "paidAmount" = $3, "balance" = $4, "status" = $5, "updatedAt" = NOW()
          WHERE "companyId" = $1 AND "id" = $2
        `,
        companyId,
        schedule.id,
        nextPaid,
        nextBalance,
        nextStatus,
      );
      remaining -= applied;
    }
  }

  private async applyReceiptInventory(companyId: string, receiptId: string, notes?: string) {
    const items = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT ri."receivedQuantity", poi."productId", poi."unitPrice"
        FROM "purchase_order_receipt_items" ri
        LEFT JOIN "purchase_order_items" poi ON poi."id" = ri."orderItemId"
        WHERE ri."receiptId" = $1
      `,
      receiptId,
    );

    for (const item of items) {
      if (!item.productId) continue;
      const quantity = this.toNumber(item.receivedQuantity);
      if (quantity <= 0.0001) continue;
      const unitCost = this.toNumber(item.unitPrice);
      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, companyId, deletedAt: null },
        select: { id: true, stock: true, cost: true },
      });
      if (!product) continue;
      const currentStock = this.toNumber(product.stock);
      const currentCost = this.toNumber(product.cost);
      const nextStock = currentStock + quantity;
      const nextCost = nextStock <= 0.0001 ? currentCost : ((currentStock * currentCost) + (quantity * unitCost)) / nextStock;
      await this.prisma.product.update({
        where: { id: product.id },
        data: {
          stock: { increment: Math.round(quantity) },
          cost: nextCost,
        },
      });
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "purchase_inventory_movements" (
            "id", "companyId", "productId", "receiptId", "type", "quantity", "unitCost", "notes", "createdAt"
          ) VALUES ($1, $2, $3, $4, 'RECEIPT_IN', $5, $6, $7, NOW())
        `,
        randomUUID(),
        companyId,
        product.id,
        receiptId,
        quantity,
        unitCost,
        notes ?? 'Ingreso por recepción',
      );
    }
  }

  private async reverseReceiptInventory(companyId: string, receiptId: string, adjustmentId: string, notes?: string) {
    const items = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT ri."receivedQuantity", poi."productId", poi."unitPrice"
        FROM "purchase_order_receipt_items" ri
        LEFT JOIN "purchase_order_items" poi ON poi."id" = ri."orderItemId"
        WHERE ri."receiptId" = $1
      `,
      receiptId,
    );

    for (const item of items) {
      if (!item.productId) continue;
      const quantity = this.toNumber(item.receivedQuantity);
      if (quantity <= 0.0001) continue;
      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, companyId, deletedAt: null },
        select: { id: true, stock: true },
      });
      if (!product) continue;
      const currentStock = this.toNumber(product.stock);
      if (currentStock + 0.0001 < quantity) {
        throw new BadRequestException(`No hay stock suficiente para revertir la recepción del producto ${product.id}`);
      }
      await this.prisma.product.update({
        where: { id: product.id },
        data: { stock: { decrement: Math.round(quantity) } },
      });
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "purchase_inventory_movements" (
            "id", "companyId", "productId", "receiptId", "adjustmentId", "type", "quantity", "unitCost", "notes", "createdAt"
          ) VALUES ($1, $2, $3, $4, $5, 'RECEIPT_REVERSAL_OUT', $6, $7, $8, NOW())
        `,
        randomUUID(),
        companyId,
        product.id,
        receiptId,
        adjustmentId,
        quantity,
        this.toNumber(item.unitPrice),
        notes ?? 'Salida por reversión de recepción',
      );
    }
  }

  private async createAccountingEntryForPurchaseInvoice(companyId: string, invoice: any, payable: any) {
    const accounts = await this.resolvePurchasingAccountingAccounts(companyId);
    if (!accounts.payable || !accounts.inventoryOrExpense) {
      throw new BadRequestException('No existen cuentas contables suficientes para compras. Configura inventario/gasto y proveedores en contabilidad');
    }

    const lines = [
      {
        accountId: accounts.inventoryOrExpense.id,
        description: `Factura proveedor ${invoice.number}`,
        debit: this.toNumber(invoice.subtotal),
        credit: 0,
        position: 1,
      },
    ];

    let nextPosition = 2;
    if (this.toNumber(invoice.taxAmount) > 0) {
      if (!accounts.vat) {
        throw new BadRequestException('No existe cuenta de IVA descontable/configurada para compras');
      }
      lines.push({
        accountId: accounts.vat.id,
        description: `IVA factura proveedor ${invoice.number}`,
        debit: this.toNumber(invoice.taxAmount),
        credit: 0,
        position: nextPosition++,
      });
    }

    lines.push({
      accountId: accounts.payable.id,
      description: `CxP ${payable.number}`,
      debit: 0,
      credit: this.toNumber(invoice.total),
      position: nextPosition,
    });

    await this.accountingService.createAutoPostedEntry(companyId, {
      date: new Date(invoice.issueDate).toISOString().slice(0, 10),
      description: `Causación factura proveedor ${invoice.number}`,
      reference: payable.number,
      sourceType: 'PURCHASE' as any,
      sourceId: `purchase-invoice:${invoice.id}`,
      lines,
    });
  }

  private async createAccountingEntryForPayablePayment(companyId: string, payable: any, payment: any) {
    const accounts = await this.resolvePurchasingAccountingAccounts(companyId, payment.paymentMethod as PaymentMethod);
    if (!accounts.payable || !accounts.cashLike) {
      throw new BadRequestException('No existen cuentas contables suficientes para registrar el pago de la cuenta por pagar');
    }

    await this.accountingService.createAutoPostedEntry(companyId, {
      date: new Date(payment.paymentDate).toISOString().slice(0, 10),
      description: `Pago cuenta por pagar ${payable.number}`,
      reference: payment.number,
      sourceType: 'PURCHASE' as any,
      sourceId: `payable-payment:${payment.id}`,
      lines: [
        {
          accountId: accounts.payable.id,
          description: `Pago ${payable.number}`,
          debit: this.toNumber(payment.amount),
          credit: 0,
          position: 1,
        },
        {
          accountId: accounts.cashLike.id,
          description: `Salida de banco/caja ${payment.number}`,
          debit: 0,
          credit: this.toNumber(payment.amount),
          position: 2,
        },
      ],
    });
  }

  private async createAccountingEntryForPayablePaymentReversal(companyId: string, payable: any, payment: any) {
    const accounts = await this.resolvePurchasingAccountingAccounts(companyId, payment.paymentMethod as PaymentMethod);
    if (!accounts.payable || !accounts.cashLike) {
      throw new BadRequestException('No existen cuentas contables suficientes para revertir el pago de la cuenta por pagar');
    }

    await this.accountingService.createAutoPostedEntry(companyId, {
      date: new Date().toISOString().slice(0, 10),
      description: `Reversión pago cuenta por pagar ${payable.number}`,
      reference: payment.number,
      sourceType: 'PURCHASE' as any,
      sourceId: `payable-payment-reversal:${payment.id}`,
      lines: [
        {
          accountId: accounts.cashLike.id,
          description: `Reverso salida ${payment.number}`,
          debit: this.toNumber(payment.amount),
          credit: 0,
          position: 1,
        },
        {
          accountId: accounts.payable.id,
          description: `Reabre ${payable.number}`,
          debit: 0,
          credit: this.toNumber(payment.amount),
          position: 2,
        },
      ],
    });
  }

  private async createAccountingEntryForPurchaseAdvance(companyId: string, advance: any) {
    const accounts = await this.resolvePurchasingAccountingAccounts(companyId, advance.paymentMethod as PaymentMethod);
    if (!accounts.advance || !accounts.cashLike) {
      throw new BadRequestException('No existen cuentas contables suficientes para registrar el anticipo al proveedor');
    }

    await this.accountingService.createAutoPostedEntry(companyId, {
      date: new Date(advance.issueDate).toISOString().slice(0, 10),
      description: `Anticipo proveedor ${advance.number}`,
      reference: advance.reference ?? advance.number,
      sourceType: 'PURCHASE' as any,
      sourceId: `purchase-advance:${advance.id}`,
      lines: [
        {
          accountId: accounts.advance.id,
          description: `Anticipo a proveedor ${advance.number}`,
          debit: this.toNumber(advance.amount),
          credit: 0,
          position: 1,
        },
        {
          accountId: accounts.cashLike.id,
          description: `Salida de caja/banco ${advance.number}`,
          debit: 0,
          credit: this.toNumber(advance.amount),
          position: 2,
        },
      ],
    });
  }

  private async createAccountingEntryForAppliedAdvance(companyId: string, payable: any, advance: any, amount: number, applicationId: string, applicationDate: string) {
    const accounts = await this.resolvePurchasingAccountingAccounts(companyId, advance.paymentMethod as PaymentMethod);
    if (!accounts.advance || !accounts.payable) {
      throw new BadRequestException('No existen cuentas contables suficientes para aplicar el anticipo a la cuenta por pagar');
    }

    await this.accountingService.createAutoPostedEntry(companyId, {
      date: new Date(applicationDate).toISOString().slice(0, 10),
      description: `Aplicación anticipo ${advance.number} a ${payable.number}`,
      reference: payable.number,
      sourceType: 'PURCHASE' as any,
      sourceId: `purchase-advance-application:${applicationId}`,
      lines: [
        {
          accountId: accounts.payable.id,
          description: `Cruce anticipo contra ${payable.number}`,
          debit: amount,
          credit: 0,
          position: 1,
        },
        {
          accountId: accounts.advance.id,
          description: `Aplicación anticipo ${advance.number}`,
          debit: 0,
          credit: amount,
          position: 2,
        },
      ],
    });
  }

  private async createAccountingEntryForAdjustment(companyId: string, adjustment: any, payable: any, mode: 'reduce' | 'increase') {
    const accounts = await this.resolvePurchasingAccountingAccounts(companyId);
    if (!accounts.payable || !accounts.inventoryOrExpense) {
      throw new BadRequestException('No existen cuentas contables suficientes para registrar el ajuste de compra');
    }

    const debitPayable = mode === 'reduce' ? this.toNumber(adjustment.amount) : 0;
    const creditPayable = mode === 'increase' ? this.toNumber(adjustment.amount) : 0;
    const debitCounter = mode === 'increase' ? this.toNumber(adjustment.amount) : 0;
    const creditCounter = mode === 'reduce' ? this.toNumber(adjustment.amount) : 0;

    await this.accountingService.createAutoPostedEntry(companyId, {
      date: new Date().toISOString().slice(0, 10),
      description: `Ajuste compra ${adjustment.type} ${payable.number}`,
      reference: adjustment.id,
      sourceType: 'PURCHASE' as any,
      sourceId: `purchase-adjustment:${adjustment.id}`,
      lines: [
        {
          accountId: accounts.payable.id,
          description: `Ajuste ${payable.number}`,
          debit: debitPayable,
          credit: creditPayable,
          position: 1,
        },
        {
          accountId: accounts.inventoryOrExpense.id,
          description: adjustment.reason,
          debit: debitCounter,
          credit: creditCounter,
          position: 2,
        },
      ],
    });
  }

  private appendNote(base: any, extra: string) {
    const text = String(base ?? '').trim();
    return text ? `${text} | ${extra}` : extra;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: calcular totales de una orden a partir de sus ítems
  //   itemBase     = quantity * unitPrice * (1 - discount/100)
  //   itemTax      = itemBase * taxRate / 100
  //   itemTotal    = itemBase + itemTax
  //   subtotal     = suma de itemBase
  //   taxAmount    = suma de itemTax
  //   total        = subtotal + taxAmount   (sin descuento global adicional)
  // ─────────────────────────────────────────────────────────────────────────────
  private calcOrderTotals(items: CreatePurchaseOrderItemDto[]) {
    let subtotal = 0;
    let taxAmount = 0;

    const computed = items.map((item) => {
      const taxRate = item.taxRate ?? 19;
      const discount = item.discount ?? 0;
      const base = item.quantity * item.unitPrice * (1 - discount / 100);
      const tax = base * taxRate / 100;
      subtotal += base;
      taxAmount += tax;
      return {
        productId: item.productId ?? null,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate,
        taxAmount: tax,
        discount,
        total: base + tax,
        position: item.position,
      };
    });

    const total = subtotal + taxAmount;
    return { subtotal, taxAmount, total, computed };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: genera el siguiente número de OC para la empresa en formato OC-NNNN
  // Busca el mayor número correlativo ya emitido (incluyendo soft-deleted)
  // ─────────────────────────────────────────────────────────────────────────────
  private async generateOrderNumber(companyId: string): Promise<string> {
    const last = await this.prisma.purchaseOrder.findFirst({
      where: { companyId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    let nextSeq = 1;
    if (last?.number) {
      // Formato esperado: OC-NNNN; extrae la parte numérica
      const parts = last.number.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
    }

    return `OC-${String(nextSeq).padStart(4, '0')}`;
  }

  private normalizeText(value: any): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private escapeHtml(value: any): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatCurrency(value: any): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Number(value ?? 0));
  }

  private formatDate(value: any): string {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  private orderStatusLabel(status: string): string {
    return ({
      DRAFT: 'BORRADOR',
      SENT: 'ENVIADA',
      RECEIVED: 'RECIBIDA',
      PARTIAL: 'PARCIAL',
      CANCELLED: 'CANCELADA',
    } as Record<string, string>)[status] ?? status ?? '-';
  }

  private async getOrderRenderContext(companyId: string, id: string) {
    const order = await this.findOneOrder(companyId, id);
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, nit: true, razonSocial: true, email: true, phone: true, address: true, city: true },
    });
    return { order, company };
  }

  async generateOrderPreview(companyId: string, id: string): Promise<Buffer> {
    const { order, company } = await this.getOrderRenderContext(companyId, id);
    const rows = (order.lines ?? []).map((line: any, index: number) => {
      const base = this.lineBaseForRender(line);
      const tax = this.lineTaxForRender(line);
      const total = base + tax;
      return `
        <tr>
          <td>${index + 1}</td>
          <td>
            <strong>${this.escapeHtml(line.description)}</strong>
            <div class="line-meta">Cant. ${this.escapeHtml(line.quantity)} · Dto. ${this.escapeHtml(line.discountPercent ?? 0)}%</div>
          </td>
          <td>${this.escapeHtml(line.quantity)}</td>
          <td>${this.formatCurrency(line.unitPrice)}</td>
          <td>${this.escapeHtml(line.taxPercent ?? 0)}%</td>
          <td>${this.formatCurrency(base)}</td>
          <td>${this.formatCurrency(total)}</td>
        </tr>
      `;
    }).join('');

    const notesBlock = order.notes ? `
      <div class="notes-card">
        <h4>Observaciones</h4>
        <p>${this.escapeHtml(order.notes)}</p>
      </div>
    ` : '';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Orden de compra ${this.escapeHtml(order.orderNumber)}</title>
  <style>
    * { box-sizing:border-box; }
    body { margin:0; font-family:Arial, sans-serif; background:#eef2ff; color:#172554; }
    .page { max-width:980px; margin:24px auto; background:#fff; border-radius:18px; overflow:hidden; box-shadow:0 22px 44px rgba(15,23,42,.12); }
    .hero { padding:28px 34px; background:linear-gradient(135deg, #1e3a8a 0%, #4338ca 55%, #0f766e 100%); color:#fff; display:flex; justify-content:space-between; gap:24px; }
    .hero h1 { margin:0 0 8px; font-size:30px; }
    .hero p { margin:0; color:rgba(255,255,255,.8); line-height:1.5; }
    .hero-box { min-width:240px; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.18); border-radius:18px; padding:18px; }
    .hero-box small { display:block; text-transform:uppercase; letter-spacing:.12em; font-size:11px; color:#c7d2fe; margin-bottom:8px; }
    .hero-box strong { display:block; font-size:28px; line-height:1.1; }
    .hero-box span { display:inline-block; margin-top:8px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.18); font-size:12px; font-weight:700; }
    .body { padding:28px 34px 32px; }
    .summary-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:16px; margin-bottom:22px; }
    .card { border:1px solid #dbe4f0; border-radius:16px; overflow:hidden; }
    .card-head { padding:12px 16px; background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#475569; }
    .card-body { padding:16px; }
    .info-row { display:flex; justify-content:space-between; gap:12px; padding:6px 0; font-size:14px; }
    .info-row span { color:#64748b; }
    .info-row strong { color:#0f172a; text-align:right; }
    table { width:100%; border-collapse:collapse; }
    thead th { background:#1e3a8a; color:#fff; font-size:11px; text-transform:uppercase; letter-spacing:.08em; padding:12px 10px; text-align:left; }
    tbody td { padding:12px 10px; border-bottom:1px solid #e2e8f0; font-size:13px; color:#334155; vertical-align:top; }
    tbody tr:nth-child(even) td { background:#f8fafc; }
    .line-meta { margin-top:4px; color:#64748b; font-size:12px; }
    .totals { margin-top:18px; margin-left:auto; max-width:320px; border:1px solid #dbe4f0; border-radius:16px; overflow:hidden; }
    .totals .head { padding:12px 16px; background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#475569; }
    .total-row { display:flex; justify-content:space-between; gap:12px; padding:12px 16px; font-size:14px; }
    .total-row strong { color:#0f172a; }
    .total-row.final { border-top:1px solid #e2e8f0; font-size:16px; font-weight:800; color:#1e3a8a; }
    .notes-card { margin-top:18px; padding:16px 18px; border-radius:16px; border:1px solid #ddd6fe; background:#faf5ff; }
    .notes-card h4 { margin:0 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:#6d28d9; }
    .notes-card p { margin:0; color:#374151; line-height:1.6; white-space:pre-wrap; }
    .footer { margin-top:24px; padding-top:16px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; gap:16px; font-size:12px; color:#64748b; }
    @media print { body { background:#fff; } .page { margin:0; box-shadow:none; border-radius:0; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="hero">
      <div>
        <h1>Orden de Compra</h1>
        <p>${this.escapeHtml(company?.name ?? 'BeccaFact')}</p>
        <p>${this.escapeHtml(company?.razonSocial ?? '')}</p>
        <p>NIT ${this.escapeHtml(company?.nit ?? '-')} · ${this.escapeHtml(company?.email ?? '-')}</p>
      </div>
      <div class="hero-box">
        <small>No. orden</small>
        <strong>${this.escapeHtml(order.orderNumber)}</strong>
        <span>${this.escapeHtml(this.orderStatusLabel(order.status))}</span>
      </div>
    </div>
    <div class="body">
      <div class="summary-grid">
        <div class="card">
          <div class="card-head">Cliente</div>
          <div class="card-body">
            <div class="info-row"><span>Nombre</span><strong>${this.escapeHtml(order.customer?.name ?? '-')}</strong></div>
            <div class="info-row"><span>Documento</span><strong>${this.escapeHtml(order.customer?.documentNumber ?? '-')}</strong></div>
            <div class="info-row"><span>Email</span><strong>${this.escapeHtml(order.customer?.email ?? '-')}</strong></div>
            <div class="info-row"><span>Teléfono</span><strong>${this.escapeHtml(order.customer?.phone ?? '-')}</strong></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head">Resumen</div>
          <div class="card-body">
            <div class="info-row"><span>Fecha emisión</span><strong>${this.escapeHtml(this.formatDate(order.issueDate))}</strong></div>
            <div class="info-row"><span>Fecha vencimiento</span><strong>${this.escapeHtml(this.formatDate(order.dueDate))}</strong></div>
            <div class="info-row"><span>Moneda</span><strong>COP</strong></div>
            <div class="info-row"><span>Líneas</span><strong>${this.escapeHtml((order.lines ?? []).length)}</strong></div>
          </div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Descripción</th>
            <th>Cant.</th>
            <th>Precio</th>
            <th>IVA</th>
            <th>Subtotal</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="totals">
        <div class="head">Totales</div>
        <div class="total-row"><span>Subtotal</span><strong>${this.formatCurrency(order.subtotal)}</strong></div>
        <div class="total-row"><span>IVA</span><strong>${this.formatCurrency(order.taxAmount)}</strong></div>
        <div class="total-row final"><span>Total</span><strong>${this.formatCurrency(order.total)}</strong></div>
      </div>

      ${notesBlock}

      <div class="footer">
        <span>Generado el ${this.escapeHtml(new Date().toLocaleString('es-CO'))}</span>
        <span>Generado por BeccaFact</span>
      </div>
    </div>
  </div>
</body>
</html>`;

    return Buffer.from(html, 'utf8');
  }

  private lineBaseForRender(line: any): number {
    const quantity = Number(line?.quantity ?? 0);
    const unitPrice = Number(line?.unitPrice ?? 0);
    const discount = Number(line?.discountPercent ?? 0);
    return quantity * unitPrice * (1 - discount / 100);
  }

  private lineTaxForRender(line: any): number {
    const base = this.lineBaseForRender(line);
    const taxPercent = Number(line?.taxPercent ?? 0);
    return base * (taxPercent / 100);
  }

  async generateOrderPdfDocument(companyId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const { order, company } = await this.getOrderRenderContext(companyId, id);
    const buffer = await this.buildPurchaseOrderPdfBuffer(order, company);
    return { buffer, filename: `${order.orderNumber}.pdf` };
  }

  async sendOrderEmail(companyId: string, id: string, to?: string) {
    const { order } = await this.getOrderRenderContext(companyId, id);
    const email = (to ?? order.customer?.email ?? '').trim();
    if (!email) {
      throw new BadRequestException('El cliente no tiene correo electrónico registrado');
    }

    const { buffer } = await this.generateOrderPdfDocument(companyId, id);
    await this.mailerService.sendPurchaseOrderEmail(
      email,
      order.orderNumber,
      order.customer?.name ?? 'Cliente',
      buffer,
    );

    return {
      message: `Orden de compra ${order.orderNumber} enviada correctamente a ${email}`,
      to: email,
    };
  }

  private async buildPurchaseOrderPdfBuffer(order: any, company: any): Promise<Buffer> {
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const marginX = 34;
    const topMargin = 36;
    const bottomMargin = 36;
    const contentWidth = pageWidth - marginX * 2;
    const colors = {
      navy: [30, 58, 138] as [number, number, number],
      teal: [15, 118, 110] as [number, number, number],
      slate: [71, 85, 105] as [number, number, number],
      text: [15, 23, 42] as [number, number, number],
      muted: [100, 116, 139] as [number, number, number],
      line: [203, 213, 225] as [number, number, number],
      soft: [248, 250, 252] as [number, number, number],
      white: [255, 255, 255] as [number, number, number],
      greenBg: [220, 252, 231] as [number, number, number],
      greenText: [22, 101, 52] as [number, number, number],
      amberBg: [254, 243, 199] as [number, number, number],
      amberText: [146, 64, 14] as [number, number, number],
      redBg: [254, 226, 226] as [number, number, number],
      redText: [153, 27, 27] as [number, number, number],
    };
    const estimateTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.56;
    const pdfSafe = (value: any) =>
      this.normalizeText(value)
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
    const wrapText = (text: any, maxWidth: number, fontSize: number) => {
      const normalized = this.normalizeText(text);
      if (!normalized) return ['-'];
      const words = normalized.split(' ');
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
          current = candidate;
        } else {
          if (current) lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines.length ? lines : ['-'];
    };
    const statusStyle = (status: string) => {
      if (status === 'RECEIVED') return { bg: colors.greenBg, text: colors.greenText };
      if (status === 'DRAFT' || status === 'SENT' || status === 'PARTIAL') return { bg: colors.amberBg, text: colors.amberText };
      if (status === 'CANCELLED') return { bg: colors.redBg, text: colors.redText };
      return { bg: colors.soft, text: colors.text };
    };

    const pages: string[] = [];
    let commands: string[] = [];
    let y = topMargin;
    const toPdfY = (topY: number) => pageHeight - topY;
    const pushPage = () => {
      if (commands.length) pages.push(commands.join('\n'));
      commands = [];
      y = topMargin;
    };
    const ensureSpace = (height: number) => {
      if (y + height <= pageHeight - bottomMargin) return;
      pushPage();
      drawHeader();
    };
    const setFill = (rgb: [number, number, number]) => commands.push(`${(rgb[0] / 255).toFixed(3)} ${(rgb[1] / 255).toFixed(3)} ${(rgb[2] / 255).toFixed(3)} rg`);
    const setStroke = (rgb: [number, number, number]) => commands.push(`${(rgb[0] / 255).toFixed(3)} ${(rgb[1] / 255).toFixed(3)} ${(rgb[2] / 255).toFixed(3)} RG`);
    const setLineWidth = (width: number) => commands.push(`${width.toFixed(2)} w`);
    const addRect = (x: number, topY: number, width: number, height: number, mode: 'S' | 'f' | 'B' = 'S') => {
      commands.push(`${x.toFixed(2)} ${toPdfY(topY + height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${mode}`);
    };
    const addText = (text: any, x: number, topY: number, options?: { size?: number; font?: 'F1' | 'F2'; color?: [number, number, number] }) => {
      const size = options?.size ?? 10;
      const font = options?.font ?? 'F1';
      if (options?.color) setFill(options.color);
      commands.push(`BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${toPdfY(topY).toFixed(2)} Tm (${pdfSafe(text) || '-'}) Tj ET`);
    };
    const addRightText = (text: any, rightX: number, topY: number, options?: { size?: number; font?: 'F1' | 'F2'; color?: [number, number, number] }) => {
      const size = options?.size ?? 10;
      const normalized = this.normalizeText(text) || '-';
      const width = estimateTextWidth(normalized, size);
      addText(normalized, Math.max(marginX, rightX - width), topY, options);
    };

    const drawHeader = () => {
      setFill(colors.navy);
      addRect(0, 0, pageWidth, 96, 'f');
      addText(company?.name ?? 'BeccaFact', marginX, 44, { size: 22, font: 'F2', color: colors.white });
      addText(company?.razonSocial ?? '', marginX, 62, { size: 10, color: colors.white });
      addText(`NIT ${company?.nit ?? '-'}`, marginX, 76, { size: 10, color: colors.white });

      const cardX = pageWidth - marginX - 186;
      setFill(colors.white);
      addRect(cardX, 24, 186, 58, 'f');
      setStroke(colors.line);
      setLineWidth(0.8);
      addRect(cardX, 24, 186, 58, 'S');
      addText('ORDEN DE COMPRA', cardX + 12, 42, { size: 11, font: 'F2', color: colors.navy });
      addText(order.orderNumber ?? '-', cardX + 12, 62, { size: 18, font: 'F2', color: colors.text });

      const badge = statusStyle(order.status);
      const badgeText = this.orderStatusLabel(order.status);
      const badgeWidth = Math.max(72, estimateTextWidth(badgeText, 9) + 18);
      setFill(badge.bg);
      addRect(cardX + 186 - badgeWidth - 12, 30, badgeWidth, 16, 'f');
      addText(badgeText, cardX + 186 - badgeWidth + 14, 41, { size: 9, font: 'F2', color: badge.text });

      y = 118;
    };

    const drawInfoCards = () => {
      const gap = 14;
      const cardWidth = (contentWidth - gap) / 2;
      const cardHeight = 116;
      ensureSpace(cardHeight + 16);
      setFill(colors.white);
      setStroke(colors.line);
      setLineWidth(0.8);
      addRect(marginX, y, cardWidth, cardHeight, 'B');
      addRect(marginX + cardWidth + gap, y, cardWidth, cardHeight, 'B');
      setFill(colors.soft);
      addRect(marginX, y, cardWidth, 24, 'f');
      addRect(marginX + cardWidth + gap, y, cardWidth, 24, 'f');
      addText('Cliente', marginX + 12, y + 16, { size: 10, font: 'F2', color: colors.navy });
      addText('Resumen', marginX + cardWidth + gap + 12, y + 16, { size: 10, font: 'F2', color: colors.navy });

      let leftY = y + 40;
      const leftRows = [
        ['Nombre', order.customer?.name ?? '-'],
        ['Documento', order.customer?.documentNumber ?? '-'],
        ['Email', order.customer?.email ?? '-'],
        ['Telefono', order.customer?.phone ?? '-'],
      ];
      for (const [label, value] of leftRows) {
        addText(label, marginX + 12, leftY, { size: 9, font: 'F2', color: colors.muted });
        addRightText(value, marginX + cardWidth - 12, leftY, { size: 9, color: colors.text });
        leftY += 16;
      }

      let rightY = y + 40;
      const rightRows = [
        ['Emision', this.formatDate(order.issueDate)],
        ['Vencimiento', this.formatDate(order.dueDate)],
        ['Subtotal', this.formatCurrency(order.subtotal)],
        ['Total', this.formatCurrency(order.total)],
      ];
      for (const [label, value] of rightRows) {
        addText(label, marginX + cardWidth + gap + 12, rightY, { size: 9, font: 'F2', color: colors.muted });
        addRightText(value, pageWidth - marginX - 12, rightY, { size: 9, color: colors.text });
        rightY += 16;
      }

      y += cardHeight + 18;
    };

    const drawTableHeader = () => {
      ensureSpace(28);
      setFill(colors.teal);
      addRect(marginX, y, contentWidth, 22, 'f');
      addText('#', marginX + 8, y + 14, { size: 9, font: 'F2', color: colors.white });
      addText('Descripcion', marginX + 28, y + 14, { size: 9, font: 'F2', color: colors.white });
      addRightText('Cant.', marginX + 318, y + 14, { size: 9, font: 'F2', color: colors.white });
      addRightText('Precio', marginX + 402, y + 14, { size: 9, font: 'F2', color: colors.white });
      addRightText('IVA', marginX + 452, y + 14, { size: 9, font: 'F2', color: colors.white });
      addRightText('Total', pageWidth - marginX - 10, y + 14, { size: 9, font: 'F2', color: colors.white });
      y += 24;
    };

    drawHeader();
    drawInfoCards();
    drawTableHeader();

    const lines = Array.isArray(order.lines) ? order.lines : [];
    lines.forEach((line: any, index: number) => {
      const descriptionLines = wrapText(line.description ?? '-', 220, 9);
      const meta = `Dto ${Number(line.discountPercent ?? 0)}% · Base ${this.formatCurrency(this.lineBaseForRender(line))}`;
      const rowHeight = Math.max(28, (descriptionLines.length + 1) * 11 + 10);
      const previousY = y;
      ensureSpace(rowHeight + 4);
      if (previousY !== y) {
        drawTableHeader();
      }
      setFill(index % 2 === 0 ? colors.white : colors.soft);
      addRect(marginX, y, contentWidth, rowHeight, 'f');
      setStroke(colors.line);
      setLineWidth(0.5);
      addRect(marginX, y, contentWidth, rowHeight, 'S');
      addText(String(index + 1), marginX + 8, y + 16, { size: 9, font: 'F2', color: colors.text });
      descriptionLines.forEach((descLine, idx) => addText(descLine, marginX + 28, y + 16 + idx * 11, { size: 9, color: colors.text }));
      addText(meta, marginX + 28, y + 16 + descriptionLines.length * 11, { size: 8, color: colors.muted });
      addRightText(line.quantity, marginX + 318, y + 16, { size: 9, color: colors.text });
      addRightText(this.formatCurrency(line.unitPrice), marginX + 402, y + 16, { size: 9, color: colors.text });
      addRightText(`${Number(line.taxPercent ?? 0)}%`, marginX + 452, y + 16, { size: 9, color: colors.text });
      addRightText(this.formatCurrency(this.lineBaseForRender(line) + this.lineTaxForRender(line)), pageWidth - marginX - 10, y + 16, { size: 9, font: 'F2', color: colors.text });
      y += rowHeight + 4;
    });

    const totalBoxWidth = 208;
    const totalBoxX = pageWidth - marginX - totalBoxWidth;
    const totalBoxHeight = 96;
    ensureSpace(totalBoxHeight + 20);
    setFill(colors.white);
    setStroke(colors.line);
    setLineWidth(0.8);
    addRect(totalBoxX, y + 8, totalBoxWidth, totalBoxHeight, 'B');
    setFill(colors.soft);
    addRect(totalBoxX, y + 8, totalBoxWidth, 24, 'f');
    addText('Totales', totalBoxX + 12, y + 24, { size: 10, font: 'F2', color: colors.navy });
    addText('Subtotal', totalBoxX + 12, y + 46, { size: 9, color: colors.muted });
    addRightText(this.formatCurrency(order.subtotal), totalBoxX + totalBoxWidth - 12, y + 46, { size: 9, font: 'F2', color: colors.text });
    addText('IVA', totalBoxX + 12, y + 64, { size: 9, color: colors.muted });
    addRightText(this.formatCurrency(order.taxAmount), totalBoxX + totalBoxWidth - 12, y + 64, { size: 9, font: 'F2', color: colors.text });
    addText('TOTAL', totalBoxX + 12, y + 88, { size: 11, font: 'F2', color: colors.navy });
    addRightText(this.formatCurrency(order.total), totalBoxX + totalBoxWidth - 12, y + 88, { size: 11, font: 'F2', color: colors.navy });
    y += totalBoxHeight + 28;

    if (order.notes) {
      const noteLines = wrapText(order.notes, contentWidth - 24, 10);
      const notesHeight = 28 + noteLines.length * 12 + 12;
      ensureSpace(notesHeight + 12);
      setFill([250, 245, 255]);
      setStroke([221, 214, 254]);
      addRect(marginX, y, contentWidth, notesHeight, 'B');
      addText('Observaciones', marginX + 12, y + 16, { size: 10, font: 'F2', color: [109, 40, 217] });
      noteLines.forEach((line, idx) => addText(line, marginX + 12, y + 34 + idx * 12, { size: 9, color: colors.text }));
      y += notesHeight + 18;
    }

    ensureSpace(24);
    addText(`Generado el ${new Date().toLocaleString('es-CO')}`, marginX, y, { size: 9, color: colors.muted });
    addRightText('Generado por BeccaFact', pageWidth - marginX, y, { size: 9, color: colors.muted });
    pushPage();

    const objects: string[] = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const kids: string[] = [];
    let nextId = 5;
    pages.forEach((content) => {
      const pageId = nextId++;
      const contentId = nextId++;
      kids.push(`${pageId} 0 R`);
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
      objects[contentId] = `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`;
    });
    objects[2] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let i = 1; i < objects.length; i++) {
      offsets[i] = Buffer.byteLength(pdf, 'utf8');
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'utf8');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CUSTOMERS USADOS EN COMPRAS
  // ─────────────────────────────────────────────────────────────────────────────

  async findAllCustomers(
    companyId: string,
    filters: { search?: string; isActive?: boolean; page?: number; limit?: number },
  ) {
    const result = await this.customersService.findAll(companyId, filters);

    return {
      ...result,
      data: result.data.map((customer) => this.mapCustomerForPurchasing(customer)),
    };
  }

  async findOneCustomer(companyId: string, id: string) {
    const customer = await this.customersService.findOne(companyId, id);
    const purchaseOrders = await this.prisma.purchaseOrder.findMany({
      where: { companyId, customerId: id, deletedAt: null },
      orderBy: { issueDate: 'desc' },
      take: 5,
      select: {
        id: true,
        number: true,
        status: true,
        issueDate: true,
        dueDate: true,
        total: true,
        currency: true,
      },
    });

    return {
      ...this.mapCustomerForPurchasing(customer),
      purchaseOrders: purchaseOrders.map((order) => ({
        ...order,
        orderNumber: order.number,
      })),
    };
  }

  async createCustomer(companyId: string, dto: CreateCustomerDto) {
    const created = await this.customersService.create(companyId, dto);
    return this.mapCustomerForPurchasing(created);
  }

  async updateCustomer(companyId: string, id: string, dto: UpdateCustomerDto) {
    const updated = await this.customersService.update(companyId, id, dto);
    return this.mapCustomerForPurchasing(updated);
  }

  async toggleCustomer(companyId: string, id: string) {
    const updated = await this.customersService.toggle(companyId, id);
    return this.mapCustomerForPurchasing(updated);
  }

  async removeCustomer(companyId: string, id: string) {
    const removed = await this.customersService.remove(companyId, id);
    return this.mapCustomerForPurchasing(removed);
  }

  async findAllPurchaseBudgets(
    companyId: string,
    filters: { search?: string; status?: PurchaseBudgetStatusValue; page?: number; limit?: number },
  ) {
    const { search, status, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const clauses = [`pb."companyId" = $1`, `pb."deletedAt" IS NULL`];
    const values: any[] = [companyId];

    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(pb."number" ILIKE $${values.length} OR pb."title" ILIKE $${values.length} OR COALESCE(pb."costCenter", '') ILIKE $${values.length} OR COALESCE(pb."projectCode", '') ILIKE $${values.length})`);
    }
    if (status) {
      values.push(status);
      clauses.push(`pb."status" = $${values.length}`);
    }

    const whereSql = clauses.join(' AND ');
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT *
        FROM "purchase_budgets" pb
        WHERE ${whereSql}
        ORDER BY pb."startDate" DESC, pb."createdAt" DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      ...values,
      limit,
      offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `SELECT COUNT(*) AS "total" FROM "purchase_budgets" pb WHERE ${whereSql}`,
      ...values,
    );

    const data = await Promise.all(rows.map(async (row) => this.mapPurchaseBudget(row, await this.getPurchaseBudgetUsage(companyId, row.id))));
    const total = Number(totalRows[0]?.total ?? 0);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOnePurchaseBudget(companyId: string, id: string) {
    const budget = await this.getPurchaseBudgetOrFail(companyId, id);
    return this.mapPurchaseBudget(budget, await this.getPurchaseBudgetUsage(companyId, id));
  }

  async createPurchaseBudget(companyId: string, dto: CreatePurchaseBudgetDto, userId?: string) {
    const number = await this.generateSequenceNumber('purchase_budgets', companyId, 'PTO');
    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "purchase_budgets" (
          "id", "companyId", "number", "title", "status", "amount", "startDate", "endDate",
          "area", "costCenter", "projectCode", "notes", "createdById", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5::"PurchaseBudgetStatus", $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      `,
      id,
      companyId,
      number,
      dto.title.trim(),
      dto.status ?? 'DRAFT',
      this.sanitizeAmount(dto.amount),
      new Date(dto.startDate),
      dto.endDate ? new Date(dto.endDate) : null,
      dto.area?.trim() || null,
      dto.costCenter?.trim() || null,
      dto.projectCode?.trim() || null,
      dto.notes?.trim() || null,
      userId ?? null,
    );
    return this.findOnePurchaseBudget(companyId, id);
  }

  async updatePurchaseBudget(companyId: string, id: string, dto: UpdatePurchaseBudgetDto) {
    await this.getPurchaseBudgetOrFail(companyId, id);
    const sets: string[] = [`"updatedAt" = NOW()`];
    const values: any[] = [companyId, id];
    const setValue = (sql: string, value: any) => {
      values.push(value);
      sets.push(`${sql} = $${values.length}`);
    };

    if (dto.title !== undefined) setValue(`"title"`, dto.title.trim());
    if (dto.status !== undefined) setValue(`"status"`, dto.status);
    if (dto.amount !== undefined) setValue(`"amount"`, this.sanitizeAmount(dto.amount));
    if (dto.startDate !== undefined) setValue(`"startDate"`, new Date(dto.startDate));
    if (dto.endDate !== undefined) setValue(`"endDate"`, dto.endDate ? new Date(dto.endDate) : null);
    if (dto.area !== undefined) setValue(`"area"`, dto.area?.trim() || null);
    if (dto.costCenter !== undefined) setValue(`"costCenter"`, dto.costCenter?.trim() || null);
    if (dto.projectCode !== undefined) setValue(`"projectCode"`, dto.projectCode?.trim() || null);
    if (dto.notes !== undefined) setValue(`"notes"`, dto.notes?.trim() || null);

    await this.prisma.$executeRawUnsafe(
      `UPDATE "purchase_budgets" SET ${sets.join(', ')} WHERE "companyId" = $1 AND "id" = $2`,
      ...values,
    );
    return this.findOnePurchaseBudget(companyId, id);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PURCHASE ORDERS
  // ─────────────────────────────────────────────────────────────────────────────

  async findAllRequests(
    companyId: string,
    filters: {
      search?: string;
      status?: PurchaseRequestStatusValue;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, status, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const clauses = [`pr."companyId" = $1`, `pr."deletedAt" IS NULL`];
    const values: any[] = [companyId];

    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(pr."number" ILIKE $${values.length} OR COALESCE(c."name", '') ILIKE $${values.length})`);
    }
    if (status) {
      values.push(status);
      clauses.push(`pr."status" = $${values.length}`);
    }

    const whereSql = clauses.join(' AND ');

    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          pr.*,
          pb."id" AS "budget_id",
          pb."number" AS "budget_number",
          pb."title" AS "budget_title",
          c."id" AS "customer_id",
          c."name" AS "customer_name",
          c."documentNumber" AS "customer_document_number",
          COUNT(pri."id")::int AS "itemsCount"
        FROM "purchase_requests" pr
        LEFT JOIN "purchase_budgets" pb ON pb."id" = pr."budgetId"
        LEFT JOIN "customers" c ON c."id" = pr."customerId"
        LEFT JOIN "purchase_request_items" pri ON pri."requestId" = pr."id"
        WHERE ${whereSql}
        GROUP BY pr."id", c."id", pb."id"
        ORDER BY pr."requestDate" DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      ...values,
      limit,
      offset,
    );

    const totalRows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `
        SELECT COUNT(*) AS "total"
        FROM "purchase_requests" pr
        LEFT JOIN "purchase_budgets" pb ON pb."id" = pr."budgetId"
        LEFT JOIN "customers" c ON c."id" = pr."customerId"
        WHERE ${whereSql}
      `,
      ...values,
    );

    const enriched = await Promise.all(
      data.map(async (row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        requestDate: row.requestDate,
        neededByDate: row.neededByDate,
        notes: row.notes,
        budgetId: row.budgetId,
        requestingArea: row.requestingArea,
        costCenter: row.costCenter,
        projectCode: row.projectCode,
        itemsCount: Number(row.itemsCount ?? 0),
        budget: row.budget_id
          ? {
              id: row.budget_id,
              number: row.budget_number,
              title: row.budget_title,
            }
          : null,
        customer: row.customer_id
          ? {
              id: row.customer_id,
              name: row.customer_name,
              documentNumber: row.customer_document_number,
            }
          : null,
        approval: await this.getLatestRequestApproval(companyId, row.id),
        createdAt: row.createdAt,
      })),
    );

    const total = Number(totalRows[0]?.total ?? 0);
    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneRequest(companyId: string, id: string) {
    return this.findRequestById(companyId, id);
  }

  async createRequest(companyId: string, dto: CreatePurchaseRequestDto, userId?: string) {
    if (dto.customerId) {
      await this.ensureCustomerForOrder(companyId, dto.customerId);
    }
    const estimatedTotal = this.calcRequestEstimatedTotal(dto.items);
    if (dto.budgetId) {
      await this.ensurePurchaseBudgetAvailable(companyId, dto.budgetId, estimatedTotal, dto.requestDate);
    }
    const number = await this.generateSequenceNumber('purchase_requests', companyId, 'SC');
    const requestId = randomUUID();

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "purchase_requests" (
          "id", "companyId", "number", "status", "requestDate", "neededByDate", "notes", "customerId", "budgetId", "requestingArea", "costCenter", "projectCode", "createdById", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      `,
      requestId,
      companyId,
      number,
      new Date(dto.requestDate),
      dto.neededByDate ? new Date(dto.neededByDate) : null,
      dto.notes ?? null,
      dto.customerId ?? null,
      dto.budgetId ?? null,
      dto.requestingArea?.trim() || null,
      dto.costCenter?.trim() || null,
      dto.projectCode?.trim() || null,
      userId ?? null,
    );

    for (const item of dto.items) {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "purchase_request_items" (
            "id", "requestId", "productId", "description", "quantity", "estimatedUnitPrice", "position"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        randomUUID(),
        requestId,
        item.productId ?? null,
        item.description,
        item.quantity,
        item.estimatedUnitPrice ?? null,
        item.position,
      );
    }

    return this.findRequestById(companyId, requestId);
  }

  async updateRequest(companyId: string, id: string, dto: UpdatePurchaseRequestDto) {
    const request = await this.findRequestById(companyId, id);
    if (!['DRAFT', 'REJECTED'].includes(request.status)) {
      throw new ForbiddenException(`Solo se pueden editar solicitudes en estado DRAFT o REJECTED. Estado actual: ${request.status}`);
    }

    if (dto.customerId) {
      await this.ensureCustomerForOrder(companyId, dto.customerId);
    }
    const nextItems = dto.items?.length ? dto.items : (request.items ?? []);
    const nextRequestDate = dto.requestDate ?? request.requestDate;
    const nextBudgetId = dto.budgetId === undefined ? request.budgetId : dto.budgetId;
    const estimatedTotal = this.calcRequestEstimatedTotal(nextItems as any[]);
    if (nextBudgetId) {
      await this.ensurePurchaseBudgetAvailable(companyId, nextBudgetId, estimatedTotal, nextRequestDate, { excludeRequestId: id });
    }

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "purchase_requests"
        SET
          "requestDate" = COALESCE($3, "requestDate"),
          "neededByDate" = COALESCE($4, "neededByDate"),
          "notes" = COALESCE($5, "notes"),
          "customerId" = COALESCE($6, "customerId"),
          "budgetId" = COALESCE($7, "budgetId"),
          "requestingArea" = COALESCE($8, "requestingArea"),
          "costCenter" = COALESCE($9, "costCenter"),
          "projectCode" = COALESCE($10, "projectCode"),
          "updatedAt" = NOW()
        WHERE "companyId" = $1 AND "id" = $2
      `,
      companyId,
      id,
      dto.requestDate ? new Date(dto.requestDate) : null,
      dto.neededByDate ? new Date(dto.neededByDate) : null,
      dto.notes ?? null,
      dto.customerId ?? null,
      dto.budgetId ?? null,
      dto.requestingArea?.trim() || null,
      dto.costCenter?.trim() || null,
      dto.projectCode?.trim() || null,
    );

    if (dto.items?.length) {
      await this.prisma.$executeRawUnsafe(`DELETE FROM "purchase_request_items" WHERE "requestId" = $1`, id);
      for (const item of dto.items) {
        await this.prisma.$executeRawUnsafe(
          `
            INSERT INTO "purchase_request_items" (
              "id", "requestId", "productId", "description", "quantity", "estimatedUnitPrice", "position"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          randomUUID(),
          id,
          item.productId ?? null,
          item.description,
          item.quantity,
          item.estimatedUnitPrice ?? null,
          item.position,
        );
      }
    }

    return this.findRequestById(companyId, id);
  }

  async updateRequestStatus(companyId: string, id: string, dto: UpdatePurchaseRequestStatusDto) {
    const request = await this.findRequestById(companyId, id);
    if (request.status === 'ORDERED' && dto.status !== 'ORDERED') {
      throw new ForbiddenException('Las solicitudes ya convertidas a orden no pueden cambiar a otro estado manualmente');
    }
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "purchase_requests"
        SET "status" = $3, "updatedAt" = NOW()
        WHERE "companyId" = $1 AND "id" = $2
      `,
      companyId,
      id,
      dto.status,
    );
    return this.findRequestById(companyId, id);
  }

  async requestApproval(companyId: string, id: string, dto: RequestPurchaseApprovalDto) {
    const request = await this.findRequestById(companyId, id);
    if (!['DRAFT', 'REJECTED'].includes(request.status)) {
      throw new ForbiddenException('Solo se puede solicitar aprobación desde borrador o rechazo');
    }
    const latestApproval = await this.getLatestRequestApproval(companyId, id);
    if (latestApproval?.status === 'PENDING') {
      throw new BadRequestException('La solicitud ya tiene una aprobación pendiente');
    }

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "purchase_request_approvals" (
          "id", "companyId", "requestId", "status", "reason", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, 'PENDING', $4, NOW(), NOW())
      `,
      randomUUID(),
      companyId,
      id,
      dto.reason?.trim() || 'Solicitud enviada a aprobación de compras',
    );

    await this.prisma.$executeRawUnsafe(
      `UPDATE "purchase_requests" SET "status" = 'PENDING_APPROVAL', "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
      companyId,
      id,
    );

    return this.findRequestById(companyId, id);
  }

  async approveRequest(companyId: string, id: string, dto: DecidePurchaseApprovalDto, userId?: string) {
    await this.findRequestById(companyId, id);
    const approval = await this.getLatestRequestApproval(companyId, id);
    if (!approval || approval.status !== 'PENDING') {
      throw new BadRequestException('La solicitud no tiene aprobaciones pendientes');
    }

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "purchase_request_approvals"
        SET "status" = 'APPROVED', "approvedById" = $3, "decidedAt" = NOW(), "reason" = COALESCE($4, "reason"), "updatedAt" = NOW()
        WHERE "companyId" = $1 AND "id" = $2
      `,
      companyId,
      approval.id,
      userId ?? null,
      dto.reason?.trim() || null,
    );

    await this.prisma.$executeRawUnsafe(
      `UPDATE "purchase_requests" SET "status" = 'APPROVED', "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
      companyId,
      id,
    );

    return this.findRequestById(companyId, id);
  }

  async rejectRequest(companyId: string, id: string, dto: DecidePurchaseApprovalDto, userId?: string) {
    await this.findRequestById(companyId, id);
    const approval = await this.getLatestRequestApproval(companyId, id);
    if (!approval || approval.status !== 'PENDING') {
      throw new BadRequestException('La solicitud no tiene aprobaciones pendientes');
    }

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "purchase_request_approvals"
        SET "status" = 'REJECTED', "approvedById" = $3, "decidedAt" = NOW(), "rejectedReason" = $4, "updatedAt" = NOW()
        WHERE "companyId" = $1 AND "id" = $2
      `,
      companyId,
      approval.id,
      userId ?? null,
      dto.reason?.trim() || 'Rechazada por aprobación de compras',
    );

    await this.prisma.$executeRawUnsafe(
      `UPDATE "purchase_requests" SET "status" = 'REJECTED', "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
      companyId,
      id,
    );

    return this.findRequestById(companyId, id);
  }

  async convertRequestToOrder(companyId: string, id: string, dto: ConvertPurchaseRequestToOrderDto) {
    const request = await this.findRequestById(companyId, id);
    if (request.status !== 'APPROVED') {
      throw new ForbiddenException('Solo se pueden convertir solicitudes aprobadas');
    }
    await this.ensureCustomerForOrder(companyId, dto.customerId);

    const order = await this.createOrder(companyId, {
      customerId: dto.customerId,
      budgetId: dto.budgetId ?? request.budgetId ?? undefined,
      issueDate: dto.issueDate ?? new Date().toISOString().slice(0, 10),
      dueDate: dto.dueDate,
      notes: dto.notes ?? request.notes ?? undefined,
      requestingArea: request.requestingArea ?? undefined,
      costCenter: request.costCenter ?? undefined,
      projectCode: request.projectCode ?? undefined,
      items: (request.items ?? []).map((item: any, index: number) => ({
        productId: item.productId ?? undefined,
        description: item.description,
        quantity: this.toNumber(item.quantity),
        unitPrice: this.toNumber(item.estimatedUnitPrice),
        taxRate: 19,
        discount: 0,
        position: index + 1,
      })),
    }, { excludeRequestId: id });

    await this.prisma.$executeRawUnsafe(
      `UPDATE "purchase_orders" SET "sourceRequestId" = $2 WHERE "companyId" = $1 AND "id" = $3`,
      companyId,
      id,
      order.id,
    );

    await this.prisma.$executeRawUnsafe(
      `UPDATE "purchase_requests" SET "status" = 'ORDERED', "customerId" = $3, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
      companyId,
      id,
      dto.customerId,
    );

    return this.findRequestById(companyId, id);
  }

  async removeRequest(companyId: string, id: string) {
    const request = await this.findRequestById(companyId, id);
    if (!['DRAFT', 'REJECTED', 'CANCELLED'].includes(request.status)) {
      throw new ForbiddenException('Solo se pueden eliminar solicitudes en borrador, rechazadas o canceladas');
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE "purchase_requests" SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
      companyId,
      id,
    );
    return { success: true };
  }

  async findAllReceipts(
    companyId: string,
    filters: {
      search?: string;
      status?: string;
      orderId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, status, orderId, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const clauses = [`r."companyId" = $1`, `r."deletedAt" IS NULL`];
    const values: any[] = [companyId];

    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(r."number" ILIKE $${values.length} OR po."number" ILIKE $${values.length} OR c."name" ILIKE $${values.length})`);
    }
    if (status) {
      values.push(status);
      clauses.push(`r."status" = $${values.length}`);
    }
    if (orderId) {
      values.push(orderId);
      clauses.push(`r."orderId" = $${values.length}`);
    }

    const whereSql = clauses.join(' AND ');
    const data = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          r.*,
          po."number" AS "orderNumber",
          c."id" AS "customerId",
          c."name" AS "customerName",
          COUNT(ri."id")::int AS "itemsCount"
        FROM "purchase_order_receipts" r
        INNER JOIN "purchase_orders" po ON po."id" = r."orderId"
        LEFT JOIN "customers" c ON c."id" = po."customerId"
        LEFT JOIN "purchase_order_receipt_items" ri ON ri."receiptId" = r."id"
        WHERE ${whereSql}
        GROUP BY r."id", po."number", c."id"
        ORDER BY r."receiptDate" DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      ...values,
      limit,
      offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `
        SELECT COUNT(*) AS "total"
        FROM "purchase_order_receipts" r
        INNER JOIN "purchase_orders" po ON po."id" = r."orderId"
        LEFT JOIN "customers" c ON c."id" = po."customerId"
        WHERE ${whereSql}
      `,
      ...values,
    );
    const total = Number(totalRows[0]?.total ?? 0);
    return {
      data: data.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        receiptDate: row.receiptDate,
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        itemsCount: Number(row.itemsCount ?? 0),
        customer: row.customerId ? { id: row.customerId, name: row.customerName } : null,
        createdAt: row.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOneReceipt(companyId: string, id: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          r.*,
          po."number" AS "orderNumber",
          po."status" AS "orderStatus",
          c."id" AS "customerId",
          c."name" AS "customerName",
          c."documentNumber" AS "customerDocumentNumber"
        FROM "purchase_order_receipts" r
        INNER JOIN "purchase_orders" po ON po."id" = r."orderId"
        LEFT JOIN "customers" c ON c."id" = po."customerId"
        WHERE r."companyId" = $1 AND r."id" = $2 AND r."deletedAt" IS NULL
        LIMIT 1
      `,
      companyId,
      id,
    );
    const receipt = rows[0];
    if (!receipt) throw new NotFoundException('Recepción no encontrada');
    const items = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT *
        FROM "purchase_order_receipt_items"
        WHERE "receiptId" = $1
        ORDER BY "position" ASC
      `,
      id,
    );
    return {
      id: receipt.id,
      number: receipt.number,
      status: receipt.status,
      receiptDate: receipt.receiptDate,
      notes: receipt.notes,
      orderId: receipt.orderId,
      orderNumber: receipt.orderNumber,
      orderStatus: receipt.orderStatus,
      customer: receipt.customerId
        ? {
            id: receipt.customerId,
            name: receipt.customerName,
            documentNumber: receipt.customerDocumentNumber,
          }
        : null,
      items: items.map((item) => ({
        ...item,
        orderedQuantity: item.orderedQuantity == null ? null : this.toNumber(item.orderedQuantity),
        receivedQuantity: this.toNumber(item.receivedQuantity),
      })),
      createdAt: receipt.createdAt,
    };
  }

  async createReceipt(companyId: string, dto: CreatePurchaseReceiptDto, userId?: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: dto.orderId, companyId, deletedAt: null },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Orden de compra no encontrada');
    if (order.status === PurchaseOrderStatus.CANCELLED) {
      throw new ForbiddenException('No puedes recibir una orden cancelada');
    }

    const orderItemsById = new Map(order.items.map((item) => [item.id, item]));
    const receiptNumber = await this.generateSequenceNumber('purchase_order_receipts', companyId, 'RC');
    const receiptId = randomUUID();

    for (const item of dto.items) {
      if (item.orderItemId && !orderItemsById.has(item.orderItemId)) {
        throw new BadRequestException('Uno de los ítems de la recepción no pertenece a la orden seleccionada');
      }
    }

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "purchase_order_receipts" (
          "id", "companyId", "orderId", "number", "status", "receiptDate", "notes", "createdById", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, 'POSTED', $5, $6, $7, NOW(), NOW())
      `,
      receiptId,
      companyId,
      dto.orderId,
      receiptNumber,
      new Date(dto.receiptDate),
      dto.notes ?? null,
      userId ?? null,
    );

    for (const item of dto.items) {
      const sourceOrderItem = item.orderItemId ? orderItemsById.get(item.orderItemId) : null;
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "purchase_order_receipt_items" (
            "id", "receiptId", "orderItemId", "description", "orderedQuantity", "receivedQuantity", "position"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        randomUUID(),
        receiptId,
        item.orderItemId ?? null,
        item.description,
        item.orderedQuantity ?? (sourceOrderItem ? this.toNumber(sourceOrderItem.quantity) : null),
        item.receivedQuantity,
        item.position,
      );
    }

    await this.applyReceiptInventory(companyId, receiptId, dto.notes ?? undefined);
    await this.syncOrderStatusFromReceipts(companyId, dto.orderId);
    return this.findOneReceipt(companyId, receiptId);
  }

  async findAllPurchaseInvoices(
    companyId: string,
    filters: { search?: string; status?: string; customerId?: string; page?: number; limit?: number },
  ) {
    const { search, status, customerId, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const clauses = [`pi."companyId" = $1`, `pi."deletedAt" IS NULL`];
    const values: any[] = [companyId];

    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(pi."number" ILIKE $${values.length} OR pi."supplierInvoiceNumber" ILIKE $${values.length} OR c."name" ILIKE $${values.length})`);
    }
    if (status) {
      values.push(status);
      clauses.push(`pi."status" = $${values.length}`);
    }
    if (customerId) {
      values.push(customerId);
      clauses.push(`pi."customerId" = $${values.length}`);
    }

    const whereSql = clauses.join(' AND ');
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          pi.*,
          c."name" AS "customerName",
          c."documentNumber" AS "customerDocumentNumber",
          po."number" AS "orderNumber",
          COUNT(pii."id")::int AS "itemsCount",
          ap."id" AS "accountPayableId",
          ap."number" AS "accountPayableNumber",
          ap."status" AS "accountPayableStatus",
          ap."balance" AS "accountPayableBalance"
        FROM "purchase_invoices" pi
        INNER JOIN "customers" c ON c."id" = pi."customerId"
        LEFT JOIN "purchase_orders" po ON po."id" = pi."purchaseOrderId"
        LEFT JOIN "purchase_invoice_items" pii ON pii."invoiceId" = pi."id"
        LEFT JOIN "accounts_payable" ap ON ap."purchaseInvoiceId" = pi."id" AND ap."deletedAt" IS NULL
        WHERE ${whereSql}
        GROUP BY pi."id", c."id", po."id", ap."id"
        ORDER BY pi."issueDate" DESC, pi."createdAt" DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      ...values,
      limit,
      offset,
    );

    const totalRows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `
        SELECT COUNT(*) AS "total"
        FROM "purchase_invoices" pi
        INNER JOIN "customers" c ON c."id" = pi."customerId"
        WHERE ${whereSql}
      `,
      ...values,
    );

    const data = rows.map((row) => ({
      id: row.id,
      number: row.number,
      supplierInvoiceNumber: row.supplierInvoiceNumber,
      status: row.status,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      notes: row.notes,
      subtotal: this.toNumber(row.subtotal),
      taxAmount: this.toNumber(row.taxAmount),
      total: this.toNumber(row.total),
      itemsCount: Number(row.itemsCount ?? 0),
      customerId: row.customerId,
      customer: {
        id: row.customerId,
        name: row.customerName,
        documentNumber: row.customerDocumentNumber,
      },
      purchaseOrderId: row.purchaseOrderId,
      orderNumber: row.orderNumber,
      accountPayable: row.accountPayableId
        ? {
            id: row.accountPayableId,
            number: row.accountPayableNumber,
            status: row.accountPayableStatus,
            balance: this.toNumber(row.accountPayableBalance),
          }
        : null,
      createdAt: row.createdAt,
    }));

    const total = Number(totalRows[0]?.total ?? 0);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOnePurchaseInvoice(companyId: string, id: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          pi.*,
          c."name" AS "customerName",
          c."documentNumber" AS "customerDocumentNumber",
          c."email" AS "customerEmail",
          po."number" AS "orderNumber"
        FROM "purchase_invoices" pi
        INNER JOIN "customers" c ON c."id" = pi."customerId"
        LEFT JOIN "purchase_orders" po ON po."id" = pi."purchaseOrderId"
        WHERE pi."companyId" = $1 AND pi."id" = $2 AND pi."deletedAt" IS NULL
        LIMIT 1
      `,
      companyId,
      id,
    );
    const invoice = rows[0];
    if (!invoice) throw new NotFoundException('Factura de proveedor no encontrada');

    const [items, payable] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM "purchase_invoice_items" WHERE "invoiceId" = $1 ORDER BY "position" ASC`,
        id,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM "accounts_payable" WHERE "companyId" = $1 AND "purchaseInvoiceId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
        companyId,
        id,
      ),
    ]);

    return {
      id: invoice.id,
      number: invoice.number,
      supplierInvoiceNumber: invoice.supplierInvoiceNumber,
      status: invoice.status,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      notes: invoice.notes,
      subtotal: this.toNumber(invoice.subtotal),
      taxAmount: this.toNumber(invoice.taxAmount),
      total: this.toNumber(invoice.total),
      purchaseOrderId: invoice.purchaseOrderId,
      orderNumber: invoice.orderNumber,
      receiptId: invoice.receiptId,
      customerId: invoice.customerId,
      customer: {
        id: invoice.customerId,
        name: invoice.customerName,
        documentNumber: invoice.customerDocumentNumber,
        email: invoice.customerEmail,
      },
      items: items.map((item) => ({
        ...item,
        quantity: this.toNumber(item.quantity),
        unitPrice: this.toNumber(item.unitPrice),
        taxRate: this.toNumber(item.taxRate),
        taxAmount: this.toNumber(item.taxAmount),
        discount: this.toNumber(item.discount),
        total: this.toNumber(item.total),
      })),
      accountPayable: payable[0]
        ? {
            ...payable[0],
            originalAmount: this.toNumber(payable[0].originalAmount),
            paidAmount: this.toNumber(payable[0].paidAmount),
            balance: this.toNumber(payable[0].balance),
          }
        : null,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  }

  async createPurchaseInvoice(companyId: string, dto: CreatePurchaseInvoiceDto, userId?: string) {
    await this.ensureCustomerForOrder(companyId, dto.customerId);
    if (!dto.items?.length) {
      throw new BadRequestException('La factura de proveedor debe incluir al menos una línea');
    }

    if (dto.purchaseOrderId) {
      const order = await this.prisma.purchaseOrder.findFirst({
        where: { id: dto.purchaseOrderId, companyId, customerId: dto.customerId, deletedAt: null },
        select: { id: true },
      });
      if (!order) throw new BadRequestException('La orden de compra no pertenece al cliente seleccionado');
    }

    if (dto.receiptId) {
      const receipt = await this.prisma.$queryRawUnsafe<any[]>(
        `
          SELECT r."id"
          FROM "purchase_order_receipts" r
          INNER JOIN "purchase_orders" po ON po."id" = r."orderId"
          WHERE r."companyId" = $1 AND r."id" = $2 AND po."customerId" = $3 AND r."deletedAt" IS NULL
          LIMIT 1
        `,
        companyId,
        dto.receiptId,
        dto.customerId,
      );
      if (!receipt[0]) throw new BadRequestException('La recepción no pertenece al cliente seleccionado');
    }

    const duplicate = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT "id"
        FROM "purchase_invoices"
        WHERE "companyId" = $1 AND "supplierInvoiceNumber" = $2 AND "deletedAt" IS NULL
        LIMIT 1
      `,
      companyId,
      dto.supplierInvoiceNumber,
    );
    if (duplicate[0]) {
      throw new BadRequestException('Ya existe una factura de proveedor con ese número');
    }

    const { subtotal, taxAmount, total, computed } = this.calcPurchaseInvoiceTotals(dto.items);
    const invoiceId = randomUUID();
    const number = await this.generateSequenceNumber('purchase_invoices', companyId, 'FP');

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "purchase_invoices" (
          "id", "companyId", "customerId", "purchaseOrderId", "receiptId", "number", "supplierInvoiceNumber",
          "status", "issueDate", "dueDate", "notes", "subtotal", "taxAmount", "total", "createdById", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
      `,
      invoiceId,
      companyId,
      dto.customerId,
      dto.purchaseOrderId ?? null,
      dto.receiptId ?? null,
      number,
      dto.supplierInvoiceNumber,
      new Date(dto.issueDate),
      dto.dueDate ? new Date(dto.dueDate) : null,
      dto.notes ?? null,
      subtotal,
      taxAmount,
      total,
      userId ?? null,
    );

    for (const item of computed) {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "purchase_invoice_items" (
            "id", "invoiceId", "orderItemId", "description", "quantity", "unitPrice", "taxRate", "taxAmount", "discount", "total", "position"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        randomUUID(),
        invoiceId,
        item.orderItemId ?? null,
        item.description,
        item.quantity,
        item.unitPrice,
        item.taxRate,
        item.taxAmount,
        item.discount,
        item.total,
        item.position,
      );
    }

    return this.findOnePurchaseInvoice(companyId, invoiceId);
  }

  async postPurchaseInvoice(companyId: string, id: string) {
    const invoice = await this.findOnePurchaseInvoice(companyId, id);
    if (invoice.status !== 'DRAFT') {
      throw new ForbiddenException('Solo se pueden contabilizar facturas de proveedor en borrador');
    }
    if (invoice.accountPayable) {
      throw new BadRequestException('La factura ya generó una cuenta por pagar');
    }

    const payableId = randomUUID();
    const payableNumber = await this.generateSequenceNumber('accounts_payable', companyId, 'CXP');
    const concept = `Factura proveedor ${invoice.number}`;

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "accounts_payable" (
          "id", "companyId", "customerId", "purchaseInvoiceId", "number", "concept", "status",
          "issueDate", "dueDate", "originalAmount", "paidAmount", "balance", "notes", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8, $9, 0, $9, $10, NOW(), NOW())
      `,
      payableId,
      companyId,
      invoice.customerId,
      id,
      payableNumber,
      concept,
      new Date(invoice.issueDate),
      invoice.dueDate ? new Date(invoice.dueDate) : null,
      invoice.total,
      invoice.notes ?? null,
    );

    await this.prisma.$executeRawUnsafe(
      `UPDATE "purchase_invoices" SET "status" = 'POSTED', "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
      companyId,
      id,
    );
    await this.createDefaultPayableSchedule(
      companyId,
      payableId,
      this.toNumber(invoice.total),
      invoice.dueDate ? new Date(invoice.dueDate) : null,
    );

    const payable = {
      id: payableId,
      number: payableNumber,
      originalAmount: invoice.total,
      balance: invoice.total,
    };

    try {
      await this.createAccountingEntryForPurchaseInvoice(companyId, invoice, payable);
    } catch (error) {
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM "accounts_payable" WHERE "companyId" = $1 AND "id" = $2`,
        companyId,
        payableId,
      );
      await this.prisma.$executeRawUnsafe(
        `UPDATE "purchase_invoices" SET "status" = 'DRAFT', "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
        companyId,
        id,
      );
      throw error;
    }

    return this.findOnePurchaseInvoice(companyId, id);
  }

  async findAllAccountsPayable(
    companyId: string,
    filters: { search?: string; status?: string; customerId?: string; page?: number; limit?: number },
  ) {
    const { search, status, customerId, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const clauses = [`ap."companyId" = $1`, `ap."deletedAt" IS NULL`];
    const values: any[] = [companyId];

    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(ap."number" ILIKE $${values.length} OR ap."concept" ILIKE $${values.length} OR c."name" ILIKE $${values.length})`);
    }
    if (status) {
      values.push(status);
      clauses.push(`ap."status" = $${values.length}`);
    }
    if (customerId) {
      values.push(customerId);
      clauses.push(`ap."customerId" = $${values.length}`);
    }

    const whereSql = clauses.join(' AND ');
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          ap.*,
          c."name" AS "customerName",
          c."documentNumber" AS "customerDocumentNumber",
          pi."number" AS "invoiceNumber",
          pi."supplierInvoiceNumber" AS "supplierInvoiceNumber",
          COUNT(app."id")::int AS "paymentsCount"
        FROM "accounts_payable" ap
        INNER JOIN "customers" c ON c."id" = ap."customerId"
        LEFT JOIN "purchase_invoices" pi ON pi."id" = ap."purchaseInvoiceId"
        LEFT JOIN "account_payable_payments" app ON app."accountPayableId" = ap."id" AND app."reversedAt" IS NULL
        WHERE ${whereSql}
        GROUP BY ap."id", c."id", pi."id"
        ORDER BY ap."dueDate" ASC NULLS LAST, ap."createdAt" DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      ...values,
      limit,
      offset,
    );

    const totalRows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `
        SELECT COUNT(*) AS "total"
        FROM "accounts_payable" ap
        INNER JOIN "customers" c ON c."id" = ap."customerId"
        WHERE ${whereSql}
      `,
      ...values,
    );

    const now = Date.now();
    const data = rows.map((row) => ({
      id: row.id,
      number: row.number,
      concept: row.concept,
      status: row.status,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      originalAmount: this.toNumber(row.originalAmount),
      paidAmount: this.toNumber(row.paidAmount),
      balance: this.toNumber(row.balance),
      paymentsCount: Number(row.paymentsCount ?? 0),
      isOverdue: row.dueDate ? new Date(row.dueDate).getTime() < now && this.toNumber(row.balance) > 0.009 : false,
      customerId: row.customerId,
      customer: {
        id: row.customerId,
        name: row.customerName,
        documentNumber: row.customerDocumentNumber,
      },
      purchaseInvoiceId: row.purchaseInvoiceId,
      invoiceNumber: row.invoiceNumber,
      supplierInvoiceNumber: row.supplierInvoiceNumber,
    }));

    const total = Number(totalRows[0]?.total ?? 0);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneAccountPayable(companyId: string, id: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          ap.*,
          c."name" AS "customerName",
          c."documentNumber" AS "customerDocumentNumber",
          c."email" AS "customerEmail",
          pi."number" AS "invoiceNumber",
          pi."supplierInvoiceNumber" AS "supplierInvoiceNumber"
        FROM "accounts_payable" ap
        INNER JOIN "customers" c ON c."id" = ap."customerId"
        LEFT JOIN "purchase_invoices" pi ON pi."id" = ap."purchaseInvoiceId"
        WHERE ap."companyId" = $1 AND ap."id" = $2 AND ap."deletedAt" IS NULL
        LIMIT 1
      `,
      companyId,
      id,
    );
    const payable = rows[0];
    if (!payable) throw new NotFoundException('Cuenta por pagar no encontrada');

    const payments = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "account_payable_payments" WHERE "accountPayableId" = $1 AND "reversedAt" IS NULL ORDER BY "paymentDate" DESC, "createdAt" DESC`,
      id,
    );
    const schedules = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "account_payable_schedules" WHERE "companyId" = $1 AND "accountPayableId" = $2 ORDER BY "dueDate" ASC, "createdAt" ASC`,
      companyId,
      id,
    );
    const advances = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          paa.*,
          pa."number" AS "advanceNumber",
          pa."paymentMethod" AS "paymentMethod"
        FROM "purchase_advance_applications" paa
        INNER JOIN "purchase_advances" pa ON pa."id" = paa."purchaseAdvanceId"
        WHERE paa."companyId" = $1 AND paa."accountPayableId" = $2
        ORDER BY paa."applicationDate" DESC, paa."createdAt" DESC
      `,
      companyId,
      id,
    );

    return {
      ...payable,
      originalAmount: this.toNumber(payable.originalAmount),
      paidAmount: this.toNumber(payable.paidAmount),
      balance: this.toNumber(payable.balance),
      customer: {
        id: payable.customerId,
        name: payable.customerName,
        documentNumber: payable.customerDocumentNumber,
        email: payable.customerEmail,
      },
      invoiceNumber: payable.invoiceNumber,
      supplierInvoiceNumber: payable.supplierInvoiceNumber,
      schedules: schedules.map((schedule) => ({
        ...schedule,
        amount: this.toNumber(schedule.amount),
        paidAmount: this.toNumber(schedule.paidAmount),
        balance: this.toNumber(schedule.balance),
      })),
      payments: payments.map((payment) => ({
        ...payment,
        amount: this.toNumber(payment.amount),
      })),
      advances: advances.map((application) => ({
        ...application,
        amount: this.toNumber(application.amount),
      })),
    };
  }

  async registerAccountPayablePayment(companyId: string, id: string, dto: RegisterPayablePaymentDto, userId?: string) {
    const payable = await this.findOneAccountPayable(companyId, id);
    if (payable.status === 'PAID' || this.toNumber(payable.balance) <= 0.009) {
      throw new BadRequestException('La cuenta por pagar ya está saldada');
    }
    const amount = this.sanitizeAmount(dto.amount);
    if (amount <= 0) {
      throw new BadRequestException('El valor del pago debe ser mayor que cero');
    }
    if (amount - this.toNumber(payable.balance) > 0.009) {
      throw new BadRequestException('El pago no puede exceder el saldo pendiente');
    }

    const paymentId = randomUUID();
    const paymentNumber = await this.generateSequenceNumber('account_payable_payments', companyId, 'PAGCXP');
    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "account_payable_payments" (
          "id", "companyId", "accountPayableId", "number", "paymentDate", "amount", "paymentMethod", "reference", "notes", "createdById", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::"PaymentMethod", $8, $9, $10, NOW(), NOW())
      `,
      paymentId,
      companyId,
      id,
      paymentNumber,
      new Date(dto.paymentDate),
      amount,
      dto.paymentMethod,
      dto.reference ?? null,
      dto.notes ?? null,
      userId ?? null,
    );

    const scheduleSnapshot = (payable.schedules ?? []).map((schedule: any) => ({
      id: schedule.id,
      paidAmount: this.toNumber(schedule.paidAmount),
      balance: this.toNumber(schedule.balance),
      status: schedule.status,
    }));

    const nextPaidAmount = this.toNumber(payable.paidAmount) + amount;
    const nextBalance = Math.max(0, this.toNumber(payable.originalAmount) - nextPaidAmount);
    const nextStatus = nextBalance <= 0.009 ? 'PAID' : 'PARTIAL';

    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "accounts_payable"
        SET "paidAmount" = $3, "balance" = $4, "status" = $5, "updatedAt" = NOW()
        WHERE "companyId" = $1 AND "id" = $2
      `,
      companyId,
      id,
      nextPaidAmount,
      nextBalance,
      nextStatus,
    );
    await this.syncPayableSchedulesAfterPayment(companyId, id, amount);

    try {
      await this.createAccountingEntryForPayablePayment(companyId, payable, {
        id: paymentId,
        number: paymentNumber,
        paymentDate: dto.paymentDate,
        amount,
        paymentMethod: dto.paymentMethod,
      });
    } catch (error) {
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM "account_payable_payments" WHERE "companyId" = $1 AND "id" = $2`,
        companyId,
        paymentId,
      );
      await this.prisma.$executeRawUnsafe(
        `
          UPDATE "accounts_payable"
          SET "paidAmount" = $3, "balance" = $4, "status" = $5, "updatedAt" = NOW()
          WHERE "companyId" = $1 AND "id" = $2
        `,
        companyId,
        id,
        payable.paidAmount,
        payable.balance,
        payable.status,
      );
      throw error;
    }

    return this.findOneAccountPayable(companyId, id);
  }

  async findAllPurchaseAdjustments(
    companyId: string,
    filters: { search?: string; status?: string; type?: string; customerId?: string; page?: number; limit?: number },
  ) {
    const { search, status, type, customerId, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const clauses = [`pa."companyId" = $1`];
    const values: any[] = [companyId];

    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(pa."reason" ILIKE $${values.length} OR c."name" ILIKE $${values.length})`);
    }
    if (status) {
      values.push(status);
      clauses.push(`pa."status" = $${values.length}`);
    }
    if (type) {
      values.push(type);
      clauses.push(`pa."type" = $${values.length}`);
    }
    if (customerId) {
      values.push(customerId);
      clauses.push(`pa."customerId" = $${values.length}`);
    }

    const whereSql = clauses.join(' AND ');
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          pa.*,
          c."name" AS "customerName",
          r."number" AS "receiptNumber",
          pi."number" AS "invoiceNumber",
          ap."number" AS "payableNumber",
          p."number" AS "paymentNumber"
        FROM "purchase_adjustments" pa
        INNER JOIN "customers" c ON c."id" = pa."customerId"
        LEFT JOIN "purchase_order_receipts" r ON r."id" = pa."receiptId"
        LEFT JOIN "purchase_invoices" pi ON pi."id" = pa."purchaseInvoiceId"
        LEFT JOIN "accounts_payable" ap ON ap."id" = pa."accountPayableId"
        LEFT JOIN "account_payable_payments" p ON p."id" = pa."paymentId"
        WHERE ${whereSql}
        ORDER BY pa."createdAt" DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      ...values,
      limit,
      offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `
        SELECT COUNT(*) AS "total"
        FROM "purchase_adjustments" pa
        INNER JOIN "customers" c ON c."id" = pa."customerId"
        WHERE ${whereSql}
      `,
      ...values,
    );
    const total = Number(totalRows[0]?.total ?? 0);
    return {
      data: rows.map((row) => ({
        ...row,
        amount: this.toNumber(row.amount),
        customer: { id: row.customerId, name: row.customerName },
        receiptNumber: row.receiptNumber,
        invoiceNumber: row.invoiceNumber,
        payableNumber: row.payableNumber,
        paymentNumber: row.paymentNumber,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOnePurchaseAdjustment(companyId: string, id: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          pa.*,
          c."name" AS "customerName",
          r."number" AS "receiptNumber",
          pi."number" AS "invoiceNumber",
          ap."number" AS "payableNumber",
          p."number" AS "paymentNumber"
        FROM "purchase_adjustments" pa
        INNER JOIN "customers" c ON c."id" = pa."customerId"
        LEFT JOIN "purchase_order_receipts" r ON r."id" = pa."receiptId"
        LEFT JOIN "purchase_invoices" pi ON pi."id" = pa."purchaseInvoiceId"
        LEFT JOIN "accounts_payable" ap ON ap."id" = pa."accountPayableId"
        LEFT JOIN "account_payable_payments" p ON p."id" = pa."paymentId"
        WHERE pa."companyId" = $1 AND pa."id" = $2
        LIMIT 1
      `,
      companyId,
      id,
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Ajuste de compra no encontrado');
    return {
      ...row,
      amount: this.toNumber(row.amount),
      customer: { id: row.customerId, name: row.customerName },
      receiptNumber: row.receiptNumber,
      invoiceNumber: row.invoiceNumber,
      payableNumber: row.payableNumber,
      paymentNumber: row.paymentNumber,
    };
  }

  async createPurchaseAdjustment(companyId: string, dto: CreatePurchaseAdjustmentDto, userId?: string) {
    await this.ensureCustomerForOrder(companyId, dto.customerId);

    if (dto.type === PurchaseAdjustmentTypeValue.RECEIPT_REVERSAL && !dto.receiptId) {
      throw new BadRequestException('La reversión de recepción requiere una recepción asociada');
    }
    if (dto.type === PurchaseAdjustmentTypeValue.INVOICE_REVERSAL && !dto.purchaseInvoiceId) {
      throw new BadRequestException('La reversión de factura requiere una factura asociada');
    }
    if (dto.type === PurchaseAdjustmentTypeValue.PAYMENT_REVERSAL && !dto.paymentId) {
      throw new BadRequestException('La reversión de pago requiere un pago asociado');
    }
    if ([PurchaseAdjustmentTypeValue.RETURN, PurchaseAdjustmentTypeValue.CREDIT_NOTE, PurchaseAdjustmentTypeValue.DEBIT_NOTE].includes(dto.type) && !dto.accountPayableId && !dto.purchaseInvoiceId) {
      throw new BadRequestException('Este ajuste requiere una cuenta por pagar o una factura contabilizada');
    }

    if (dto.receiptId) {
      const receipt = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT r."id" FROM "purchase_order_receipts" r INNER JOIN "purchase_orders" po ON po."id" = r."orderId" WHERE r."companyId" = $1 AND r."id" = $2 AND po."customerId" = $3 LIMIT 1`,
        companyId, dto.receiptId, dto.customerId,
      );
      if (!receipt[0]) throw new BadRequestException('La recepción no pertenece al cliente seleccionado');
    }
    if (dto.purchaseInvoiceId) {
      const invoice = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT "id" FROM "purchase_invoices" WHERE "companyId" = $1 AND "id" = $2 AND "customerId" = $3 AND "deletedAt" IS NULL LIMIT 1`,
        companyId, dto.purchaseInvoiceId, dto.customerId,
      );
      if (!invoice[0]) throw new BadRequestException('La factura de proveedor no pertenece al cliente seleccionado');
    }
    if (dto.accountPayableId) {
      const payable = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT "id" FROM "accounts_payable" WHERE "companyId" = $1 AND "id" = $2 AND "customerId" = $3 AND "deletedAt" IS NULL LIMIT 1`,
        companyId, dto.accountPayableId, dto.customerId,
      );
      if (!payable[0]) throw new BadRequestException('La cuenta por pagar no pertenece al cliente seleccionado');
    }
    if (dto.paymentId) {
      const payment = await this.prisma.$queryRawUnsafe<any[]>(
        `
          SELECT p."id"
          FROM "account_payable_payments" p
          INNER JOIN "accounts_payable" ap ON ap."id" = p."accountPayableId"
          WHERE p."companyId" = $1 AND p."id" = $2 AND ap."customerId" = $3
          LIMIT 1
        `,
        companyId, dto.paymentId, dto.customerId,
      );
      if (!payment[0]) throw new BadRequestException('El pago no pertenece al cliente seleccionado');
    }

    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "purchase_adjustments" (
          "id", "companyId", "customerId", "type", "status", "receiptId", "purchaseInvoiceId",
          "accountPayableId", "paymentId", "amount", "reason", "notes", "requestedById", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4::"PurchaseAdjustmentType", 'PENDING_APPROVAL', $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      `,
      id,
      companyId,
      dto.customerId,
      dto.type,
      dto.receiptId ?? null,
      dto.purchaseInvoiceId ?? null,
      dto.accountPayableId ?? null,
      dto.paymentId ?? null,
      dto.amount,
      dto.reason,
      dto.notes ?? null,
      userId ?? null,
    );

    return this.findOnePurchaseAdjustment(companyId, id);
  }

  async approvePurchaseAdjustment(companyId: string, id: string, dto: DecidePurchaseAdjustmentDto, userId?: string) {
    const adjustment = await this.findOnePurchaseAdjustment(companyId, id);
    if (adjustment.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('El ajuste no se encuentra pendiente de aprobación');
    }

    if (adjustment.type === PurchaseAdjustmentTypeValue.RECEIPT_REVERSAL) {
      if (!adjustment.receiptId) throw new BadRequestException('La reversión requiere una recepción');
      const linkedPostedInvoice = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT "id" FROM "purchase_invoices" WHERE "companyId" = $1 AND "receiptId" = $2 AND "status" = 'POSTED' AND "deletedAt" IS NULL LIMIT 1`,
        companyId,
        adjustment.receiptId,
      );
      if (linkedPostedInvoice[0]) {
        throw new BadRequestException('No puedes revertir una recepción que ya tiene una factura de proveedor contabilizada');
      }
      await this.reverseReceiptInventory(
        companyId,
        adjustment.receiptId,
        adjustment.id,
        adjustment.reason ?? adjustment.notes ?? 'Reversión de recepción aprobada',
      );
      await this.prisma.$executeRawUnsafe(
        `UPDATE "purchase_order_receipts" SET "status" = 'CANCELLED', "notes" = $3, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
        companyId,
        adjustment.receiptId,
        this.appendNote(adjustment.notes, `Reversada por ajuste ${adjustment.id}`),
      );
      const receiptRows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT "orderId" FROM "purchase_order_receipts" WHERE "companyId" = $1 AND "id" = $2 LIMIT 1`,
        companyId,
        adjustment.receiptId,
      );
      if (receiptRows[0]?.orderId) await this.syncOrderStatusFromReceipts(companyId, receiptRows[0].orderId);
    } else if (adjustment.type === PurchaseAdjustmentTypeValue.INVOICE_REVERSAL) {
      if (!adjustment.purchaseInvoiceId) throw new BadRequestException('La reversión requiere una factura');
      const invoice = await this.findOnePurchaseInvoice(companyId, adjustment.purchaseInvoiceId);
      if (invoice.accountPayable && this.toNumber(invoice.accountPayable.paidAmount) > 0.009) {
        throw new BadRequestException('No puedes revertir una factura con pagos registrados');
      }
      await this.prisma.$executeRawUnsafe(
        `UPDATE "purchase_invoices" SET "status" = 'CANCELLED', "notes" = $3, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
        companyId,
        adjustment.purchaseInvoiceId,
        this.appendNote(invoice.notes, `Reversada por ajuste ${adjustment.id}`),
      );
      if (invoice.accountPayable?.id) {
        await this.prisma.$executeRawUnsafe(
          `UPDATE "accounts_payable" SET "status" = 'CANCELLED', "balance" = 0, "notes" = $3, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
          companyId,
          invoice.accountPayable.id,
          this.appendNote(invoice.accountPayable.notes, `Cancelada por reversión de factura ${invoice.number}`),
        );
      }
    } else if (adjustment.type === PurchaseAdjustmentTypeValue.PAYMENT_REVERSAL) {
      if (!adjustment.paymentId) throw new BadRequestException('La reversión requiere un pago');
      const paymentRows = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM "account_payable_payments" WHERE "companyId" = $1 AND "id" = $2 LIMIT 1`,
        companyId,
        adjustment.paymentId,
      );
      const payment = paymentRows[0];
      if (!payment || payment.reversedAt) throw new BadRequestException('El pago no existe o ya fue revertido');
      const payable = await this.findOneAccountPayable(companyId, payment.accountPayableId);
      const nextPaidAmount = Math.max(0, this.toNumber(payable.paidAmount) - this.toNumber(payment.amount));
      const nextBalance = this.toNumber(payable.balance) + this.toNumber(payment.amount);
      const nextStatus = nextBalance <= 0.009 ? 'PAID' : nextPaidAmount <= 0.009 ? 'OPEN' : 'PARTIAL';

      await this.prisma.$executeRawUnsafe(
        `UPDATE "account_payable_payments" SET "reversedAt" = NOW(), "notes" = $3, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
        companyId,
        payment.id,
        this.appendNote(payment.notes, `Revertido por ajuste ${adjustment.id}`),
      );
      await this.prisma.$executeRawUnsafe(
        `UPDATE "accounts_payable" SET "paidAmount" = $3, "balance" = $4, "status" = $5, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
        companyId,
        payable.id,
        nextPaidAmount,
        nextBalance,
        nextStatus,
      );
      await this.createAccountingEntryForPayablePaymentReversal(companyId, payable, payment);
    } else {
      const payableId = adjustment.accountPayableId ?? adjustment.accountPayable?.id ?? adjustment.accountPayableId;
      let payable = payableId ? await this.findOneAccountPayable(companyId, payableId) : null;

      if (!payable && adjustment.purchaseInvoiceId) {
        const invoice = await this.findOnePurchaseInvoice(companyId, adjustment.purchaseInvoiceId);
        payable = invoice.accountPayable ? await this.findOneAccountPayable(companyId, invoice.accountPayable.id) : null;
      }

      if (!payable) {
        throw new BadRequestException('El ajuste requiere una cuenta por pagar o una factura contabilizada');
      }

      if ([PurchaseAdjustmentTypeValue.RETURN, PurchaseAdjustmentTypeValue.CREDIT_NOTE].includes(adjustment.type as PurchaseAdjustmentTypeValue)) {
        if (this.toNumber(adjustment.amount) - this.toNumber(payable.balance) > 0.009) {
          throw new BadRequestException('El ajuste no puede exceder el saldo pendiente de la cuenta por pagar');
        }
        const nextOriginal = Math.max(0, this.toNumber(payable.originalAmount) - this.toNumber(adjustment.amount));
        const nextBalance = Math.max(0, this.toNumber(payable.balance) - this.toNumber(adjustment.amount));
        const nextStatus = nextBalance <= 0.009 ? 'PAID' : this.toNumber(payable.paidAmount) > 0.009 ? 'PARTIAL' : 'OPEN';
        await this.prisma.$executeRawUnsafe(
          `UPDATE "accounts_payable" SET "originalAmount" = $3, "balance" = $4, "status" = $5, "notes" = $6, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
          companyId,
          payable.id,
          nextOriginal,
          nextBalance,
          nextStatus,
          this.appendNote(payable.notes, `Ajuste ${adjustment.type} ${adjustment.id}`),
        );
        await this.createAccountingEntryForAdjustment(companyId, adjustment, payable, 'reduce');
      } else if (adjustment.type === PurchaseAdjustmentTypeValue.DEBIT_NOTE) {
        const nextOriginal = this.toNumber(payable.originalAmount) + this.toNumber(adjustment.amount);
        const nextBalance = this.toNumber(payable.balance) + this.toNumber(adjustment.amount);
        const nextStatus = this.toNumber(payable.paidAmount) > 0.009 ? 'PARTIAL' : 'OPEN';
        await this.prisma.$executeRawUnsafe(
          `UPDATE "accounts_payable" SET "originalAmount" = $3, "balance" = $4, "status" = $5, "notes" = $6, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
          companyId,
          payable.id,
          nextOriginal,
          nextBalance,
          nextStatus,
          this.appendNote(payable.notes, `Ajuste ${adjustment.type} ${adjustment.id}`),
        );
        await this.createAccountingEntryForAdjustment(companyId, adjustment, payable, 'increase');
      }
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE "purchase_adjustments" SET "status" = 'APPLIED', "approvedById" = $3, "approvedAt" = NOW(), "notes" = $4, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
      companyId,
      id,
      userId ?? null,
      dto.reason ? this.appendNote(adjustment.notes, dto.reason) : adjustment.notes ?? null,
    );

    return this.findOnePurchaseAdjustment(companyId, id);
  }

  async findAllPurchaseAdvances(
    companyId: string,
    filters: { search?: string; status?: string; customerId?: string; page?: number; limit?: number },
  ) {
    const { search, status, customerId, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const clauses = [`pa."companyId" = $1`, `pa."deletedAt" IS NULL`];
    const values: any[] = [companyId];

    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(pa."number" ILIKE $${values.length} OR pa."reference" ILIKE $${values.length} OR c."name" ILIKE $${values.length})`);
    }
    if (status) {
      values.push(status);
      clauses.push(`pa."status" = $${values.length}`);
    }
    if (customerId) {
      values.push(customerId);
      clauses.push(`pa."customerId" = $${values.length}`);
    }
    const whereSql = clauses.join(' AND ');

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT pa.*, c."name" AS "customerName", c."documentNumber" AS "customerDocumentNumber",
          COUNT(paa."id")::int AS "applicationsCount"
        FROM "purchase_advances" pa
        INNER JOIN "customers" c ON c."id" = pa."customerId"
        LEFT JOIN "purchase_advance_applications" paa ON paa."purchaseAdvanceId" = pa."id"
        WHERE ${whereSql}
        GROUP BY pa."id", c."id"
        ORDER BY pa."issueDate" DESC, pa."createdAt" DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      ...values,
      limit,
      offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `
        SELECT COUNT(*) AS "total"
        FROM "purchase_advances" pa
        INNER JOIN "customers" c ON c."id" = pa."customerId"
        WHERE ${whereSql}
      `,
      ...values,
    );

    const data = rows.map((row) => ({
      ...row,
      amount: this.toNumber(row.amount),
      appliedAmount: this.toNumber(row.appliedAmount),
      balance: this.toNumber(row.balance),
      applicationsCount: Number(row.applicationsCount ?? 0),
      customer: {
        id: row.customerId,
        name: row.customerName,
        documentNumber: row.customerDocumentNumber,
      },
    }));
    const total = Number(totalRows[0]?.total ?? 0);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOnePurchaseAdvance(companyId: string, id: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT pa.*, c."name" AS "customerName", c."documentNumber" AS "customerDocumentNumber", c."email" AS "customerEmail"
        FROM "purchase_advances" pa
        INNER JOIN "customers" c ON c."id" = pa."customerId"
        WHERE pa."companyId" = $1 AND pa."id" = $2 AND pa."deletedAt" IS NULL
        LIMIT 1
      `,
      companyId,
      id,
    );
    const advance = rows[0];
    if (!advance) throw new NotFoundException('Anticipo no encontrado');

    const applications = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT paa.*, ap."number" AS "payableNumber"
        FROM "purchase_advance_applications" paa
        INNER JOIN "accounts_payable" ap ON ap."id" = paa."accountPayableId"
        WHERE paa."companyId" = $1 AND paa."purchaseAdvanceId" = $2
        ORDER BY paa."applicationDate" DESC, paa."createdAt" DESC
      `,
      companyId,
      id,
    );

    return {
      ...advance,
      amount: this.toNumber(advance.amount),
      appliedAmount: this.toNumber(advance.appliedAmount),
      balance: this.toNumber(advance.balance),
      customer: {
        id: advance.customerId,
        name: advance.customerName,
        documentNumber: advance.customerDocumentNumber,
        email: advance.customerEmail,
      },
      applications: applications.map((item) => ({
        ...item,
        amount: this.toNumber(item.amount),
      })),
    };
  }

  async createPurchaseAdvance(companyId: string, dto: CreatePurchaseAdvanceDto, userId?: string) {
    await this.ensureCustomerForOrder(companyId, dto.customerId);
    const amount = this.sanitizeAmount(dto.amount);
    if (amount <= 0) throw new BadRequestException('El valor del anticipo debe ser mayor que cero');
    const id = randomUUID();
    const number = await this.generateSequenceNumber('purchase_advances', companyId, 'ANT');

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "purchase_advances" (
          "id", "companyId", "customerId", "number", "status", "issueDate", "amount", "appliedAmount", "balance",
          "paymentMethod", "reference", "notes", "createdById", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, 'OPEN', $5, $6, 0, $6, $7::"PaymentMethod", $8, $9, $10, NOW(), NOW())
      `,
      id,
      companyId,
      dto.customerId,
      number,
      new Date(dto.issueDate),
      amount,
      dto.paymentMethod,
      dto.reference ?? null,
      dto.notes ?? null,
      userId ?? null,
    );

    try {
      await this.createAccountingEntryForPurchaseAdvance(companyId, {
        id,
        number,
        issueDate: dto.issueDate,
        amount,
        paymentMethod: dto.paymentMethod,
        reference: dto.reference ?? null,
      });
    } catch (error) {
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM "purchase_advances" WHERE "companyId" = $1 AND "id" = $2`,
        companyId,
        id,
      );
      throw error;
    }

    return this.findOnePurchaseAdvance(companyId, id);
  }

  async applyPurchaseAdvance(companyId: string, id: string, dto: ApplyPurchaseAdvanceDto, userId?: string) {
    const advance = await this.findOnePurchaseAdvance(companyId, id);
    if (advance.status === 'CANCELLED' || this.toNumber(advance.balance) <= 0.009) {
      throw new BadRequestException('El anticipo no tiene saldo disponible');
    }
    const payable = await this.findOneAccountPayable(companyId, dto.accountPayableId);
    if (advance.customerId !== payable.customerId) {
      throw new BadRequestException('El anticipo solo puede aplicarse a cuentas por pagar del mismo proveedor');
    }
    if (payable.status === 'PAID' || this.toNumber(payable.balance) <= 0.009) {
      throw new BadRequestException('La cuenta por pagar seleccionada no tiene saldo pendiente');
    }

    const amount = this.sanitizeAmount(dto.amount);
    if (amount <= 0) throw new BadRequestException('El valor aplicado debe ser mayor que cero');
    if (amount - this.toNumber(advance.balance) > 0.009) {
      throw new BadRequestException('El valor aplicado no puede exceder el saldo del anticipo');
    }
    if (amount - this.toNumber(payable.balance) > 0.009) {
      throw new BadRequestException('El valor aplicado no puede exceder el saldo de la cuenta por pagar');
    }

    const applicationId = randomUUID();
    const applicationDate = new Date().toISOString().slice(0, 10);
    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "purchase_advance_applications" (
          "id", "companyId", "purchaseAdvanceId", "accountPayableId", "amount", "applicationDate", "notes", "createdAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `,
      applicationId,
      companyId,
      id,
      dto.accountPayableId,
      amount,
      new Date(applicationDate),
      dto.notes ?? `Aplicado por ${userId ?? 'sistema'}`,
    );

    const nextAdvanceApplied = this.toNumber(advance.appliedAmount) + amount;
    const nextAdvanceBalance = Math.max(0, this.toNumber(advance.amount) - nextAdvanceApplied);
    const nextAdvanceStatus = nextAdvanceBalance <= 0.009 ? 'APPLIED' : nextAdvanceApplied > 0.009 ? 'PARTIAL' : 'OPEN';
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "purchase_advances"
        SET "appliedAmount" = $3, "balance" = $4, "status" = $5, "notes" = $6, "updatedAt" = NOW()
        WHERE "companyId" = $1 AND "id" = $2
      `,
      companyId,
      id,
      nextAdvanceApplied,
      nextAdvanceBalance,
      nextAdvanceStatus,
      dto.notes ? this.appendNote(advance.notes, dto.notes) : advance.notes ?? null,
    );

    const scheduleSnapshot = (payable.schedules ?? []).map((schedule: any) => ({
      id: schedule.id,
      paidAmount: this.toNumber(schedule.paidAmount),
      balance: this.toNumber(schedule.balance),
      status: schedule.status,
    }));

    const nextPaidAmount = this.toNumber(payable.paidAmount) + amount;
    const nextBalance = Math.max(0, this.toNumber(payable.originalAmount) - nextPaidAmount);
    const nextStatus = nextBalance <= 0.009 ? 'PAID' : 'PARTIAL';
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "accounts_payable"
        SET "paidAmount" = $3, "balance" = $4, "status" = $5, "notes" = $6, "updatedAt" = NOW()
        WHERE "companyId" = $1 AND "id" = $2
      `,
      companyId,
      payable.id,
      nextPaidAmount,
      nextBalance,
      nextStatus,
      dto.notes ? this.appendNote(payable.notes, `Cruce anticipo ${advance.number}: ${dto.notes}`) : payable.notes ?? null,
    );
    await this.syncPayableSchedulesAfterPayment(companyId, payable.id, amount);

    try {
      await this.createAccountingEntryForAppliedAdvance(companyId, payable, advance, amount, applicationId, applicationDate);
    } catch (error) {
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM "purchase_advance_applications" WHERE "companyId" = $1 AND "id" = $2`,
        companyId,
        applicationId,
      );
      await this.prisma.$executeRawUnsafe(
        `
          UPDATE "purchase_advances"
          SET "appliedAmount" = $3, "balance" = $4, "status" = $5, "notes" = $6, "updatedAt" = NOW()
          WHERE "companyId" = $1 AND "id" = $2
        `,
        companyId,
        id,
        advance.appliedAmount,
        advance.balance,
        advance.status,
        advance.notes ?? null,
      );
      await this.prisma.$executeRawUnsafe(
        `
          UPDATE "accounts_payable"
          SET "paidAmount" = $3, "balance" = $4, "status" = $5, "notes" = $6, "updatedAt" = NOW()
          WHERE "companyId" = $1 AND "id" = $2
        `,
        companyId,
        payable.id,
        payable.paidAmount,
        payable.balance,
        payable.status,
        payable.notes ?? null,
      );
      for (const schedule of scheduleSnapshot) {
        await this.prisma.$executeRawUnsafe(
          `
            UPDATE "account_payable_schedules"
            SET "paidAmount" = $3, "balance" = $4, "status" = $5, "updatedAt" = NOW()
            WHERE "companyId" = $1 AND "id" = $2
          `,
          companyId,
          schedule.id,
          schedule.paidAmount,
          schedule.balance,
          schedule.status,
        );
      }
      throw error;
    }

    return this.findOnePurchaseAdvance(companyId, id);
  }

  async setAccountPayableSchedule(companyId: string, id: string, dto: CreatePayableScheduleDto) {
    const payable = await this.findOneAccountPayable(companyId, id);
    if (payable.status === 'CANCELLED' || payable.status === 'PAID') {
      throw new BadRequestException('Solo puedes programar pagos sobre cuentas por pagar abiertas');
    }
    if (!dto.schedules?.length) {
      throw new BadRequestException('Debes registrar al menos una cuota en la programación');
    }

    const normalized = dto.schedules.map((item) => ({
      dueDate: item.dueDate,
      amount: this.sanitizeAmount(item.amount),
      notes: item.notes,
    }));
    if (normalized.some((item) => !item.dueDate || item.amount <= 0)) {
      throw new BadRequestException('Cada cuota debe tener fecha de vencimiento y valor mayor que cero');
    }
    const scheduledTotal = normalized.reduce((sum, item) => sum + item.amount, 0);
    if (Math.abs(scheduledTotal - this.toNumber(payable.balance)) > 0.01) {
      throw new BadRequestException('La suma del cronograma debe coincidir con el saldo pendiente de la cuenta por pagar');
    }

    await this.replacePayableSchedules(companyId, id, normalized);
    return this.findOneAccountPayable(companyId, id);
  }

  async getAnalyticsReport(companyId: string, filters?: { dateFrom?: string; dateTo?: string }) {
    const clauses = [`po."companyId" = $1`, `po."deletedAt" IS NULL`];
    const values: any[] = [companyId];
    if (filters?.dateFrom) {
      values.push(new Date(filters.dateFrom));
      clauses.push(`po."issueDate" >= $${values.length}`);
    }
    if (filters?.dateTo) {
      values.push(new Date(filters.dateTo));
      clauses.push(`po."issueDate" <= $${values.length}`);
    }
    const whereOrders = clauses.join(' AND ');

    const [kpiRows, supplierRows, productRows, areaRows, budgetRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `
          SELECT
            COUNT(*)::int AS "ordersCount",
            COALESCE(SUM(po."total"), 0) AS "ordersTotal",
            COALESCE(AVG(po."total"), 0) AS "averageOrder",
            COALESCE(SUM(CASE WHEN po."status" = 'RECEIVED' THEN 1 ELSE 0 END), 0)::int AS "receivedCount",
            COALESCE(SUM(CASE WHEN po."status" = 'PARTIAL' THEN 1 ELSE 0 END), 0)::int AS "partialCount",
            COALESCE(SUM(CASE WHEN po."status" = 'CANCELLED' THEN 1 ELSE 0 END), 0)::int AS "cancelledCount"
          FROM "purchase_orders" po
          WHERE ${whereOrders}
        `,
        ...values,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `
          SELECT
            c."id",
            c."name",
            COUNT(po."id")::int AS "ordersCount",
            COALESCE(SUM(po."total"), 0) AS "totalSpend",
            COALESCE(AVG(EXTRACT(EPOCH FROM (r."receiptDate" - po."issueDate")) / 86400), 0) AS "avgLeadTimeDays"
          FROM "purchase_orders" po
          INNER JOIN "customers" c ON c."id" = po."customerId"
          LEFT JOIN "purchase_order_receipts" r
            ON r."orderId" = po."id" AND r."status" = 'POSTED' AND r."deletedAt" IS NULL
          WHERE ${whereOrders}
          GROUP BY c."id", c."name"
          ORDER BY "totalSpend" DESC
          LIMIT 10
        `,
        ...values,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `
          SELECT
            COALESCE(p."id", poi."productId") AS "productId",
            COALESCE(p."name", poi."description") AS "productName",
            COALESCE(SUM(poi."quantity"), 0) AS "quantity",
            COALESCE(SUM(poi."total"), 0) AS "totalSpend"
          FROM "purchase_order_items" poi
          INNER JOIN "purchase_orders" po ON po."id" = poi."orderId"
          LEFT JOIN "products" p ON p."id" = poi."productId"
          WHERE ${whereOrders}
          GROUP BY COALESCE(p."id", poi."productId"), COALESCE(p."name", poi."description")
          ORDER BY "totalSpend" DESC
          LIMIT 10
        `,
        ...values,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `
          SELECT
            COALESCE(po."requestingArea", 'Sin área') AS "area",
            COALESCE(po."costCenter", 'Sin centro de costo') AS "costCenter",
            COUNT(po."id")::int AS "ordersCount",
            COALESCE(SUM(po."total"), 0) AS "totalSpend"
          FROM "purchase_orders" po
          WHERE ${whereOrders}
          GROUP BY COALESCE(po."requestingArea", 'Sin área'), COALESCE(po."costCenter", 'Sin centro de costo')
          ORDER BY "totalSpend" DESC
          LIMIT 10
        `,
        ...values,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `
          SELECT
            pb."id",
            pb."number",
            pb."title",
            pb."amount",
            COALESCE(SUM(po."total"), 0) AS "executedAmount"
          FROM "purchase_budgets" pb
          LEFT JOIN "purchase_orders" po
            ON po."budgetId" = pb."id" AND po."deletedAt" IS NULL AND po."status" <> 'CANCELLED'
          WHERE pb."companyId" = $1 AND pb."deletedAt" IS NULL
          GROUP BY pb."id"
          ORDER BY pb."createdAt" DESC
          LIMIT 10
        `,
        companyId,
      ),
    ]);

    const kpis = kpiRows[0] ?? {};
    return {
      summary: {
        ordersCount: Number(kpis.ordersCount ?? 0),
        ordersTotal: this.toNumber(kpis.ordersTotal),
        averageOrder: this.toNumber(kpis.averageOrder),
        receivedCount: Number(kpis.receivedCount ?? 0),
        partialCount: Number(kpis.partialCount ?? 0),
        cancelledCount: Number(kpis.cancelledCount ?? 0),
      },
      supplierPerformance: supplierRows.map((row) => ({
        id: row.id,
        name: row.name,
        ordersCount: Number(row.ordersCount ?? 0),
        totalSpend: this.toNumber(row.totalSpend),
        avgLeadTimeDays: this.toNumber(row.avgLeadTimeDays),
      })),
      topProducts: productRows.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        quantity: this.toNumber(row.quantity),
        totalSpend: this.toNumber(row.totalSpend),
      })),
      spendByArea: areaRows.map((row) => ({
        area: row.area,
        costCenter: row.costCenter,
        ordersCount: Number(row.ordersCount ?? 0),
        totalSpend: this.toNumber(row.totalSpend),
      })),
      budgetVsActual: budgetRows.map((row) => {
        const budgetAmount = this.toNumber(row.amount);
        const executedAmount = this.toNumber(row.executedAmount);
        return {
          id: row.id,
          number: row.number,
          title: row.title,
          budgetAmount,
          executedAmount,
          availableAmount: Math.max(0, budgetAmount - executedAmount),
          executionPct: budgetAmount <= 0.009 ? 0 : (executedAmount / budgetAmount) * 100,
        };
      }),
    };
  }

  async getTraceabilityReport(
    companyId: string,
    filters: { search?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number },
  ) {
    const { search, dateFrom, dateTo, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const clauses = [`pr."companyId" = $1`, `pr."deletedAt" IS NULL`];
    const values: any[] = [companyId];
    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(pr."number" ILIKE $${values.length} OR c."name" ILIKE $${values.length} OR po."number" ILIKE $${values.length})`);
    }
    if (dateFrom) {
      values.push(new Date(dateFrom));
      clauses.push(`pr."requestDate" >= $${values.length}`);
    }
    if (dateTo) {
      values.push(new Date(dateTo));
      clauses.push(`pr."requestDate" <= $${values.length}`);
    }
    const whereSql = clauses.join(' AND ');

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          pr."id" AS "requestId",
          pr."number" AS "requestNumber",
          pr."status" AS "requestStatus",
          pr."requestDate",
          c."name" AS "customerName",
          po."id" AS "orderId",
          po."number" AS "orderNumber",
          po."status" AS "orderStatus",
          po."issueDate",
          po."total" AS "orderTotal",
          COUNT(DISTINCT r."id")::int AS "receiptsCount",
          COALESCE(SUM(CASE WHEN r."status" = 'POSTED' THEN 1 ELSE 0 END), 0)::int AS "postedReceiptsCount",
          COUNT(DISTINCT pi."id")::int AS "invoicesCount",
          COUNT(DISTINCT ap."id")::int AS "payablesCount",
          COALESCE(SUM(ap."balance"), 0) AS "pendingBalance"
        FROM "purchase_requests" pr
        LEFT JOIN "customers" c ON c."id" = pr."customerId"
        LEFT JOIN "purchase_orders" po ON po."sourceRequestId" = pr."id" AND po."deletedAt" IS NULL
        LEFT JOIN "purchase_order_receipts" r ON r."orderId" = po."id" AND r."deletedAt" IS NULL
        LEFT JOIN "purchase_invoices" pi ON pi."purchaseOrderId" = po."id" AND pi."deletedAt" IS NULL
        LEFT JOIN "accounts_payable" ap ON ap."purchaseInvoiceId" = pi."id" AND ap."deletedAt" IS NULL
        WHERE ${whereSql}
        GROUP BY pr."id", c."id", po."id"
        ORDER BY pr."requestDate" DESC, pr."createdAt" DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      ...values,
      limit,
      offset,
    );

    const totalRows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `
        SELECT COUNT(DISTINCT pr."id") AS "total"
        FROM "purchase_requests" pr
        LEFT JOIN "customers" c ON c."id" = pr."customerId"
        LEFT JOIN "purchase_orders" po ON po."sourceRequestId" = pr."id" AND po."deletedAt" IS NULL
        WHERE ${whereSql}
      `,
      ...values,
    );

    const data = rows.map((row) => ({
      requestId: row.requestId,
      requestNumber: row.requestNumber,
      requestStatus: row.requestStatus,
      requestDate: row.requestDate,
      customerName: row.customerName,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      orderStatus: row.orderStatus,
      issueDate: row.issueDate,
      orderTotal: this.toNumber(row.orderTotal),
      receiptsCount: Number(row.receiptsCount ?? 0),
      postedReceiptsCount: Number(row.postedReceiptsCount ?? 0),
      invoicesCount: Number(row.invoicesCount ?? 0),
      payablesCount: Number(row.payablesCount ?? 0),
      pendingBalance: this.toNumber(row.pendingBalance),
      completionStage: row.payablesCount > 0
        ? 'Facturada / CxP'
        : row.postedReceiptsCount > 0
          ? 'Recibida'
          : row.orderId
            ? 'Ordenada'
            : 'Solicitada',
    }));

    const total = Number(totalRows[0]?.total ?? 0);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async rejectPurchaseAdjustment(companyId: string, id: string, dto: DecidePurchaseAdjustmentDto, userId?: string) {
    const adjustment = await this.findOnePurchaseAdjustment(companyId, id);
    if (adjustment.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('El ajuste no se encuentra pendiente de aprobación');
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE "purchase_adjustments" SET "status" = 'REJECTED', "approvedById" = $3, "rejectedReason" = $4, "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
      companyId,
      id,
      userId ?? null,
      dto.reason?.trim() || 'Rechazado',
    );
    return this.findOnePurchaseAdjustment(companyId, id);
  }

  async findAllSupplierQuotes(
    companyId: string,
    filters: { search?: string; status?: string; purchaseRequestId?: string; customerId?: string; page?: number; limit?: number },
  ) {
    const { search, status, purchaseRequestId, customerId, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const clauses = [`sq."companyId" = $1`, `sq."deletedAt" IS NULL`];
    const values: any[] = [companyId];
    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(sq."number" ILIKE $${values.length} OR c."name" ILIKE $${values.length})`);
    }
    if (status) {
      values.push(status);
      clauses.push(`sq."status" = $${values.length}`);
    }
    if (purchaseRequestId) {
      values.push(purchaseRequestId);
      clauses.push(`sq."purchaseRequestId" = $${values.length}`);
    }
    if (customerId) {
      values.push(customerId);
      clauses.push(`sq."customerId" = $${values.length}`);
    }
    const whereSql = clauses.join(' AND ');
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          sq.*,
          c."name" AS "customerName",
          pr."number" AS "requestNumber",
          COUNT(sqi."id")::int AS "itemsCount"
        FROM "purchase_supplier_quotes" sq
        INNER JOIN "customers" c ON c."id" = sq."customerId"
        LEFT JOIN "purchase_requests" pr ON pr."id" = sq."purchaseRequestId"
        LEFT JOIN "purchase_supplier_quote_items" sqi ON sqi."quoteId" = sq."id"
        WHERE ${whereSql}
        GROUP BY sq."id", c."id", pr."id"
        ORDER BY sq."createdAt" DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      ...values,
      limit,
      offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `
        SELECT COUNT(*) AS "total"
        FROM "purchase_supplier_quotes" sq
        INNER JOIN "customers" c ON c."id" = sq."customerId"
        WHERE ${whereSql}
      `,
      ...values,
    );

    const data = rows.map((row) => ({
      ...row,
      subtotal: this.toNumber(row.subtotal),
      taxAmount: this.toNumber(row.taxAmount),
      total: this.toNumber(row.total),
      score: row.score == null ? null : this.toNumber(row.score),
      itemsCount: Number(row.itemsCount ?? 0),
      customer: { id: row.customerId, name: row.customerName },
      requestNumber: row.requestNumber,
    }));
    const total = Number(totalRows[0]?.total ?? 0);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOneSupplierQuote(companyId: string, id: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          sq.*,
          c."name" AS "customerName",
          c."documentNumber" AS "customerDocumentNumber",
          pr."number" AS "requestNumber"
        FROM "purchase_supplier_quotes" sq
        INNER JOIN "customers" c ON c."id" = sq."customerId"
        LEFT JOIN "purchase_requests" pr ON pr."id" = sq."purchaseRequestId"
        WHERE sq."companyId" = $1 AND sq."id" = $2 AND sq."deletedAt" IS NULL
        LIMIT 1
      `,
      companyId,
      id,
    );
    const quote = rows[0];
    if (!quote) throw new NotFoundException('Cotización de proveedor no encontrada');
    const items = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "purchase_supplier_quote_items" WHERE "quoteId" = $1 ORDER BY "position" ASC`,
      id,
    );
    return {
      ...quote,
      subtotal: this.toNumber(quote.subtotal),
      taxAmount: this.toNumber(quote.taxAmount),
      total: this.toNumber(quote.total),
      score: quote.score == null ? null : this.toNumber(quote.score),
      customer: { id: quote.customerId, name: quote.customerName, documentNumber: quote.customerDocumentNumber },
      requestNumber: quote.requestNumber,
      items: items.map((item) => ({
        ...item,
        quantity: this.toNumber(item.quantity),
        unitPrice: this.toNumber(item.unitPrice),
        taxRate: this.toNumber(item.taxRate),
        taxAmount: this.toNumber(item.taxAmount),
        total: this.toNumber(item.total),
      })),
    };
  }

  async createSupplierQuote(companyId: string, dto: CreatePurchaseSupplierQuoteDto, userId?: string) {
    await this.ensureCustomerForOrder(companyId, dto.customerId);
    if (!dto.items?.length) throw new BadRequestException('La cotización del proveedor debe incluir al menos una línea');
    if (dto.purchaseRequestId) {
      await this.findOneRequest(companyId, dto.purchaseRequestId);
    }
    const { subtotal, taxAmount, total, computed } = this.calcSupplierQuoteTotals(dto.items);
    const quoteId = randomUUID();
    const number = await this.generateSequenceNumber('purchase_supplier_quotes', companyId, 'CPR');
    const score = subtotal > 0 ? Math.max(1, 1000000 / subtotal) : null;

    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "purchase_supplier_quotes" (
          "id", "companyId", "customerId", "purchaseRequestId", "number", "status", "validUntil", "leadTimeDays",
          "paymentTermDays", "notes", "subtotal", "taxAmount", "total", "score", "createdById", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, 'RECEIVED', $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
      `,
      quoteId,
      companyId,
      dto.customerId,
      dto.purchaseRequestId ?? null,
      number,
      dto.validUntil ? new Date(dto.validUntil) : null,
      dto.leadTimeDays ?? null,
      dto.paymentTermDays ?? null,
      dto.notes ?? null,
      subtotal,
      taxAmount,
      total,
      score,
      userId ?? null,
    );

    for (const item of computed) {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "purchase_supplier_quote_items" (
            "id", "quoteId", "requestItemId", "description", "quantity", "unitPrice", "taxRate", "taxAmount", "total", "position"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        randomUUID(),
        quoteId,
        item.requestItemId ?? null,
        item.description,
        item.quantity,
        item.unitPrice,
        item.taxRate,
        item.taxAmount,
        item.total,
        item.position,
      );
    }

    return this.findOneSupplierQuote(companyId, quoteId);
  }

  async compareSupplierQuotes(companyId: string, requestId: string) {
    const request = await this.findOneRequest(companyId, requestId);
    const quotes = await this.findAllSupplierQuotes(companyId, { purchaseRequestId: requestId, limit: 200, page: 1 });
    const sorted = [...quotes.data].sort((a, b) => {
      if (a.total !== b.total) return a.total - b.total;
      return (a.leadTimeDays ?? 9999) - (b.leadTimeDays ?? 9999);
    });
    return {
      request,
      quotes: sorted.map((quote, index) => ({
        ...quote,
        ranking: index + 1,
        isBestPrice: index === 0,
      })),
    };
  }

  async awardSupplierQuote(companyId: string, id: string, dto: AwardPurchaseSupplierQuoteDto) {
    const quote = await this.findOneSupplierQuote(companyId, id);
    if (quote.status === 'AWARDED') {
      throw new BadRequestException('La cotización ya fue adjudicada');
    }
    const linkedRequest = quote.purchaseRequestId
      ? await this.findOneRequest(companyId, quote.purchaseRequestId)
      : null;

    const order = await this.createOrder(companyId, {
      customerId: quote.customerId,
      budgetId: linkedRequest?.budgetId ?? undefined,
      issueDate: dto.issueDate,
      dueDate: dto.dueDate,
      notes: dto.notes ?? quote.notes ?? undefined,
      requestingArea: linkedRequest?.requestingArea ?? undefined,
      costCenter: linkedRequest?.costCenter ?? undefined,
      projectCode: linkedRequest?.projectCode ?? undefined,
      items: (quote.items ?? []).map((item: any, index: number) => ({
        description: item.description,
        quantity: this.toNumber(item.quantity),
        unitPrice: this.toNumber(item.unitPrice),
        taxRate: this.toNumber(item.taxRate),
        discount: 0,
        position: index + 1,
      })),
    }, linkedRequest?.id ? { excludeRequestId: linkedRequest.id } : undefined);

    await this.prisma.$executeRawUnsafe(
      `UPDATE "purchase_supplier_quotes" SET "status" = 'AWARDED', "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
      companyId,
      id,
    );
    if (quote.purchaseRequestId) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "purchase_supplier_quotes" SET "status" = 'REJECTED', "updatedAt" = NOW() WHERE "companyId" = $1 AND "purchaseRequestId" = $2 AND "id" <> $3 AND "deletedAt" IS NULL`,
        companyId,
        quote.purchaseRequestId,
        id,
      );
      await this.prisma.$executeRawUnsafe(
        `UPDATE "purchase_orders" SET "sourceRequestId" = $2, "awardedQuoteId" = $3 WHERE "companyId" = $1 AND "id" = $4`,
        companyId,
        quote.purchaseRequestId,
        id,
        order.id,
      );
      await this.prisma.$executeRawUnsafe(
        `UPDATE "purchase_requests" SET "status" = 'ORDERED', "updatedAt" = NOW() WHERE "companyId" = $1 AND "id" = $2`,
        companyId,
        quote.purchaseRequestId,
      );
    } else {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "purchase_orders" SET "awardedQuoteId" = $2 WHERE "companyId" = $1 AND "id" = $3`,
        companyId,
        id,
        order.id,
      );
    }

    return {
      awardedQuote: await this.findOneSupplierQuote(companyId, id),
      order,
    };
  }

  async findAllFrameworkAgreements(
    companyId: string,
    filters: { search?: string; status?: string; customerId?: string; page?: number; limit?: number },
  ) {
    const { search, status, customerId, page = 1, limit = 20 } = filters;
    const offset = (page - 1) * limit;
    const clauses = [`fa."companyId" = $1`, `fa."deletedAt" IS NULL`];
    const values: any[] = [companyId];
    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(fa."number" ILIKE $${values.length} OR fa."title" ILIKE $${values.length} OR c."name" ILIKE $${values.length})`);
    }
    if (status) {
      values.push(status);
      clauses.push(`fa."status" = $${values.length}`);
    }
    if (customerId) {
      values.push(customerId);
      clauses.push(`fa."customerId" = $${values.length}`);
    }
    const whereSql = clauses.join(' AND ');
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT
          fa.*,
          c."name" AS "customerName",
          COUNT(fai."id")::int AS "itemsCount"
        FROM "purchase_framework_agreements" fa
        INNER JOIN "customers" c ON c."id" = fa."customerId"
        LEFT JOIN "purchase_framework_agreement_items" fai ON fai."agreementId" = fa."id"
        WHERE ${whereSql}
        GROUP BY fa."id", c."id"
        ORDER BY fa."createdAt" DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      ...values,
      limit,
      offset,
    );
    const totalRows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `
        SELECT COUNT(*) AS "total"
        FROM "purchase_framework_agreements" fa
        INNER JOIN "customers" c ON c."id" = fa."customerId"
        WHERE ${whereSql}
      `,
      ...values,
    );
    const total = Number(totalRows[0]?.total ?? 0);
    return {
      data: rows.map((row) => ({
        ...row,
        itemsCount: Number(row.itemsCount ?? 0),
        customer: { id: row.customerId, name: row.customerName },
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOneFrameworkAgreement(companyId: string, id: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
        SELECT fa.*, c."name" AS "customerName"
        FROM "purchase_framework_agreements" fa
        INNER JOIN "customers" c ON c."id" = fa."customerId"
        WHERE fa."companyId" = $1 AND fa."id" = $2 AND fa."deletedAt" IS NULL
        LIMIT 1
      `,
      companyId,
      id,
    );
    const agreement = rows[0];
    if (!agreement) throw new NotFoundException('Acuerdo marco no encontrado');
    const items = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "purchase_framework_agreement_items" WHERE "agreementId" = $1 ORDER BY "position" ASC`,
      id,
    );
    return {
      ...agreement,
      customer: { id: agreement.customerId, name: agreement.customerName },
      items: items.map((item) => ({
        ...item,
        unitPrice: this.toNumber(item.unitPrice),
        taxRate: this.toNumber(item.taxRate),
        minQuantity: item.minQuantity == null ? null : this.toNumber(item.minQuantity),
      })),
    };
  }

  async createFrameworkAgreement(companyId: string, dto: CreatePurchaseFrameworkAgreementDto, userId?: string) {
    await this.ensureCustomerForOrder(companyId, dto.customerId);
    if (!dto.items?.length) throw new BadRequestException('El acuerdo marco debe incluir al menos una línea');
    const agreementId = randomUUID();
    const number = await this.generateSequenceNumber('purchase_framework_agreements', companyId, 'AM');
    await this.prisma.$executeRawUnsafe(
      `
        INSERT INTO "purchase_framework_agreements" (
          "id", "companyId", "customerId", "number", "status", "title", "startDate", "endDate",
          "paymentTermDays", "leadTimeDays", "notes", "createdById", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      `,
      agreementId,
      companyId,
      dto.customerId,
      number,
      dto.title,
      new Date(dto.startDate),
      dto.endDate ? new Date(dto.endDate) : null,
      dto.paymentTermDays ?? null,
      dto.leadTimeDays ?? null,
      dto.notes ?? null,
      userId ?? null,
    );
    for (const item of dto.items) {
      await this.prisma.$executeRawUnsafe(
        `
          INSERT INTO "purchase_framework_agreement_items" (
            "id", "agreementId", "productId", "description", "unitPrice", "taxRate", "minQuantity", "notes", "position"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        randomUUID(),
        agreementId,
        item.productId ?? null,
        item.description,
        this.sanitizeAmount(item.unitPrice),
        this.sanitizePercent(item.taxRate ?? 19),
        item.minQuantity == null ? null : this.sanitizeAmount(item.minQuantity),
        item.notes ?? null,
        item.position,
      );
    }
    return this.findOneFrameworkAgreement(companyId, agreementId);
  }

  async findAllOrders(
    companyId: string,
    filters: {
      search?: string;
      status?: PurchaseOrderStatus;
      customerId?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, status, customerId, dateFrom, dateTo, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;
    const where: any = { companyId, deletedAt: null };

    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status) where.status = status;
    if (customerId) {
      await this.customersService.findOne(companyId, customerId);
      where.customerId = customerId;
    }

    if (dateFrom || dateTo) {
      where.issueDate = {};
      if (dateFrom) where.issueDate.gte = new Date(dateFrom);
      if (dateTo) where.issueDate.lte = new Date(dateTo);
    }

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { issueDate: 'desc' },
        skip,
        take: +limit,
        include: {
          budget: {
            select: { id: true, number: true, title: true },
          },
          customer: {
            select: { id: true, name: true, documentNumber: true },
          },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      data: data.map((order) => this.mapOrderSupplierToCustomer(order)),
      total,
      page: +page,
      limit: +limit,
      totalPages: Math.ceil(total / +limit),
    };
  }

  async findOneOrder(companyId: string, id: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        budget: { select: { id: true, number: true, title: true } },
        customer: true,
        items: {
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!order) throw new NotFoundException('Orden de compra no encontrada');
    return this.mapOrderSupplierToCustomer(order);
  }

  async createOrder(companyId: string, dto: CreatePurchaseOrderDto, options?: { excludeRequestId?: string; excludeOrderId?: string }) {
    const customerId = dto.customerId ?? dto.supplierId;
    if (!customerId) {
      throw new BadRequestException('El cliente asociado a la orden es obligatorio');
    }

    const customer = await this.ensureCustomerForOrder(companyId, customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    const number = await this.generateOrderNumber(companyId);
    const { subtotal, taxAmount, total, computed } = this.calcOrderTotals(dto.items);
    if (dto.budgetId) {
      await this.ensurePurchaseBudgetAvailable(companyId, dto.budgetId, total, dto.issueDate, options);
    }

    return this.prisma.purchaseOrder.create({
      data: {
        companyId,
        customerId: customer.id,
        budgetId: dto.budgetId ?? null,
        number,
        issueDate: new Date(dto.issueDate),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        notes: dto.notes,
        requestingArea: dto.requestingArea ?? null,
        costCenter: dto.costCenter ?? null,
        projectCode: dto.projectCode ?? null,
        currency: dto.currency ?? 'COP',
        subtotal,
        taxAmount,
        discountAmount: 0,
        total,
        items: {
          create: computed,
        },
      },
      include: {
        budget: { select: { id: true, number: true, title: true } },
        customer: { select: { id: true, name: true, documentNumber: true, email: true, phone: true, address: true, creditDays: true } },
        items: { orderBy: { position: 'asc' } },
      },
    }).then((order) => this.mapOrderSupplierToCustomer(order));
  }

  async updateOrder(companyId: string, id: string, dto: UpdatePurchaseOrderDto) {
    const order = await this.findOneOrder(companyId, id);

    // Solo se permite editar órdenes en estado DRAFT
    if (order.status !== PurchaseOrderStatus.DRAFT) {
      throw new ForbiddenException(
        `Solo se pueden modificar órdenes en estado DRAFT. Estado actual: ${order.status}`,
      );
    }

    // Recalcular totales si se envían ítems
    let totalsData: any = {};
    let itemsData: any = {};

    let nextTotal = order.total;
    if (dto.items && dto.items.length > 0) {
      const { subtotal, taxAmount, total, computed } = this.calcOrderTotals(dto.items);
      totalsData = { subtotal, taxAmount, total };
      nextTotal = total;
      // Reemplazar ítems: eliminar los anteriores y crear los nuevos
      itemsData = {
        items: {
          deleteMany: {},
          create: computed,
        },
      };
    }

    const nextBudgetId = dto.budgetId === undefined ? order.budgetId : dto.budgetId;
    const nextIssueDate = dto.issueDate ?? order.issueDate;
    if (nextBudgetId) {
      await this.ensurePurchaseBudgetAvailable(companyId, nextBudgetId, this.toNumber(nextTotal), nextIssueDate, { excludeOrderId: id });
    }

    const { items: _items, ...rest } = dto;

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        ...rest,
        budgetId: dto.budgetId ?? undefined,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        ...totalsData,
        ...itemsData,
      },
      include: {
        budget: { select: { id: true, number: true, title: true } },
        customer: { select: { id: true, name: true, documentNumber: true, email: true, phone: true, address: true, creditDays: true } },
        items: { orderBy: { position: 'asc' } },
      },
    }).then((order) => this.mapOrderSupplierToCustomer(order));
  }

  async updateOrderStatus(companyId: string, id: string, dto: UpdatePurchaseOrderStatusDto) {
    // Verificar que la orden existe y pertenece a la empresa
    await this.findOneOrder(companyId, id);

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: dto.status },
      include: {
        budget: { select: { id: true, number: true, title: true } },
        customer: { select: { id: true, name: true, documentNumber: true, email: true, phone: true, address: true, creditDays: true } },
      },
    }).then((order) => this.mapOrderSupplierToCustomer(order));
  }

  async removeOrder(companyId: string, id: string) {
    const order = await this.findOneOrder(companyId, id);

    // Solo se puede eliminar órdenes en estado DRAFT o CANCELLED
    if (order.status !== PurchaseOrderStatus.DRAFT && order.status !== PurchaseOrderStatus.CANCELLED) {
      throw new ForbiddenException(
        `Solo se pueden eliminar órdenes en estado DRAFT o CANCELLED. Estado actual: ${order.status}`,
      );
    }

    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
