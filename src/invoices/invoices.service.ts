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
import { createHash } from 'crypto';
import * as archiver from 'archiver';
import * as https from 'https';
import * as http from 'http';

// ─────────────────────────────────────────────────────────────────────────────
// DIAN Constants — BeccaFact Software propio
// ─────────────────────────────────────────────────────────────────────────────
const DIAN_SOFTWARE_ID  = '8c2e43bd-9d57-4144-b0af-8876de5917a8';
const DIAN_SOFTWARE_PIN = '12345';
const DIAN_TEST_SET_ID  = 'aa87ad48-5975-46d1-b0d5-f8ed563a528e';
const DIAN_WS_HAB       = 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc';
const DIAN_WS_PROD      = 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc';

// Technical key used during habilitación (test) — provided by DIAN in the numbering range
const DIAN_TECH_KEY_HAB = 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private prisma:    PrismaService,
    private companiesService: CompaniesService,
  ) {}

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
    if (status)     where.status     = status;
    if (type)       where.type       = type;
    if (customerId) where.customerId = customerId;
    if (from || to) {
      where.issueDate = {};
      if (from) where.issueDate.gte = new Date(from);
      if (to)   where.issueDate.lte = new Date(to);
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
          include: { product: { select: { id: true, name: true, sku: true } } },
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

    let subtotal = 0;
    let taxAmount = 0;
    const itemsWithTotals = dto.items.map((item, index) => {
      const lineSubtotal  = Number(item.quantity) * Number(item.unitPrice);
      const discount      = lineSubtotal * (Number(item.discount ?? 0) / 100);
      const lineAfterDiscount = lineSubtotal - discount;
      const lineTax       = lineAfterDiscount * (Number(item.taxRate ?? 19) / 100);
      const lineTotal     = lineAfterDiscount + lineTax;
      subtotal  += lineAfterDiscount;
      taxAmount += lineTax;
      return {
        productId:   item.productId ?? null,
        description: item.description,
        quantity:    item.quantity,
        unitPrice:   item.unitPrice,
        taxRate:     item.taxRate ?? 19,
        taxAmount:   lineTax,
        discount:    item.discount ?? 0,
        total:       lineTotal,
        position:    index + 1,
      };
    });

    const total = subtotal + taxAmount;
    const invoiceNumber = await this.getNextInvoiceNumber(companyId, dto.prefix ?? 'FV');

    const invoice = await this.prisma.invoice.create({
      data: {
        companyId,
        customerId: dto.customerId,
        invoiceNumber,
        prefix:    dto.prefix ?? 'FV',
        type:      dto.type ?? 'VENTA',
        status:    'DRAFT',
        issueDate: dto.issueDate ? new Date(dto.issueDate) : new Date(),
        dueDate:   dto.dueDate   ? new Date(dto.dueDate)   : null,
        subtotal,
        taxAmount,
        discountAmount: dto.discountAmount ?? 0,
        total,
        notes:    dto.notes,
        currency: dto.currency ?? 'COP',
        items:    { create: itemsWithTotals },
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
      data:  { status: 'CANCELLED', notes: `${invoice.notes ?? ''}\n[CANCELADA]: ${reason}` },
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
      this.prisma.invoice.groupBy({ by: ['type'],   where, _count: { id: true }, _sum: { total: true } }),
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
      include: { customer: true, items: true, company: true },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.status !== 'DRAFT') throw new BadRequestException('Solo se pueden enviar facturas en estado DRAFT');

    const inv = invoice as any;
    const company   = inv.company;
    const customer  = inv.customer;
    const items     = inv.items;

    // ── Determine environment ─────────────────────────────────────────────
    const isTestMode    = company.dianTestMode !== false;
    const softwareId    = company.dianSoftwareId  || DIAN_SOFTWARE_ID;
    const softwarePin   = company.dianSoftwarePin || DIAN_SOFTWARE_PIN;
    const testSetId     = company.dianTestSetId   || DIAN_TEST_SET_ID;
    const claveTecnica  = company.dianClaveTecnica || DIAN_TECH_KEY_HAB;

    // ── Full invoice number for DIAN: prefix concatenated with numeric part only
    // DB stores invoiceNumber as "FV-0001" or "0001", prefix separately.
    // DIAN requires: prefix + consecutive number WITHOUT dash e.g. "SETP990000001"
    const prefix = invoice.prefix || 'SETP';
    const rawNum = invoice.invoiceNumber || '0001';
    // Strip prefix and dashes if invoiceNumber already contains them (e.g. "FV-0001" → "0001")
    const numericPart = rawNum.replace(new RegExp(`^${prefix}-?`), '').replace(/^0+/, '') || rawNum.replace(/\D/g, '') || '1';
    const fullNumber  = `${prefix}${numericPart}`;

    // ── Dates with Bogotá offset ──────────────────────────────────────────
    const issueDateObj = new Date(invoice.issueDate);
    const issueDate    = this.toColombiaDate(issueDateObj);
    const issueTime    = this.toColombiaTime(issueDateObj);

    // ── Tax breakdown ─────────────────────────────────────────────────────
    const taxIva  = Number(invoice.taxAmount);   // code 01 IVA
    const taxInc  = 0;                           // code 04 INC (not used here)
    const taxIca  = 0;                           // code 03 ICA (not used here)
    const subtotal = Number(invoice.subtotal);
    const total    = Number(invoice.total);

    // ── CUFE — SHA-384 per Anexo Técnico DIAN v1.9 §11.2 ─────────────────
    const cufe = this.calcCufe({
      invoiceNumber: fullNumber, issueDate, issueTime,
      subtotal, taxIva, taxInc, taxIca, total,
      nitSupplier: company.nit,
      nitCustomer: customer.documentNumber || customer.taxId || '222222222222',
      claveTecnica,
      tipoAmbiente: isTestMode ? '2' : '1',
    });

    // ── Software Security Code ────────────────────────────────────────────
    const ssc = this.calcSoftwareSecurityCode(softwareId, softwarePin, fullNumber);

    // ── Customer ID type (DIAN codes) ────────────────────────────────────
    const idTypeMap: Record<string, string> = { NIT: '31', CC: '13', CE: '22', PASSPORT: '21', TI: '12' };
    const custIdType = idTypeMap[customer.documentType || 'CC'] || '13';
    const custDv     = custIdType === '31' ? this.calcDv(customer.documentNumber || '') : '';

    // ── Company DV ───────────────────────────────────────────────────────
    const supplierDv = this.calcDv(company.nit);

    // ── Numbering range data ──────────────────────────────────────────────
    const resolucion   = company.dianResolucion   || '18760000001';
    const dianPrefix   = company.dianPrefijo      || prefix;
    const rangoDesde   = String(company.dianRangoDesde || 1);
    const rangoHasta   = String(company.dianRangoHasta || 5000000);
    const fechaDesde   = company.dianFechaDesde ? this.toColombiaDate(new Date(company.dianFechaDesde)) : '2019-01-19';
    const fechaHasta   = company.dianFechaHasta ? this.toColombiaDate(new Date(company.dianFechaHasta)) : '2030-01-19';

    // ── Build UBL 2.1 XML ────────────────────────────────────────────────
    this.logger.log(`[DIAN] Generating XML for ${fullNumber} CUFE=${cufe.slice(0,16)}…`);
    const xmlUnsigned = this.buildUblXml({
      fullNumber, prefix: dianPrefix, issueDate, issueTime,
      dueDate: invoice.dueDate ? this.toColombiaDate(new Date(invoice.dueDate)) : issueDate,
      profileExecutionId: isTestMode ? '2' : '1',
      currency: invoice.currency || 'COP',
      cufe, ssc, softwareId,
      resolucion, rangoDesde, rangoHasta, fechaDesde, fechaHasta,
      subtotal, taxIva, taxInc, taxIca, total,
      supplierNit: company.nit, supplierDv,
      supplierName: company.razonSocial,
      supplierAddress: company.address || 'Sin dirección',
      supplierCity: company.city || 'Bogotá',
      supplierDepartment: company.department || 'Cundinamarca',
      supplierCountry: company.country || 'CO',
      supplierPhone: company.phone || '0000000000',
      supplierEmail: company.email,
      custIdType, custDv,
      custId: customer.documentNumber || customer.taxId || '222222222222',
      custName: customer.name || 'Sin nombre',
      custAddress: customer.address || 'Sin dirección',
      custCity: customer.city || 'Bogotá',
      custCountry: customer.country || 'CO',
      custEmail: customer.email || 'cliente@example.com',
      items: items.map((it: any, idx: number) => ({
        lineId: idx + 1,
        description: it.description,
        quantity: Number(it.quantity),
        unit: it.unit || 'EA',
        unitPrice: Number(it.unitPrice),
        taxRate: Number(it.taxRate),
        taxAmount: Number(it.taxAmount),
        discount: Number(it.discount || 0),
        lineTotal: Number(it.total),
      })),
    });

    // ── Sign XML (XAdES-BES placeholder — real cert needed for production) ─
    const xmlSigned = this.signXmlPlaceholder(xmlUnsigned, company.dianCertificate, company.dianCertificateKey);

    // ── Compress to ZIP → Base64 ──────────────────────────────────────────
    const xmlFileName = `${fullNumber}.xml`;
    const zipFileName = `${fullNumber}.zip`;
    this.logger.log(`[DIAN] Compressing ${xmlFileName} → ${zipFileName}`);
    const zipBuffer  = await this.createZip(xmlFileName, xmlSigned);
    const zipBase64  = zipBuffer.toString('base64');

    // ── Save XML before network call ──────────────────────────────────────
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        dianCufe:    cufe,
        dianStatus:  'PENDING',
        dianAttempts: { increment: 1 },
        xmlContent:  xmlUnsigned,
        xmlSigned,
      } as any,
    });

    // ── Call DIAN WebService ──────────────────────────────────────────────
    this.logger.log(`[DIAN] Calling ${isTestMode ? 'SendTestSetAsync' : 'SendBillAsync'} → ${isTestMode ? DIAN_WS_HAB : DIAN_WS_PROD}`);

    let soapResult: DianSoapResult;
    try {
      if (isTestMode) {
        soapResult = await this.soapSendTestSetAsync({ zipFileName, zipBase64, testSetId, wsUrl: DIAN_WS_HAB });
      } else {
        soapResult = await this.soapSendBillAsync({ zipFileName, zipBase64, wsUrl: DIAN_WS_PROD });
      }
    } catch (err: any) {
      this.logger.error(`[DIAN] SOAP call failed: ${err.message}`);
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data:  { dianStatus: 'ERROR', dianStatusMsg: err.message } as any,
      });
      throw new BadRequestException(`Error de comunicación con DIAN: ${err.message}`);
    }

    // ── Persist result ────────────────────────────────────────────────────
    const newStatus = soapResult.zipKey ? 'ISSUED' : 'DRAFT';
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status:          newStatus,
        dianStatus:      soapResult.zipKey ? 'SENT' : 'ERROR',
        dianZipKey:      soapResult.zipKey,
        dianQrCode:      `https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=${cufe}`,
        dianSentAt:      new Date(),
        dianStatusMsg:   soapResult.errorMessages?.join('; ') || null,
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
    const cufe   = invoice.dianCufe;
    if (!zipKey && !cufe) throw new BadRequestException('La factura no tiene un ZipKey o CUFE para consultar');

    const isTestMode = invoice.company?.dianTestMode !== false;
    const wsUrl      = isTestMode ? DIAN_WS_HAB : DIAN_WS_PROD;

    let result: DianStatusResult;
    if (zipKey) {
      result = await this.soapGetStatusZip({ trackId: zipKey, wsUrl });
    } else {
      result = await this.soapGetStatus({ trackId: cufe!, wsUrl });
    }

    // Map DIAN status to invoice status
    let newInvoiceStatus: string = invoice.status;
    // DIAN returns '0' or '00' for success (PDF §7.11.3 shows '0', §7.12.3 shows '00')
    if (result.isValid && (result.statusCode === '00' || result.statusCode === '0')) {
      newInvoiceStatus = 'ACCEPTED_DIAN';
    } else if (result.statusCode === '99') {
      newInvoiceStatus = 'REJECTED_DIAN';
    }

    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status:          newInvoiceStatus,
        dianStatus:      result.statusCode,
        dianStatusCode:  result.statusCode,
        dianStatusMsg:   result.statusMessage || result.statusDescription,
        dianXmlBase64:   result.xmlBase64,
        dianResponseAt:  new Date(),
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
      xml:      invoice.xmlSigned,
      filename: `${invoice.prefix}${invoice.invoiceNumber}.xml`,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUFE — Código Único Factura Electrónica (Anexo Técnico DIAN v1.9 §11.2)
  // SHA-384(NumFac+FecFac+HorFac+ValFac+CodImp1+ValImp1+CodImp2+ValImp2+CodImp3+ValImp3+ValTot+NitOFE+NumAdq+ClTec+TipoAmbiente)
  // ══════════════════════════════════════════════════════════════════════════

  private calcCufe(p: {
    invoiceNumber: string; issueDate: string; issueTime: string;
    subtotal: number; taxIva: number; taxInc: number; taxIca: number; total: number;
    nitSupplier: string; nitCustomer: string; claveTecnica: string; tipoAmbiente: string;
  }): string {
    const f = (n: number) => n.toFixed(2);
    const input =
      p.invoiceNumber + p.issueDate + p.issueTime +
      f(p.subtotal) +
      '01' + f(p.taxIva) +
      '04' + f(p.taxInc) +
      '03' + f(p.taxIca) +
      f(p.total) +
      p.nitSupplier + p.nitCustomer + p.claveTecnica + p.tipoAmbiente;
    this.logger.debug(`[CUFE] input: ${input}`);
    return createHash('sha384').update(input, 'utf8').digest('hex');
  }

  // SHA-384(SoftwareID + Pin + NumFac)
  private calcSoftwareSecurityCode(softwareId: string, pin: string, invoiceNumber: string): string {
    return createHash('sha384').update(`${softwareId}${pin}${invoiceNumber}`, 'utf8').digest('hex');
  }

  // Dígito de verificación NIT
  calcDv(nit: string): string {
    const n = nit.replace(/\D/g, '');
    const f = [3,7,13,17,19,23,29,37,41,43,47];
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
    cufe: string; ssc: string; softwareId: string;
    resolucion: string; rangoDesde: string; rangoHasta: string; fechaDesde: string; fechaHasta: string;
    subtotal: number; taxIva: number; taxInc: number; taxIca: number; total: number;
    supplierNit: string; supplierDv: string; supplierName: string;
    supplierAddress: string; supplierCity: string; supplierDepartment: string;
    supplierCountry: string; supplierPhone: string; supplierEmail: string;
    custIdType: string; custDv: string; custId: string;
    custName: string; custAddress: string; custCity: string; custCountry: string; custEmail: string;
    items: Array<{ lineId: number; description: string; quantity: number; unit: string; unitPrice: number; taxRate: number; taxAmount: number; discount: number; lineTotal: number }>;
  }): string {
    const x = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const env = d.profileExecutionId === '2' ? 'hab' : '';

    const itemsXml = d.items.map(item => `
  <cac:InvoiceLine>
    <cbc:ID>${item.lineId}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${item.unit}">${item.quantity.toFixed(4)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${d.currency}">${item.lineTotal.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:FreeOfChargeIndicator>false</cbc:FreeOfChargeIndicator>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${d.currency}">${item.taxAmount.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${d.currency}">${item.lineTotal.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${d.currency}">${item.taxAmount.toFixed(2)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>${item.taxRate.toFixed(2)}</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID>01</cbc:ID>
            <cbc:Name>IVA</cbc:Name>
            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>${x(item.description)}</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${d.currency}">${item.unitPrice.toFixed(2)}</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="${item.unit}">${item.quantity.toFixed(4)}</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>`).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<fe:Invoice xmlns:fe="http://www.dian.gov.co/contratos/facturaelectronica/v1"
            xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
            xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
            xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
            xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
            xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
            xmlns:sts="http://www.dian.gov.co/contratos/facturaelectronica/v1/Structures"
            xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"
            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

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
          <sts:QRCode>https://catalogo-vpfe${env ? '-hab' : ''}.dian.gov.co/document/searchqr?documentkey=${d.cufe}</sts:QRCode>
        </sts:DianExtensions>
      </ext:ExtensionContent>
    </ext:UBLExtension>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <!-- SIGNATURE_PLACEHOLDER -->
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>

  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1</cbc:ProfileID>
  <cbc:ProfileExecutionID>${d.profileExecutionId}</cbc:ProfileExecutionID>
  <cbc:ID>${d.fullNumber}</cbc:ID>
  <cbc:UUID schemeID="${d.profileExecutionId}" schemeName="CUFE-SHA384">${d.cufe}</cbc:UUID>
  <cbc:IssueDate>${d.issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${d.issueTime}</cbc:IssueTime>
  <cbc:DueDate>${d.dueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode listAgencyID="195" listAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" listSchemeURI="http://www.dian.gov.co/micrositios/faceladoc/FacturaElectronica/Z-Anexo-Tecnico-Factura-Electr.de-Venta-V-1-7-2020.pdf">01</cbc:InvoiceTypeCode>
  <cbc:Note>${x(d.supplierName)}</cbc:Note>
  <cbc:DocumentCurrencyCode listID="ISO 4217 Alpha" listAgencyID="6" listAgencyName="United Nations Economic Commission for Europe">${d.currency}</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${d.items.length}</cbc:LineCountNumeric>

  <!-- Supplier -->
  <cac:AccountingSupplierParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName><cbc:Name>${x(d.supplierName)}</cbc:Name></cac:PartyName>
      <cac:PhysicalLocation>
        <cac:Address>
          <cbc:Department>${x(d.supplierDepartment)}</cbc:Department>
          <cbc:CityName>${x(d.supplierCity)}</cbc:CityName>
          <cbc:CountrySubentity>${x(d.supplierDepartment)}</cbc:CountrySubentity>
          <cac:AddressLine><cbc:Line>${x(d.supplierAddress)}</cbc:Line></cac:AddressLine>
          <cac:Country>
            <cbc:IdentificationCode>${d.supplierCountry}</cbc:IdentificationCode>
            <cbc:Name languageID="es">Colombia</cbc:Name>
          </cac:Country>
        </cac:Address>
      </cac:PhysicalLocation>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>${x(d.supplierName)}</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="${d.supplierDv}" schemeName="31">${d.supplierNit}</cbc:CompanyID>
        <cbc:TaxLevelCode listName="O-13;O-15;O-48">48</cbc:TaxLevelCode>
        <cac:RegistrationAddress>
          <cbc:Department>${x(d.supplierDepartment)}</cbc:Department>
          <cbc:CityName>${x(d.supplierCity)}</cbc:CityName>
          <cac:AddressLine><cbc:Line>${x(d.supplierAddress)}</cbc:Line></cac:AddressLine>
          <cac:Country><cbc:IdentificationCode>${d.supplierCountry}</cbc:IdentificationCode><cbc:Name languageID="es">Colombia</cbc:Name></cac:Country>
        </cac:RegistrationAddress>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${x(d.supplierName)}</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" schemeID="${d.supplierDv}" schemeName="31">${d.supplierNit}</cbc:CompanyID>
      </cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:Telephone>${d.supplierPhone}</cbc:Telephone>
        <cbc:ElectronicMail>${d.supplierEmail}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <!-- Customer -->
  <cac:AccountingCustomerParty>
    <cbc:AdditionalAccountID>1</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName><cbc:Name>${x(d.custName)}</cbc:Name></cac:PartyName>
      <cac:PhysicalLocation>
        <cac:Address>
          <cbc:CityName>${x(d.custCity)}</cbc:CityName>
          <cac:AddressLine><cbc:Line>${x(d.custAddress)}</cbc:Line></cac:AddressLine>
          <cac:Country><cbc:IdentificationCode>${d.custCountry}</cbc:IdentificationCode><cbc:Name languageID="es">Colombia</cbc:Name></cac:Country>
        </cac:Address>
      </cac:PhysicalLocation>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>${x(d.custName)}</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)"${d.custDv ? ` schemeID="${d.custDv}"` : ''} schemeName="${d.custIdType}">${d.custId}</cbc:CompanyID>
        <cbc:TaxLevelCode listName="49">49</cbc:TaxLevelCode>
        <cac:RegistrationAddress>
          <cbc:CityName>${x(d.custCity)}</cbc:CityName>
          <cac:AddressLine><cbc:Line>${x(d.custAddress)}</cbc:Line></cac:AddressLine>
          <cac:Country><cbc:IdentificationCode>${d.custCountry}</cbc:IdentificationCode><cbc:Name languageID="es">Colombia</cbc:Name></cac:Country>
        </cac:RegistrationAddress>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${x(d.custName)}</cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)"${d.custDv ? ` schemeID="${d.custDv}"` : ''} schemeName="${d.custIdType}">${d.custId}</cbc:CompanyID>
      </cac:PartyLegalEntity>
      <cac:Contact><cbc:ElectronicMail>${d.custEmail}</cbc:ElectronicMail></cac:Contact>
    </cac:Party>
  </cac:AccountingCustomerParty>

  <cac:PaymentMeans>
    <cbc:ID>1</cbc:ID>
    <cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>
    <cbc:PaymentDueDate>${d.dueDate}</cbc:PaymentDueDate>
  </cac:PaymentMeans>

  <!-- IVA total -->
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${d.currency}">${d.taxIva.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${d.currency}">${d.subtotal.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${d.currency}">${d.taxIva.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>${d.subtotal > 0 ? ((d.taxIva / d.subtotal) * 100).toFixed(2) : '19.00'}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name><cbc:TaxTypeCode>VAT</cbc:TaxTypeCode></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${d.currency}">${d.subtotal.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${d.currency}">${d.subtotal.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${d.currency}">${d.total.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="${d.currency}">0.00</cbc:AllowanceTotalAmount>
    <cbc:ChargeTotalAmount currencyID="${d.currency}">0.00</cbc:ChargeTotalAmount>
    <cbc:PayableAmount currencyID="${d.currency}">${d.total.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  ${itemsXml}

</fe:Invoice>`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // XAdES-BES SIGNATURE (placeholder — embeds ds:Signature structure)
  // In production: use a real RSA key+cert from the ONAC-accredited CA
  // ══════════════════════════════════════════════════════════════════════════

  private signXmlPlaceholder(xml: string, certPem?: string, keyPem?: string): string {
    // If real cert+key present, attempt real signature
    if (certPem && keyPem && !certPem.includes('PLACEHOLDER')) {
      try {
        const { createSign, X509Certificate } = require('crypto');
        const sigId = require('crypto').randomUUID().replace(/-/g, '');
        const signingTime = new Date().toISOString();

        const cert = new X509Certificate(certPem);
        const certBase64 = certPem.replace(/-----BEGIN CERTIFICATE-----/g,'').replace(/-----END CERTIFICATE-----/g,'').replace(/\s/g,'');
        const certDer    = Buffer.from(certBase64, 'base64');
        const certDigest = createHash('sha256').update(certDer).digest('base64');

        const signedPropsXml = `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xmldsig-${sigId}-signedprops">
          <xades:SignedSignatureProperties>
            <xades:SigningTime>${signingTime}</xades:SigningTime>
            <xades:SigningCertificate>
              <xades:Cert>
                <xades:CertDigest>
                  <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                  <ds:DigestValue>${certDigest}</ds:DigestValue>
                </xades:CertDigest>
                <xades:IssuerSerial>
                  <ds:X509IssuerName>${cert.issuer}</ds:X509IssuerName>
                  <ds:X509SerialNumber>${cert.serialNumber}</ds:X509SerialNumber>
                </xades:IssuerSerial>
              </xades:Cert>
            </xades:SigningCertificate>
          </xades:SignedSignatureProperties>
        </xades:SignedProperties>`;

        const docDigest       = createHash('sha256').update(xml, 'utf8').digest('base64');
        const propsDigest     = createHash('sha256').update(signedPropsXml, 'utf8').digest('base64');
        const signedInfoXml   = `<ds:SignedInfo>
          <ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
          <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
          <ds:Reference URI="">
            <ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></ds:Transforms>
            <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
            <ds:DigestValue>${docDigest}</ds:DigestValue>
          </ds:Reference>
          <ds:Reference Id="xmldsig-${sigId}-ref2" Type="http://uri.etsi.org/01903#SignedProperties" URI="#xmldsig-${sigId}-signedprops">
            <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
            <ds:DigestValue>${propsDigest}</ds:DigestValue>
          </ds:Reference>
        </ds:SignedInfo>`;

        const signer = createSign('RSA-SHA256');
        signer.update(signedInfoXml, 'utf8');
        const sigValue = signer.sign(keyPem, 'base64');

        const sigBlock = `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="xmldsig-${sigId}">
          ${signedInfoXml}
          <ds:SignatureValue>${sigValue}</ds:SignatureValue>
          <ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
          <ds:Object>
            <xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="#xmldsig-${sigId}">
              ${signedPropsXml}
            </xades:QualifyingProperties>
          </ds:Object>
        </ds:Signature>`;

        return xml.replace('<!-- SIGNATURE_PLACEHOLDER -->', sigBlock);
      } catch (e) {
        this.logger.warn(`[DIAN] Real signature failed, using placeholder: ${(e as Error).message}`);
      }
    }

    // Placeholder signature structure (valid XML structure, mock values)
    const sigId  = 'dev-' + Date.now();
    const sigBlock = `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="xmldsig-${sigId}">
      <ds:SignedInfo>
        <ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
        <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
        <ds:Reference URI="">
          <ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></ds:Transforms>
          <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
          <ds:DigestValue>PENDING_REAL_CERTIFICATE</ds:DigestValue>
        </ds:Reference>
      </ds:SignedInfo>
      <ds:SignatureValue>PENDING_REAL_CERTIFICATE_SIGNATURE</ds:SignatureValue>
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>PENDING_REAL_CERTIFICATE</ds:X509Certificate></ds:X509Data></ds:KeyInfo>
    </ds:Signature>`;
    return xml.replace('<!-- SIGNATURE_PLACEHOLDER -->', sigBlock);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ZIP compression
  // ══════════════════════════════════════════════════════════════════════════

  private createZip(filename: string, content: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = (archiver as any)('zip', { zlib: { level: 9 } });
      archive.on('data',  (c: Buffer) => chunks.push(c));
      archive.on('end',   () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
      archive.append(Buffer.from(content, 'utf8'), { name: filename });
      archive.finalize();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SOAP CLIENTS — DIAN WebServices
  // ══════════════════════════════════════════════════════════════════════════

  /** SendTestSetAsync — habilitación environment */
  private async soapSendTestSetAsync(p: { zipFileName: string; zipBase64: string; testSetId: string; wsUrl: string }): Promise<DianSoapResult> {
    const body = `<wcf:SendTestSetAsync>
      <wcf:fileName>${p.zipFileName}</wcf:fileName>
      <wcf:contentFile>${p.zipBase64}</wcf:contentFile>
      <wcf:testSetId>${p.testSetId}</wcf:testSetId>
    </wcf:SendTestSetAsync>`;
    const raw = await this.soapCall(p.wsUrl, body, 'SendTestSetAsync');
    const zipKey = this.extractTag(raw, 'b:ZipKey') || this.extractTag(raw, 'ZipKey');
    const errors = this.extractAllTags(raw, 'b:processedMessage');
    return { success: !!zipKey, zipKey, errorMessages: errors, raw };
  }

  /** SendBillAsync — production */
  private async soapSendBillAsync(p: { zipFileName: string; zipBase64: string; wsUrl: string }): Promise<DianSoapResult> {
    const body = `<wcf:SendBillAsync>
      <wcf:fileName>${p.zipFileName}</wcf:fileName>
      <wcf:contentFile>${p.zipBase64}</wcf:contentFile>
    </wcf:SendBillAsync>`;
    const raw = await this.soapCall(p.wsUrl, body, 'SendBillAsync');
    const zipKey = this.extractTag(raw, 'b:zipKey') || this.extractTag(raw, 'ZipKey');
    const errors = this.extractAllTags(raw, 'b:processedMessage');
    return { success: !!zipKey && errors.length === 0, zipKey, errorMessages: errors, raw };
  }

  /** GetStatus — query by CUFE */
  private async soapGetStatus(p: { trackId: string; wsUrl: string }): Promise<DianStatusResult> {
    const body = `<wcf:GetStatus>
      <wcf:trackId>${p.trackId}</wcf:trackId>
    </wcf:GetStatus>`;
    const raw = await this.soapCall(p.wsUrl, body, 'GetStatus');
    return this.parseStatusResponse(raw);
  }

  /** GetStatusZip — query batch by ZipKey */
  private async soapGetStatusZip(p: { trackId: string; wsUrl: string }): Promise<DianStatusResult> {
    const body = `<wcf:GetStatusZip>
      <wcf:trackId>${p.trackId}</wcf:trackId>
    </wcf:GetStatusZip>`;
    const raw = await this.soapCall(p.wsUrl, body, 'GetStatusZip');
    return this.parseStatusResponse(raw);
  }

  private parseStatusResponse(raw: string): DianStatusResult {
    return {
      isValid:           this.extractTag(raw, 'b:IsValid') === 'true',
      statusCode:        this.extractTag(raw, 'b:StatusCode'),
      statusDescription: this.extractTag(raw, 'b:StatusDescription'),
      statusMessage:     this.extractTag(raw, 'b:StatusMessage'),
      xmlBase64:         this.extractTag(raw, 'b:XmlBase64Bytes'),
      trackId:           this.extractTag(raw, 'b:XmlDocumentKey') || this.extractTag(raw, 'b:xmlDocumentKey'),
      errorMessages:     this.extractAllTags(raw, 'c:string'),
      raw,
    };
  }

  /** Low-level SOAP HTTP POST */
  private soapCall(wsUrl: string, soapBody: string, action: string): Promise<string> {
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:wcf="http://wcf.dian.colombia">
  <soap:Header/>
  <soap:Body>${soapBody}</soap:Body>
</soap:Envelope>`;

    this.logger.debug(`[DIAN SOAP] ${action} → ${wsUrl}\n${envelope.slice(0, 300)}…`);

    return new Promise((resolve, reject) => {
      const u   = new URL(wsUrl);
      const lib = u.protocol === 'https:' ? https : http;
      const opt = {
        hostname: u.hostname,
        port:     u.port || (u.protocol === 'https:' ? 443 : 80),
        path:     u.pathname + u.search,
        method:   'POST',
        headers: {
          'Content-Type':   'application/soap+xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(envelope, 'utf8'),
          'SOAPAction':     `http://wcf.dian.colombia/IWcfDianCustomerServices/${action}`,
        },
        rejectUnauthorized: false, // allow DIAN HAB self-signed cert
        timeout: 30000,
      };

      const req = (lib as any).request(opt, (res: any) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end',  () => {
          this.logger.debug(`[DIAN SOAP] ${action} response:\n${data.slice(0, 400)}…`);
          resolve(data);
        });
      });
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`DIAN timeout: ${action}`)); });
      req.write(envelope, 'utf8');
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
    const num   = parseInt(parts[parts.length - 1] ?? '0') + 1;
    return `${prefix}-${String(num).padStart(4, '0')}`;
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