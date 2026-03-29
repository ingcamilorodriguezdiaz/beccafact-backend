import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PayrollService } from '../payroll/payroll.service';
import { DianTestSetStatus, DianTestSetType } from '@prisma/client';


@Injectable()
export class DianTestSetsService {
  private readonly logger = new Logger(DianTestSetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly payrollService: PayrollService,
  ) {}

  // ── List test sets for a company ────────────────────────────────────────────

  async findByCompany(companyId: string) {
    await this.assertCompanyExists(companyId);
    return this.prisma.dianTestSet.findMany({
      where: { companyId },
      include: { _count: { select: { documents: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Get single test set with all documents ───────────────────────────────────

  async findOne(id: string) {
    const ts = await this.prisma.dianTestSet.findUnique({
      where: { id },
      include: { documents: { orderBy: { sequence: 'asc' } } },
    });
    if (!ts) throw new NotFoundException(`Test set ${id} no encontrado`);
    return ts;
  }

  // ── Start facturación test set (fire-and-forget) ─────────────────────────────

  async startFacturacion(companyId: string) {
    await this.assertCompanyExists(companyId);
    await this.assertNoInProgress(companyId, DianTestSetType.FACTURACION);

    // Create the test set header
    const testSet = await this.prisma.dianTestSet.create({
      data: {
        companyId,
        type: DianTestSetType.FACTURACION,
        status: DianTestSetStatus.PENDING,
        totalDocs: 50,
      },
    });

    // Create the 50 document placeholders
    const docTypes = [
      ...Array(30).fill('FACTURA'),
      ...Array(10).fill('NOTA_DEBITO'),
      ...Array(10).fill('NOTA_CREDITO'),
    ];
    await (this.prisma as any).dianTestSetDocument.createMany({
      data: docTypes.map((docType, i) => ({
        testSetId: testSet.id,
        sequence: i + 1,
        docType,
        status: 'PENDING',
      })),
    });

    // Launch background execution without blocking the HTTP response
    setImmediate(() => {
      this.executeFacturacion(testSet.id, companyId).catch(async (err) => {
        this.logger.error(`executeFacturacion failed for testSet ${testSet.id}: ${err.message}`, err.stack);
        await this.prisma.dianTestSet.update({
          where: { id: testSet.id },
          data: {
            status: DianTestSetStatus.FAILED,
            completedAt: new Date(),
            notes: `Error inesperado: ${err.message}`,
          },
        }).catch(() => undefined);
      });
    });

    return testSet;
  }

  // ── Start nómina test set (fire-and-forget) ──────────────────────────────────

  async startNomina(companyId: string) {
    await this.assertCompanyExists(companyId);
    await this.assertNoInProgress(companyId, DianTestSetType.NOMINA);

    const testSet = await this.prisma.dianTestSet.create({
      data: {
        companyId,
        type: DianTestSetType.NOMINA,
        status: DianTestSetStatus.PENDING,
        totalDocs: 20,
      },
    });

    const docTypes = [
      ...Array(10).fill('NOMINA_ELECTRONICA'),
      ...Array(10).fill('NOMINA_AJUSTE'),
    ];
    await (this.prisma as any).dianTestSetDocument.createMany({
      data: docTypes.map((docType, i) => ({
        testSetId: testSet.id,
        sequence: i + 1,
        docType,
        status: 'PENDING',
      })),
    });

    setImmediate(() => {
      this.executeNomina(testSet.id, companyId).catch(async (err) => {
        this.logger.error(`executeNomina failed for testSet ${testSet.id}: ${err.message}`, err.stack);
        await this.prisma.dianTestSet.update({
          where: { id: testSet.id },
          data: {
            status: DianTestSetStatus.FAILED,
            completedAt: new Date(),
            notes: `Error inesperado: ${err.message}`,
          },
        }).catch(() => undefined);
      });
    });

    return testSet;
  }

  // ── Check/refresh DIAN status for pending documents ──────────────────────────

  async checkStatuses(testSetId: string) {
    const testSet = await this.findOne(testSetId);

    const sentDocs = testSet.documents.filter(
      (d) => d.status === 'PENDING' || d.status === 'SENT',
    );

    // Check DIAN status for each pending document
    for (const doc of sentDocs) {
      try {
        if (doc.payrollId) {
          // Nómina document — use checkPayrollStatus
          const result = await this.payrollService.checkPayrollStatus(testSet.companyId, doc.payrollId);
          const recStatus  = (result as any)?.record?.status as string | undefined;
          const statusCode = (result as any)?.dian?.statusCode as string | undefined;
          const errors     = (result as any)?.dian?.errors as string[] | undefined;
          const statusMsg  = errors?.length
            ? errors.join(' | ')
            : ((result as any)?.dian?.statusDesc ?? (result as any)?.dian?.statusMsg);

          if (recStatus === 'ACCEPTED' || recStatus === 'REJECTED') {
            await (this.prisma as any).dianTestSetDocument.update({
              where: { id: doc.id },
              data: { status: recStatus, dianStatusCode: statusCode ?? null, dianStatusMsg: statusMsg ?? null },
            });
          }
        } else if (doc.invoiceId) {
          // Factura document — use queryDianStatus
          const invoice = await this.invoicesService.queryDianStatus(testSet.companyId, doc.invoiceId);
          let docStatus = doc.status;
          if ((invoice as any).status === 'ACCEPTED_DIAN') docStatus = 'ACCEPTED';
          else if ((invoice as any).status === 'REJECTED_DIAN') docStatus = 'REJECTED';

          if (docStatus !== doc.status) {
            await (this.prisma as any).dianTestSetDocument.update({
              where: { id: doc.id },
              data: {
                status: docStatus,
                dianStatusCode: (invoice as any).dianStatusCode ?? null,
                dianStatusMsg:  (invoice as any).dianStatusMsg  ?? null,
              },
            });
          }
        }
      } catch (err) {
        this.logger.warn(`checkStatuses: doc ${doc.id} – ${(err as any).message}`);
      }
    }

    // Recompute aggregate counts
    const allDocs   = await (this.prisma as any).dianTestSetDocument.findMany({ where: { testSetId } }) as any[];
    const accepted  = allDocs.filter((d: any) => d.status === 'ACCEPTED').length;
    const rejected  = allDocs.filter((d: any) => d.status === 'REJECTED').length;
    const errored   = allDocs.filter((d: any) => d.status === 'ERROR').length;
    const pending   = allDocs.filter((d: any) => d.status === 'PENDING' || d.status === 'SENT').length;
    const totalDocs = allDocs.length;

    // Determine new test-set status
    let newStatus: DianTestSetStatus = testSet.status as DianTestSetStatus;
    if (pending === 0 && testSet.status !== DianTestSetStatus.IN_PROGRESS) {
      if (accepted === totalDocs) {
        newStatus = DianTestSetStatus.COMPLETED;
      } else if (accepted > 0) {
        newStatus = DianTestSetStatus.PARTIAL;
      } else {
        newStatus = DianTestSetStatus.FAILED;
      }
    }

    await this.prisma.dianTestSet.update({
      where: { id: testSetId },
      data: {
        acceptedDocs: accepted,
        rejectedDocs: rejected,
        errorDocs:    errored,
        sentDocs:     totalDocs - pending,
        status:       newStatus,
        ...(pending === 0 && !testSet.completedAt ? { completedAt: new Date() } : {}),
      },
    });

    return this.findOne(testSetId);
  }

  // ── Cancel / delete a test set ────────────────────────────────────────────────

  async cancel(testSetId: string) {
    const testSet = await this.prisma.dianTestSet.findUnique({ where: { id: testSetId } });
    if (!testSet) throw new NotFoundException(`Test set ${testSetId} no encontrado`);

    // Cascade deletes the documents as well (defined in schema)
    await this.prisma.dianTestSet.delete({ where: { id: testSetId } });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Execute facturación test set in background
  // ════════════════════════════════════════════════════════════════════════════

  private async executeFacturacion(testSetId: string, companyId: string): Promise<void> {
    // 1. Mark as IN_PROGRESS
    await this.prisma.dianTestSet.update({
      where: { id: testSetId },
      data: { status: DianTestSetStatus.IN_PROGRESS, startedAt: new Date() },
    });

    // 2. Ensure test customer exists
    const customerId = await this.ensureTestCustomer(companyId);

    // 3. Ensure test product exists
    const productId = await this.ensureTestProduct(companyId);

    // Retrieve document slots
    const docs: any[] = await (this.prisma as any).dianTestSetDocument.findMany({
      where: { testSetId },
      orderBy: { sequence: 'asc' },
    });

    let sentDocs = 0;
    let acceptedDocs = 0;
    let rejectedDocs = 0;
    let errorDocs = 0;

    const facturaIds: string[] = [];

    // ── 4. Send 30 FACTURA docs (sequences 1-30) ─────────────────────────────
    const facturaDocs = docs.filter((d) => d.docType === 'FACTURA');
    for (const doc of facturaDocs) {
      try {
        const invoice = await this.invoicesService.create(companyId,null , {
          customerId,
          type: 'VENTA' as any,
          prefix: 'SETP',
          issueDate: new Date().toISOString().split('T')[0],
          items: [
            {
              productId,
              description: `Producto Test DIAN - ítem ${doc.sequence}`,
              quantity: 1,
              unitPrice: 100000,
              taxRate: 19,
            },
          ],
          notes: `Documento de prueba DIAN - set ${testSetId} - sec ${doc.sequence}`,
        });

        facturaIds.push(invoice.id);

        let dianZipKey: string | undefined;
        let dianStatusCode: string | undefined;
        let dianStatusMsg: string | undefined;
        let docStatus = 'SENT';

        try {
          const dianResult = await this.invoicesService.sendToDian(companyId, invoice.id);
          dianZipKey = (dianResult as any)?.dianZipKey ?? undefined;
          dianStatusCode = (dianResult as any)?.dianStatusCode ?? undefined;
          dianStatusMsg = (dianResult as any)?.dianStatusMsg ?? undefined;
          docStatus = dianStatusCode === '00' ? 'ACCEPTED' : 'SENT';
          if (docStatus === 'ACCEPTED') acceptedDocs++;
          else sentDocs++;
        } catch (dianErr) {
          this.logger.warn(`DIAN send error (factura seq ${doc.sequence}): ${dianErr.message}`);
          docStatus = 'ERROR';
          dianStatusMsg = dianErr.message;
          errorDocs++;
        }

        sentDocs++;
        await (this.prisma as any).dianTestSetDocument.update({
          where: { id: doc.id },
          data: {
            invoiceId: invoice.id,
            status: docStatus,
            dianZipKey,
            dianStatusCode,
            dianStatusMsg,
            sentAt: new Date(),
          },
        });
        await this.prisma.dianTestSet.update({
          where: { id: testSetId },
          data: { sentDocs, acceptedDocs, rejectedDocs, errorDocs },
        });
      } catch (err) {
        this.logger.error(`Error creando factura de prueba seq ${doc.sequence}: ${err.message}`);
        errorDocs++;
        await (this.prisma as any).dianTestSetDocument.update({
          where: { id: doc.id },
          data: { status: 'ERROR', errorMsg: err.message },
        });
        await this.prisma.dianTestSet.update({
          where: { id: testSetId },
          data: { errorDocs },
        });
      }

      await this.sleep(500);
    }

    // ── 5. Send 10 NOTA_DEBITO docs (sequences 31-40, referencing facturas 1-10) ─
    const notaDebitoDocs = docs.filter((d:any) => d.docType === 'NOTA_DEBITO');
    for (let i = 0; i < notaDebitoDocs.length; i++) {
      const doc = notaDebitoDocs[i];
      const originalInvoiceId = facturaIds[i] ?? facturaIds[0]; // safe fallback

      if (!originalInvoiceId) {
        errorDocs++;
        await (this.prisma as any).dianTestSetDocument.update({
          where: { id: doc.id },
          data: { status: 'ERROR', errorMsg: 'No hay factura original disponible para nota débito' },
        });
        continue;
      }

      try {
        const nota = await this.invoicesService.create(companyId,null, {
          customerId,
          type: 'NOTA_DEBITO' as any,
          prefix: 'SETP',
          issueDate: new Date().toISOString().split('T')[0],
          originalInvoiceId,
          discrepancyReasonCode: '1',
          discrepancyReason: 'Ajuste por prueba DIAN',
          items: [
            {
              productId,
              description: `Cargo adicional Test DIAN - ítem ${doc.sequence}`,
              quantity: 1,
              unitPrice: 10000,
              taxRate: 19,
            },
          ],
          notes: `Nota Débito de prueba DIAN - set ${testSetId} - sec ${doc.sequence}`,
        });

        let dianZipKey: string | undefined;
        let dianStatusCode: string | undefined;
        let dianStatusMsg: string | undefined;
        let docStatus = 'SENT';

        try {
          const dianResult = await this.invoicesService.sendToDian(companyId, nota.id);
          dianZipKey = (dianResult as any)?.dianZipKey ?? undefined;
          dianStatusCode = (dianResult as any)?.dianStatusCode ?? undefined;
          dianStatusMsg = (dianResult as any)?.dianStatusMsg ?? undefined;
          docStatus = dianStatusCode === '00' ? 'ACCEPTED' : 'SENT';
          if (docStatus === 'ACCEPTED') acceptedDocs++;
          else sentDocs++;
        } catch (dianErr) {
          this.logger.warn(`DIAN send error (nota débito seq ${doc.sequence}): ${dianErr.message}`);
          docStatus = 'ERROR';
          dianStatusMsg = dianErr.message;
          errorDocs++;
        }

        sentDocs++;
        await (this.prisma as any).dianTestSetDocument.update({
          where: { id: doc.id },
          data: {
            invoiceId: nota.id,
            status: docStatus,
            dianZipKey,
            dianStatusCode,
            dianStatusMsg,
            sentAt: new Date(),
          },
        });
        await this.prisma.dianTestSet.update({
          where: { id: testSetId },
          data: { sentDocs, acceptedDocs, rejectedDocs, errorDocs },
        });
      } catch (err) {
        this.logger.error(`Error creando nota débito seq ${doc.sequence}: ${err.message}`);
        errorDocs++;
        await (this.prisma as any).dianTestSetDocument.update({
          where: { id: doc.id },
          data: { status: 'ERROR', errorMsg: err.message },
        });
        await this.prisma.dianTestSet.update({
          where: { id: testSetId },
          data: { errorDocs },
        });
      }

      await this.sleep(500);
    }

    // ── 6. Send 10 NOTA_CREDITO docs (sequences 41-50, referencing facturas 11-20) ─
    const notaCreditoDocs = docs.filter((d:any) => d.docType === 'NOTA_CREDITO');
    for (let i = 0; i < notaCreditoDocs.length; i++) {
      const doc = notaCreditoDocs[i];
      // Reference facturas 11-20 (indices 10-19)
      const originalInvoiceId = facturaIds[i + 10] ?? facturaIds[0];

      if (!originalInvoiceId) {
        errorDocs++;
        await (this.prisma as any).dianTestSetDocument.update({
          where: { id: doc.id },
          data: { status: 'ERROR', errorMsg: 'No hay factura original disponible para nota crédito' },
        });
        continue;
      }

      try {
        const nota = await this.invoicesService.create(companyId,null, {
          customerId,
          type: 'NOTA_CREDITO' as any,
          prefix: 'SETP',
          issueDate: new Date().toISOString().split('T')[0],
          originalInvoiceId,
          discrepancyReasonCode: '1',
          discrepancyReason: 'Devolución parcial por prueba DIAN',
          items: [
            {
              productId,
              description: `Devolución Test DIAN - ítem ${doc.sequence}`,
              quantity: 1,
              unitPrice: 10000,
              taxRate: 19,
            },
          ],
          notes: `Nota Crédito de prueba DIAN - set ${testSetId} - sec ${doc.sequence}`,
        });

        let dianZipKey: string | undefined;
        let dianStatusCode: string | undefined;
        let dianStatusMsg: string | undefined;
        let docStatus = 'SENT';

        try {
          const dianResult = await this.invoicesService.sendToDian(companyId, nota.id);
          dianZipKey = (dianResult as any)?.dianZipKey ?? undefined;
          dianStatusCode = (dianResult as any)?.dianStatusCode ?? undefined;
          dianStatusMsg = (dianResult as any)?.dianStatusMsg ?? undefined;
          docStatus = dianStatusCode === '00' ? 'ACCEPTED' : 'SENT';
          if (docStatus === 'ACCEPTED') acceptedDocs++;
          else sentDocs++;
        } catch (dianErr) {
          this.logger.warn(`DIAN send error (nota crédito seq ${doc.sequence}): ${dianErr.message}`);
          docStatus = 'ERROR';
          dianStatusMsg = dianErr.message;
          errorDocs++;
        }

        sentDocs++;
        await (this.prisma as any).dianTestSetDocument.update({
          where: { id: doc.id },
          data: {
            invoiceId: nota.id,
            status: docStatus,
            dianZipKey,
            dianStatusCode,
            dianStatusMsg,
            sentAt: new Date(),
          },
        });
        await this.prisma.dianTestSet.update({
          where: { id: testSetId },
          data: { sentDocs, acceptedDocs, rejectedDocs, errorDocs },
        });
      } catch (err) {
        this.logger.error(`Error creando nota crédito seq ${doc.sequence}: ${err.message}`);
        errorDocs++;
        await (this.prisma as any).dianTestSetDocument.update({
          where: { id: doc.id },
          data: { status: 'ERROR', errorMsg: err.message },
        });
        await this.prisma.dianTestSet.update({
          where: { id: testSetId },
          data: { errorDocs },
        });
      }

      await this.sleep(500);
    }

    // ── 7. Compute final status ──────────────────────────────────────────────
    const finalStatus = this.computeFinalStatus(acceptedDocs, rejectedDocs, errorDocs, 50);
    await this.prisma.dianTestSet.update({
      where: { id: testSetId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
        sentDocs,
        acceptedDocs,
        rejectedDocs,
        errorDocs,
      },
    });

    this.logger.log(
      `Facturación test set ${testSetId} completed: ${acceptedDocs} accepted, ` +
      `${rejectedDocs} rejected, ${errorDocs} errors. Status: ${finalStatus}`,
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Execute nómina test set in background
  // ════════════════════════════════════════════════════════════════════════════

  private async executeNomina(testSetId: string, companyId: string): Promise<void> {
    // 1. Mark as IN_PROGRESS
    await this.prisma.dianTestSet.update({
      where: { id: testSetId },
      data: { status: DianTestSetStatus.IN_PROGRESS, startedAt: new Date() },
    });

    // 2. Resolve a real userId for audit logs
    const systemUserId = await this.resolveSystemUserId(companyId);

    // 3. Ensure test employee exists
    const employeeId = await this.ensureTestEmployee(companyId);

    // Retrieve document slots
    const docs: any[] = await (this.prisma as any).dianTestSetDocument.findMany({
      where: { testSetId },
      orderBy: { sequence: 'asc' },
    });

    let sentDocs = 0;
    let acceptedDocs = 0;
    let rejectedDocs = 0;
    let errorDocs = 0;

    const nieDocs = docs.filter((d) => d.docType === 'NOMINA_ELECTRONICA');
    const nieIds: string[] = [];

    // Find available periods to avoid "Ya existe una NIE" conflicts on re-runs
    const availablePeriods = await this.findAvailableNiePeriods(companyId, employeeId, nieDocs.length);

    // ── 3. Send 10 NOMINA_ELECTRONICA docs ─────────────────────────────────
    for (let i = 0; i < nieDocs.length; i++) {
      const doc = nieDocs[i];
      const period = availablePeriods[i] ?? `2099-${String(i + 1).padStart(2, '0')}`;
      const [py, pm] = period.split('-');
      const lastDay = new Date(Number(py), Number(pm), 0).getDate();
      const payDate = `${period}-${String(lastDay).padStart(2, '0')}`;

      try {
        const payroll = await this.payrollService.createPayroll(
          companyId,
          {
            employeeId,
            period,
            payDate,
            baseSalary: 1300000,
            daysWorked: 30,
            overtimeHours: 0,
            bonuses: 0,
            commissions: 0,
            transportAllowance: 162000,
            vacationPay: 0,
            sickLeave: 0,
            loans: 0,
            otherDeductions: 0,
            notes: `Nómina de prueba DIAN - set ${testSetId} - sec ${doc.sequence}`,
          },
          systemUserId,
        );

        nieIds.push(payroll.id);

        let dianZipKey: string | undefined;
        let dianStatusCode: string | undefined;
        let dianStatusMsg: string | undefined;
        let docStatus = 'SENT';

        try {
          // submitPayroll returns { record, dian: { zipKey, success, errors, ... } }
          const submitResult = await this.payrollService.submitPayroll(companyId, payroll.id, systemUserId);
          dianZipKey = (submitResult as any)?.dian?.zipKey ?? undefined;

          // Poll DIAN until ACCEPTED/REJECTED — NIE is async (status=SUBMITTED) until GetStatusZip confirms
          // 10 retries × 4s = 40s max (DIAN can be slow on test environments)
          const polled = await this.pollPayrollStatus(companyId, payroll.id, 10, 4000);
          dianStatusCode = polled.dianStatusCode;
          dianStatusMsg  = polled.dianStatusMsg;

          if (polled.status === 'ACCEPTED') {
            docStatus = 'ACCEPTED';
            acceptedDocs++;
          } else if (polled.status === 'REJECTED') {
            docStatus = 'REJECTED';
            rejectedDocs++;
          } else {
            docStatus = 'SENT'; // still pending after max retries
            sentDocs++;
          }
        } catch (dianErr) {
          this.logger.warn(`DIAN submit error (NIE seq ${doc.sequence}): ${(dianErr as any).message}`);
          docStatus = 'ERROR';
          dianStatusMsg = (dianErr as any).message;
          errorDocs++;
        }

        await (this.prisma as any).dianTestSetDocument.update({
          where: { id: doc.id },
          data: {
            payrollId: payroll.id,
            status: docStatus,
            dianZipKey,
            dianStatusCode,
            dianStatusMsg,
            sentAt: new Date(),
          },
        });
        await this.prisma.dianTestSet.update({
          where: { id: testSetId },
          data: { sentDocs, acceptedDocs, rejectedDocs, errorDocs },
        });
      } catch (err) {
        this.logger.error(`Error creando NIE seq ${doc.sequence}: ${err.message}`);
        nieIds.push(''); // placeholder to keep index alignment
        errorDocs++;
        await (this.prisma as any).dianTestSetDocument.update({
          where: { id: doc.id },
          data: { status: 'ERROR', errorMsg: err.message },
        });
        await this.prisma.dianTestSet.update({
          where: { id: testSetId },
          data: { errorDocs },
        });
      }

      await this.sleep(500);
    }

    // ── 4. Send 10 NOMINA_AJUSTE docs (referencing NIE docs 1-10) ─────────
    const niaeDocs = docs.filter((d) => d.docType === 'NOMINA_AJUSTE');
    for (let i = 0; i < niaeDocs.length; i++) {
      const doc = niaeDocs[i];
      const originalNieId = nieIds[i] ?? '';

      if (!originalNieId) {
        errorDocs++;
        await (this.prisma as any).dianTestSetDocument.update({
          where: { id: doc.id },
          data: { status: 'ERROR', errorMsg: 'No hay NIE disponible para crear Nota de Ajuste' },
        });
        await this.prisma.dianTestSet.update({
          where: { id: testSetId },
          data: { errorDocs },
        });
        continue;
      }

      try {
        // Check the NIE is ACCEPTED before creating the NIAE
        const nie = await this.prisma.payroll_records.findUnique({ where: { id: originalNieId } });
        if (!nie || nie.status !== 'ACCEPTED') {
          throw new Error(
            `NIE ${originalNieId} no está en estado ACCEPTED (actual: ${nie?.status ?? 'no encontrado'})`,
          );
        }

        const month = String(i + 1).padStart(2, '0');
        const payDate = `2024-${month}-30`;

        const niaeResult = await this.payrollService.createNotaAjuste(
          companyId,
          originalNieId,
          {
            tipoAjuste: 'Reemplazar',
            payDate,
            baseSalary: 1300000,
            daysWorked: 30,
            overtimeHours: 0,
            bonuses: 0, // NIAE XSD no permite Bonificaciones — usar 0 para evitar ZB01
            commissions: 0,
            transportAllowance: 162000,
            vacationPay: 0,
            sickLeave: 0,
            loans: 0,
            otherDeductions: 0,
            notes: `NIAE de prueba DIAN - set ${testSetId} - sec ${doc.sequence}`,
          },
          systemUserId,
        );

        // createNotaAjuste returns { nota, predecessor, originalNie, message }
        const niaeId: string = (niaeResult as any).nota.id;

        let dianZipKey: string | undefined;
        let dianStatusCode: string | undefined;
        let dianStatusMsg: string | undefined;
        let docStatus = 'SENT';

        try {
          const submitResult = await this.payrollService.submitPayroll(companyId, niaeId, systemUserId);
          dianZipKey = (submitResult as any)?.dian?.zipKey ?? undefined;

          const polled = await this.pollPayrollStatus(companyId, niaeId, 10, 4000);
          dianStatusCode = polled.dianStatusCode;
          dianStatusMsg  = polled.dianStatusMsg;

          if (polled.status === 'ACCEPTED') {
            docStatus = 'ACCEPTED';
            acceptedDocs++;
          } else if (polled.status === 'REJECTED') {
            docStatus = 'REJECTED';
            rejectedDocs++;
          } else {
            docStatus = 'SENT';
            sentDocs++;
          }
        } catch (dianErr) {
          this.logger.warn(`DIAN submit error (NIAE seq ${doc.sequence}): ${(dianErr as any).message}`);
          docStatus = 'ERROR';
          dianStatusMsg = (dianErr as any).message;
          errorDocs++;
        }

        await (this.prisma as any).dianTestSetDocument.update({
          where: { id: doc.id },
          data: {
            payrollId: niaeId,
            status: docStatus,
            dianZipKey,
            dianStatusCode,
            dianStatusMsg,
            sentAt: new Date(),
          },
        });
        await this.prisma.dianTestSet.update({
          where: { id: testSetId },
          data: { sentDocs, acceptedDocs, rejectedDocs, errorDocs },
        });
      } catch (err) {
        this.logger.error(`Error creando NIAE seq ${doc.sequence}: ${err.message}`);
        errorDocs++;
        await (this.prisma as any).dianTestSetDocument.update({
          where: { id: doc.id },
          data: { status: 'ERROR', errorMsg: err.message },
        });
        await this.prisma.dianTestSet.update({
          where: { id: testSetId },
          data: { errorDocs },
        });
      }

      await this.sleep(500);
    }

    // ── 5. Compute final status ──────────────────────────────────────────────
    const finalStatus = this.computeFinalStatus(acceptedDocs, rejectedDocs, errorDocs, 20);
    await this.prisma.dianTestSet.update({
      where: { id: testSetId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
        sentDocs,
        acceptedDocs,
        rejectedDocs,
        errorDocs,
      },
    });

    this.logger.log(
      `Nómina test set ${testSetId} completed: ${acceptedDocs} accepted, ` +
      `${rejectedDocs} rejected, ${errorDocs} errors. Status: ${finalStatus}`,
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Polls checkPayrollStatus until status is ACCEPTED/REJECTED or maxRetries is exhausted.
   * Returns the final { status, dianStatusCode, dianStatusMsg }.
   */
  private async pollPayrollStatus(
    companyId: string,
    payrollId: string,
    maxRetries: number,
    delayMs: number,
  ): Promise<{ status: string; dianStatusCode?: string; dianStatusMsg?: string }> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await this.sleep(delayMs);
      try {
        const result = await this.payrollService.checkPayrollStatus(companyId, payrollId);
        const status     = (result as any)?.record?.status as string | undefined;
        const statusCode = (result as any)?.dian?.statusCode as string | undefined;
        const errors     = (result as any)?.dian?.errors as string[] | undefined;

        // Build human-readable message: prefer errors array, fall back to status desc
        const statusMsg = errors?.length
          ? errors.join(' | ')
          : ((result as any)?.dian?.statusDesc ?? (result as any)?.dian?.statusMsg);

        // Any terminal state: ACCEPTED, REJECTED, or any non-empty statusCode with isValid=false
        // DIAN codes: '00'=accepted, '99'=validation errors, '2'=test-set rejected, '66'=not found
        if (status === 'ACCEPTED' || status === 'REJECTED') {
          return { status, dianStatusCode: statusCode, dianStatusMsg: statusMsg };
        }
        // statusCode set but document not valid → treat as REJECTED (terminal)
        // Exclude code '0' (one zero) = "en proceso" / in-progress — NOT a terminal state
        // Terminal rejection codes: '99' (validation errors), '2' (test-set rejected), '66' (not found)
        const TERMINAL_REJECTION_CODES = ['99', '2', '66'];
        if (statusCode && TERMINAL_REJECTION_CODES.includes(statusCode) && (result as any)?.dian?.isValid === false) {
          return { status: 'REJECTED', dianStatusCode: statusCode, dianStatusMsg: statusMsg };
        }
      } catch (err) {
        this.logger.warn(`pollPayrollStatus attempt ${attempt + 1} for ${payrollId}: ${(err as any).message}`);
      }
    }
    // Timeout: read current DB state
    const record = await this.prisma.payroll_records.findUnique({
      where: { id: payrollId },
      select: { status: true, dianStatusCode: true, dianStatusMsg: true },
    });
    return {
      status:         (record as any)?.status         ?? 'SUBMITTED',
      dianStatusCode: (record as any)?.dianStatusCode ?? undefined,
      dianStatusMsg:  (record as any)?.dianStatusMsg  ?? undefined,
    };
  }

  /**
   * Returns `count` period strings (YYYY-MM) that do NOT yet have a NOMINA_ELECTRONICA
   * for this employee, scanning forward from 2010-01.
   * This avoids "Ya existe una NIE" conflicts when re-running the test set.
   */
  private async findAvailableNiePeriods(
    companyId: string,
    employeeId: string,
    count: number,
  ): Promise<string[]> {
    const periods: string[] = [];
    let year = 2010;
    let month = 1;

    while (periods.length < count) {
      const period = `${year}-${String(month).padStart(2, '0')}`;
      const existing = await this.prisma.payroll_records.findFirst({
        where: { companyId, employeeId, period, payrollType: 'NOMINA_ELECTRONICA' },
        select: { id: true },
      });
      if (!existing) periods.push(period);

      month++;
      if (month > 12) { month = 1; year++; }
      if (year > 2099) break; // safety net
    }

    return periods;
  }

  /** Returns a real userId for audit log purposes — first active user in the company */
  private async resolveSystemUserId(companyId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { companyId, isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) throw new Error(`No hay usuarios activos en la empresa ${companyId}`);
    return user.id;
  }

  private async assertCompanyExists(companyId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException(`Empresa ${companyId} no encontrada`);
  }

  private async assertNoInProgress(companyId: string, type: DianTestSetType): Promise<void> {
    const existing = await this.prisma.dianTestSet.findFirst({
      where: { companyId, type, status: DianTestSetStatus.IN_PROGRESS },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe un test set de ${type} en progreso para esta empresa (id: ${existing.id})`,
      );
    }
  }

  /** Get or create a test customer for DIAN test sets */
  private async ensureTestCustomer(companyId: string): Promise<string> {
    const existing = await this.prisma.customer.findFirst({
      where: { companyId, documentNumber: '900000001', deletedAt: null },
    });
    if (existing) return existing.id;

    const created = await this.prisma.customer.create({
      data: {
        companyId,
        documentType: 'NIT',
        documentNumber: '900000001',
        name: 'CLIENTE TEST DIAN',
        email: 'test@dian.gov.co',
        address: 'Cra 8 Nro 6C - 38',
        city: 'Bogotá D.C.',
        cityCode: '11001',
        departmentCode: '11',
        country: 'CO',
        taxLevelCode: 'O-99',
      },
    });
    return created.id;
  }

  /** Get or create a test product for DIAN test sets */
  private async ensureTestProduct(companyId: string): Promise<string> {
    const existing = await this.prisma.product.findFirst({
      where: { companyId, sku: 'TEST-DIAN-001', deletedAt: null },
    });
    if (existing) return existing.id;

    const created = await this.prisma.product.create({
      data: {
        companyId,
        sku: 'TEST-DIAN-001',
        name: 'Producto Test DIAN',
        description: 'Producto creado automáticamente para el set de pruebas DIAN',
        price: 100000,
        cost: 0,
        stock: 9999,
        unit: 'UND',
        taxRate: 19,
        taxType: 'IVA',
        unspscCode: '01010101',
        status: 'ACTIVE',
      },
    });
    return created.id;
  }

  /** Get or create a test employee for DIAN nómina test sets */
  private async ensureTestEmployee(companyId: string): Promise<string> {
    const existing = await this.prisma.employees.findFirst({
      where: { companyId, documentNumber: '1234567890' },
    });
    if (existing) return existing.id;

    const created = await this.prisma.employees.create({
      data: {
        companyId,
        documentType: 'CC',
        documentNumber: '1234567890',
        firstName: 'Empleado',
        lastName: 'Test DIAN',
        email: 'empleado.test@dian.gov.co',
        position: 'Tester',
        baseSalary: 1300000,
        contractType: 'INDEFINITE',
        hireDate: new Date('2020-01-01'),
        city: 'Bogotá D.C.',
        cityCode: '11001',
        departmentCode: '11',
        country: 'CO',
        isActive: true,
      },
    });
    return created.id;
  }

  /** Compute the final DianTestSetStatus based on counters */
  private computeFinalStatus(
    accepted: number,
    rejected: number,
    errors: number,
    total: number,
  ): DianTestSetStatus {
    if (accepted === total) return DianTestSetStatus.COMPLETED;
    if (errors + rejected === total) return DianTestSetStatus.FAILED;
    if (accepted > 0) return DianTestSetStatus.PARTIAL;
    return DianTestSetStatus.FAILED;
  }

  /** Sleep helper for rate-limiting DIAN API calls */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
