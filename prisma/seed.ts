import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ─── Dígito de verificación NIT (DIAN) ────────────────────────────────────────
function calcDv(nit: string): string {
  const clean = nit.replace(/\D/g, '');
  const factors = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let sum = 0;
  for (let i = 0; i < clean.length; i++) {
    sum += parseInt(clean[clean.length - 1 - i]) * factors[i];
  }
  const rem = sum % 11;
  return rem > 1 ? String(11 - rem) : String(rem);
}

async function main() {
  console.log('🌱 Iniciando seed de BeccaFact...');

  // ─── ROLES ────────────────────────────────────────────────────────────────────
  const rolesData = [
    {
      name: 'SUPER_ADMIN',
      displayName: 'Super Administrador',
      description: 'Acceso total al sistema multi-tenant',
      isSystem: true,
      permissions: [],
    },
    {
      name: 'ADMIN',
      displayName: 'Administrador',
      description: 'Control total de la empresa',
      isSystem: true,
      permissions: [
        { resource: 'invoices', action: 'create' },
        { resource: 'invoices', action: 'read' },
        { resource: 'invoices', action: 'update' },
        { resource: 'invoices', action: 'delete' },
        { resource: 'invoices', action: 'export' },
        { resource: 'products', action: 'create' },
        { resource: 'products', action: 'read' },
        { resource: 'products', action: 'update' },
        { resource: 'products', action: 'delete' },
        { resource: 'products', action: 'import' },
        { resource: 'customers', action: 'create' },
        { resource: 'customers', action: 'read' },
        { resource: 'customers', action: 'update' },
        { resource: 'customers', action: 'delete' },
        { resource: 'users', action: 'create' },
        { resource: 'users', action: 'read' },
        { resource: 'users', action: 'update' },
        { resource: 'users', action: 'delete' },
        { resource: 'reports', action: 'read' },
        { resource: 'integrations', action: 'create' },
        { resource: 'integrations', action: 'read' },
        { resource: 'integrations', action: 'update' },
        { resource: 'integrations', action: 'delete' },
        { resource: 'cartera', action: 'read' },
        { resource: 'cartera', action: 'create' },
        { resource: 'cartera', action: 'update' },
        { resource: 'payroll', action: 'read' },
        { resource: 'payroll', action: 'create' },
        { resource: 'payroll', action: 'update' },
        { resource: 'payroll', action: 'delete' },
        { resource: 'payroll', action: 'transmit' },
      ],
    },
    {
      name: 'MANAGER',
      displayName: 'Gerente',
      description: 'Gestión operativa sin configuración',
      isSystem: true,
      permissions: [
        { resource: 'invoices', action: 'create' },
        { resource: 'invoices', action: 'read' },
        { resource: 'invoices', action: 'update' },
        { resource: 'invoices', action: 'export' },
        { resource: 'products', action: 'create' },
        { resource: 'products', action: 'read' },
        { resource: 'products', action: 'update' },
        { resource: 'products', action: 'import' },
        { resource: 'customers', action: 'create' },
        { resource: 'customers', action: 'read' },
        { resource: 'customers', action: 'update' },
        { resource: 'reports', action: 'read' },
        { resource: 'users', action: 'read' },
        { resource: 'cartera', action: 'read' },
        { resource: 'cartera', action: 'create' },
        { resource: 'cartera', action: 'update' },
        { resource: 'payroll', action: 'read' },
        { resource: 'payroll', action: 'create' },
        { resource: 'payroll', action: 'update' },
        { resource: 'payroll', action: 'transmit' },
      ],
    },
    {
      name: 'OPERATOR',
      displayName: 'Operador',
      description: 'Operaciones básicas de facturación e inventario',
      isSystem: true,
      permissions: [
        { resource: 'invoices', action: 'create' },
        { resource: 'invoices', action: 'read' },
        { resource: 'products', action: 'read' },
        { resource: 'products', action: 'update' },
        { resource: 'customers', action: 'create' },
        { resource: 'customers', action: 'read' },
        { resource: 'cartera', action: 'read' },
        { resource: 'payroll', action: 'read' },
        { resource: 'payroll', action: 'create' },
      ],
    },
    {
      name: 'VIEWER',
      displayName: 'Consultor',
      description: 'Solo lectura en todos los módulos',
      isSystem: true,
      permissions: [
        { resource: 'invoices', action: 'read' },
        { resource: 'products', action: 'read' },
        { resource: 'customers', action: 'read' },
        { resource: 'reports', action: 'read' },
      ],
    },
  ];

  for (const roleData of rolesData) {
    const { permissions, ...data } = roleData;
    const role = await prisma.role.upsert({
      where: { name: data.name },
      update: {},
      create: data,
    });
    for (const perm of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_resource_action: { roleId: role.id, resource: perm.resource, action: perm.action } },
        update: {},
        create: { roleId: role.id, ...perm },
      });
    }
    console.log(`  ✅ Rol: ${role.name}`);
  }

  // ─── PLANES ───────────────────────────────────────────────────────────────────
  const plansData = [
    {
      name: 'BASIC',
      displayName: 'Integración Básica',
      description: 'Para pequeñas empresas que inician con facturación electrónica',
      price: 89000,
      features: [
        { key: 'max_documents_per_month', value: '300',   label: '300 documentos/mes' },
        { key: 'has_invoices',            value: 'true',  label: 'Facturación básica DIAN' },
        { key: 'has_inventory',           value: 'false', label: 'Sin inventario' },
        { key: 'has_cartera',             value: 'false', label: 'Sin cartera' },
        { key: 'has_payroll',             value: 'false', label: 'Sin nómina' },
        { key: 'max_integrations',        value: '1',     label: '1 integración' },
        { key: 'storage_months',          value: '12',    label: '12 meses almacenamiento' },
        { key: 'max_products',            value: '100',   label: '100 productos' },
        { key: 'bulk_import',             value: 'false', label: 'Sin importación masiva' },
        { key: 'has_integrations',        value: 'true',  label: '1 integración activa' },
        { key: 'max_users',               value: '3',     label: '3 usuarios' },
      ],
    },
    {
      name: 'EMPRESARIAL',
      displayName: 'Plan Empresarial',
      description: 'Para empresas en crecimiento con necesidades completas',
      price: 249000,
      features: [
        { key: 'max_documents_per_month', value: '2000',  label: '2.000 documentos/mes' },
        { key: 'has_invoices',            value: 'true',  label: 'Todos los documentos DIAN' },
        { key: 'has_inventory',           value: 'true',  label: 'Inventario completo' },
        { key: 'has_cartera',             value: 'true',  label: 'Cartera y cobranza' },
        { key: 'has_payroll',             value: 'true',  label: 'Nómina electrónica' },
        { key: 'max_integrations',        value: '5',     label: '5 integraciones' },
        { key: 'storage_months',          value: '60',    label: '5 años almacenamiento' },
        { key: 'max_products',            value: '5000',  label: '5.000 productos' },
        { key: 'bulk_import',             value: 'true',  label: 'Importación masiva estándar' },
        { key: 'has_integrations',        value: 'true',  label: '5 integraciones activas' },
        { key: 'max_users',               value: '15',    label: '15 usuarios' },
      ],
    },
    {
      name: 'CORPORATIVO',
      displayName: 'Plan Corporativo',
      description: 'Para grandes empresas con volúmenes ilimitados y SLA garantizado',
      price: 749000,
      features: [
        { key: 'max_documents_per_month', value: 'unlimited', label: 'Documentos ilimitados' },
        { key: 'has_invoices',            value: 'true',       label: 'Todos los documentos DIAN' },
        { key: 'has_inventory',           value: 'true',       label: 'Inventario avanzado multi-sede' },
        { key: 'has_cartera',             value: 'true',       label: 'Cartera y cobranza avanzada' },
        { key: 'has_payroll',             value: 'true',       label: 'Nómina electrónica completa' },
        { key: 'max_integrations',        value: 'unlimited',  label: 'Integraciones ilimitadas' },
        { key: 'storage_months',          value: 'unlimited',  label: 'Almacenamiento ilimitado' },
        { key: 'max_products',            value: 'unlimited',  label: 'Productos ilimitados' },
        { key: 'bulk_import',             value: 'true',       label: 'Importación masiva avanzada' },
        { key: 'has_integrations',        value: 'true',       label: 'Integraciones ilimitadas' },
        { key: 'max_users',               value: 'unlimited',  label: 'Usuarios ilimitados' },
        { key: 'has_sla',                 value: 'true',       label: 'SLA contractual 99.9%' },
        { key: 'has_multicompany',        value: 'true',       label: 'Multiempresa avanzado' },
        { key: 'priority_support',        value: 'true',       label: 'Soporte prioritario 24/7' },
      ],
    },
  ];

  for (const planData of plansData) {
    const { features, ...data } = planData;
    const plan = await prisma.plan.upsert({
      where: { name: data.name },
      update: { price: data.price, description: data.description },
      create: data,
    });
    for (const feat of features) {
      await prisma.planFeature.upsert({
        where: { planId_key: { planId: plan.id, key: feat.key } },
        update: { value: feat.value, label: feat.label },
        create: { planId: plan.id, ...feat },
      });
    }
    console.log(`  ✅ Plan: ${plan.displayName}`);
  }

  // ─── SUPER ADMIN ──────────────────────────────────────────────────────────────
  const superAdminRole = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  const superAdminPassword = await bcrypt.hash('BeccaFact@2025!', 12);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@beccafact.com' },
    update: {},
    create: {
      email: 'superadmin@beccafact.com',
      password: superAdminPassword,
      firstName: 'Super',
      lastName: 'Admin',
      isSuperAdmin: true,
      isActive: true,
    },
  });
  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: superAdmin.id, roleId: superAdminRole.id } },
      update: {},
      create: { userId: superAdmin.id, roleId: superAdminRole.id },
    });
  }
  console.log(`  ✅ Super Admin: ${superAdmin.email}`);

  // ─── EMPRESA DEMO ─────────────────────────────────────────────────────────────
  // NIT real del set de pruebas DIAN: 902043550-6 con DV calculado
  const empresarialPlan = await prisma.plan.findUnique({ where: { name: 'EMPRESARIAL' } });
  const adminRole       = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  const operatorRole    = await prisma.role.findUnique({ where: { name: 'OPERATOR' } });

  const demoCompany = await prisma.company.upsert({
    where: { nit: '902043550-6' },
    update: {},
    create: {
      name:        'Empresa Demo BeccaFact',
      nit:         '902043550-6',
      razonSocial: 'EMPRESA DEMO BECCAFACT S.A.S.',
      email:       'demo@empresademo.com',
      phone:       '6015551234',
      address:     'Calle 72 # 12-34',
      city:        'Bogotá, D.C.',
      department:  'Bogotá',
      country:     'CO',
      status:      'ACTIVE',
      dianTestMode: true
      // Campos DIAN adicionales (guardados via `as any` en el service)
      // Se inyectan aquí para que el XML quede correcto desde el primer envío
    } as any,
  });

  // Actualizar campos DIAN extra que el service lee via `as any`
  await prisma.company.update({
    where: { id: demoCompany.id },
    data: {
      // Resolución habilitación DIAN set de pruebas
      dianResolucion:  '18760000001',
      dianFechaDesde:  '2019-01-19',
      dianFechaHasta:  '2030-01-19',
      dianRangoDesde:  990000000,
      dianRangoHasta:  995000000,
      dianPrefijo:      'SETP',
      dianSoftwareId:  '8c2e43bd-9d57-4144-b0af-8876de5917a8',
      dianSoftwarePin: '12345',
      dianTestSetId:'aa87ad48-5975-46d1-b0d5-f8ed563a528e',
      dianClaveTecnica:'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',      
      // Ubicación DIVIPOLA — Bogotá D.C.
      // cityCode y departmentCode son campos `as any` → se pasan en `data as any`
      cityCode:        '11001',    // DIVIPOLA: Bogotá
      departmentCode:  '11',       // ISO 3166-2:CO-DC
    } as any,
  });

  if (empresarialPlan) {
    await prisma.subscription.upsert({
      where: {
        id: (await prisma.subscription.findFirst({ where: { companyId: demoCompany.id } }))?.id ?? 'nonexistent',
      },
      update: {},
      create: {
        companyId: demoCompany.id,
        planId:    empresarialPlan.id,
        status:    'ACTIVE',
        startDate: new Date(),
        endDate:   new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
      },
    });
  }

  // ─── USUARIOS DEMO ────────────────────────────────────────────────────────────
  const adminPassword = await bcrypt.hash('Admin@123456!', 12);
  const demoAdmin = await prisma.user.upsert({
    where: { email: 'admin@empresademo.com' },
    update: {},
    create: {
      email:      'admin@empresademo.com',
      password:   adminPassword,
      firstName:  'Carlos',
      lastName:   'Rodríguez',
      companyId:  demoCompany.id,
      isActive:   true,
    },
  });
  if (adminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: demoAdmin.id, roleId: adminRole.id } },
      update: {},
      create: { userId: demoAdmin.id, roleId: adminRole.id },
    });
  }

  const operPassword = await bcrypt.hash('Oper@123456!', 12);
  const demoOper = await prisma.user.upsert({
    where: { email: 'operador@empresademo.com' },
    update: {},
    create: {
      email:     'operador@empresademo.com',
      password:  operPassword,
      firstName: 'María',
      lastName:  'González',
      companyId: demoCompany.id,
      isActive:  true,
    },
  });
  if (operatorRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: demoOper.id, roleId: operatorRole.id } },
      update: {},
      create: { userId: demoOper.id, roleId: operatorRole.id },
    });
  }

  // ─── CLIENTES DEMO ────────────────────────────────────────────────────────────
  // Todos los campos que el service lee para construir el XML UBL son incluidos.
  //
  // Campos clave por tipo de persona:
  //   Persona Jurídica (NIT):
  //     - documentType: 'NIT', schemeID DIAN = '31'
  //     - AdditionalAccountID = '1'
  //     - TaxLevelCode listName="04" → O-99  (responsabilidad DIAN tabla 13.2.6.2)
  //     - TaxScheme ID='01' Name='IVA'
  //     - RegistrationAddress con ID (DIVIPOLA), CityName, CountrySubentity,
  //       CountrySubentityCode, AddressLine/Line, Country/IdentificationCode
  //
  //   Persona Natural (CC):
  //     - documentType: 'CC', schemeID DIAN = '13'
  //     - AdditionalAccountID = '2'
  //     - TaxLevelCode listName="49" → R-99-PN
  //     - TaxScheme ID='ZZ' Name='No aplica'
  //     - RegistrationAddress (igual que jurídica)

  const demoCustomers = [
    // ── Persona Jurídica NIT ──────────────────────────────────────────────
    {
      documentType:   'NIT' as const,
      documentNumber: '800200300-5',
      name:           'DISTRIBUIDORA NACIONAL S.A.S.',
      email:          'compras@distribuidora.com',
      phone:          '6012223344',
      address:        'Carrera 15 # 93-47',
      city:           'Bogotá, D.C.',
      department:     'Bogotá',
      country:        'CO',
      cityCode:       '11001',   // DIVIPOLA Bogotá
      departmentCode: '11',      // ISO 3166-2:CO-DC
      creditDays:     30,
    },
    {
      documentType:   'NIT' as const,
      documentNumber: '860001234-2',
      name:           'COMERCIALIZADORA DEL VALLE LTDA',
      email:          'facturas@covalle.com',
      phone:          '6024456677',
      address:        'Calle 5 # 38-25 Piso 3',
      city:           'Cali',
      department:     'Valle del Cauca',
      country:        'CO',
      cityCode:       '76001',   // DIVIPOLA Cali
      departmentCode: '76',      // ISO 3166-2:CO-VAC
      creditDays:     60,
    },
    {
      documentType:   'NIT' as const,
      documentNumber: '901234567-3',
      name:           'TECH SOLUTIONS COLOMBIA S.A.S.',
      email:          'admin@techsol.co',
      phone:          '6013334455',
      address:        'Av. El Dorado # 68C-61 Of. 502',
      city:           'Bogotá, D.C.',
      department:     'Bogotá',
      country:        'CO',
      cityCode:       '11001',
      departmentCode: '11',
      creditDays:     30,
    },
    {
      documentType:   'NIT' as const,
      documentNumber: '890903938-8',
      name:           'BANCOLOMBIA S.A.',
      email:          'servicios@bancolombia.com.co',
      phone:          '6044441111',
      address:        'Carrera 48 # 26-85',
      city:           'Medellín',
      department:     'Antioquia',
      country:        'CO',
      cityCode:       '05001',   // DIVIPOLA Medellín
      departmentCode: '05',      // ISO 3166-2:CO-ANT
      creditDays:     0,
    },
    {
      documentType:   'NIT' as const,
      documentNumber: '900108281-1',
      // Exactamente el mismo cliente del XML de ejemplo de la Caja de Herramientas (Genérica.xml)
      name:           'OPTICAS GMO COLOMBIA S.A.S.',
      email:          'compras@opticasgmo.com',
      phone:          '6013005500',
      address:        'Carrera 9A # 99-07 Of. 802',
      city:           'Bogotá, D.C.',
      department:     'Bogotá',
      country:        'CO',
      cityCode:       '11001',
      departmentCode: '11',
      creditDays:     30,
    },
    // ── Persona Natural CC ───────────────────────────────────────────────
    {
      documentType:   'CC' as const,
      documentNumber: '12345678',
      name:           'JUAN CARLOS PÉREZ MORALES',
      email:          'juan.perez@email.com',
      phone:          '3001234567',
      address:        'Calle 50 # 45-23 Apto 301',
      city:           'Medellín',
      department:     'Antioquia',
      country:        'CO',
      cityCode:       '05001',
      departmentCode: '05',
      creditDays:     0,
    },
    {
      documentType:   'CC' as const,
      documentNumber: '52890123',
      name:           'ANDREA PATRICIA GÓMEZ TORRES',
      email:          'andrea.gomez@gmail.com',
      phone:          '3159876543',
      address:        'Carrera 11 # 80-15 Casa 7',
      city:           'Bogotá, D.C.',
      department:     'Bogotá',
      country:        'CO',
      cityCode:       '11001',
      departmentCode: '11',
      creditDays:     0,
    },
  ];

  for (const customer of demoCustomers) {
    const { cityCode, departmentCode, ...customerData } = customer as any;
    await prisma.customer.upsert({
      where: {
        companyId_documentType_documentNumber: {
          companyId:      demoCompany.id,
          documentType:   customerData.documentType,
          documentNumber: customerData.documentNumber,
        },
      },
      update: { cityCode, departmentCode } as any,
      create: { ...customerData, companyId: demoCompany.id, cityCode, departmentCode } as any,
    });
  }

  // ─── CATEGORÍAS ───────────────────────────────────────────────────────────────
  const categories = ['Tecnología', 'Servicios Profesionales', 'Papelería y Suministros', 'Muebles y Enseres'];
  const createdCategories: Record<string, string> = {};
  for (const catName of categories) {
    const cat = await prisma.category.upsert({
      where: { companyId_name: { companyId: demoCompany.id, name: catName } },
      update: {},
      create: { companyId: demoCompany.id, name: catName },
    });
    createdCategories[catName] = cat.id;
  }

  // ─── PRODUCTOS DEMO ───────────────────────────────────────────────────────────
  // Campos clave para que el XML sea aceptado por la DIAN:
  //
  //   unit:        Código UNece tabla 13.3.6 de la Caja de Herramientas
  //                  EA  = "cada" (artículo físico individual)
  //                  NIU = "número de unidades internacionales" (licencias, accesos)
  //                  HUR = "hora" (servicios por tiempo)
  //                  NAR = "número de artículos" (resmas, cajas de unidades)
  //                  ZZ  = "mutuamente definido" (cuando no aplica otro)
  //
  //   unspscCode:  Código UNSPSC (tabla 13.3.5 schemeID='001', schemeName='UNSPSC')
  //                Requerido para regla FAZ09 ("identificación del bien o servicio")
  //                Se enviará en <cac:AdditionalItemIdentification> del XML.
  //                Tomado del clasificador incluido en la Caja de Herramientas:
  //                  43211503 = Laptops / computadores portátiles
  //                  43211708 = Monitores de computador
  //                  81111500 = Servicios de consultoría en TI
  //                  44111500 = Papel de oficina (resmas, papel continuo)
  //                  56101520 = Sillas de oficina ergonómicas
  //                  43211507 = Computadores de escritorio
  //                  43222641 = Routers/acces points
  //                  81111811 = Soporte técnico en sitio
  //
  //   taxRate:     19 % IVA para bienes y servicios gravados (tabla 13.3.11)
  //   taxType:     'IVA' → TaxScheme ID='01' Name='IVA'

  const demoProducts = [
    {
      sku:         'LAP-001',
      name:        'Laptop Lenovo IdeaPad 15 AMD Ryzen 5',
      description: 'Computador portátil Lenovo IdeaPad 15 AMD Ryzen 5 8GB RAM 512GB SSD Windows 11',
      categoryId:  createdCategories['Tecnología'],
      price:       2500000,
      cost:        1800000,
      stock:       15,
      unit:        'EA',          // unitCode UNece "cada"
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '43211503',   // Laptops
    },
    {
      sku:         'MON-001',
      name:        'Monitor LG 27" Full HD IPS',
      description: 'Monitor LG 27 pulgadas Full HD IPS 75Hz HDMI DisplayPort',
      categoryId:  createdCategories['Tecnología'],
      price:       850000,
      cost:        600000,
      stock:       8,
      unit:        'EA',
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '43211708',   // Monitores
    },
    {
      sku:         'SRV-001',
      name:        'Consultoría Tecnológica',
      description: 'Servicio de consultoría tecnológica por hora - implementación y soporte',
      categoryId:  createdCategories['Servicios Profesionales'],
      price:       150000,
      cost:        80000,
      stock:       0,
      unit:        'HUR',        // hora
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '81111500',   // Consultoría TI
    },
    {
      sku:         'PAP-001',
      name:        'Resma Papel Carta 75g x500 Hojas',
      description: 'Resma de papel bond carta 75 gramos 500 hojas marca Reprograf',
      categoryId:  createdCategories['Papelería y Suministros'],
      price:       18000,
      cost:        12000,
      stock:       120,
      unit:        'NAR',        // número de artículos (resmas)
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '44111500',   // Papel de oficina
    },
    {
      sku:         'MUE-001',
      name:        'Silla Ergonómica Ejecutiva Reclinable',
      description: 'Silla ejecutiva ergonómica con soporte lumbar ajustable, reposa brazos y altura regulable',
      categoryId:  createdCategories['Muebles y Enseres'],
      price:       450000,
      cost:        280000,
      stock:       25,
      unit:        'EA',
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '56101520',   // Sillas de oficina
    },
    {
      sku:         'LAP-002',
      name:        'Laptop HP EliteBook 840 G9 Intel Core i7',
      description: 'Computador portátil HP EliteBook 840 G9 Intel Core i7 16GB RAM 512GB SSD Windows 11 Pro',
      categoryId:  createdCategories['Tecnología'],
      price:       4200000,
      cost:        3100000,
      stock:       5,
      unit:        'EA',
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '43211503',   // Laptops
    },
    {
      sku:         'SRV-002',
      name:        'Soporte Técnico en Sitio',
      description: 'Servicio de soporte técnico presencial en instalaciones del cliente por hora',
      categoryId:  createdCategories['Servicios Profesionales'],
      price:       120000,
      cost:        60000,
      stock:       0,
      unit:        'HUR',        // hora
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '81111811',   // Soporte técnico en sitio
    },
    {
      sku:         'RED-001',
      name:        'Access Point WiFi 6 TP-Link EAP670',
      description: 'Punto de acceso WiFi 6 AX3000 para empresas, montaje en techo, PoE',
      categoryId:  createdCategories['Tecnología'],
      price:       380000,
      cost:        240000,
      stock:       12,
      unit:        'EA',
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '43222641',   // Routers/access points
    },
    {
      sku:         'SRV-003',
      name:        'Licencia Software Antivirus Anual',
      description: 'Licencia anual antivirus empresarial para 1 equipo - renovación o nueva activación',
      categoryId:  createdCategories['Servicios Profesionales'],
      price:       85000,
      cost:        40000,
      stock:       0,
      unit:        'NIU',        // número de unidades internacionales (licencias)
      taxRate:     19,
      taxType:     'IVA',
    },
    {
      sku:         'PAP-002',
      name:        'Carpeta AZ Oficio Palanca Metálica',
      description: 'Carpeta AZ tamaño oficio con palanca metálica y fuelle, capacidad 500 hojas',
      categoryId:  createdCategories['Papelería y Suministros'],
      price:       12500,
      cost:        7500,
      stock:       80,
      unit:        'EA',
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '44122008',   // Carpetas / archivadores
    },
  ];

  for (const product of demoProducts) {
    const { unspscCode, ...productData } = product as any;
    await prisma.product.upsert({
      where: { companyId_sku: { companyId: demoCompany.id, sku: productData.sku } },
      update: { unspscCode } as any,
      create: { ...productData, companyId: demoCompany.id, unspscCode } as any,
    });
  }

  console.log(`\n  ✅ Empresa Demo: ${demoCompany.name}`);
  console.log(`  ✅ Admin demo:   admin@empresademo.com / Admin@123456!`);
  console.log(`  ✅ Operador:     operador@empresademo.com / Oper@123456!`);
  console.log(`  ✅ ${demoProducts.length} productos con código UNSPSC y unidad UNece`);
  console.log(`  ✅ ${demoCustomers.length} clientes con DIVIPOLA y campos DIAN`);

  console.log('\n🎉 Seed completado exitosamente!\n');
  console.log('📋 Credenciales:');
  console.log('  Super Admin: superadmin@beccafact.com / BeccaFact@2025!');
  console.log('  Admin Demo:  admin@empresademo.com / Admin@123456!');
  console.log('  Operador:    operador@empresademo.com / Oper@123456!');
  console.log('\n📌 Datos DIAN en clientes:');
  console.log('  - cityCode (DIVIPOLA), departmentCode (ISO 3166-2:CO)');
  console.log('  - NIT → schemeID=31, AdditionalAccountID=1, TaxLevelCode listName=04');
  console.log('  - CC  → schemeID=13, AdditionalAccountID=2, TaxLevelCode listName=49');
  console.log('\n📌 Datos DIAN en productos:');
  console.log('  - unit: EA/HUR/NIU/NAR (tabla 13.3.6 UNece)');
  console.log('  - unspscCode (tabla 13.3.5 UNSPSC schemeID=001)');
  console.log('  - taxType: IVA → TaxScheme ID=01 Name=IVA');
}

main()
  .catch((e) => { console.error('❌ Error en seed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());