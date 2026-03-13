import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { createHash, createSign, randomBytes } from 'crypto';
import * as archiver from 'archiver';
import * as https from 'https';
import * as http from 'http';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// DIAN Constants — BeccaFact Software propio
// ─────────────────────────────────────────────────────────────────────────────
const DIAN_SOFTWARE_ID = '8c2e43bd-9d57-4144-b0af-8876de5917a8';
const DIAN_SOFTWARE_PIN = '12345';
const DIAN_TEST_SET_ID = 'aa87ad48-5975-46d1-b0d5-f8ed563a528e';
const DIAN_WS_HAB = 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc';
const DIAN_WS_PROD = 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc';


// ─────────────────────────────────────────────────────────────────────────────
// Carga certificado DIAN desde archivo en disco (rutas configurables via .env)
// Variables: DIAN_CERT_PATH y DIAN_KEY_PATH  (relativas al CWD o absolutas)
// Si no existen los archivos, usa el certificado auto-firmado de fallback
// (solo válido para pruebas locales — la DIAN rechazará certs no acreditados)
// ─────────────────────────────────────────────────────────────────────────────
/** Elimina los "Bag Attributes" que genera openssl pkcs12 -nodes antes del bloque PEM */
function cleanPemStatic(raw: string, type: string): string {
  const marker = `-----BEGIN ${type}-----`;
  const idx = raw.indexOf(marker);
  return idx >= 0 ? raw.slice(idx).trim() : raw.trim();
}


// Technical key used during habilitación (test) — provided by DIAN in the numbering range
const DIAN_TECH_KEY_HAB = 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private prisma: PrismaService,
    private companiesService: CompaniesService,
  ) {
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EXISTING METHODS (unchanged)
  // ══════════════════════════════════════════════════════════════════════════

  async findAll(companyId: string, filters: {
    search?: string; status?: string; type?: string;
    from?: string; to?: string; customerId?: string;
    page?: number; limit?: number;
  }) {
    const { search, status, type, from, to, customerId, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;
    const where: any = { companyId, deletedAt: null };

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (status) where.status = status;
    if (type) where.type = type;
    if (customerId) where.customerId = customerId;
    if (from || to) {
      where.issueDate = {};
      if (from) where.issueDate.gte = new Date(from);
      if (to) where.issueDate.lte = new Date(to);
    }

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, documentNumber: true } },
          _count: { select: { items: true } },
        },
        orderBy: { issueDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(companyId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        customer: true,
        items: {
          include: { product: { select: { id: true, name: true, sku: true, unit: true, unspscCode: true } } },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    return invoice;
  }

  async create(companyId: string, dto: CreateInvoiceDto) {
    const canCreate = await this.companiesService.checkLimit(companyId, 'max_documents_per_month');
    if (!canCreate) throw new ForbiddenException('Has alcanzado el límite mensual de documentos. Actualiza tu plan.');

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, companyId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    // Pre-cargar productos para obtener unit y unspscCode (DIAN XML)
    const productIds = dto.items.map(i => i.productId).filter(Boolean) as string[];
    const products = productIds.length > 0
      ? await this.prisma.product.findMany({
        where: { id: { in: productIds }, companyId },
        select: { id: true, unit: true, sku: true },
      })
      : [];
    const productMap = new Map(products.map(p => [p.id, p]));

    let subtotal = 0;
    let taxAmount = 0;
    const itemsWithTotals = dto.items.map((item, index) => {
      const lineSubtotal = Number(item.quantity) * Number(item.unitPrice);
      const discount = lineSubtotal * (Number(item.discount ?? 0) / 100);
      const lineAfterDiscount = lineSubtotal - discount;
      const lineTax = lineAfterDiscount * (Number(item.taxRate ?? 19) / 100);
      const lineTotal = lineAfterDiscount + lineTax;
      subtotal += lineAfterDiscount;
      taxAmount += lineTax;
      // unit: usar el del producto si existe, luego el del DTO, default 'EA' (tabla 13.3.6 UNece)
      const prod = item.productId ? productMap.get(item.productId) : undefined;
      const unit = (item as any).unit || prod?.unit || 'EA';
      return {
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        taxRate: Number(item.taxRate ?? 19),
        taxAmount: lineTax,
        discount: Number(item.discount ?? 0),
        total: lineTotal,
        position: index + 1,

        ...(item.productId && {
          product: {
            connect: { id: item.productId }
          }
        })
      } as any;
    });

    const total = subtotal + taxAmount;
    const invoiceNumber = await this.getNextInvoiceNumber(companyId, dto.prefix ?? 'FV');

    const invoice = await this.prisma.invoice.create({
      data: {
        companyId,
        customerId: dto.customerId,
        invoiceNumber,
        prefix: dto.prefix ?? 'FV',
        type: dto.type ?? 'VENTA',
        status: 'DRAFT',
        issueDate: dto.issueDate ? new Date(dto.issueDate) : new Date(),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        subtotal,
        taxAmount,
        discountAmount: dto.discountAmount ?? 0,
        total,
        notes: dto.notes,
        currency: dto.currency ?? 'COP',
        items: { create: itemsWithTotals },
      },
      include: { customer: true, items: true },
    });

    await this.companiesService.incrementUsage(companyId, 'max_documents_per_month');
    return invoice;
  }

  async cancel(companyId: string, invoiceId: string, reason: string) {
    const invoice = await this.findOne(companyId, invoiceId);
    if (['CANCELLED', 'PAID'].includes(invoice.status)) throw new BadRequestException('Esta factura no puede cancelarse');
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'CANCELLED', notes: `${invoice.notes ?? ''}\n[CANCELADA]: ${reason}` },
    });
  }

  async markAsPaid(companyId: string, invoiceId: string) {
    const invoice = await this.findOne(companyId, invoiceId);
    if (invoice.status === 'PAID') throw new BadRequestException('La factura ya está pagada');
    return this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID' } });
  }

  async getSummary(companyId: string, from: string, to: string) {
    const where: any = { companyId, deletedAt: null, issueDate: { gte: new Date(from), lte: new Date(to) } };
    const [invoices, byStatus, byType] = await Promise.all([
      this.prisma.invoice.aggregate({ where, _sum: { total: true, taxAmount: true, subtotal: true }, _count: { id: true } }),
      this.prisma.invoice.groupBy({ by: ['status'], where, _count: { id: true }, _sum: { total: true } }),
      this.prisma.invoice.groupBy({ by: ['type'], where, _count: { id: true }, _sum: { total: true } }),
    ]);
    return {
      totals: { count: invoices._count.id, total: invoices._sum.total ?? 0, subtotal: invoices._sum.subtotal ?? 0, taxAmount: invoices._sum.taxAmount ?? 0 },
      byStatus,
      byType,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DIAN INTEGRATION — sendToDian (replaces the mock)
  // ══════════════════════════════════════════════════════════════════════════

  async sendToDian(companyId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      include: {
        customer: true,
        company: true,
        items: {
          include: { product: { select: { id: true, sku: true, unit: true, unspscCode: true } } },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.status !== 'DRAFT') throw new BadRequestException('Solo se pueden enviar facturas en estado DRAFT');

    const inv = invoice as any;
    const company = inv.company;
    const customer = inv.customer;
    const items = inv.items;

    // ── Determine environment ─────────────────────────────────────────────
    const isTestMode = company.dianTestMode !== false;
    const softwareId = company.dianSoftwareId || DIAN_SOFTWARE_ID;
    const softwarePin = company.dianSoftwarePin || DIAN_SOFTWARE_PIN;
    const testSetId = company.dianTestSetId || DIAN_TEST_SET_ID;
    const claveTecnica = company.dianClaveTecnica || DIAN_TECH_KEY_HAB;

    // ── Full invoice number for DIAN ──────────────────────────────────────
    // En HABILITACIÓN la DIAN exige prefijo SETP y numeración 990000001-995000000
    // En PRODUCCIÓN se usa el prefijo y número real de la factura
    const dbPrefix = invoice.prefix || 'FV';
    const rawNum = invoice.invoiceNumber || '0001';

    let prefix: string;
    let numericPart: string;

    if (isTestMode) {
      // Ambiente habilitación: prefijo SETP, número en rango 990000001+
      prefix = company.dianPrefijo || 'SETP';
      // Extraer solo dígitos del invoiceNumber
      const digits = rawNum.replace(/\D/g, '') || '1';
      // Mapear al rango 990000000: 990000000 + número de factura
      const rangeBase = Number(company.dianRangoDesde || 990000000);
      numericPart = String(rangeBase + parseInt(digits, 10));
    } else {
      // Producción: prefijo y número reales
      prefix = dbPrefix;
      numericPart = rawNum.replace(new RegExp(`^${dbPrefix}-?`), '').replace(/^0+/, '') || rawNum.replace(/\D/g, '') || '1';
    }

    const fullNumber = `${prefix}${numericPart}`;

    // ── Dates with Bogotá offset ──────────────────────────────────────────
    // FAD09e/ZE02: SigningTime DEBE ser idéntico a IssueDate+IssueTime del XML.
    //
    // Problema raíz: cuando se crea una factura con solo fecha ("2026-03-12"),
    // Prisma guarda 2026-03-12T00:00:00.000Z (medianoche UTC).
    // toColombiaDate(medianoche UTC) = 2026-03-11 (¡un día antes! UTC-5)
    // toColombiaTime(medianoche UTC) = "19:00:00-05:00"
    // Pero la firma ocurre con new Date() real → SigningTime distinto → FAD09e.
    //
    // Solución:
    // 1. issueDate: se lee de la BD como string ISO y se trunca a YYYY-MM-DD
    //    SIN restar offset (la fecha del documento es un dato de negocio, no timestamp).
    // 2. issueTime: se usa new Date() en el momento del envío a DIAN.
    //    La firma usará exactamente este mismo valor → IssueTime == SigningTime.
    const nowForIssue = new Date();  // momento exacto de generación/envío
    // Extraer fecha del documento directamente del string ISO sin ajuste de zona
    // invoice.issueDate puede ser Date o string "2026-03-12" / "2026-03-12T00:00:00.000Z"
    const issueDateRaw = invoice.issueDate instanceof Date
      ? invoice.issueDate.toISOString()
      : String(invoice.issueDate);
    const issueDate = issueDateRaw.substring(0, 10);         // "2026-03-12" siempre correcto
    const issueTime = this.toColombiaTime(nowForIssue);       // hora actual Colombia == SigningTime

    // ── Tax breakdown ─────────────────────────────────────────────────────
    const taxIva = Number(invoice.taxAmount);   // code 01 IVA
    const taxInc = 0;                           // code 04 INC (not used here)
    const taxIca = 0;                           // code 03 ICA (not used here)
    const subtotal = Number(invoice.subtotal);
    const total = Number(invoice.total);

    // ── Company DV (antes del CUFE para usar supplierNitClean) ────────────
    // company.nit puede venir como "900987654" o "900987654-1" — solo usar los dígitos base
    const supplierNitClean = company.nit.replace(/[^0-9]/g, '').slice(0, 9); // 9 dígitos NIT Colombia
    const supplierDv = this.calcDv(supplierNitClean);

    // ── Customer ID type (DIAN codes) ────────────────────────────────────
    const idTypeMap: Record<string, string> = { NIT: '31', CC: '13', CE: '22', PASSPORT: '21', TI: '12' };
    const custIdType = idTypeMap[customer.documentType || 'CC'] || '13';
    // custId: quitar DV si viene como "900108281-1" o "900108281-1" — usar solo NIT base
    const custIdRaw = customer.documentNumber || customer.taxId || '222222222222';
    // Strip hyphen-and-digit suffix (DV) for NIT: "900108281-1" → "900108281"
    const custIdBase = custIdType === '31' ? custIdRaw.replace(/-\d$/, '').replace(/\D/g, '').slice(0, 9) : custIdRaw.replace(/-\d$/, '');
    const custId = custIdBase;
    // FAK24: DV obligatorio cuando schemeName=31. Calcular siempre desde el NIT limpio.
    const custDv = custIdType === '31' ? this.calcDv(custIdBase.replace(/[^0-9]/g, '').slice(0, 9)) : '';
    const nitCustomerClean = custIdBase.replace(/[^0-9]/g, '');

    // ── CUFE — SHA-384 per Anexo Técnico DIAN v1.9 §11.2 ─────────────────
    const { cufe, cufeInput } = this.calcCufeWithInput({
      invoiceNumber: fullNumber, issueDate, issueTime,
      subtotal, taxIva, taxInc, taxIca, total,
      nitSupplier: supplierNitClean,
      nitCustomer: nitCustomerClean,
      claveTecnica,
      tipoAmbiente: isTestMode ? '2' : '1',
    });

    // ── Software Security Code ────────────────────────────────────────────
    const ssc = this.calcSoftwareSecurityCode(softwareId, softwarePin, fullNumber);

    // ── Numbering range data ──────────────────────────────────────────────
    const resolucion = company.dianResolucion || '18760000001';
    const dianPrefix = company.dianPrefijo || prefix;
    const rangoDesde = String(company.dianRangoDesde || 1);
    const rangoHasta = String(company.dianRangoHasta || 5000000);
    // Fechas de la resolución: vienen de la DB como Date (ej. 2019-01-19T00:00:00Z).
    // toColombiaDate restaría 5h → 2019-01-18. Para fechas de autorización usamos
    // directamente el valor ISO sin corrección de zona (son fechas de calendario, no timestamps).
    const toDateOnly = (d: Date) => d.toISOString().split('T')[0];
    const fechaDesde = company.dianFechaDesde ? toDateOnly(new Date(company.dianFechaDesde)) : '2019-01-19';
    const fechaHasta = company.dianFechaHasta ? toDateOnly(new Date(company.dianFechaHasta)) : '2030-01-19';

    // ── Build UBL 2.1 XML ────────────────────────────────────────────────
    this.logger.log(`[DIAN] Generating XML for ${fullNumber} CUFE=${cufe.slice(0, 16)}…`);
    // ── CustomizationID: 05=bienes, 01=consumidor final ──────────────────
    // Consumidor final: doc != NIT (CC, TI, CE, etc. — no tiene RUT)
    const isConsumidorFinal = custIdType !== '31';
    const customizationId = isConsumidorFinal ? '01' : '05';

    // ── PaymentMeansCode desde invoice.paymentMethod ──────────────────────
    // 10=contado, 41=crédito, 42=transferencia, 48=tarj.crédito, 54=tarj.débito
    const paymentMeansCodeMap: Record<string, string> = {
      cash: '10', credit: '41', transfer: '42',
      credit_card: '48', debit_card: '54', check: '20',
    };
    const invoicePaymentMethod = (invoice as any).paymentMethod as string | undefined;
    const paymentMeansCode = paymentMeansCodeMap[invoicePaymentMethod ?? 'cash'] || '10';

    const xmlUnsigned = this.buildUblXml({
      fullNumber, prefix: dianPrefix, issueDate, issueTime,
      dueDate: invoice.dueDate ? this.toColombiaDate(new Date(invoice.dueDate)) : issueDate,
      profileExecutionId: isTestMode ? '2' : '1',
      currency: invoice.currency || 'COP',
      cufe, cufeInput, ssc, softwareId,
      resolucion, rangoDesde, rangoHasta, fechaDesde, fechaHasta,
      subtotal, taxIva, taxInc, taxIca, total,
      supplierNit: supplierNitClean, supplierDv,
      supplierName: company.razonSocial,
      supplierAddress: company.address || 'Sin dirección',
      supplierCity: company.city || 'Bogotá',
      supplierCityCode: (company as any).cityCode || '11001',
      supplierDepartment: company.department || 'Cundinamarca',
      supplierDeptCode: (company as any).departmentCode || '11',
      supplierCountry: company.country || 'CO',
      supplierPhone: company.phone || '0000000000',
      supplierEmail: company.email,
      custIdType, custDv,
      custId,
      custName: customer.name || 'Sin nombre',
      custAddress: customer.address || 'Sin dirección',
      custCity: customer.city || 'Bogotá',
      custCityCode: (customer as any).cityCode || '11001',
      custDepartment: (customer as any).department || 'Bogotá',
      custDeptCode: ((customer as any).departmentCode || '11').toString().replace(/^0+(?=\d{2})/, '') || '11',
      custCountry: customer.country || 'CO',
      custEmail: customer.email || 'cliente@example.com',
      custTaxLevelCode: (customer as any).taxLevelCode || null,
      customizationId,
      paymentMeansCode,
      items: items.map((it: any, idx: number) => ({
        lineId: idx + 1,
        description: it.description,
        quantity: Number(it.quantity),
        unit: it.unit || it.product?.unit || 'EA',
        unitPrice: Number(it.unitPrice),
        taxRate: Number(it.taxRate),
        taxAmount: Number(it.taxAmount),
        discount: Number(it.discount || 0),
        // lineTotal = precio neto SIN IVA (UBL LineExtensionAmount y TaxableAmount)
        // it.total en la BD incluye IVA → usar total - taxAmount para obtener el neto
        lineTotal: Number(it.total) - Number(it.taxAmount),
        sku: it.product?.sku || it.description?.substring(0, 20) || String(idx + 1),
        unspscCode: it.product?.unspscCode ?? (it as any).unspscCode ?? null,
      })),
    });
    const certPem = this.normalizePem(company.dianCertificate);
    const keyPem = this.normalizePem(company.dianCertificateKey);
    // ── Sign XML (XAdES-BES placeholder — real cert needed for production) ─
    // issueDate + issueTime del XML → usados en SigningTime (FAD09e)
    const issueDateTimeForSig = `${issueDate}T${issueTime.replace(/-05:00$/, '')}-05:00`;
    const xmlSigned = this.signXmlPlaceholder(xmlUnsigned, certPem, keyPem, issueDateTimeForSig);

    // ── Compress to ZIP → Base64 ──────────────────────────────────────────
    // Anexo Técnico §15: fileName = {NitOFE}{CUFE}.zip
    const xmlFileName = `${supplierNitClean}${fullNumber}.xml`;
    const zipFileName = `${supplierNitClean}${fullNumber}.zip`;
    this.logger.log(`[DIAN] Compressing ${xmlFileName} → ${zipFileName}`);
    const zipBuffer = await this.createZip(xmlFileName, xmlSigned);
    const zipBase64 = zipBuffer.toString('base64');

    // ── Save XML before network call ──────────────────────────────────────
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        dianCufe: cufe,
        dianStatus: 'PENDING',
        dianAttempts: { increment: 1 },
        xmlContent: xmlUnsigned,
        xmlSigned,
      } as any,
    });

    // ── Call DIAN WebService ──────────────────────────────────────────────
    // WS-Security X.509 Certificate Token Profile 1.1 (Anexo Técnico §7.5)

    this.logger.log(`[DIAN] Calling ${isTestMode ? 'SendTestSetAsync' : 'SendBillAsync'} → ${isTestMode ? DIAN_WS_HAB : DIAN_WS_PROD}`);

    let soapResult: DianSoapResult;
    try {
      if (isTestMode) {
        soapResult = await this.soapSendTestSetAsync({ zipFileName, zipBase64, testSetId, wsUrl: DIAN_WS_HAB, certPem, keyPem });
      } else {
        soapResult = await this.soapSendBillAsync({ zipFileName, zipBase64, wsUrl: DIAN_WS_PROD, certPem, keyPem });
      }
    } catch (err: any) {
      this.logger.error(`[DIAN] SOAP call failed: ${err.message}`);
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { dianStatus: 'ERROR', dianStatusMsg: err.message, dianErrors: null } as any,
      });
      throw new BadRequestException(`Error de comunicación con DIAN: ${err.message}`);
    }

    // ── Persist result ────────────────────────────────────────────────────
    const newStatus = soapResult.zipKey ? 'SENT_DIAN' : 'DRAFT';
    const sendErrors: string[] = soapResult.errorMessages ?? [];
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: newStatus,
        dianStatus: soapResult.zipKey ? 'SENT' : 'ERROR',
        dianZipKey: soapResult.zipKey || null,
        dianQrCode: cufe ? `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${cufe}` : null,
        dianSentAt: new Date(),
        dianStatusMsg: sendErrors.length > 0 ? sendErrors.join('; ') : null,
        dianErrors: sendErrors.length > 0 ? JSON.stringify(sendErrors) : null,
      } as any,
    });

    return {
      ...updated,
      dianResult: soapResult,
    };
  }

  // ── Query DIAN status by ZipKey ───────────────────────────────────────────
  async queryDianStatus(companyId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      include: { company: true },
    }) as any;
    if (!invoice) throw new NotFoundException('Factura no encontrada');

    const zipKey = invoice.dianZipKey;
    const cufe = invoice.dianCufe;
    if (!zipKey && !cufe) throw new BadRequestException('La factura no tiene un ZipKey o CUFE para consultar');

    const isTestMode = invoice.company?.dianTestMode !== false;
    const wsUrl = isTestMode ? DIAN_WS_HAB : DIAN_WS_PROD;
    const certPem = invoice.company?.dianCertificate;
    const keyPem = invoice.company?.dianCertificateKey;

    let result: DianStatusResult;
    if (zipKey) {
      result = await this.soapGetStatusZip({ trackId: zipKey, wsUrl, certPem, keyPem });
    } else {
      result = await this.soapGetStatus({ trackId: cufe!, wsUrl, certPem, keyPem });
    }

    // Map DIAN status to invoice status
    let newInvoiceStatus: string = invoice.status;
    // DIAN returns '0' or '00' for success (PDF §7.11.3 shows '0', §7.12.3 shows '00')
    if (result.isValid && (result.statusCode === '00' || result.statusCode === '0')) {
      newInvoiceStatus = 'ACCEPTED_DIAN';
    } else if (result.statusCode === '99') {
      newInvoiceStatus = 'REJECTED_DIAN';
    }

    const statusErrors: string[] = result.errorMessages ?? [];
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: newInvoiceStatus,
        dianStatus: result.statusCode,
        dianStatusCode: result.statusCode,
        dianStatusMsg: result.statusMessage || result.statusDescription || null,
        dianErrors: statusErrors.length > 0 ? JSON.stringify(statusErrors) : null,
        dianXmlBase64: result.xmlBase64 || null,
        dianResponseAt: new Date(),
      } as any,
    });
  }

  // ── Download signed XML ───────────────────────────────────────────────────
  async getXml(companyId: string, invoiceId: string): Promise<{ xml: string; filename: string }> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
    }) as any;
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (!invoice.xmlSigned) throw new BadRequestException('XML aún no generado para esta factura');
    return {
      xml: invoice.xmlSigned,
      filename: `${invoice.prefix}${invoice.invoiceNumber}.xml`,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DIAN SOAPUI HELPER — Genera payload listo para pruebas manuales
  // Endpoint: POST /v1/invoices/dian/soapui-payload
  // No requiere factura en BD. Datos hardcodeados para ambiente habilitación.
  // ══════════════════════════════════════════════════════════════════════════

  async buildSoapUiPayload(overrides?: {
    nitEmpresa?: string;
    nitCliente?: string;
    numFactura?: string;
    subtotal?: number;
    iva?: number;
    certPem?: string;
    keyPem?: string;
  }) {
    const o = overrides ?? {};

    // ── Datos de prueba hardcodeados (ambiente habilitación DIAN) ────────────
    const softwareId = DIAN_SOFTWARE_ID;
    const softwarePin = DIAN_SOFTWARE_PIN;
    const testSetId = DIAN_TEST_SET_ID;
    const claveTecnica = DIAN_TECH_KEY_HAB;

    // Empresa facturadora — usar el NIT registrado en el catálogo DIAN HAB
    const nitEmpresa = (o.nitEmpresa ?? '900987654').replace(/\D/g, '');
    const dvEmpresa = this.calcDv(nitEmpresa);

    // Cliente de prueba
    const nitCliente = (o.nitCliente ?? '900000001').replace(/\D/g, '');

    // Número de factura en rango habilitación (990000001 – 995000000)
    const numFactura = o.numFactura ?? 'SETP990000001';
    const prefix = numFactura.replace(/\d.*$/, '') || 'SETP';

    // Valores monetarios
    const subtotal = o.subtotal ?? 1000000;   // $1.000.000 COP
    const iva = o.iva ?? 190000;         // 19% IVA
    const total = subtotal + iva;

    // Fechas en horario Colombia (UTC-5)
    const now = new Date();
    const issueDate = this.toColombiaDate(now);
    const issueTime = this.toColombiaTime(now);
    const dueDate = issueDate;               // contado

    // ── Calcular CUFE ────────────────────────────────────────────────────────
    const { cufe, cufeInput } = this.calcCufeWithInput({
      invoiceNumber: numFactura,
      issueDate, issueTime,
      subtotal, taxIva: iva, taxInc: 0, taxIca: 0, total,
      nitSupplier: nitEmpresa,
      nitCustomer: nitCliente,
      claveTecnica,
      tipoAmbiente: '2',  // habilitación
    });

    // ── Calcular Software Security Code ─────────────────────────────────────
    const ssc = this.calcSoftwareSecurityCode(softwareId, softwarePin, numFactura);

    // ── Construir XML UBL 2.1 ────────────────────────────────────────────────
    const xmlUnsigned = this.buildUblXml({
      fullNumber: numFactura,
      prefix,
      issueDate, issueTime, dueDate,
      profileExecutionId: '2',          // habilitación
      currency: 'COP',
      cufe, cufeInput, ssc, softwareId,
      // Datos de resolución de prueba DIAN habilitación
      resolucion: '18760000001',
      rangoDesde: '990000000',
      rangoHasta: '995000000',
      fechaDesde: '2019-01-19',
      fechaHasta: '2030-01-19',
      // Empresa
      supplierNit: nitEmpresa,
      supplierDv: dvEmpresa,
      supplierName: 'EMPRESA DEMO BECCAFACT SAS',
      supplierAddress: 'Calle 100 No 10-20',
      supplierCity: 'Bogotá',
      supplierCityCode: '11001',
      supplierDepartment: 'Cundinamarca',
      supplierDeptCode: '11',
      supplierCountry: 'CO',
      supplierPhone: '6011234567',
      supplierEmail: 'facturacion@beccafact.co',
      // Cliente de prueba
      custIdType: '31',
      custDv: this.calcDv(nitCliente),
      custId: nitCliente,
      custName: 'CLIENTE PRUEBA SAS',
      custAddress: 'Carrera 7 No 32-00',
      custCity: 'Bogotá',
      custCityCode: '11001',
      custCountry: 'CO',
      custDepartment: 'Bogotá',
      custDeptCode: '11',
      custEmail: 'compras@clienteprueba.co',
      customizationId: '05',
      paymentMeansCode: '10',
      // Totales
      subtotal, taxIva: iva, taxInc: 0, taxIca: 0, total,
      // Una sola línea de detalle
      items: [{
        lineId: 1,
        description: 'Servicio de software BeccaFact (prueba habilitación)',
        quantity: 1,
        unit: 'EA',
        unitPrice: subtotal,
        taxRate: 19,
        taxAmount: iva,
        discount: 0,
        lineTotal: subtotal,
      }],
    });

    // ── Firmar XML ───────────────────────────────────────────────────────────
    const issueDateTimePreview = `${issueDate}T${issueTime.replace(/-05:00$/, '')}-05:00`;
    const xmlSigned = this.signXmlPlaceholder(
      xmlUnsigned,
      o.certPem ?? '',
      o.keyPem ?? '',
      issueDateTimePreview,
    );

    // ── Comprimir y codificar ────────────────────────────────────────────────
    const xmlFileName = `${nitEmpresa}${numFactura}.xml`;
    const zipFileName = `${nitEmpresa}${numFactura}.zip`;
    const zipBuffer = await this.createZip(xmlFileName, xmlSigned);
    const zipBase64 = zipBuffer.toString('base64');

    // ── Construir SOAP Envelope listo para SoapUI ────────────────────────────
    const actionUri = 'http://wcf.dian.colombia/IWcfDianCustomerServices/SendTestSetAsync';
    const wsUrl = DIAN_WS_HAB;
    const { randomBytes: rb, createHash: cH, createSign: cS } = require('crypto');

    // Timestamps WS-Security
    const tsNow = new Date();
    const created = tsNow.toISOString().replace(/\.\d{3}Z$/, '.000Z');
    const expires = new Date(tsNow.getTime() + 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
    const rnd = () => rb(8).toString('hex').toUpperCase();
    const tsId = `TS-${rnd()}`;
    const bstId = `X509-${rnd()}`;
    const sigId = `SIG-${rnd()}`;
    const kiId = `KI-${rnd()}`;
    const strId = `STR-${rnd()}`;
    const toId = `id-${rnd()}`;

    const effectiveCert = o.certPem ?? '';
    const effectiveKey = o.keyPem ?? '';
    const certBase64 = effectiveCert
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');

    // Namespaces
    const EXC_C14N_UI = 'http://www.w3.org/2001/10/xml-exc-c14n#';
    const WSU_NS_UI = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
    const WSSE_NS_UI = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
    const DS_NS_UI = 'http://www.w3.org/2000/09/xmldsig#';
    const WSA_NS_UI = 'http://www.w3.org/2005/08/addressing';

    // Digest de wsa:To con InclusiveNamespaces PrefixList="soap wcf"
    const toForDigest =
      `<wsa:To` +
      ` xmlns:soap="http://www.w3.org/2003/05/soap-envelope"` +
      ` xmlns:wsa="${WSA_NS_UI}"` +
      ` xmlns:wcf="http://wcf.dian.colombia"` +
      ` xmlns:wsu="${WSU_NS_UI}"` +
      ` wsu:Id="${toId}"` +
      `>${wsUrl}</wsa:To>`;
    const toDigestUI = cH('sha256').update(toForDigest, 'utf8').digest('base64');

    // SignedInfo con InclusiveNamespaces
    const siBody =
      `<ds:SignedInfo xmlns:ds="${DS_NS_UI}">` +
      `<ds:CanonicalizationMethod Algorithm="${EXC_C14N_UI}">` +
      `<ec:InclusiveNamespaces PrefixList="wsa soap wcf" xmlns:ec="${EXC_C14N_UI}"/>` +
      `</ds:CanonicalizationMethod>` +
      `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
      `<ds:Reference URI="#${toId}">` +
      `<ds:Transforms>` +
      `<ds:Transform Algorithm="${EXC_C14N_UI}">` +
      `<ec:InclusiveNamespaces PrefixList="soap wcf" xmlns:ec="${EXC_C14N_UI}"/>` +
      `</ds:Transform>` +
      `</ds:Transforms>` +
      `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
      `<ds:DigestValue>${toDigestUI}</ds:DigestValue>` +
      `</ds:Reference>` +
      `</ds:SignedInfo>`;
    const signerSoap = cS('RSA-SHA256');
    signerSoap.update(siBody, 'utf8');
    const sigValueSoap = signerSoap.sign(effectiveKey, 'base64');

    const soapEnvelope =
      '<soap:Envelope' +
      ' xmlns:soap="http://www.w3.org/2003/05/soap-envelope"' +
      ' xmlns:wcf="http://wcf.dian.colombia">' +
      `<soap:Header xmlns:wsa="${WSA_NS_UI}">` +
      `<wsse:Security xmlns:wsse="${WSSE_NS_UI}" xmlns:wsu="${WSU_NS_UI}">` +
      `<wsu:Timestamp wsu:Id="${tsId}">` +
      `<wsu:Created>${created}</wsu:Created>` +
      `<wsu:Expires>${expires}</wsu:Expires>` +
      `</wsu:Timestamp>` +
      `<wsse:BinarySecurityToken` +
      ` EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary"` +
      ` ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"` +
      ` wsu:Id="${bstId}"` +
      `>${certBase64}</wsse:BinarySecurityToken>` +
      `<ds:Signature Id="${sigId}" xmlns:ds="${DS_NS_UI}">` +
      siBody +
      `<ds:SignatureValue>${sigValueSoap}</ds:SignatureValue>` +
      `<ds:KeyInfo Id="${kiId}">` +
      `<wsse:SecurityTokenReference wsu:Id="${strId}">` +
      `<wsse:Reference URI="#${bstId}" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"/>` +
      `</wsse:SecurityTokenReference>` +
      `</ds:KeyInfo>` +
      `</ds:Signature>` +
      `</wsse:Security>` +
      `<wsa:Action>${actionUri}</wsa:Action>` +
      `<wsa:To wsu:Id="${toId}" xmlns:wsu="${WSU_NS_UI}">${wsUrl}</wsa:To>` +
      `</soap:Header>` +
      `<soap:Body>` +
      `<wcf:SendTestSetAsync>` +
      `<wcf:fileName>${zipFileName}</wcf:fileName>` +
      `<wcf:contentFile>${zipBase64}</wcf:contentFile>` +
      `<wcf:testSetId>${testSetId}</wcf:testSetId>` +
      `</wcf:SendTestSetAsync>` +
      `</soap:Body>` +
      `</soap:Envelope>`;

    return {
      // ── Instrucciones SoapUI ─────────────────────────────────────────────
      instrucciones: {
        paso1: 'Abre SoapUI y crea un proyecto SOAP nuevo',
        paso2: `URL del WSDL: ${wsUrl}?wsdl`,
        paso3: 'O crea una Raw Request y pega el soapEnvelope directamente',
        paso4: `Endpoint: ${wsUrl}`,
        paso5: `Content-Type header: application/soap+xml; charset=utf-8; action="${actionUri}"`,
        paso6: 'Envía la petición y espera la respuesta con b:ZipKey',
        nota: 'El certificado actual es auto-firmado (prueba local). Reemplaza con cert real de CA ONAC para que DIAN acepte la firma.',
      },
      // ── Datos del documento ──────────────────────────────────────────────
      documento: {
        numFactura,
        nitEmpresa,
        nitCliente,
        cufe,
        cufeInput,
        issueDate,
        issueTime,
        subtotal,
        iva,
        total,
        testSetId,
      },
      // ── Archivos generados ───────────────────────────────────────────────
      archivos: {
        xmlFileName,
        zipFileName,
        xmlSignedLength: xmlSigned.length,
        zipBase64Length: zipBase64.length,
        zipBase64Muestra: zipBase64.slice(0, 80) + '...',
      },
      // ── SOAP Envelope completo listo para pegar en SoapUI ────────────────
      soapEnvelope,
      // ── XML firmado (para inspección / validación externa) ───────────────
      xmlSigned,
      // ── Configuración SoapUI (headers) ───────────────────────────────────
      soapUiConfig: {
        endpoint: wsUrl,
        contentType: `application/soap+xml; charset=utf-8; action="${actionUri}"`,
        method: 'POST',
        wsdl: `${wsUrl}?wsdl`,
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUFE — Código Único Factura Electrónica (Anexo Técnico DIAN v1.9 §11.2)
  // SHA-384(NumFac+FecFac+HorFac+ValFac+CodImp1+ValImp1+CodImp2+ValImp2+CodImp3+ValImp3+ValTot+NitOFE+NumAdq+ClTec+TipoAmbiente)
  // ══════════════════════════════════════════════════════════════════════════

  // Retorna { cufe, cufeInput } — cufeInput va en cbc:Note del XML (Anexo §11.2 / Generica.xml)
  private calcCufeWithInput(p: {
    invoiceNumber: string; issueDate: string; issueTime: string;
    subtotal: number; taxIva: number; taxInc: number; taxIca: number; total: number;
    nitSupplier: string; nitCustomer: string; claveTecnica: string; tipoAmbiente: string;
  }): { cufe: string; cufeInput: string } {
    const f = (n: number) => n.toFixed(2);
    // Anexo §11.2 pág 656: NitOFE y NumAdq SIN puntos, SIN guiones, SIN dígito de verificación
    const nitOFE = p.nitSupplier.replace(/[^0-9]/g, '');
    const numAdq = p.nitCustomer.replace(/[^0-9]/g, '');
    const cufeInput =
      p.invoiceNumber + p.issueDate + p.issueTime +
      f(p.subtotal) +
      '01' + f(p.taxIva) +
      '04' + f(p.taxInc) +
      '03' + f(p.taxIca) +
      f(p.total) +
      nitOFE + numAdq + p.claveTecnica + p.tipoAmbiente;
    this.logger.debug(`[CUFE] input: ${cufeInput}`);
    const cufe = createHash('sha384').update(cufeInput, 'utf8').digest('hex');
    return { cufe, cufeInput };
  }

  // SHA-384(SoftwareID + Pin + NumFac)
  private calcSoftwareSecurityCode(softwareId: string, pin: string, invoiceNumber: string): string {
    return createHash('sha384').update(`${softwareId}${pin}${invoiceNumber}`, 'utf8').digest('hex');
  }

  // Dígito de verificación NIT
  calcDv(nit: string): string {
    const n = nit.replace(/\D/g, '');
    const f = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47];
    let sum = 0;
    [...n].reverse().forEach((d, i) => { if (i < f.length) sum += parseInt(d) * f[i]; });
    const r = sum % 11;
    return (r >= 2 ? 11 - r : r).toString();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // XML UBL 2.1 BUILDER — Anexo Técnico DIAN v1.9
  // ══════════════════════════════════════════════════════════════════════════

  private buildUblXml(d: {
    fullNumber: string; prefix: string; issueDate: string; issueTime: string;
    dueDate: string; profileExecutionId: string; currency: string;
    cufe: string; cufeInput: string; ssc: string; softwareId: string;
    resolucion: string; rangoDesde: string; rangoHasta: string; fechaDesde: string; fechaHasta: string;
    subtotal: number; taxIva: number; taxInc: number; taxIca: number; total: number;
    supplierNit: string; supplierDv: string; supplierName: string;
    supplierAddress: string; supplierCity: string; supplierCityCode: string;
    supplierDepartment: string; supplierDeptCode: string;
    supplierCountry: string; supplierPhone: string; supplierEmail: string;
    custIdType: string; custDv: string; custId: string;
    custName: string; custAddress: string; custCity: string; custCityCode: string; custDepartment: string; custDeptCode: string;
    custCountry: string; custEmail: string; custTaxLevelCode?: string | null;
    // Nuevos campos de control
    customizationId?: string;    // '01' consumidor final | '05' bienes | '09' servicios | '10' mandatos  default='05'
    paymentMeansCode?: string;   // '10' contado | '41' crédito | '42' transferencia | '48' tarj.crédito | '54' tarj.débito
    items: Array<{ lineId: number; description: string; quantity: number; unit: string; unitPrice: number; taxRate: number; taxAmount: number; discount: number; lineTotal: number; sku?: string; unspscCode?: string | null }>;
  }): string {
    const x = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const isHab = d.profileExecutionId === '2';

    // ── CustomizationID según tipo de operación ───────────────────────────
    // 01=consumidor final (sin NIT), 05=venta bienes, 09=servicios, 10=mandatos
    const customizationId = d.customizationId || '05';

    // ── PaymentMeansCode ──────────────────────────────────────────────────
    const paymentMeansCode = d.paymentMeansCode || '10';

    // ── Base imponible y TaxTotals agrupados por tasa (FAS01a/FAS01b) ──────
    // La DIAN exige que haya exactamente un TaxTotal de cabecera por cada código
    // de tributo presente en las líneas, con el mismo ID, Name y Percent.
    interface TaxGroup { taxId: string; taxName: string; percent: number; taxableAmt: number; taxAmt: number; }
    const taxGroupsMap = new Map<string, TaxGroup>();
    for (const it of d.items) {
      if (it.taxAmount > 0) {
        const key = `${String(it.taxRate)}`; // agrupar por tasa (% IVA)
        const existing = taxGroupsMap.get(key);
        if (existing) {
          existing.taxableAmt += it.lineTotal;
          existing.taxAmt += it.taxAmount;
        } else {
          taxGroupsMap.set(key, { taxId: '01', taxName: 'IVA', percent: it.taxRate, taxableAmt: it.lineTotal, taxAmt: it.taxAmount });
        }
      }
    }
    // Si no hay ningún grupo con IVA, crear un bloque 0.00 para cumplir estructura
    const taxGroups: TaxGroup[] = taxGroupsMap.size > 0
      ? Array.from(taxGroupsMap.values())
      : [{ taxId: '01', taxName: 'IVA', percent: 0, taxableAmt: 0, taxAmt: 0 }];
    const taxableBase = taxGroups.reduce((s, g) => s + g.taxableAmt, 0);

    // ── Items XML — con AllowanceCharge cuando hay descuento ──────────────
    const itemsXml = d.items.map(item => {
      // Precio bruto de la línea (antes de descuento)
      const grossLineTotal = item.discount > 0
        ? item.lineTotal + item.discount
        : item.lineTotal;
      const grossUnitPrice = item.discount > 0
        ? item.unitPrice + (item.discount / item.quantity)
        : item.unitPrice;

      // Bloque AllowanceCharge solo si hay descuento
      const allowanceBlock = item.discount > 0 ? `
      <cac:AllowanceCharge>
         <cbc:ID>1</cbc:ID>
         <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
         <cbc:AllowanceChargeReason>Descuento</cbc:AllowanceChargeReason>
         <cbc:MultiplierFactorNumeric>${((item.discount / grossLineTotal) * 100).toFixed(2)}</cbc:MultiplierFactorNumeric>
         <cbc:Amount currencyID="${d.currency}">${item.discount.toFixed(2)}</cbc:Amount>
         <cbc:BaseAmount currencyID="${d.currency}">${grossLineTotal.toFixed(2)}</cbc:BaseAmount>
      </cac:AllowanceCharge>` : '';

      // Bloque TaxTotal — solo cuando hay IVA
      const taxBlock = item.taxAmount > 0 ? `
      <cac:TaxTotal>
         <cbc:TaxAmount currencyID="${d.currency}">${item.taxAmount.toFixed(2)}</cbc:TaxAmount>
         <cbc:TaxEvidenceIndicator>false</cbc:TaxEvidenceIndicator>
         <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="${d.currency}">${item.lineTotal.toFixed(2)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="${d.currency}">${item.taxAmount.toFixed(2)}</cbc:TaxAmount>
            <cac:TaxCategory>
               <cbc:Percent>${item.taxRate.toFixed(2)}</cbc:Percent>
               <cac:TaxScheme>
                  <cbc:ID>01</cbc:ID>
                  <cbc:Name>IVA</cbc:Name>
               </cac:TaxScheme>
            </cac:TaxCategory>
         </cac:TaxSubtotal>
      </cac:TaxTotal>` : '';

      return `
   <cac:InvoiceLine>
      <cbc:ID>${item.lineId}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="${item.unit}">${item.quantity.toFixed(6)}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${d.currency}">${item.lineTotal.toFixed(2)}</cbc:LineExtensionAmount>
      <cbc:FreeOfChargeIndicator>false</cbc:FreeOfChargeIndicator>${allowanceBlock}${taxBlock}
      <cac:Item>
         <cbc:Description>${x(item.description)}</cbc:Description>
         <cac:SellersItemIdentification>
            <cbc:ID>${item.sku || String(item.lineId)}</cbc:ID>
         </cac:SellersItemIdentification>
         <cac:StandardItemIdentification>
            <cbc:ID schemeAgencyID="10" schemeID="${item.unspscCode ? '001' : '999'}" schemeName="${item.unspscCode ? 'UNSPSC' : 'Estandar de adopcion del contribuyente facturador'}">${item.unspscCode ?? (item.sku || String(item.lineId))}</cbc:ID>
         </cac:StandardItemIdentification>
      </cac:Item>
      <cac:Price>
         <cbc:PriceAmount currencyID="${d.currency}">${grossUnitPrice.toFixed(2)}</cbc:PriceAmount>
         <cbc:BaseQuantity unitCode="${item.unit}">${item.quantity.toFixed(6)}</cbc:BaseQuantity>
      </cac:Price>
   </cac:InvoiceLine>`;
    }).join('');

    // ── QRCode exactamente como el XML de ejemplo DIAN ────────────────────
    const qrCode = `NroFactura=${d.fullNumber}
NitFacturador=${d.supplierNit}
NitAdquiriente=${d.custId}
FechaFactura=${d.issueDate}
ValorTotalFactura=${d.total.toFixed(2)}
CUFE=${d.cufe}
URL=https://catalogo-vpfe${isHab ? '-hab' : ''}.dian.gov.co/Document/FindDocument?documentKey=${d.cufe}`;

    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2     http://docs.oasis-open.org/ubl/os-UBL-2.1/xsd/maindoc/UBL-Invoice-2.1.xsd">
   <ext:UBLExtensions>
      <ext:UBLExtension>
         <ext:ExtensionContent>
            <sts:DianExtensions>
               <sts:InvoiceControl>
                  <sts:InvoiceAuthorization>${d.resolucion}</sts:InvoiceAuthorization>
                  <sts:AuthorizationPeriod>
                     <cbc:StartDate>${d.fechaDesde}</cbc:StartDate>
                     <cbc:EndDate>${d.fechaHasta}</cbc:EndDate>
                  </sts:AuthorizationPeriod>
                  <sts:AuthorizedInvoices>
                     <sts:Prefix>${d.prefix}</sts:Prefix>
                     <sts:From>${d.rangoDesde}</sts:From>
                     <sts:To>${d.rangoHasta}</sts:To>
                  </sts:AuthorizedInvoices>
               </sts:InvoiceControl>
               <sts:InvoiceSource>
                  <cbc:IdentificationCode listAgencyID="6" listAgencyName="United Nations Economic Commission for Europe" listSchemeURI="urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1">CO</cbc:IdentificationCode>
               </sts:InvoiceSource>
               <sts:SoftwareProvider>
                  <sts:ProviderID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="${d.supplierDv}" schemeName="31">${d.supplierNit}</sts:ProviderID>
                  <sts:SoftwareID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)">${d.softwareId}</sts:SoftwareID>
               </sts:SoftwareProvider>
               <sts:SoftwareSecurityCode schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)">${d.ssc}</sts:SoftwareSecurityCode>
               <sts:AuthorizationProvider>
                  <sts:AuthorizationProviderID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="4" schemeName="31">800197268</sts:AuthorizationProviderID>
               </sts:AuthorizationProvider>
               <sts:QRCode>${x(qrCode)}</sts:QRCode>
            </sts:DianExtensions>
         </ext:ExtensionContent>
      </ext:UBLExtension>
   
   <ext:UBLExtension><ext:ExtensionContent><!-- SIGNATURE_PLACEHOLDER --></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
   <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
   <cbc:CustomizationID>${customizationId}</cbc:CustomizationID>
   <cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>
   <cbc:ProfileExecutionID>${d.profileExecutionId}</cbc:ProfileExecutionID>
   <cbc:ID>${d.fullNumber}</cbc:ID>
   <cbc:UUID schemeID="${d.profileExecutionId}" schemeName="CUFE-SHA384">${d.cufe}</cbc:UUID>
   <cbc:IssueDate>${d.issueDate}</cbc:IssueDate>
   <cbc:IssueTime>${d.issueTime}</cbc:IssueTime>
   <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
   <cbc:Note>${x(d.cufeInput)}</cbc:Note>
   <cbc:DocumentCurrencyCode listAgencyID="6" listAgencyName="United Nations Economic Commission for Europe" listID="ISO 4217 Alpha">${d.currency}</cbc:DocumentCurrencyCode>
   <cbc:LineCountNumeric>${d.items.length}</cbc:LineCountNumeric>
   <cac:AccountingSupplierParty>
      <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
      <cac:Party>
         <cac:PartyName>
            <cbc:Name>${x(d.supplierName)}</cbc:Name>
         </cac:PartyName>
         <cac:PhysicalLocation>
            <cac:Address>
               <cbc:ID>${d.supplierCityCode || '11001'}</cbc:ID>
               <cbc:CityName>${x(d.supplierCity)}</cbc:CityName>
               <cbc:CountrySubentity>${x(d.supplierDepartment)}</cbc:CountrySubentity>
               <cbc:CountrySubentityCode>${d.supplierDeptCode || '11'}</cbc:CountrySubentityCode>
               <cac:AddressLine>
                  <cbc:Line>${x(d.supplierAddress)}</cbc:Line>
               </cac:AddressLine>
               <cac:Country>
                  <cbc:IdentificationCode>${d.supplierCountry}</cbc:IdentificationCode>
                  <cbc:Name languageID="es">Colombia</cbc:Name>
               </cac:Country>
            </cac:Address>
         </cac:PhysicalLocation>
         <cac:PartyTaxScheme>
            <cbc:RegistrationName>${x(d.supplierName)}</cbc:RegistrationName>
            <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="${d.supplierDv}" schemeName="31">${d.supplierNit}</cbc:CompanyID>
            <cbc:TaxLevelCode listName="05">O-99</cbc:TaxLevelCode>
            <cac:RegistrationAddress>
               <cbc:ID>${d.supplierCityCode || '11001'}</cbc:ID>
               <cbc:CityName>${x(d.supplierCity)}</cbc:CityName>
               <cbc:CountrySubentity>${x(d.supplierDepartment)}</cbc:CountrySubentity>
               <cbc:CountrySubentityCode>${d.supplierDeptCode || '11'}</cbc:CountrySubentityCode>
               <cac:AddressLine>
                  <cbc:Line>${x(d.supplierAddress)}</cbc:Line>
               </cac:AddressLine>
               <cac:Country>
                  <cbc:IdentificationCode>${d.supplierCountry}</cbc:IdentificationCode>
                  <cbc:Name languageID="es">Colombia</cbc:Name>
               </cac:Country>
            </cac:RegistrationAddress>
            <cac:TaxScheme>
               <cbc:ID>01</cbc:ID>
               <cbc:Name>IVA</cbc:Name>
            </cac:TaxScheme>
         </cac:PartyTaxScheme>
         <cac:PartyLegalEntity>
            <cbc:RegistrationName>${x(d.supplierName)}</cbc:RegistrationName>
            <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="${d.supplierDv}" schemeName="31">${d.supplierNit}</cbc:CompanyID>
            <cac:CorporateRegistrationScheme>
               <cbc:ID>${d.prefix}</cbc:ID>
            </cac:CorporateRegistrationScheme>
         </cac:PartyLegalEntity>
         <cac:Contact>
            <cbc:Telephone>${d.supplierPhone}</cbc:Telephone>
            <cbc:ElectronicMail>${d.supplierEmail}</cbc:ElectronicMail>
         </cac:Contact>
      </cac:Party>
   </cac:AccountingSupplierParty>
   <cac:AccountingCustomerParty>
      <cbc:AdditionalAccountID>${d.custIdType === '31' ? '1' : '2'}</cbc:AdditionalAccountID>
      <cac:Party>
         <cac:PartyName>
            <cbc:Name>${x(d.custName)}</cbc:Name>
         </cac:PartyName>
         <cac:PhysicalLocation>
            <cac:Address>
               <cbc:ID>${d.custCityCode || '11001'}</cbc:ID>
               <cbc:CityName>${x(d.custCity)}</cbc:CityName>
               <cbc:CountrySubentity>${x(d.custDepartment)}</cbc:CountrySubentity>
               <cbc:CountrySubentityCode>${d.custDeptCode || '11'}</cbc:CountrySubentityCode>
               <cac:AddressLine>
                  <cbc:Line>${x(d.custAddress)}</cbc:Line>
               </cac:AddressLine>
               <cac:Country>
                  <cbc:IdentificationCode>${d.custCountry}</cbc:IdentificationCode>
                  <cbc:Name languageID="es">Colombia</cbc:Name>
               </cac:Country>
            </cac:Address>
         </cac:PhysicalLocation>
         <cac:PartyTaxScheme>
            <cbc:RegistrationName>${x(d.custName)}</cbc:RegistrationName>
            <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)"${d.custDv ? ` schemeID="${d.custDv}"` : ''} schemeName="${d.custIdType}">${d.custId}</cbc:CompanyID>
            ${d.custIdType !== '31'
        ? `<cbc:TaxLevelCode listName="49">R-99-PN</cbc:TaxLevelCode>`
        : `<cbc:TaxLevelCode listName="48">${d.custTaxLevelCode && d.custTaxLevelCode !== 'ZZ' && d.custTaxLevelCode !== 'O-99' ? d.custTaxLevelCode : 'O-13'}</cbc:TaxLevelCode>`}
            <cac:RegistrationAddress>
               <cbc:ID>${d.custCityCode || '11001'}</cbc:ID>
               <cbc:CityName>${x(d.custCity)}</cbc:CityName>
               <cbc:CountrySubentity>${x(d.custDepartment)}</cbc:CountrySubentity>
               <cbc:CountrySubentityCode>${d.custDeptCode || '11'}</cbc:CountrySubentityCode>
               <cac:AddressLine>
                  <cbc:Line>${x(d.custAddress)}</cbc:Line>
               </cac:AddressLine>
               <cac:Country>
                  <cbc:IdentificationCode>${d.custCountry}</cbc:IdentificationCode>
                  <cbc:Name languageID="es">Colombia</cbc:Name>
               </cac:Country>
            </cac:RegistrationAddress>
            ${d.custIdType !== '31'
        ? `<cac:TaxScheme><cbc:ID>ZZ</cbc:ID><cbc:Name>No aplica</cbc:Name></cac:TaxScheme>`
        : `<cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>`}
         </cac:PartyTaxScheme>
         <cac:PartyLegalEntity>
            <cbc:RegistrationName>${x(d.custName)}</cbc:RegistrationName>
            <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)"${d.custDv ? ` schemeID="${d.custDv}"` : ''} schemeName="${d.custIdType}">${d.custId}</cbc:CompanyID>
            ${d.custIdType !== '31' ? (() => {
        // FAK61: persona natural (CC/CE/TI/Pasaporte) → obligatorio <cac:Person>
        // Descomponer "JUAN CARLOS PÉREZ MORALES" → FirstName [MiddleName] FamilyName
        const parts = (d.custName || '').trim().split(/\s+/);
        const fn = x(parts[0] || '');
        const mn = parts.length > 2 ? x(parts.slice(1, -1).join(' ')) : '';
        const ln = x(parts.length > 1 ? parts[parts.length - 1] : '');
        return `<cac:Person>
               <cbc:FirstName>${fn}</cbc:FirstName>${mn ? `
               <cbc:MiddleName>${mn}</cbc:MiddleName>` : ''}
               <cbc:FamilyName>${ln}</cbc:FamilyName>
            </cac:Person>`;
      })() : ''}
         </cac:PartyLegalEntity>
         <cac:Contact>
            <cbc:ElectronicMail>${d.custEmail}</cbc:ElectronicMail>
         </cac:Contact>
      </cac:Party>
   </cac:AccountingCustomerParty>
   <cac:PaymentMeans>
      <cbc:ID>2</cbc:ID>
      <cbc:PaymentMeansCode>${paymentMeansCode}</cbc:PaymentMeansCode>
      <cbc:PaymentDueDate>${d.dueDate}</cbc:PaymentDueDate>
   </cac:PaymentMeans>
${taxGroups.map(g => `   <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${d.currency}">${g.taxAmt.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
         <cbc:TaxableAmount currencyID="${d.currency}">${g.taxableAmt.toFixed(2)}</cbc:TaxableAmount>
         <cbc:TaxAmount currencyID="${d.currency}">${g.taxAmt.toFixed(2)}</cbc:TaxAmount>
         <cac:TaxCategory>
            <cbc:Percent>${g.percent.toFixed(2)}</cbc:Percent>
            <cac:TaxScheme>
               <cbc:ID>${g.taxId}</cbc:ID>
               <cbc:Name>${g.taxName}</cbc:Name>
            </cac:TaxScheme>
         </cac:TaxCategory>
      </cac:TaxSubtotal>
   </cac:TaxTotal>`).join('\n')}
   <cac:LegalMonetaryTotal>
      <cbc:LineExtensionAmount currencyID="${d.currency}">${d.subtotal.toFixed(2)}</cbc:LineExtensionAmount>
      <cbc:TaxExclusiveAmount currencyID="${d.currency}">${(taxableBase > 0 ? taxableBase : d.subtotal).toFixed(2)}</cbc:TaxExclusiveAmount>
      <cbc:TaxInclusiveAmount currencyID="${d.currency}">${d.total.toFixed(2)}</cbc:TaxInclusiveAmount>
      <cbc:AllowanceTotalAmount currencyID="${d.currency}">${d.items.reduce((s, it) => s + (it.discount || 0), 0).toFixed(2)}</cbc:AllowanceTotalAmount>
      <cbc:ChargeTotalAmount currencyID="${d.currency}">0.00</cbc:ChargeTotalAmount>
      <cbc:PrepaidAmount currencyID="${d.currency}">0.00</cbc:PrepaidAmount>
      <cbc:PayableAmount currencyID="${d.currency}">${d.total.toFixed(2)}</cbc:PayableAmount>
   </cac:LegalMonetaryTotal>
${itemsXml}
</Invoice>`;
  }

  /**
   * Canonicaliza un fragmento XML aplicando C14N Inclusive manualmente:
   * 1. Inserta los 9 namespaces del Invoice root en el tag de apertura
   * 2. Expande los self-closing tags (<foo/> → <foo></foo>)
   * La DIAN verifica los digests y la firma sobre contenido C14N Inclusive,
   * que requiere ambas transformaciones para producir el hash correcto.
   */
  private toC14nString(fragment: string, openTag: string): string {
    const INVOICE_NS =
      ` xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"` +
      ` xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"` +
      ` xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"` +
      ` xmlns:ds="http://www.w3.org/2000/09/xmldsig#"` +
      ` xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"` +
      ` xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1"` +
      ` xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"` +
      ` xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#"` +
      ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`;
    // Extraer el nombre del tag (e.g. '<ds:KeyInfo ' → 'ds:KeyInfo')
    // para construir un regex que funcione tanto con atributos (<ds:KeyInfo Id="...">)
    // como sin atributos (<ds:SignedInfo>)
    const tagName = openTag.replace(/^</, '').replace(/[\s>].*$/, '');
    // Insertar INVOICE_NS justo antes del primer espacio o '>' después del nombre del tag
    const withNs = fragment.replace(
      new RegExp(`(<${tagName})([ >])`),
      `$1${INVOICE_NS}$2`,
    );
    // C14N Inclusive convierte self-closing <ds:Foo attr="x"/> → <ds:Foo attr="x"></ds:Foo>
    return withNs.replace(/<((?:ds|xades|xades141|sts):[A-Za-z]+)([^>]*)\/>/g, '<$1$2></$1>');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // XAdES-BES SIGNATURE — estructura exacta según ejemplos DIAN v1.9
  // 3 References: (1) doc enveloped, (2) KeyInfo, (3) SignedProperties
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Limpia un PEM que puede venir con "Bag Attributes" de un pfx/p12 export
   * (openssl pkcs12 -nodes genera esos headers). Extrae solo el bloque PEM válido.
   * También normaliza saltos de línea y espacios.
   */
  private cleanPem(raw: string, type: 'CERTIFICATE' | 'PRIVATE KEY' | 'RSA PRIVATE KEY'): string {
    if (!raw) return raw;
    const marker = `-----BEGIN ${type}-----`;
    const idx = raw.indexOf(marker);
    return idx >= 0 ? raw.slice(idx).trim() : raw.trim();
  }

  private normalizePem(pem: string): string {
    return pem
      .replace(/\\n/g, '\n')  // Convierte los literales \n a saltos de línea
      .replace(/\r/g, '')      // Quita CR si viene de Windows
      .trim();                 // Quita espacios al inicio y final
  }

  private signXmlPlaceholder(xml: string, certPem: string, keyPem: string, issueDateTime?: string): string {
    // ── Limpiar Bag Attributes que genera openssl pkcs12 ─────────────────────
    // Los certs de GSE/Andes vienen con "Bag Attributes\n  friendlyName:..." antes del PEM
    const rawCert = certPem;
    const rawKey = keyPem;

    // Detectar si la key es PKCS8 (BEGIN PRIVATE KEY) o PKCS1 (BEGIN RSA PRIVATE KEY)
    const keyType = rawKey.includes('BEGIN RSA PRIVATE KEY') ? 'RSA PRIVATE KEY' : 'PRIVATE KEY';
    const effectiveCert = this.cleanPem(rawCert, 'CERTIFICATE');
    const effectiveKey = this.cleanPem(rawKey, keyType);

    try {
      const { createSign, X509Certificate, randomUUID } = require('crypto');

      // Dos UUIDs distintos, igual que en el ejemplo DIAN
      const sigId = randomUUID();
      const keyInfoId = randomUUID();
      // Formato: 2026-03-10T15:30:00-05:00 (hora Colombia)
      // FAD09e: SigningTime DEBE coincidir con IssueDate+IssueTime del XML
      // Si se pasa issueDateTime lo usamos; si no, usamos now() como fallback
      const signingTime = issueDateTime ?? (new Date().toISOString().slice(0, 19) + '-05:00');

      // ── Cert info ────────────────────────────────────────────────────────
      const certBase64 = effectiveCert
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\s/g, '');
      const certDer = Buffer.from(certBase64, 'base64');
      const certDigest = createHash('sha256').update(certDer).digest('base64');
      const cert = new X509Certificate(effectiveCert);

      // X509IssuerName en formato RFC 2253 sin espacio después de coma — como en los ejemplos DIAN:
      // "C=CO,L=Bogota D.C.,O=Andes SCD.,OU=...,CN=...,emailAddress=..."
      // Node.js X509Certificate.issuer devuelve las partes con \n, en orden reverso al RFC2253,
      // así que simplemente revertimos y unimos con "," (sin espacio)
      const issuerName = cert.issuer
        .split('\n')
        .map((s: string) => s.trim())
        .filter(Boolean)
        .reverse()
        .join(',');

      // SerialNumber: X509Certificate.serialNumber es hex, DIAN necesita decimal
      const serialDec = BigInt('0x' + cert.serialNumber).toString();

      // ── SignedProperties — digest exactamente como en los ejemplos DIAN ──
      // SIN xmlns en el elemento — los namespaces (xades, ds) vienen del scope
      // del Invoice root que los declara. El validador DIAN hace C14N sobre el
      // elemento en su contexto de namespaces heredados del documento.
      // Ref verificada contra Combustible.xml y Consumidor Final.xml de DIAN.
      const signedPropsXml =
        `<xades:SignedProperties Id="xmldsig-${sigId}-signedprops"><xades:SignedSignatureProperties><xades:SigningTime>${signingTime}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${certDigest}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>${issuerName}</ds:X509IssuerName><ds:X509SerialNumber>${serialDec}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate><xades:SignaturePolicyIdentifier><xades:SignaturePolicyId><xades:SigPolicyId><xades:Identifier>https://facturaelectronica.dian.gov.co/politicadefirma/v1/politicadefirmav2.pdf</xades:Identifier></xades:SigPolicyId><xades:SigPolicyHash><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>dMoMvtcG5aIzgYo0tIsSQeVJBDnUnfSOfBpxXrmor0Y=</ds:DigestValue></xades:SigPolicyHash></xades:SignaturePolicyId></xades:SignaturePolicyIdentifier><xades:SignerRole><xades:ClaimedRoles><xades:ClaimedRole>supplier</xades:ClaimedRole></xades:ClaimedRoles></xades:SignerRole></xades:SignedSignatureProperties></xades:SignedProperties>`;

      // ── KeyInfo XML (digest como Ref 2) ───────────────────────────────────
      const keyInfoXml =
        `<ds:KeyInfo Id="xmldsig-${keyInfoId}-keyinfo"><ds:X509Data><ds:X509Certificate>${certBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>`;

      // ── Digests C14N Inclusive ────────────────────────────────────────────────
      // La DIAN verifica cada Reference aplicando C14N Inclusive al elemento en su
      // contexto dentro del documento. C14N Inclusive:
      //   1. Hereda los namespaces del elemento raíz Invoice (9 namespaces)
      //   2. Convierte self-closing tags <foo/> → <foo></foo>
      // toC14nString() aplica ambas transformaciones sin necesitar un parser XML.

      // docDigest: URI="" con transform enveloped-signature + C14N Inclusive
      // La DIAN aplica: (1) quitar <ds:Signature> del árbol (deja ExtensionContent vacío),
      // (2) C14N Inclusive del documento resultante.
      // C14N del documento = quitar declaración XML <?xml...?> + expandir self-closing tags.
      // El xml que recibimos tiene <!-- SIGNATURE_PLACEHOLDER --> → lo vaciamos antes de C14N.
      const xmlForDoc = xml.replace('<!-- SIGNATURE_PLACEHOLDER -->', '');
      const xmlC14n = xmlForDoc
        .replace(/^<\?xml[^?]+\?>\s*/s, '')                          // quitar declaración XML
        .replace(/<([A-Za-z][A-Za-z0-9:_.-]*)([^>]*)\/>/g, '<$1$2></$1>'); // expandir self-closing
      const docDigest = createHash('sha256').update(Buffer.from(xmlC14n, 'utf8')).digest('base64');

      // keyInfoDigest: elemento <ds:KeyInfo> canonicalizado
      // KeyInfo no tiene elementos self-closing → toC14nString solo agrega NS
      const keyInfoC14n = this.toC14nString(keyInfoXml, '<ds:KeyInfo ');
      const keyInfoDigest = createHash('sha256').update(Buffer.from(keyInfoC14n, 'utf8')).digest('base64');

      // propsDigest: elemento <xades:SignedProperties> canonicalizado
      // SignedProperties tiene <ds:DigestMethod .../> → toC14nString expande self-closing
      const signedPropsC14n = this.toC14nString(signedPropsXml, '<xades:SignedProperties ');
      const propsDigest = createHash('sha256').update(Buffer.from(signedPropsC14n, 'utf8')).digest('base64');

      // ── SignedInfo — 3 referencias exactamente como DIAN ─────────────────
      // Contenido del SignedInfo (idéntico en versión a firmar y versión a insertar)
      const signedInfoContent =
        `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
        `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
        `<ds:Reference Id="xmldsig-${sigId}-ref0" URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${docDigest}</ds:DigestValue></ds:Reference>` +
        `<ds:Reference URI="#xmldsig-${keyInfoId}-keyinfo"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${keyInfoDigest}</ds:DigestValue></ds:Reference>` +
        `<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#xmldsig-${sigId}-signedprops"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${propsDigest}</ds:DigestValue></ds:Reference>`;

      // Versión para FIRMAR: con todos los namespaces heredados del Invoice root (C14N Inclusive)
      // Versión para INSERTAR en el XML: sin namespaces (los hereda del documento)
      const signedInfoXml = `<ds:SignedInfo>${signedInfoContent}</ds:SignedInfo>`;

      // Versión para FIRMAR: C14N Inclusive completo (NS heredados + self-closing expandidos)
      const signedInfoC14n = this.toC14nString(signedInfoXml, '<ds:SignedInfo>');

      // ── Firma RSA-SHA256 sobre el SignedInfo canonicalizado ───────────────
      const signer = createSign('RSA-SHA256');
      signer.update(signedInfoC14n, 'utf8');  // ← firmar C14N correcto
      const sigValue = signer.sign(effectiveKey).toString('base64');

      // ── Bloque Signature final ────────────────────────────────────────────
      const sigBlock =
        `<ds:Signature Id="xmldsig-${sigId}">
${signedInfoXml}
<ds:SignatureValue Id="xmldsig-${sigId}-sigvalue">
${sigValue}
</ds:SignatureValue>
${keyInfoXml}
<ds:Object><xades:QualifyingProperties Target="#xmldsig-${sigId}"><xades:SignedProperties Id="xmldsig-${sigId}-signedprops"><xades:SignedSignatureProperties><xades:SigningTime>${signingTime}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${certDigest}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>${issuerName}</ds:X509IssuerName><ds:X509SerialNumber>${serialDec}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate><xades:SignaturePolicyIdentifier><xades:SignaturePolicyId><xades:SigPolicyId><xades:Identifier>https://facturaelectronica.dian.gov.co/politicadefirma/v1/politicadefirmav2.pdf</xades:Identifier></xades:SigPolicyId><xades:SigPolicyHash><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>dMoMvtcG5aIzgYo0tIsSQeVJBDnUnfSOfBpxXrmor0Y=</ds:DigestValue></xades:SigPolicyHash></xades:SignaturePolicyId></xades:SignaturePolicyIdentifier><xades:SignerRole><xades:ClaimedRoles><xades:ClaimedRole>supplier</xades:ClaimedRole></xades:ClaimedRoles></xades:SignerRole></xades:SignedSignatureProperties></xades:SignedProperties></xades:QualifyingProperties></ds:Object>
</ds:Signature>`;

      return xml.replace('<!-- SIGNATURE_PLACEHOLDER -->', sigBlock);
    } catch (e) {
      this.logger.error(`[DIAN] XML signing failed: ${(e as Error).message}`);
      throw new Error(`No se pudo firmar el XML: ${(e as Error).message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ZIP compression
  // ══════════════════════════════════════════════════════════════════════════

  private createZip(filename: string, content: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = (archiver as any)('zip', { zlib: { level: 9 } });
      archive.on('data', (c: Buffer) => chunks.push(c));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
      archive.append(Buffer.from(content, 'utf8'), { name: filename });
      archive.finalize();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SOAP CLIENTS — DIAN WebServices
  // ══════════════════════════════════════════════════════════════════════════

  /** SendTestSetAsync — habilitación environment */
  private async soapSendTestSetAsync(p: { zipFileName: string; zipBase64: string; testSetId: string; wsUrl: string; certPem: string; keyPem: string }): Promise<DianSoapResult> {
    // CRÍTICO: sin whitespace ni saltos de línea — el bodyContent para el digest usa este mismo string
    const body = `<wcf:SendTestSetAsync><wcf:fileName>${p.zipFileName}</wcf:fileName><wcf:contentFile>${p.zipBase64}</wcf:contentFile><wcf:testSetId>${p.testSetId}</wcf:testSetId></wcf:SendTestSetAsync>`;
    const raw = await this.soapCall(p.wsUrl, body, 'SendTestSetAsync', p.certPem, p.keyPem);
    const zipKey = this.extractTag(raw, 'b:ZipKey') || this.extractTag(raw, 'ZipKey');
    const errors = this.extractAllTags(raw, 'b:processedMessage');
    return { success: !!zipKey, zipKey, errorMessages: errors, raw };
  }

  /** SendBillAsync — production */
  private async soapSendBillAsync(p: { zipFileName: string; zipBase64: string; wsUrl: string; certPem: string; keyPem: string }): Promise<DianSoapResult> {
    const body = `<wcf:SendBillAsync><wcf:fileName>${p.zipFileName}</wcf:fileName><wcf:contentFile>${p.zipBase64}</wcf:contentFile></wcf:SendBillAsync>`;
    const raw = await this.soapCall(p.wsUrl, body, 'SendBillAsync', p.certPem, p.keyPem);
    const zipKey = this.extractTag(raw, 'b:zipKey') || this.extractTag(raw, 'ZipKey');
    const errors = this.extractAllTags(raw, 'b:processedMessage');
    return { success: !!zipKey && errors.length === 0, zipKey, errorMessages: errors, raw };
  }

  /** GetStatus — query by CUFE */
  private async soapGetStatus(p: { trackId: string; wsUrl: string; certPem: string; keyPem: string }): Promise<DianStatusResult> {
    const body = `<wcf:GetStatus><wcf:trackId>${p.trackId}</wcf:trackId></wcf:GetStatus>`;
    const raw = await this.soapCall(p.wsUrl, body, 'GetStatus', p.certPem, p.keyPem);
    return this.parseStatusResponse(raw);
  }

  /** GetStatusZip — query batch by ZipKey */
  private async soapGetStatusZip(p: { trackId: string; wsUrl: string; certPem: string; keyPem: string }): Promise<DianStatusResult> {
    const body = `<wcf:GetStatusZip><wcf:trackId>${p.trackId}</wcf:trackId></wcf:GetStatusZip>`;
    const raw = await this.soapCall(p.wsUrl, body, 'GetStatusZip', p.certPem, p.keyPem);
    return this.parseStatusResponse(raw);
  }

  private parseStatusResponse(raw: string): DianStatusResult {
    return {
      isValid: this.extractTag(raw, 'b:IsValid') === 'true',
      statusCode: this.extractTag(raw, 'b:StatusCode'),
      statusDescription: this.extractTag(raw, 'b:StatusDescription'),
      statusMessage: this.extractTag(raw, 'b:StatusMessage'),
      xmlBase64: this.extractTag(raw, 'b:XmlBase64Bytes'),
      trackId: this.extractTag(raw, 'b:XmlDocumentKey') || this.extractTag(raw, 'b:xmlDocumentKey'),
      errorMessages: this.extractAllTags(raw, 'c:string'),
      raw,
    };
  }

  /**
   * WS-Security header para DIAN.
   *
   * Ambiente HABILITACIÓN (SendTestSetAsync):
   *   La DIAN HAB NO requiere firma del mensaje SOAP — acepta <soap:Header/>
   *   vacío. El header complejo con X.509 sólo es requerido en PRODUCCIÓN.
   *
   * Ambiente PRODUCCIÓN:
   *   Requiere BinarySecurityToken + Signature RSA-SHA256 con certificado
   *   digital expedido por entidad certificadora avalada por ONAC en Colombia.
   */
  private buildWsSecurityHeader(certPem?: string, keyPem?: string): string {
    // Sin certificado real → header vacío (válido para habilitación)
    if (!certPem || !keyPem || certPem.includes('PLACEHOLDER') || certPem.includes('PENDING')) {
      return `<soap:Header/>`;
    }

    // Con certificado real → BinarySecurityToken + Timestamp + Signature
    try {
      const { createSign } = require('crypto');
      const now = new Date();
      const created = now.toISOString().replace(/\.\d{3}Z$/, '.000Z');
      const expires = new Date(now.getTime() + 5 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
      const tsId = `TS-${randomBytes(8).toString('hex')}`;
      const bstId = `BST-${randomBytes(8).toString('hex')}`;
      const sigId = `SIG-${randomBytes(8).toString('hex')}`;

      const certBase64 = certPem
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\s/g, '');

      const timestampXml = `<wsu:Timestamp xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" wsu:Id="${tsId}"><wsu:Created>${created}</wsu:Created><wsu:Expires>${expires}</wsu:Expires></wsu:Timestamp>`;
      const tsDigest = createHash('sha256').update(timestampXml, 'utf8').digest('base64');

      const signedInfoXml = `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><ds:Reference URI="#${tsId}"><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${tsDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;

      const signer = createSign('RSA-SHA256');
      signer.update(signedInfoXml, 'utf8');
      const sigValue = signer.sign(keyPem, 'base64');

      return `<soap:Header>
  <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
                 xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"
                 soap:mustUnderstand="1">
    <wsu:Timestamp wsu:Id="${tsId}">
      <wsu:Created>${created}</wsu:Created>
      <wsu:Expires>${expires}</wsu:Expires>
    </wsu:Timestamp>
    <wsse:BinarySecurityToken
        wsu:Id="${bstId}"
        ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"
        EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${certBase64}</wsse:BinarySecurityToken>
    <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="${sigId}">
      ${signedInfoXml}
      <ds:SignatureValue>${sigValue}</ds:SignatureValue>
      <ds:KeyInfo>
        <wsse:SecurityTokenReference>
          <wsse:Reference URI="#${bstId}"
            ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"/>
        </wsse:SecurityTokenReference>
      </ds:KeyInfo>
    </ds:Signature>
  </wsse:Security>
</soap:Header>`;
    } catch (e) {
      this.logger.warn(`[DIAN] WS-Security header failed: ${(e as Error).message}`);
      return `<soap:Header/>`;
    }
  }

  /**
   * ExcC14N (Exclusive Canonicalization) puro en TypeScript.
   *
   * Orden de namespace declarations según el estándar XML-ExcC14N + comportamiento de WSS4J/lxml:
   *   1. Primero los prefijos del InclusiveNamespaces PrefixList (en el orden dado)
   *   2. Luego los prefijos utilizados por el elemento (element prefix, attribute prefixes)
   *      ordenados por local name del prefijo
   *   Nunca se repite un prefijo.
   *
   * Para wsa:To con InclusiveNamespaces="soap wcf":
   *   soap, wcf  (InclusiveNamespaces, en ese orden)
   *   wsa        (prefijo del elemento)
   *   wsu        (prefijo de atributo wsu:Id)
   *
   * Para ds:SignedInfo con InclusiveNamespaces="wsa soap wcf":
   *   wsa, soap, wcf  (InclusiveNamespaces)
   *   ds              (prefijo del elemento)
   *   ec              (prefijo usado en hijos — ignorado en el elemento raíz)
   */
  private excC14nElement(
    elementXml: string,
    inheritedNs: Record<string, string>,
    inclusiveNsPrefixes: string[],
  ): string {
    // Tag de apertura del elemento raíz
    const ownNsMatch = elementXml.match(/^<[^>]+>/)?.[0] ?? '';

    // Extraer namespace declarations propias del elemento
    const ownNs: Record<string, string> = {};
    for (const m of ownNsMatch.matchAll(/xmlns:(\w+)="([^"]+)"/g)) {
      ownNs[m[1]] = m[2];
    }

    // Todos los namespaces en scope
    const allNs = { ...inheritedNs, ...ownNs };

    // Prefijos visiblemente usados: prefijo del element + prefijos en atributos
    const tagMatch = elementXml.match(/^<(\w+):/);
    const elemPrefix = tagMatch?.[1] ?? '';
    const usedByElem = new Set<string>();
    if (elemPrefix) usedByElem.add(elemPrefix);
    for (const m of ownNsMatch.matchAll(/ (\w+):[\w]+=["'][^"']*["']/g)) {
      if (m[1] !== 'xmlns') usedByElem.add(m[1]);
    }

    // Orden final: todos los prefijos a incluir, ordenados alfabéticamente por prefijo
    // (regla del estándar XML C14N — ExcC14N mantiene el mismo orden para ns declarations)
    const allPrefixes = new Set<string>();
    for (const p of inclusiveNsPrefixes) {
      if (allNs[p]) allPrefixes.add(p);
    }
    for (const p of usedByElem) {
      if (allNs[p]) allPrefixes.add(p);
    }
    const ordered = [...allPrefixes].sort();

    // Construir el tag de apertura con declarations en el orden correcto
    const nsDecls = ordered.map(p => ` xmlns:${p}="${allNs[p]}"`).join('');
    let openTag = ownNsMatch.replace(/ xmlns:\w+="[^"]+"/g, '');
    openTag = openTag.replace(/^(<\S+)/, `$1${nsDecls}`);

    return openTag + elementXml.slice(ownNsMatch.length);
  }

  /**
   * Low-level SOAP HTTP POST — DIAN WCF (SOAP 1.2 + WS-Addressing + WS-Security)
   *
   * FIX DEFINITIVO: ExcC14N implementado en TypeScript puro (sin Python).
   * El error InvalidSecurity ocurría porque el orden de namespace declarations era incorrecto.
   * ExcC14N ordena por namespace URI, no por prefijo. Firmar el string raw produce una firma
   * que el servidor no puede verificar (canonicaliza diferente).
   */
  private soapCall(wsUrl: string, soapBody: string, action: string, certPem: string, keyPem: string): Promise<string> {
    const effectiveCert = this.cleanPem(certPem, 'CERTIFICATE');
    const effectiveKey = this.cleanPem(
      keyPem,
      keyPem.includes('BEGIN RSA PRIVATE KEY') ? 'RSA PRIVATE KEY' : 'PRIVATE KEY',
    );

    const actionUri = `http://wcf.dian.colombia/IWcfDianCustomerServices/${action}`;
    const now = new Date();
    const created = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const expires = new Date(now.getTime() + 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

    const rand = () => randomBytes(17).toString('hex').toUpperCase();
    const tsId = `TS-${rand()}`;
    const bstId = `X509-${rand()}`;
    const sigId = `SIG-${rand()}`;
    const kiId = `KI-${rand()}`;
    const strId = `STR-${rand()}`;
    const toId = `id-${rand()}`;

    const certBase64 = effectiveCert
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');

    const SOAP_NS = 'http://www.w3.org/2003/05/soap-envelope';
    const WCF_NS = 'http://wcf.dian.colombia';
    const WSA_NS = 'http://www.w3.org/2005/08/addressing';
    const WSU_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
    const WSSE_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
    const DS_NS = 'http://www.w3.org/2000/09/xmldsig#';
    const EC_NS = 'http://www.w3.org/2001/10/xml-exc-c14n#';

    // Namespaces heredados del contexto del Envelope (los que están en scope cuando
    // el servidor canonicaliza wsa:To y ds:SignedInfo)
    const envelopeNs: Record<string, string> = { soap: SOAP_NS, wcf: WCF_NS };
    const headerNs: Record<string, string> = { ...envelopeNs, wsa: WSA_NS };
    const securityNs: Record<string, string> = { ...headerNs, wsse: WSSE_NS, wsu: WSU_NS };
    const sigNs: Record<string, string> = { ...securityNs, ds: DS_NS };

    // ── 1. Digest de wsa:To con ExcC14N, InclusiveNamespaces="soap wcf" ───────
    // El elemento tiene wsu:Id (usa wsu:) y xmlns:wsu inline.
    // Namespaces en scope: headerNs + wsse + wsu (de Security) + wsu inline propio
    const toRaw = `<wsa:To xmlns:wsu="${WSU_NS}" wsu:Id="${toId}">${wsUrl}</wsa:To>`;
    const toC14n = this.excC14nElement(toRaw, headerNs, ['soap', 'wcf']);
    const toDigest = createHash('sha256').update(toC14n, 'utf8').digest('base64');

    // ── 2. Construir SignedInfo en forma c14n directamente ────────────────────
    // Reglas C14N aplicadas manualmente (verificadas contra lxml):
    //   1. Namespace declarations en opening tag ordenadas alfabéticamente por prefijo:
    //      ds < soap < wcf < wsa
    //   2. xmlns:ec va ANTES de PrefixList en ec:InclusiveNamespaces (orden alfa de atributos)
    //   3. Elementos vacíos se expanden: <X/> → <X></X>
    //   4. Sin whitespace extra entre elementos
    const signedInfoC14n =
      `<ds:SignedInfo` +
      ` xmlns:ds="${DS_NS}"` +
      ` xmlns:soap="${SOAP_NS}"` +
      ` xmlns:wcf="${WCF_NS}"` +
      ` xmlns:wsa="${WSA_NS}">` +
      `<ds:CanonicalizationMethod Algorithm="${EC_NS}">` +
      `<ec:InclusiveNamespaces xmlns:ec="${EC_NS}" PrefixList="wsa soap wcf">` +
      `</ec:InclusiveNamespaces>` +
      `</ds:CanonicalizationMethod>` +
      `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256">` +
      `</ds:SignatureMethod>` +
      `<ds:Reference URI="#${toId}">` +
      `<ds:Transforms>` +
      `<ds:Transform Algorithm="${EC_NS}">` +
      `<ec:InclusiveNamespaces xmlns:ec="${EC_NS}" PrefixList="soap wcf">` +
      `</ec:InclusiveNamespaces>` +
      `</ds:Transform>` +
      `</ds:Transforms>` +
      `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256">` +
      `</ds:DigestMethod>` +
      `<ds:DigestValue>${toDigest}</ds:DigestValue>` +
      `</ds:Reference>` +
      `</ds:SignedInfo>`;

    // SignedInfo raw para el envelope (formato normal, sin expansión c14n)
    const signedInfoRaw =
      `<ds:SignedInfo>` +
      `<ds:CanonicalizationMethod Algorithm="${EC_NS}">` +
      `<ec:InclusiveNamespaces PrefixList="wsa soap wcf" xmlns:ec="${EC_NS}"/>` +
      `</ds:CanonicalizationMethod>` +
      `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
      `<ds:Reference URI="#${toId}">` +
      `<ds:Transforms>` +
      `<ds:Transform Algorithm="${EC_NS}">` +
      `<ec:InclusiveNamespaces PrefixList="soap wcf" xmlns:ec="${EC_NS}"/>` +
      `</ds:Transform>` +
      `</ds:Transforms>` +
      `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
      `<ds:DigestValue>${toDigest}</ds:DigestValue>` +
      `</ds:Reference>` +
      `</ds:SignedInfo>`;

    // ── 4. Firmar los bytes canonicalizados del SignedInfo ─────────────────────
    const signer = createSign('RSA-SHA256');
    signer.update(signedInfoC14n, 'utf8');
    const sigValue = signer.sign(effectiveKey, 'base64');

    // ── 5. Construir el envelope final ────────────────────────────────────────
    const envelope =
      `<soap:Envelope xmlns:soap="${SOAP_NS}" xmlns:wcf="${WCF_NS}">` +
      `<soap:Header xmlns:wsa="${WSA_NS}">` +
      `<wsse:Security xmlns:wsse="${WSSE_NS}" xmlns:wsu="${WSU_NS}">` +
      `<wsu:Timestamp wsu:Id="${tsId}">` +
      `<wsu:Created>${created}</wsu:Created>` +
      `<wsu:Expires>${expires}</wsu:Expires>` +
      `</wsu:Timestamp>` +
      `<wsse:BinarySecurityToken` +
      ` EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary"` +
      ` ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"` +
      ` wsu:Id="${bstId}">${certBase64}</wsse:BinarySecurityToken>` +
      `<ds:Signature Id="${sigId}" xmlns:ds="${DS_NS}">` +
      signedInfoRaw +
      `<ds:SignatureValue>${sigValue}</ds:SignatureValue>` +
      `<ds:KeyInfo Id="${kiId}">` +
      `<wsse:SecurityTokenReference wsu:Id="${strId}">` +
      `<wsse:Reference URI="#${bstId}"` +
      ` ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"/>` +
      `</wsse:SecurityTokenReference>` +
      `</ds:KeyInfo>` +
      `</ds:Signature>` +
      `</wsse:Security>` +
      `<wsa:Action>${actionUri}</wsa:Action>` +
      `<wsa:To xmlns:wsu="${WSU_NS}" wsu:Id="${toId}">${wsUrl}</wsa:To>` +
      `</soap:Header>` +
      `<soap:Body>${soapBody}</soap:Body>` +
      `</soap:Envelope>`;

    this.logger.debug(`[DIAN] toC14n: ${toC14n}`);
    this.logger.debug(`[DIAN] siC14n: ${signedInfoC14n.slice(0, 200)}...`);
    this.logger.debug(`[DIAN] toDigest: ${toDigest}`);
    return new Promise((resolve, reject) => {
      const u = new URL(wsUrl);
      const lib = u.protocol === 'https:' ? https : http;

      const agent = u.protocol === 'https:'
        ? new (require('https').Agent)({
          cert: effectiveCert,
          key: effectiveKey,
          rejectUnauthorized: false,
          keepAlive: false,
        })
        : undefined;

      const bodyBuf = Buffer.from(envelope, 'utf8');
      const opt = {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${actionUri}"`,
          'Content-Length': bodyBuf.length,
        },
        agent,
        timeout: 60000,
      };

      const req = (lib as any).request(opt, (res: any) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          this.logger.debug(`[DIAN SOAP] ${action} HTTP ${res.statusCode}:\n${data.slice(0, 600)}...`);
          resolve(data);
        });
      });
      req.on('error', (e: any) => {
        this.logger.error(`[DIAN SOAP] ${action} network error: ${e.code} - ${e.message}`);
        reject(e);
      });
      req.on('timeout', () => {
        req.destroy();
        this.logger.error(`[DIAN SOAP] ${action} timeout after 60s`);
        reject(new Error(`DIAN timeout: ${action}`));
      });
      req.write(bodyBuf);
      req.end();
    });
  }

  // ── XML helpers ───────────────────────────────────────────────────────────
  private extractTag(xml: string, tag: string): string | undefined {
    const s = xml.indexOf(`<${tag}>`);
    if (s === -1) return undefined;
    const e = xml.indexOf(`</${tag}>`, s);
    return e === -1 ? undefined : xml.substring(s + tag.length + 2, e).trim();
  }

  private extractAllTags(xml: string, tag: string): string[] {
    const r: string[] = [];
    let pos = 0;
    while (true) {
      const s = xml.indexOf(`<${tag}>`, pos);
      if (s === -1) break;
      const e = xml.indexOf(`</${tag}>`, s);
      if (e === -1) break;
      r.push(xml.substring(s + tag.length + 2, e).trim());
      pos = e + tag.length + 3;
    }
    return r;
  }

  // ── Date helpers ──────────────────────────────────────────────────────────
  private toColombiaDate(d: Date): string {
    // YYYY-MM-DD in UTC-5
    const offset = d.getTime() - 5 * 60 * 60 * 1000;
    return new Date(offset).toISOString().split('T')[0];
  }

  private toColombiaTime(d: Date): string {
    // HH:mm:ss-05:00
    const offset = d.getTime() - 5 * 60 * 60 * 1000;
    const t = new Date(offset).toISOString().split('T')[1].split('.')[0];
    return `${t}-05:00`;
  }

  // ── Invoice number ────────────────────────────────────────────────────────
  private async getNextInvoiceNumber(companyId: string, prefix: string): Promise<string> {
    const last = await this.prisma.invoice.findFirst({
      where: { companyId, prefix, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { invoiceNumber: true },
    });
    if (!last) return `${prefix}-0001`;
    const parts = last.invoiceNumber.split('-');
    const num = parseInt(parts[parts.length - 1] ?? '0') + 1;
    return `${prefix}-${String(num).padStart(4, '0')}`;
  }


  async generatePdf(companyId: string, invoiceId: string): Promise<Buffer> {
    const invoice = await this.findOne(companyId, invoiceId);

    // Fetch company info for header
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, nit: true, razonSocial: true, email: true, phone: true, address: true, city: true },
    });

    const fmtCOP = (v: any) =>
      new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(Number(v));

    const fmtDate = (d: any) =>
      d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

    const typeLabel = (t: string) =>
      ({ VENTA: 'FACTURA DE VENTA', NOTA_CREDITO: 'NOTA CRÉDITO', NOTA_DEBITO: 'NOTA DÉBITO' }[t] ?? t);

    const statusLabel = (s: string) =>
      ({ DRAFT: 'BORRADOR', SENT_DIAN: 'ENVIADA DIAN', ACCEPTED_DIAN: 'ACEPTADA DIAN', PAID: 'PAGADA', CANCELLED: 'ANULADA', OVERDUE: 'VENCIDA' }[s] ?? s);

    // Build items rows HTML
    const itemRows = (invoice.items as any[]).map((item, i) => `
      <tr class="${i % 2 === 0 ? 'row-even' : 'row-odd'}">
        <td class="td-center">${i + 1}</td>
        <td>${item.description}</td>
        <td class="td-center">${Number(item.quantity)}</td>
        <td class="td-right">${fmtCOP(item.unitPrice)}</td>
        <td class="td-center">${Number(item.taxRate)}%</td>
        <td class="td-center">${Number(item.discount)}%</td>
        <td class="td-right"><strong>${fmtCOP(item.total)}</strong></td>
      </tr>
    `).join('');

    const isDraft = invoice.status === 'DRAFT';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Factura ${invoice.invoiceNumber}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Arial', sans-serif; font-size: 13px; color: #1e293b; background: #fff; padding: 32px; }
  .watermark { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-35deg);
    font-size:90px; font-weight:900; color:rgba(0,0,0,0.05); pointer-events:none; z-index:0;
    white-space:nowrap; letter-spacing:8px; }
  .content { position:relative; z-index:1; }

  /* Header */
  .inv-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:28px; border-bottom:3px solid #1a407e; padding-bottom:20px; }
  .company-block h1 { font-size:20px; font-weight:900; color:#1a407e; letter-spacing:1px; margin-bottom:4px; }
  .company-block p { font-size:11.5px; color:#64748b; margin:2px 0; }
  .inv-title-block { text-align:right; }
  .inv-type { font-size:16px; font-weight:800; color:#1a407e; letter-spacing:2px; margin-bottom:6px; }
  .inv-number { font-size:26px; font-weight:900; color:#0f172a; font-family:monospace; }
  .inv-date { font-size:12px; color:#64748b; margin-top:4px; }
  .status-badge { display:inline-block; margin-top:8px; padding:3px 12px; border-radius:99px;
    font-size:11px; font-weight:700; letter-spacing:.05em; }
  .status-draft { background:#f3f4f6; color:#6b7280; border:1px solid #d1d5db; }
  .status-accepted { background:#dcfce7; color:#166534; }
  .status-paid { background:#dcfce7; color:#166534; }
  .status-sent { background:#dbeafe; color:#1e40af; }
  .status-cancelled { background:#fee2e2; color:#991b1b; }

  /* Client + info grid */
  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
  .info-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px 16px; }
  .info-box h4 { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#94a3b8; margin-bottom:10px; }
  .info-row { display:flex; justify-content:space-between; margin-bottom:5px; }
  .info-row span { font-size:12px; color:#94a3b8; }
  .info-row strong { font-size:12px; color:#1e293b; text-align:right; max-width:200px; }

  /* Items table */
  .items-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em;
    color:#94a3b8; margin-bottom:8px; }
  table { width:100%; border-collapse:collapse; margin-bottom:20px; }
  thead tr { background:#1a407e; }
  thead th { padding:9px 10px; font-size:11px; font-weight:700; color:#fff; text-align:left; letter-spacing:.04em; }
  .td-center { text-align:center; }
  .td-right { text-align:right; }
  tbody tr { border-bottom:1px solid #f0f4f8; }
  .row-even td { background:#fff; }
  .row-odd td { background:#f8fafc; }
  td { padding:9px 10px; font-size:12.5px; color:#374151; vertical-align:middle; }
  tbody tr:last-child { border-bottom:2px solid #e2e8f0; }

  /* Totals */
  .totals-wrap { display:flex; justify-content:flex-end; margin-bottom:24px; }
  .totals-box { min-width:280px; }
  .tot-row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f0f4f8; }
  .tot-row span { font-size:13px; color:#64748b; }
  .tot-row strong { font-size:13px; color:#1e293b; }
  .tot-total { border-top:2px solid #1a407e !important; border-bottom:none !important;
    margin-top:4px; padding-top:10px !important; }
  .tot-total span, .tot-total strong { font-size:16px; font-weight:800; color:#1a407e; }

  /* Notes + DIAN */
  .notes-box { background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:12px 16px; margin-bottom:16px; }
  .notes-box h4 { font-size:10px; font-weight:700; text-transform:uppercase; color:#92400e; margin-bottom:6px; }
  .notes-box p { font-size:12px; color:#78350f; }
  .dian-box { background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px 16px; margin-bottom:16px; }
  .dian-box h4 { font-size:10px; font-weight:700; text-transform:uppercase; color:#166534; margin-bottom:6px; }
  .dian-box p { font-size:11px; color:#166534; word-break:break-all; }

  /* Footer */
  .inv-footer { border-top:1px solid #e2e8f0; padding-top:16px; display:flex; justify-content:space-between; }
  .footer-left p { font-size:11px; color:#94a3b8; margin:2px 0; }
  .footer-right { text-align:right; }
  .footer-right p { font-size:11px; color:#94a3b8; }
  .powered { font-size:10px; color:#c7d9f5; margin-top:4px; }
</style>
</head>
<body>
${isDraft ? '<div class="watermark">BORRADOR</div>' : ''}
<div class="content">

  <!-- Header -->
  <div class="inv-header">
    <div class="company-block">
      <h1>${company?.name ?? 'BeccaFact'}</h1>
      <p>${company?.razonSocial ?? ''}</p>
      <p>NIT: ${company?.nit ?? '—'}</p>
      ${company?.email ? `<p>${company.email}</p>` : ''}
      ${company?.phone ? `<p>${company.phone}</p>` : ''}
      ${company?.address ? `<p>${company.address}${company.city ? ', ' + company.city : ''}</p>` : ''}
    </div>
    <div class="inv-title-block">
      <div class="inv-type">${typeLabel(invoice.type)}</div>
      <div class="inv-number">${invoice.invoiceNumber}</div>
      <div class="inv-date">Emisión: ${fmtDate(invoice.issueDate)}</div>
      ${invoice.dueDate ? `<div class="inv-date">Vencimiento: ${fmtDate(invoice.dueDate)}</div>` : ''}
      <span class="status-badge status-${isDraft ? 'draft' : invoice.status === 'PAID' ? 'paid' : invoice.status === 'ACCEPTED_DIAN' ? 'accepted' : invoice.status === 'SENT_DIAN' ? 'sent' : invoice.status === 'CANCELLED' ? 'cancelled' : 'draft'}">
        ${statusLabel(invoice.status)}
      </span>
    </div>
  </div>

  <!-- Info Grid -->
  <div class="info-grid">
    <div class="info-box">
      <h4>Cliente / Receptor</h4>
      <div class="info-row"><span>Nombre</span><strong>${(invoice.customer as any).name}</strong></div>
      <div class="info-row"><span>Documento</span><strong>${(invoice.customer as any).documentNumber}</strong></div>
      ${(invoice.customer as any).email ? `<div class="info-row"><span>Email</span><strong>${(invoice.customer as any).email}</strong></div>` : ''}
      ${(invoice.customer as any).phone ? `<div class="info-row"><span>Teléfono</span><strong>${(invoice.customer as any).phone}</strong></div>` : ''}
      ${(invoice.customer as any).address ? `<div class="info-row"><span>Dirección</span><strong>${(invoice.customer as any).address}</strong></div>` : ''}
    </div>
    <div class="info-box">
      <h4>Información de Pago</h4>
      <div class="info-row"><span>Moneda</span><strong>${invoice.currency}</strong></div>
      <div class="info-row"><span>Subtotal</span><strong>${fmtCOP(invoice.subtotal)}</strong></div>
      <div class="info-row"><span>IVA</span><strong>${fmtCOP(invoice.taxAmount)}</strong></div>
      <div class="info-row"><span>Descuento</span><strong>${fmtCOP(invoice.discountAmount)}</strong></div>
      <div class="info-row"><span>Total</span><strong style="color:#1a407e;font-size:14px">${fmtCOP(invoice.total)}</strong></div>
    </div>
  </div>

  <!-- Items -->
  <div class="items-title">Detalle de productos / servicios</div>
  <table>
    <thead>
      <tr>
        <th style="width:40px" class="td-center">#</th>
        <th>Descripción</th>
        <th style="width:70px" class="td-center">Cant.</th>
        <th style="width:110px" class="td-right">Precio unit.</th>
        <th style="width:65px" class="td-center">IVA</th>
        <th style="width:65px" class="td-center">Desc.</th>
        <th style="width:120px" class="td-right">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <!-- Totals -->
  <div class="totals-wrap">
    <div class="totals-box">
      <div class="tot-row"><span>Subtotal</span><strong>${fmtCOP(invoice.subtotal)}</strong></div>
      <div class="tot-row"><span>IVA</span><strong>${fmtCOP(invoice.taxAmount)}</strong></div>
      ${Number(invoice.discountAmount) > 0 ? `<div class="tot-row"><span>Descuento</span><strong>-${fmtCOP(invoice.discountAmount)}</strong></div>` : ''}
      <div class="tot-row tot-total"><span>TOTAL</span><strong>${fmtCOP(invoice.total)}</strong></div>
    </div>
  </div>

  ${invoice.notes ? `
  <div class="notes-box">
    <h4>Notas / Observaciones</h4>
    <p>${invoice.notes}</p>
  </div>` : ''}

  ${invoice.dianCufe ? `
  <div class="dian-box">
    <h4>Información DIAN</h4>
    <p>CUFE: ${invoice.dianCufe}</p>
    ${invoice.dianQrCode ? `<p>QR: ${invoice.dianQrCode}</p>` : ''}
  </div>` : ''}

  <!-- Footer -->
  <div class="inv-footer">
    <div class="footer-left">
      <p>Generado el ${new Date().toLocaleString('es-CO')}</p>
      ${isDraft ? '<p style="color:#dc2626;font-weight:700">⚠ Documento en borrador — no válido como factura oficial</p>' : ''}
    </div>
    <div class="footer-right">
      <p class="powered">Generado por BeccaFact · Colombia</p>
    </div>
  </div>

</div>
</body>
</html>`;

    // Return HTML as Buffer — the controller sends it with PDF content-type
    // For real PDF generation add puppeteer/wkhtmltopdf; for now returns the HTML
    // which browsers render as a PDF-like document when opened in a tab or iframe
    return Buffer.from(html, 'utf-8');
  }
}

// ── Interfaces ────────────────────────────────────────────────────────────────
export interface DianSoapResult {
  success: boolean;
  zipKey?: string;
  errorMessages: string[];
  raw: string;
}

interface DianStatusResult {
  isValid: boolean;
  statusCode?: string;
  statusDescription?: string;
  statusMessage?: string;
  xmlBase64?: string;
  trackId?: string;
  errorMessages: string[];
  raw: string;
}