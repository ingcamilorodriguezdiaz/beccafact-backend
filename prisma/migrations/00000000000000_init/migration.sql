CREATE TYPE public."CashMovementType" AS ENUM (
    'IN',
    'OUT'
);
CREATE TYPE public."CompanyStatus" AS ENUM (
    'ACTIVE',
    'SUSPENDED',
    'CANCELLED',
    'TRIAL'
);
CREATE TYPE public."DeliveryStatus" AS ENUM (
    'PENDING',
    'DELIVERED'
);
CREATE TYPE public."DianDocumentType" AS ENUM (
    'FACTURA_VENTA',
    'NOTA_CREDITO',
    'NOTA_DEBITO',
    'FACTURA_EXPORTACION',
    'DOCUMENTO_SOPORTE',
    'NOTA_AJUSTE_SOPORTE',
    'NOMINA_INDIVIDUAL',
    'NOMINA_INDIVIDUAL_AJUSTE'
);
CREATE TYPE public."DianTestSetStatus" AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'PARTIAL',
    'FAILED'
);
CREATE TYPE public."DianTestSetType" AS ENUM (
    'FACTURACION',
    'NOMINA'
);
CREATE TYPE public."DocumentType" AS ENUM (
    'NIT',
    'CC',
    'CE',
    'PASSPORT',
    'TI'
);
CREATE TYPE public."ImportStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'COMPLETED',
    'ERROR',
    'CANCELLED'
);
CREATE TYPE public."IntegrationStatus" AS ENUM (
    'PENDING',
    'ACTIVE',
    'ERROR',
    'SUSPENDED'
);
CREATE TYPE public."IntegrationType" AS ENUM (
    'DIAN',
    'NOMINA',
    'CONTABILIDAD',
    'BANCOS',
    'ECOMMERCE',
    'CUSTOM'
);
CREATE TYPE public."InvoiceStatus" AS ENUM (
    'DRAFT',
    'SENT_DIAN',
    'ACCEPTED_DIAN',
    'REJECTED_DIAN',
    'PAID',
    'CANCELLED',
    'OVERDUE'
);
CREATE TYPE public."InvoiceType" AS ENUM (
    'VENTA',
    'NOTA_CREDITO',
    'NOTA_DEBITO',
    'SOPORTE_ADQUISICION'
);
CREATE TYPE public."PaymentMethod" AS ENUM (
    'CASH',
    'CARD',
    'TRANSFER',
    'MIXED'
);
CREATE TYPE public."PayrollType" AS ENUM (
    'NOMINA_ELECTRONICA',
    'NOMINA_AJUSTE'
);
CREATE TYPE public."PosSaleStatus" AS ENUM (
    'COMPLETED',
    'CANCELLED',
    'REFUNDED',
    'ADVANCE'
);
CREATE TYPE public."PosSessionStatus" AS ENUM (
    'OPEN',
    'CLOSED'
);
CREATE TYPE public."ProductStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'OUT_OF_STOCK'
);
CREATE TYPE public."SubscriptionStatus" AS ENUM (
    'ACTIVE',
    'TRIAL',
    'SUSPENDED',
    'CANCELLED',
    'EXPIRED'
);
CREATE TYPE public."TaxType" AS ENUM (
    'IVA',
    'INC',
    'ICA',
    'NONE'
);
CREATE TABLE public.audit_logs (
    id text NOT NULL,
    "companyId" text,
    "userId" text,
    action text NOT NULL,
    resource text NOT NULL,
    "resourceId" text,
    before jsonb,
    after jsonb,
    ip text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.banks (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL
);
CREATE TABLE public.branches (
    id text NOT NULL,
    "companyId" text NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    department text,
    phone text,
    email text,
    "isMain" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "cityCode" text,
    country text DEFAULT 'CO'::text,
    "departmentCode" text
);
CREATE TABLE public.cartera_payments (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "invoiceId" text NOT NULL,
    "userId" text NOT NULL,
    amount numeric(12,2) NOT NULL,
    "paymentMethod" text NOT NULL,
    reference text,
    notes text,
    "paymentDate" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.categories (
    id text NOT NULL,
    "companyId" text NOT NULL,
    name text NOT NULL,
    description text,
    "parentId" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);
CREATE TABLE public.companies (
    id text NOT NULL,
    name text NOT NULL,
    nit text NOT NULL,
    "razonSocial" text NOT NULL,
    email text NOT NULL,
    phone text,
    address text,
    city text,
    department text,
    "cityCode" text,
    "departmentCode" text,
    country text DEFAULT 'CO'::text NOT NULL,
    status public."CompanyStatus" DEFAULT 'ACTIVE'::public."CompanyStatus" NOT NULL,
    "dianTestMode" boolean DEFAULT true NOT NULL,
    "dianSoftwareId" text,
    "dianSoftwarePin" text,
    "dianTestSetId" text,
    "dianClaveTecnica" text,
    "dianResolucion" text,
    "dianPrefijo" text,
    "dianRangoDesde" integer,
    "dianRangoHasta" integer,
    "dianFechaDesde" text,
    "dianFechaHasta" text,
    "dianCertificate" text,
    "dianCertificateKey" text,
    "logoUrl" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "nominaSoftwareId" text,
    "nominaSoftwarePin" text,
    "nominaTestSetId" text,
    "dianPosResolucion" text,
    "dianPosPrefijo" text,
    "dianPosRangoDesde" integer,
    "dianPosRangoHasta" integer,
    "dianPosFechaDesde" text,
    "dianPosFechaHasta" text
);
CREATE TABLE public.countries (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL
);
CREATE TABLE public.customers (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "documentType" public."DocumentType" DEFAULT 'NIT'::public."DocumentType" NOT NULL,
    "documentNumber" text NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    address text,
    city text,
    department text,
    "cityCode" text,
    "departmentCode" text,
    country text DEFAULT 'CO'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "creditLimit" numeric(12,2),
    "creditDays" integer,
    notes text,
    "taxLevelCode" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone
);
CREATE TABLE public.departments (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    "countryCode" text DEFAULT 'CO'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL
);
CREATE TABLE public.dian_test_set_documents (
    id text NOT NULL,
    "testSetId" text NOT NULL,
    sequence integer NOT NULL,
    "docType" text NOT NULL,
    "invoiceId" text,
    "payrollId" text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    "dianZipKey" text,
    "dianStatusCode" text,
    "dianStatusMsg" text,
    "errorMsg" text,
    "sentAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.dian_test_sets (
    id text NOT NULL,
    "companyId" text NOT NULL,
    type public."DianTestSetType" NOT NULL,
    status public."DianTestSetStatus" DEFAULT 'PENDING'::public."DianTestSetStatus" NOT NULL,
    "totalDocs" integer NOT NULL,
    "sentDocs" integer DEFAULT 0 NOT NULL,
    "acceptedDocs" integer DEFAULT 0 NOT NULL,
    "rejectedDocs" integer DEFAULT 0 NOT NULL,
    "errorDocs" integer DEFAULT 0 NOT NULL,
    "startedAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.dian_xml_templates (
    id text NOT NULL,
    "documentType" public."DianDocumentType" NOT NULL,
    version text DEFAULT 'V1.0:2021'::text NOT NULL,
    name text NOT NULL,
    description text,
    "xmlTemplate" text NOT NULL,
    "xsdSchemaUrl" text,
    namespace text,
    "rootElement" text,
    "hashAlgorithm" text,
    "hashFields" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "isCurrent" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "createdBy" text
);
CREATE TABLE public.employees (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "documentType" text DEFAULT 'CC'::text NOT NULL,
    "documentNumber" text NOT NULL,
    "firstName" text NOT NULL,
    "lastName" text NOT NULL,
    email text,
    phone text,
    "position" text NOT NULL,
    "baseSalary" numeric(12,2) NOT NULL,
    "contractType" text DEFAULT 'INDEFINITE'::text NOT NULL,
    "hireDate" timestamp(3) without time zone NOT NULL,
    city text,
    "bankAccount" text,
    "bankName" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "bankCode" text,
    "cityCode" text,
    country text DEFAULT 'CO'::text NOT NULL,
    "departmentCode" text,
    "branchId" text
);
CREATE TABLE public.import_errors (
    id text NOT NULL,
    "importJobId" text NOT NULL,
    "rowNumber" integer NOT NULL,
    field text,
    value text,
    message text NOT NULL,
    "rawData" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.import_jobs (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "userId" text NOT NULL,
    type text DEFAULT 'PRODUCTS'::text NOT NULL,
    status public."ImportStatus" DEFAULT 'PENDING'::public."ImportStatus" NOT NULL,
    "fileName" text NOT NULL,
    "fileUrl" text NOT NULL,
    "totalRows" integer DEFAULT 0 NOT NULL,
    "processedRows" integer DEFAULT 0 NOT NULL,
    "successRows" integer DEFAULT 0 NOT NULL,
    "errorRows" integer DEFAULT 0 NOT NULL,
    "reportUrl" text,
    "startedAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.integrations (
    id text NOT NULL,
    "companyId" text NOT NULL,
    type public."IntegrationType" NOT NULL,
    name text NOT NULL,
    config jsonb NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "lastSyncAt" timestamp(3) without time zone,
    status public."IntegrationStatus" DEFAULT 'PENDING'::public."IntegrationStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.invoice_items (
    id text NOT NULL,
    "invoiceId" text NOT NULL,
    "productId" text,
    description text NOT NULL,
    quantity numeric(12,4) NOT NULL,
    "unitPrice" numeric(12,2) NOT NULL,
    "taxRate" numeric(5,2) NOT NULL,
    "taxAmount" numeric(12,2) NOT NULL,
    discount numeric(5,2) DEFAULT 0 NOT NULL,
    total numeric(12,2) NOT NULL,
    "position" integer NOT NULL
);
CREATE TABLE public.invoices (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "customerId" text NOT NULL,
    "invoiceNumber" text NOT NULL,
    prefix text DEFAULT 'FV'::text NOT NULL,
    type public."InvoiceType" DEFAULT 'VENTA'::public."InvoiceType" NOT NULL,
    status public."InvoiceStatus" DEFAULT 'DRAFT'::public."InvoiceStatus" NOT NULL,
    "issueDate" timestamp(3) without time zone NOT NULL,
    "dueDate" timestamp(3) without time zone,
    subtotal numeric(12,2) NOT NULL,
    "taxAmount" numeric(12,2) NOT NULL,
    "discountAmount" numeric(12,2) DEFAULT 0 NOT NULL,
    total numeric(12,2) NOT NULL,
    notes text,
    "dianCufe" text,
    "dianQrCode" text,
    "dianStatus" text,
    "dianStatusCode" text,
    "dianStatusMsg" text,
    "dianErrors" text,
    "dianZipKey" text,
    "dianXmlBase64" text,
    "dianSentAt" timestamp(3) without time zone,
    "dianResponseAt" timestamp(3) without time zone,
    "dianAttempts" integer DEFAULT 0 NOT NULL,
    "xmlContent" text,
    "xmlSigned" text,
    "pdfUrl" text,
    "xmlUrl" text,
    currency text DEFAULT 'COP'::text NOT NULL,
    "exchangeRate" numeric(12,4) DEFAULT 1 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "dianCude" text,
    "discrepancyReason" text,
    "discrepancyReasonCode" text,
    "originalInvoiceId" text,
    "branchId" text
);
CREATE TABLE public.municipalities (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    "departmentCode" text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL
);
CREATE TABLE public.parameters (
    id text NOT NULL,
    category text NOT NULL,
    value text NOT NULL,
    label text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.payroll_records (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "employeeId" text NOT NULL,
    period text NOT NULL,
    "payDate" timestamp(3) without time zone NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    cune text,
    "cuneHash" text,
    "cuneInput" text,
    "payrollType" public."PayrollType" DEFAULT 'NOMINA_ELECTRONICA'::public."PayrollType" NOT NULL,
    "payrollNumber" text,
    "xmlSigned" text,
    "xmlUrl" text,
    "pdfUrl" text,
    "dianZipKey" text,
    "dianStatus" text,
    "dianStatusCode" text,
    "dianStatusMsg" text,
    "dianErrors" text,
    "dianAttempts" integer DEFAULT 0 NOT NULL,
    "cuneRef" text,
    "payrollNumberRef" text,
    "fechaGenRef" text,
    "tipoAjuste" text,
    "originalNieId" text,
    "predecessorId" text,
    "isAnulado" boolean DEFAULT false NOT NULL,
    "submittedAt" timestamp(3) without time zone,
    "baseSalary" numeric(12,2) NOT NULL,
    "daysWorked" integer DEFAULT 30 NOT NULL,
    "overtimeHours" numeric(8,2) DEFAULT 0 NOT NULL,
    bonuses numeric(12,2) DEFAULT 0 NOT NULL,
    commissions numeric(12,2) DEFAULT 0 NOT NULL,
    "transportAllowance" numeric(12,2) DEFAULT 0 NOT NULL,
    "vacationPay" numeric(12,2) DEFAULT 0 NOT NULL,
    "healthEmployee" numeric(12,2) DEFAULT 0 NOT NULL,
    "pensionEmployee" numeric(12,2) DEFAULT 0 NOT NULL,
    "sickLeave" numeric(12,2) DEFAULT 0 NOT NULL,
    loans numeric(12,2) DEFAULT 0 NOT NULL,
    "otherDeductions" numeric(12,2) DEFAULT 0 NOT NULL,
    "healthEmployer" numeric(12,2) DEFAULT 0 NOT NULL,
    "pensionEmployer" numeric(12,2) DEFAULT 0 NOT NULL,
    arl numeric(12,2) DEFAULT 0 NOT NULL,
    "compensationFund" numeric(12,2) DEFAULT 0 NOT NULL,
    "totalEarnings" numeric(12,2) NOT NULL,
    "totalDeductions" numeric(12,2) NOT NULL,
    "netPay" numeric(12,2) NOT NULL,
    "totalEmployerCost" numeric(12,2) NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "branchId" text,
    "invoiceId" text
);
CREATE TABLE public.plan_features (
    id text NOT NULL,
    "planId" text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    label text
);
CREATE TABLE public.plans (
    id text NOT NULL,
    name text NOT NULL,
    "displayName" text NOT NULL,
    description text,
    price numeric(12,2) NOT NULL,
    currency text DEFAULT 'COP'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "isCustom" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.pos_cash_movements (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "sessionId" text NOT NULL,
    "userId" text NOT NULL,
    type public."CashMovementType" NOT NULL,
    amount numeric(12,2) NOT NULL,
    reason text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.pos_sale_items (
    id text NOT NULL,
    "saleId" text NOT NULL,
    "productId" text,
    description text NOT NULL,
    quantity numeric(12,4) NOT NULL,
    "unitPrice" numeric(12,2) NOT NULL,
    "taxRate" numeric(5,2) NOT NULL,
    "taxAmount" numeric(12,2) NOT NULL,
    discount numeric(5,2) DEFAULT 0 NOT NULL,
    subtotal numeric(12,2) NOT NULL,
    total numeric(12,2) NOT NULL
);
CREATE TABLE public.pos_sales (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "sessionId" text NOT NULL,
    "customerId" text,
    "saleNumber" text NOT NULL,
    subtotal numeric(12,2) NOT NULL,
    "taxAmount" numeric(12,2) NOT NULL,
    "discountAmount" numeric(12,2) DEFAULT 0 NOT NULL,
    total numeric(12,2) NOT NULL,
    "paymentMethod" public."PaymentMethod" DEFAULT 'CASH'::public."PaymentMethod" NOT NULL,
    "amountPaid" numeric(12,2) NOT NULL,
    change numeric(12,2) DEFAULT 0 NOT NULL,
    status public."PosSaleStatus" DEFAULT 'COMPLETED'::public."PosSaleStatus" NOT NULL,
    "invoiceId" text,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "branchId" text,
    "advanceAmount" numeric(12,2) DEFAULT 0 NOT NULL,
    "deliveryStatus" public."DeliveryStatus" DEFAULT 'DELIVERED'::public."DeliveryStatus" NOT NULL,
    "remainingAmount" numeric(12,2) DEFAULT 0 NOT NULL
);
CREATE TABLE public.pos_sessions (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "userId" text NOT NULL,
    status public."PosSessionStatus" DEFAULT 'OPEN'::public."PosSessionStatus" NOT NULL,
    "openedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "closedAt" timestamp(3) without time zone,
    "initialCash" numeric(12,2) DEFAULT 0 NOT NULL,
    "finalCash" numeric(12,2),
    "expectedCash" numeric(12,2),
    "cashDifference" numeric(12,2),
    "totalSales" numeric(12,2) DEFAULT 0 NOT NULL,
    "totalTransactions" integer DEFAULT 0 NOT NULL,
    notes text,
    "branchId" text
);
CREATE TABLE public.products (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "categoryId" text,
    sku text NOT NULL,
    name text NOT NULL,
    description text,
    price numeric(12,2) NOT NULL,
    cost numeric(12,2) DEFAULT 0 NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    "minStock" integer DEFAULT 0 NOT NULL,
    unit text DEFAULT 'UND'::text NOT NULL,
    "taxRate" numeric(5,2) DEFAULT 19 NOT NULL,
    "taxType" public."TaxType" DEFAULT 'IVA'::public."TaxType" NOT NULL,
    "unspscCode" text,
    status public."ProductStatus" DEFAULT 'ACTIVE'::public."ProductStatus" NOT NULL,
    "imageUrl" text,
    barcode text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "branchId" text
);
CREATE TABLE public.role_permissions (
    id text NOT NULL,
    "roleId" text NOT NULL,
    resource text NOT NULL,
    action text NOT NULL
);
CREATE TABLE public.roles (
    id text NOT NULL,
    name text NOT NULL,
    "displayName" text NOT NULL,
    description text,
    "isSystem" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.subscriptions (
    id text NOT NULL,
    "companyId" text NOT NULL,
    "planId" text NOT NULL,
    status public."SubscriptionStatus" DEFAULT 'ACTIVE'::public."SubscriptionStatus" NOT NULL,
    "startDate" timestamp(3) without time zone NOT NULL,
    "endDate" timestamp(3) without time zone,
    "trialEndsAt" timestamp(3) without time zone,
    "customLimits" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.usage_tracking (
    id text NOT NULL,
    "companyId" text NOT NULL,
    metric text NOT NULL,
    value integer DEFAULT 0 NOT NULL,
    period text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.user_branches (
    id text NOT NULL,
    "userId" text NOT NULL,
    "branchId" text NOT NULL,
    "companyId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.user_roles (
    id text NOT NULL,
    "userId" text NOT NULL,
    "roleId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.users (
    id text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    "firstName" text NOT NULL,
    "lastName" text NOT NULL,
    phone text,
    avatar text,
    "isActive" boolean DEFAULT true NOT NULL,
    "isSuperAdmin" boolean DEFAULT false NOT NULL,
    "companyId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "lastLoginAt" timestamp(3) without time zone,
    "refreshToken" text,
    "hasSeenTour" boolean DEFAULT false NOT NULL
);
ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.banks
    ADD CONSTRAINT banks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cartera_payments
    ADD CONSTRAINT cartera_payments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.countries
    ADD CONSTRAINT countries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dian_test_set_documents
    ADD CONSTRAINT dian_test_set_documents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dian_test_sets
    ADD CONSTRAINT dian_test_sets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.dian_xml_templates
    ADD CONSTRAINT dian_xml_templates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.import_errors
    ADD CONSTRAINT import_errors_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.municipalities
    ADD CONSTRAINT municipalities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.parameters
    ADD CONSTRAINT parameters_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payroll_records
    ADD CONSTRAINT payroll_records_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.plan_features
    ADD CONSTRAINT plan_features_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pos_cash_movements
    ADD CONSTRAINT pos_cash_movements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pos_sale_items
    ADD CONSTRAINT pos_sale_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pos_sales
    ADD CONSTRAINT pos_sales_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pos_sessions
    ADD CONSTRAINT pos_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.usage_tracking
    ADD CONSTRAINT usage_tracking_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT user_branches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
CREATE INDEX "audit_logs_companyId_createdAt_idx" ON public.audit_logs USING btree ("companyId", "createdAt");
CREATE INDEX "audit_logs_resource_resourceId_idx" ON public.audit_logs USING btree (resource, "resourceId");
CREATE INDEX "audit_logs_userId_idx" ON public.audit_logs USING btree ("userId");
CREATE INDEX banks_code_idx ON public.banks USING btree (code);
CREATE UNIQUE INDEX banks_code_key ON public.banks USING btree (code);
CREATE INDEX "branches_companyId_idx" ON public.branches USING btree ("companyId");
CREATE INDEX "branches_companyId_isActive_idx" ON public.branches USING btree ("companyId", "isActive");
CREATE UNIQUE INDEX "branches_companyId_name_key" ON public.branches USING btree ("companyId", name);
CREATE INDEX "cartera_payments_companyId_paymentDate_idx" ON public.cartera_payments USING btree ("companyId", "paymentDate");
CREATE INDEX "cartera_payments_invoiceId_idx" ON public.cartera_payments USING btree ("invoiceId");
CREATE INDEX "categories_companyId_idx" ON public.categories USING btree ("companyId");
CREATE UNIQUE INDEX "categories_companyId_name_key" ON public.categories USING btree ("companyId", name);
CREATE INDEX companies_nit_idx ON public.companies USING btree (nit);
CREATE UNIQUE INDEX companies_nit_key ON public.companies USING btree (nit);
CREATE INDEX companies_status_idx ON public.companies USING btree (status);
CREATE INDEX countries_code_idx ON public.countries USING btree (code);
CREATE UNIQUE INDEX countries_code_key ON public.countries USING btree (code);
CREATE UNIQUE INDEX "customers_companyId_documentType_documentNumber_key" ON public.customers USING btree ("companyId", "documentType", "documentNumber");
CREATE INDEX "customers_companyId_idx" ON public.customers USING btree ("companyId");
CREATE INDEX departments_code_idx ON public.departments USING btree (code);
CREATE UNIQUE INDEX departments_code_key ON public.departments USING btree (code);
CREATE INDEX "departments_countryCode_idx" ON public.departments USING btree ("countryCode");
CREATE INDEX "dian_xml_templates_documentType_isActive_idx" ON public.dian_xml_templates USING btree ("documentType", "isActive");
CREATE UNIQUE INDEX "dian_xml_templates_documentType_version_key" ON public.dian_xml_templates USING btree ("documentType", version);
CREATE INDEX "employees_branchId_idx" ON public.employees USING btree ("branchId");
CREATE UNIQUE INDEX "employees_companyId_documentNumber_key" ON public.employees USING btree ("companyId", "documentNumber");
CREATE INDEX "employees_companyId_idx" ON public.employees USING btree ("companyId");
CREATE INDEX "import_errors_importJobId_idx" ON public.import_errors USING btree ("importJobId");
CREATE INDEX "import_jobs_companyId_idx" ON public.import_jobs USING btree ("companyId");
CREATE INDEX import_jobs_status_idx ON public.import_jobs USING btree (status);
CREATE INDEX "integrations_companyId_idx" ON public.integrations USING btree ("companyId");
CREATE INDEX "invoice_items_invoiceId_idx" ON public.invoice_items USING btree ("invoiceId");
CREATE INDEX "invoices_branchId_idx" ON public.invoices USING btree ("branchId");
CREATE INDEX "invoices_companyId_idx" ON public.invoices USING btree ("companyId");
CREATE UNIQUE INDEX "invoices_companyId_invoiceNumber_key" ON public.invoices USING btree ("companyId", "invoiceNumber");
CREATE INDEX "invoices_companyId_issueDate_idx" ON public.invoices USING btree ("companyId", "issueDate");
CREATE INDEX "invoices_companyId_status_idx" ON public.invoices USING btree ("companyId", status);
CREATE UNIQUE INDEX "invoices_dianCude_key" ON public.invoices USING btree ("dianCude");
CREATE UNIQUE INDEX "invoices_dianCufe_key" ON public.invoices USING btree ("dianCufe");
CREATE INDEX "invoices_originalInvoiceId_idx" ON public.invoices USING btree ("originalInvoiceId");
CREATE INDEX municipalities_code_idx ON public.municipalities USING btree (code);
CREATE UNIQUE INDEX municipalities_code_key ON public.municipalities USING btree (code);
CREATE INDEX "municipalities_departmentCode_idx" ON public.municipalities USING btree ("departmentCode");
CREATE INDEX parameters_category_idx ON public.parameters USING btree (category);
CREATE INDEX "payroll_records_branchId_idx" ON public.payroll_records USING btree ("branchId");
CREATE INDEX "payroll_records_companyId_employeeId_originalNieId_idx" ON public.payroll_records USING btree ("companyId", "employeeId", "originalNieId");
CREATE INDEX "payroll_records_companyId_employeeId_payrollType_idx" ON public.payroll_records USING btree ("companyId", "employeeId", "payrollType");
CREATE INDEX "payroll_records_companyId_employeeId_period_payrollType_idx" ON public.payroll_records USING btree ("companyId", "employeeId", period, "payrollType");
CREATE UNIQUE INDEX payroll_records_cune_key ON public.payroll_records USING btree (cune);
CREATE UNIQUE INDEX "payroll_records_invoiceId_key" ON public.payroll_records USING btree ("invoiceId");
CREATE UNIQUE INDEX "plan_features_planId_key_key" ON public.plan_features USING btree ("planId", key);
CREATE UNIQUE INDEX plans_name_key ON public.plans USING btree (name);
CREATE INDEX "pos_cash_movements_companyId_createdAt_idx" ON public.pos_cash_movements USING btree ("companyId", "createdAt");
CREATE INDEX "pos_cash_movements_sessionId_idx" ON public.pos_cash_movements USING btree ("sessionId");
CREATE INDEX "pos_sale_items_saleId_idx" ON public.pos_sale_items USING btree ("saleId");
CREATE INDEX "pos_sales_branchId_idx" ON public.pos_sales USING btree ("branchId");
CREATE INDEX "pos_sales_companyId_createdAt_idx" ON public.pos_sales USING btree ("companyId", "createdAt");
CREATE UNIQUE INDEX "pos_sales_companyId_saleNumber_key" ON public.pos_sales USING btree ("companyId", "saleNumber");
CREATE UNIQUE INDEX "pos_sales_invoiceId_key" ON public.pos_sales USING btree ("invoiceId");
CREATE INDEX "pos_sales_sessionId_idx" ON public.pos_sales USING btree ("sessionId");
CREATE INDEX "pos_sessions_branchId_idx" ON public.pos_sessions USING btree ("branchId");
CREATE INDEX "pos_sessions_companyId_openedAt_idx" ON public.pos_sessions USING btree ("companyId", "openedAt");
CREATE INDEX "pos_sessions_companyId_status_idx" ON public.pos_sessions USING btree ("companyId", status);
CREATE INDEX "products_branchId_idx" ON public.products USING btree ("branchId");
CREATE INDEX "products_companyId_branchId_sku_idx" ON public.products USING btree ("companyId", "branchId", sku);
CREATE INDEX "products_companyId_idx" ON public.products USING btree ("companyId");
CREATE INDEX "products_companyId_status_idx" ON public.products USING btree ("companyId", status);
CREATE UNIQUE INDEX "role_permissions_roleId_resource_action_key" ON public.role_permissions USING btree ("roleId", resource, action);
CREATE UNIQUE INDEX roles_name_key ON public.roles USING btree (name);
CREATE INDEX "subscriptions_companyId_idx" ON public.subscriptions USING btree ("companyId");
CREATE INDEX subscriptions_status_idx ON public.subscriptions USING btree (status);
CREATE UNIQUE INDEX "usage_tracking_companyId_metric_period_key" ON public.usage_tracking USING btree ("companyId", metric, period);
CREATE INDEX "usage_tracking_companyId_period_idx" ON public.usage_tracking USING btree ("companyId", period);
CREATE INDEX "user_branches_companyId_idx" ON public.user_branches USING btree ("companyId");
CREATE UNIQUE INDEX "user_branches_userId_branchId_key" ON public.user_branches USING btree ("userId", "branchId");
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON public.user_roles USING btree ("userId", "roleId");
CREATE INDEX "users_companyId_idx" ON public.users USING btree ("companyId");
CREATE INDEX users_email_idx ON public.users USING btree (email);
CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);
ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.branches
    ADD CONSTRAINT "branches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.cartera_payments
    ADD CONSTRAINT "cartera_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.cartera_payments
    ADD CONSTRAINT "cartera_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public.invoices(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.cartera_payments
    ADD CONSTRAINT "cartera_payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.categories
    ADD CONSTRAINT "categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.categories
    ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.customers
    ADD CONSTRAINT "customers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.departments
    ADD CONSTRAINT "departments_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES public.countries(code) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.dian_test_set_documents
    ADD CONSTRAINT "dian_test_set_documents_testSetId_fkey" FOREIGN KEY ("testSetId") REFERENCES public.dian_test_sets(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.dian_test_sets
    ADD CONSTRAINT "dian_test_sets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.employees
    ADD CONSTRAINT "employees_bankCode_fkey" FOREIGN KEY ("bankCode") REFERENCES public.banks(code) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.employees
    ADD CONSTRAINT "employees_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.employees
    ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.import_errors
    ADD CONSTRAINT "import_errors_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES public.import_jobs(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT "import_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT "import_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT "integrations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT "invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public.invoices(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT "invoice_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT "invoices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT "invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT "invoices_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES public.invoices(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.municipalities
    ADD CONSTRAINT "municipalities_departmentCode_fkey" FOREIGN KEY ("departmentCode") REFERENCES public.departments(code) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.payroll_records
    ADD CONSTRAINT "payroll_records_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.payroll_records
    ADD CONSTRAINT "payroll_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.payroll_records
    ADD CONSTRAINT "payroll_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES public.employees(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.payroll_records
    ADD CONSTRAINT "payroll_records_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public.invoices(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.payroll_records
    ADD CONSTRAINT "payroll_records_originalNieId_fkey" FOREIGN KEY ("originalNieId") REFERENCES public.payroll_records(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.payroll_records
    ADD CONSTRAINT "payroll_records_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES public.payroll_records(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.plan_features
    ADD CONSTRAINT "plan_features_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.plans(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.pos_cash_movements
    ADD CONSTRAINT "pos_cash_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.pos_cash_movements
    ADD CONSTRAINT "pos_cash_movements_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public.pos_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.pos_cash_movements
    ADD CONSTRAINT "pos_cash_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.pos_sale_items
    ADD CONSTRAINT "pos_sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.pos_sale_items
    ADD CONSTRAINT "pos_sale_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES public.pos_sales(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.pos_sales
    ADD CONSTRAINT "pos_sales_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.pos_sales
    ADD CONSTRAINT "pos_sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.pos_sales
    ADD CONSTRAINT "pos_sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.pos_sales
    ADD CONSTRAINT "pos_sales_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public.invoices(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.pos_sales
    ADD CONSTRAINT "pos_sales_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public.pos_sessions(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.pos_sessions
    ADD CONSTRAINT "pos_sessions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.pos_sessions
    ADD CONSTRAINT "pos_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.pos_sessions
    ADD CONSTRAINT "pos_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.products
    ADD CONSTRAINT "products_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.products
    ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES public.categories(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE ONLY public.products
    ADD CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT "subscriptions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES public.plans(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.usage_tracking
    ADD CONSTRAINT "usage_tracking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT "user_branches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.user_branches
    ADD CONSTRAINT "user_branches_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE ONLY public.users
    ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE SET NULL;
