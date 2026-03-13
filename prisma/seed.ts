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

// ─── Certificado real BECCASOFT SAS (GSE / Andes SCD) ────────────────────────
// NIT: 902043550  |  CN: BECCASOFT SAS
// Válido: 2026-03-10 → 2027-03-10  |  P12 password: Sirweb123*
const BECCASOFT_CERT = 
`-----BEGIN CERTIFICATE-----
MIIHFDCCBPygAwIBAgIKUeH3Tk2JcQEdvDANBgkqhkiG9w0BAQsFADCBhjEeMBwG
CSqGSIb3DQEJARYPaW5mb0Bnc2UuY29tLmNvMSUwIwYDVQQDExxBdXRvcmlkYWQg
U3Vib3JkaW5hZGEgMDEgR1NFMQwwCgYDVQQLEwNQS0kxDDAKBgNVBAoTA0dTRTEU
MBIGA1UEBxMLQm9nb3RhIEQuQy4xCzAJBgNVBAYTAkNPMB4XDTI2MDMxMDE1Mjgx
NloXDTI3MDMxMDE1MzgxNFowgeYxGjAYBgNVBAkMEUNSIDNBIE4gMTcgU1VSIDk5
MSMwIQYDVQQNDBpGRVBKIEdTRSBDTCA3NyA3IDQ0IE9GIDcwMTEVMBMGA1UECAwM
Q1VORElOQU1BUkNBMREwDwYDVQQHDAhNT1NRVUVSQTELMAkGA1UEBhMCQ08xFjAU
BgNVBAMMDUJFQ0NBU09GVCBTQVMxGTAXBgorBgEEAaRmAQMCDAk5MDIwNDM1NTAx
DDAKBgNVBCkMA05JVDESMBAGA1UEBRMJOTAyMDQzNTUwMRcwFQYDVQQLDA5BRE1J
TklTVFJBQ0lPTjCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAJAFC0lu
oG387TMIQ5hFxpF498QFzpTA6q79akA5Xl0IU3KjTd0HfLcD3cp705z0T6iI9Jp8
YyLM4SfNMFTlYdR0fDK6ZW7FLWNo5mWF4klIiV1cR3ikT5z6MLuX1/UsR7FXcq8F
oW7NokWtZ3nbkHzhgkCCAbxc4XDsBRJQruqdktunVRpgYrdJHjf8wQwvXVMJwd6e
GB1vuu+aIEHj1K7f7DZDXPpQhCRzSFjsgC8M13pvmeecjq+wsMaBGm6t0oa46dkR
eF1TSJyN7PoY/K9C7pTM8XCbOkl9L9Feb73Y02DRZGU8lHNdYNbp1ctes3i/mfHJ
9hBkJckrqKwp03MCAwEAAaOCAiAwggIcMAwGA1UdEwEB/wQCMAAwHwYDVR0jBBgw
FoAUQbzUOXi4g6MXGgiaqbgEAgkt2JkwaAYIKwYBBQUHAQEEXDBaMDIGCCsGAQUF
BzAChiZodHRwczovL2NlcnRzMi5nc2UuY29tLmNvL0NBX1NVQjAxLmNydDAkBggr
BgEFBQcwAYYYaHR0cHM6Ly9vY3NwMi5nc2UuY29tLmNvMGwGA1UdEQRlMGOBFmJl
Y2Nhc29mdC5jb0BnbWFpbC5jb22GSWh0dHBzOi8vZ3NlLmNvbS5jby9kb2N1bWVu
dG9zL2NlcnRpZmljYWNpb25lcy9hY3JlZGl0YWNpb24vMTYtRUNELTAwMS5wZGYw
gYMGA1UdIAR8MHoweAYLKwYBBAGB8yABBBIwaTBnBggrBgEFBQcCARZbaHR0cHM6
Ly9nc2UuY29tLmNvL2RvY3VtZW50b3MvY2FsaWRhZC9EUEMvRGVjbGFyYWNpb25f
ZGVfUHJhY3RpY2FzX2RlX0NlcnRpZmljYWNpb25fVjIwLnBkZjAnBgNVHSUEIDAe
BggrBgEFBQcDAgYIKwYBBQUHAwQGCCsGAQUFBwMBMDUGA1UdHwQuMCwwKqAooCaG
JGh0dHBzOi8vY3JsMi5nc2UuY29tLmNvL0NBX1NVQjAxLmNybDAdBgNVHQ4EFgQU
rYnksSvVrSbCqJGEP9bXp6exYj8wDgYDVR0PAQH/BAQDAgTwMA0GCSqGSIb3DQEB
CwUAA4ICAQCFZ3+HRJUwKyBJNGQzpXMbMtSn/pgLzoByHcv94InwVwdepfdrpy18
j8h/UoX7akjHC8vOeuwlHXHG61x6NxUWoRXGljDm63iBbTIJFWRPcNR2Mne1Eauv
JafQEkhCSHN2SC7c6yirnmfVV6L7JuUMDzaNBULO+/qkp2eATheDrjvsgMRx+KhX
lt2gGChr4oFFuTVvXsH7WIC3jJfpbEXw2/4iVFoSBSkT/J+CAnRpYd0Ol7YhlXjj
oTm5b96r8L6ANgk+vJaajfZlIfvkqRyFZmRxwcUgvGEuvPDbSwlpMycsPadqDx7g
V8sr6gfNCrgUJ3Qm1fdT0DzCEcrAKBc4M3oy84dkmhjh5+JQRCDG0VVxSGlYFSe4
639HOT4xgokMHtHZ3bzVdt+fR6a8qyTI/MNjcItoTpVvGMSEc1/RM2E7mPkrrxO1
284vb26uc8QJUFhXwHqGDT2T5KxysXsoRWqYk7VkdiXP6BfiG55SJG23qR/jc41N
JG7f4C/D6CYNZSzaKrywC7wqCXh0Y55MLeQ2ejzJeXkeKh0PlpRhFmtctgrOtq4J
Qu/HDAruh+P5ig1o7lpBUd+f4Q93n52OJKi5hfcZI4hLaf6whMa1HL2p86V/L8fw
QoMhE14yDzMpSY75w55sFax4UVXWOf/8LCjpzTRqBSeAHmDXPvFW9Q==
-----END CERTIFICATE-----`;

const BECCASOFT_KEY = 
`-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCQBQtJbqBt/O0z
CEOYRcaRePfEBc6UwOqu/WpAOV5dCFNyo03dB3y3A93Ke9Oc9E+oiPSafGMizOEn
zTBU5WHUdHwyumVuxS1jaOZlheJJSIldXEd4pE+c+jC7l9f1LEexV3KvBaFuzaJF
rWd525B84YJAggG8XOFw7AUSUK7qnZLbp1UaYGK3SR43/MEML11TCcHenhgdb7rv
miBB49Su3+w2Q1z6UIQkc0hY7IAvDNd6b5nnnI6vsLDGgRpurdKGuOnZEXhdU0ic
jez6GPyvQu6UzPFwmzpJfS/RXm+92NNg0WRlPJRzXWDW6dXLXrN4v5nxyfYQZCXJ
K6isKdNzAgMBAAECggEAIgq/Lz1R+I2Xd7+VUrHzjME+N3xz5x9umaxW6BVnY7Ar
IWbOaddyOERWsZzxWSE6jwjIYJfUSw6IjgLnULnjlPdvwAHlJfi/kMbj5s1tvorB
xWqhjjewhddxm3X52v77d0THW+2Fyg4bNEMXuWsXzRz0z9CrHl4J/8oaLMkbf2Mh
VCsjWJsfFkEal0s1Hw0rRxT+Xl7WwWdhbY8ZhrfkZvG8BL+aZ6MelXKYaiMfnKHK
FziOnWq9BgzEJAsMaXc60UbXE3ln+WkrEK5xQD8oTJjGlyNoVJ395iAgxJvg+9C/
Hkjrdz2pWhq/MARNjXdjIxEUyaxbMEd1VmZx+7xjuQKBgQDnHGZ2+Ss6D16HkcYp
CShc4pvkt2Y5iwG9VFx/YkCw5ZOgRT61QugOMQ+EYDNbiNRrqe2LJHT1NS9whxAq
O4bbuFTqckCsMETL41lvtszOX/GhIeFyzXJ2ey/Eqw5e1enJ55TMaF3p+t04Ravf
g58ID4IOq/pE+mqsxIim1ScIfwKBgQCfh5ZH2ViYVJ+hXi5S9ouuavifeSIA+XtY
oY+11Moa/1GAu7In/DIriuUD9q6BNsOnq6Uch1edsjM2ndEC5f/gRfW7cVFo7O82
cSk4SiYlbE1uszi2Lg147QX2jGoeCE/lNzMDTZzEnkbb5FNFU518AgAnQ1i5r2vz
5956GDcbDQKBgHddosqGLT5im8dXkkq1kSRQYoZB90l3M2HPRasBWzpCiPn5accD
FInn6wTLDxuS02v8K1V3cfUIEEWFbOLzNdccILeqZR7KG25XMWVSu/tHcKxxrFi4
Jgtt2qEwXE69G3AN7TuaGA92Y3Xh/kCGYcgvAlSDnNKtqBUtuQq6AtwPAoGAW6b2
PAku0TWtEHSfgKKM1YQ3msdpNc4fg2guvHSoOKJ/HMq5LCfEWyfNM13CHBJujiIb
FizbtYnvym0Y6+VgAGWxLCOKdhHJzSluWRygldeHFRZ6epAyxUrHpkI9pUt5O2Nf
N4KbkoqsgyDGhonnbJtpoyUaEHQsPVD1jIflAPECgYEAkZelDkhJ6gyEkQZx670T
HQ+45xhr120tT8i+Q+kfaiW3cd/82HnBzPkw5R3/w0PUUzrucOH5ocsE9l/66JuB
UvrkuLpY3kyzMbi+jIHfxTin61QR8ApNwkCGDAgUKT2yddGJSNXzUtun1z6Q2ROg
1W5XLXwQQb45aUUlloPA1Qc=
-----END PRIVATE KEY-----`;

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

  // ─── EMPRESA DEMO — BECCASOFT SAS ─────────────────────────────────────────────
  // CAMBIOS vs seed original:
  //   ✅ NIT: '902043550' (sin DV, sin guión) — el DV se pone en @schemeID del XML
  //   ✅ razonSocial: 'BECCASOFT SAS' exacto del RUT → resuelve FAJ43b
  //   ✅ Dirección real según certificado GSE (Mosquera, Cundinamarca)
  //   ✅ cityCode/departmentCode del emisor (DIVIPOLA) → resuelve FAK08/FAK28/FAK32
  //   ✅ dianFechaDesde/Hasta como new Date() (no string) → resuelve FAB07b/FAB08b
  //   ✅ dianCertificate / dianCertificateKey con PEM real → resuelve ZE02
  //   ✅ Suscripción: create-only sin upsert roto
  const BECCASOFT_NIT = '902043550';
  const BECCASOFT_DV  = calcDv(BECCASOFT_NIT); // → '1'

  const empresarialPlan = await prisma.plan.findUnique({ where: { name: 'EMPRESARIAL' } });
  const adminRole       = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  const operatorRole    = await prisma.role.findUnique({ where: { name: 'OPERATOR' } });

  // Buscar la empresa por cualquiera de los NITs que pudo haber tenido
  let demoCompany = await prisma.company.findFirst({
    where: { nit: { in: ['902043550', '902043550-1', '902043550-6', '900987654-1'] } },
  });

  if (!demoCompany) {
    demoCompany = await prisma.company.create({
      data: {
        name:        'BECCASOFT SAS',
        nit:         BECCASOFT_NIT,
        razonSocial: 'BECCASOFT SAS',
        email:       'beccasoft.co@gmail.com',
        phone:       '3214567890',
        address:     'CR 3A N 17 SUR 99',
        city:        'Mosquera',
        department:  'Cundinamarca',
        country:     'CO',
        status:      'ACTIVE',
        dianTestMode: true,
      } as any,
    });
  }

  // Actualizar TODOS los campos DIAN en un solo update
  await prisma.company.update({
    where: { id: demoCompany.id },
    data: {
      // ── Datos reales BECCASOFT SAS ────────────────────────────────────
      name:        'BECCASOFT SAS',
      nit:         BECCASOFT_NIT,   // NIT sin DV (FAK24 — el DV se calcula en el service)
      razonSocial: 'BECCASOFT SAS', // nombre exacto del RUT (FAJ43b)
      email:       'beccasoft.co@gmail.com',
      phone:       '3214567890',
      address:     'CR 3A N 17 SUR 99',
      city:        'Mosquera',
      department:  'Cundinamarca',
      country:     'CO',
      dianTestMode: true,

      // ── Ubicación DIVIPOLA (tabla 13.4.3) — FAK08/FAK28/FAK32 ────────
      cityCode:       '25473', // DIVIPOLA: Mosquera, Cundinamarca
      departmentCode: '25',    // ISO 3166-2:CO — Cundinamarca

      // ── Resolución habilitación DIAN (set de pruebas) ─────────────────
      dianResolucion: '18760000001',
      dianPrefijo:    'SETP',
      dianRangoDesde: 990000000,
      dianRangoHasta: 995000000,
      // ✅ FIX: new Date() en lugar de string — Prisma necesita Date para TIMESTAMPTZ
      dianFechaDesde: '2019-01-19',
      dianFechaHasta: '2030-01-19',

      // ── Credenciales software DIAN ────────────────────────────────────
      dianSoftwareId:   '8c2e43bd-9d57-4144-b0af-8876de5917a8',
      dianSoftwarePin:  '12345',
      dianTestSetId:    'aa87ad48-5975-46d1-b0d5-f8ed563a528e',
      dianClaveTecnica: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',

      // ── Certificado digital real GSE (NIT 902043550) — ZE02/FAD09e ───
      // PEM con saltos de línea reales. El service usa normalizePem().
      dianCertificate:    BECCASOFT_CERT,
      dianCertificateKey: BECCASOFT_KEY,
    } as any,
  });

  console.log(`  ✅ Empresa: BECCASOFT SAS (NIT ${BECCASOFT_NIT}-${BECCASOFT_DV})`);

  // Suscripción: solo crear si no existe
  if (empresarialPlan) {
    const existingSub = await prisma.subscription.findFirst({ where: { companyId: demoCompany.id } });
    if (!existingSub) {
      await prisma.subscription.create({
        data: {
          companyId: demoCompany.id,
          planId:    empresarialPlan.id,
          status:    'ACTIVE',
          startDate: new Date(),
          endDate:   new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        },
      });
    }
  }

  // ─── USUARIOS DEMO ────────────────────────────────────────────────────────────
  const adminPassword = await bcrypt.hash('Admin@123456!', 12);
  const demoAdmin = await prisma.user.upsert({
    where: { email: 'admin@empresademo.com' },
    update: {},
    create: {
      email:     'admin@empresademo.com',
      password:  adminPassword,
      firstName: 'Carlos',
      lastName:  'Rodríguez',
      companyId: demoCompany.id,
      isActive:  true,
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
  // CAMBIOS vs seed original:
  //   ✅ documentNumber: NIT SIN DV y SIN guión (ej: '800200300' no '800200300-5')
  //      El DV se calcula automáticamente en el service con calcDv() y se pone
  //      en CompanyID/@schemeID del XML → resuelve FAK24 / FAK24b
  //   ✅ update: ahora también actualiza name, city, department, address
  //      para que re-ejecutar el seed corrija datos existentes
  //
  // Campos clave por tipo de persona para el XML UBL (Anexo Técnico v1.9):
  //   NIT → schemeID=31 | AdditionalAccountID=1 | TaxLevelCode listName="04" O-99
  //         TaxScheme ID='01' Name='IVA'
  //   CC  → schemeID=13 | AdditionalAccountID=2 | TaxLevelCode listName="49" R-99-PN
  //         TaxScheme ID='ZZ' Name='No aplica'
  //   RegistrationAddress: cityCode (DIVIPOLA), city, CountrySubentityCode (2 dígitos)

  const demoCustomers = [
    // ── Persona Jurídica NIT ───────────────────────────────────────────────────
    {
      documentType:   'NIT' as const,
      documentNumber: '800200300',      // ✅ SIN DV, SIN guión
      name:           'DISTRIBUIDORA NACIONAL S.A.S.',
      email:          'compras@distribuidora.com',
      phone:          '6012223344',
      address:        'Carrera 15 # 93-47',
      city:           'Bogotá, D.C.',
      department:     'Bogotá',
      country:        'CO',
      cityCode:       '11001',          // DIVIPOLA Bogotá (tabla 13.4.3)
      departmentCode: '11',             // ISO 3166-2:CO-DC (tabla 13.4.2)
      taxLevelCode:   'ZZ',             // FAK26: responsabilidad fiscal (TipoResponsabilidad-2.1)
      creditDays:     30,
    },
    {
      documentType:   'NIT' as const,
      documentNumber: '860001234',      // ✅ SIN DV, SIN guión
      name:           'COMERCIALIZADORA DEL VALLE LTDA',
      email:          'facturas@covalle.com',
      phone:          '6024456677',
      address:        'Calle 5 # 38-25 Piso 3',
      city:           'Cali',
      department:     'Valle del Cauca',
      country:        'CO',
      cityCode:       '76001',          // DIVIPOLA Cali
      departmentCode: '76',             // ISO 3166-2:CO-VAC
      taxLevelCode:   'ZZ',             // FAK26: responsabilidad fiscal (TipoResponsabilidad-2.1)
      creditDays:     60,
    },
    {
      documentType:   'NIT' as const,
      documentNumber: '901234567',      // ✅ SIN DV, SIN guión
      name:           'TECH SOLUTIONS COLOMBIA S.A.S.',
      email:          'admin@techsol.co',
      phone:          '6013334455',
      address:        'Av. El Dorado # 68C-61 Of. 502',
      city:           'Bogotá, D.C.',
      department:     'Bogotá',
      country:        'CO',
      cityCode:       '11001',
      departmentCode: '11',
      taxLevelCode:   'ZZ',             // FAK26: responsabilidad fiscal (TipoResponsabilidad-2.1)
      creditDays:     30,
    },
    {
      documentType:   'NIT' as const,
      documentNumber: '890903938',      // ✅ SIN DV, SIN guión
      name:           'BANCOLOMBIA S.A.',
      email:          'servicios@bancolombia.com.co',
      phone:          '6044441111',
      address:        'Carrera 48 # 26-85',
      city:           'Medellín',
      department:     'Antioquia',
      country:        'CO',
      cityCode:       '05001',          // DIVIPOLA Medellín
      departmentCode: '05',             // ISO 3166-2:CO-ANT
      taxLevelCode:   'ZZ',             // FAK26: responsabilidad fiscal (TipoResponsabilidad-2.1)
      creditDays:     0,
    },
    {
      documentType:   'NIT' as const,
      documentNumber: '900108281',      // ✅ SIN DV, SIN guión
      name:           'OPTICAS GMO COLOMBIA S.A.S.',
      email:          'compras@opticasgmo.com',
      phone:          '6013005500',
      address:        'Carrera 9A # 99-07 Of. 802',
      city:           'Bogotá, D.C.',
      department:     'Bogotá',
      country:        'CO',
      cityCode:       '11001',
      departmentCode: '11',
      taxLevelCode:   'ZZ',             // FAK26: responsabilidad fiscal (TipoResponsabilidad-2.1)
      creditDays:     30,
    },
    // ── Persona Natural CC ────────────────────────────────────────────────────
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
      taxLevelCode:   'ZZ',             // FAK26: persona natural sin responsabilidad fiscal
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
      taxLevelCode:   'ZZ',             // FAK26: persona natural sin responsabilidad fiscal
      creditDays:     0,
    },
  ];

  for (const customer of demoCustomers) {
    const { cityCode, departmentCode, taxLevelCode, ...customerData } = customer as any;
    await prisma.customer.upsert({
      where: {
        companyId_documentType_documentNumber: {
          companyId:      demoCompany.id,
          documentType:   customerData.documentType,
          documentNumber: customerData.documentNumber,
        },
      },
      // ✅ FIX: update también actualiza todos los campos importantes
      update: {
        name:           customerData.name,
        email:          customerData.email,
        phone:          customerData.phone,
        address:        customerData.address,
        city:           customerData.city,
        department:     customerData.department,
        country:        customerData.country,
        taxLevelCode,   // FAK26: actualiza responsabilidad fiscal en re-seed
        cityCode,
        departmentCode,
      } as any,
      create: { ...customerData, companyId: demoCompany.id, taxLevelCode, cityCode, departmentCode } as any,
    });
  }
  console.log(`  ✅ ${demoCustomers.length} clientes con DIVIPOLA, departmentCode y NIT sin DV`);

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
  // CAMBIOS vs seed original:
  //   ✅ SRV-003: añadido unspscCode '43232700' (faltaba → FAZ09)
  //   ✅ update: ahora actualiza unit + unspscCode + price/taxRate para corregir
  //      productos existentes al re-ejecutar el seed
  //
  // unit: código UNece tabla 13.3.6 — el service lo guarda en invoice_items.unit
  //   EA  = "cada"  (artículo físico individual)
  //   HUR = "hora"  (servicios por tiempo)
  //   NIU = "número de unidades internacionales" (licencias, accesos)
  //   NAR = "número de artículos" (resmas, cajas)
  //
  // unspscCode: tabla 13.3.5 (schemeID='001', schemeName='UNSPSC') → FAZ09
  //   43211503 = Laptops / computadores portátiles
  //   43211708 = Monitores de computador
  //   81111500 = Servicios de consultoría en TI
  //   44111500 = Papel de oficina
  //   56101520 = Sillas de oficina ergonómicas
  //   43211503 = Laptops HP (mismo código)
  //   81111811 = Soporte técnico en sitio
  //   43222641 = Routers / access points
  //   43232700 = Software de seguridad
  //   44122008 = Carpetas / archivadores

  const demoProducts = [
    {
      sku:         'LAP-001',
      name:        'Laptop Lenovo IdeaPad 15 AMD Ryzen 5',
      description: 'Computador portátil Lenovo IdeaPad 15 AMD Ryzen 5 8GB RAM 512GB SSD Windows 11',
      categoryId:  createdCategories['Tecnología'],
      price:       2500000,
      cost:        1800000,
      stock:       15,
      unit:        'EA',
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '43211503',
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
      unspscCode:  '43211708',
    },
    {
      sku:         'SRV-001',
      name:        'Consultoría Tecnológica',
      description: 'Servicio de consultoría tecnológica por hora - implementación y soporte',
      categoryId:  createdCategories['Servicios Profesionales'],
      price:       150000,
      cost:        80000,
      stock:       0,
      unit:        'HUR',
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '81111500',
    },
    {
      sku:         'PAP-001',
      name:        'Resma Papel Carta 75g x500 Hojas',
      description: 'Resma de papel bond carta 75 gramos 500 hojas marca Reprograf',
      categoryId:  createdCategories['Papelería y Suministros'],
      price:       18000,
      cost:        12000,
      stock:       120,
      unit:        'NAR',
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '44111500',
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
      unspscCode:  '56101520',
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
      unspscCode:  '43211503',
    },
    {
      sku:         'SRV-002',
      name:        'Soporte Técnico en Sitio',
      description: 'Servicio de soporte técnico presencial en instalaciones del cliente por hora',
      categoryId:  createdCategories['Servicios Profesionales'],
      price:       120000,
      cost:        60000,
      stock:       0,
      unit:        'HUR',
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '81111811',
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
      unspscCode:  '43222641',
    },
    {
      sku:         'SRV-003',
      name:        'Licencia Software Antivirus Anual',
      description: 'Licencia anual antivirus empresarial para 1 equipo - renovación o nueva activación',
      categoryId:  createdCategories['Servicios Profesionales'],
      price:       85000,
      cost:        40000,
      stock:       0,
      unit:        'NIU',
      taxRate:     19,
      taxType:     'IVA',
      unspscCode:  '43232700',  // ✅ FIX: faltaba en el seed original → FAZ09
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
      unspscCode:  '44122008',
    },
  ];

  for (const product of demoProducts) {
    const { unspscCode, ...productData } = product as any;
    await prisma.product.upsert({
      where: { companyId_sku: { companyId: demoCompany.id, sku: productData.sku } },
      // ✅ FIX: update incluye unit + unspscCode para corregir registros existentes
      update: {
        unit:       productData.unit,
        unspscCode,
        price:      productData.price,
        cost:       productData.cost,
        taxRate:    productData.taxRate,
      } as any,
      create: { ...productData, companyId: demoCompany.id, unspscCode } as any,
    });
  }
  console.log(`  ✅ ${demoProducts.length} productos con UNSPSC y unidad UNece`);

  console.log(`\n  ✅ Empresa:  BECCASOFT SAS (NIT ${BECCASOFT_NIT}-${BECCASOFT_DV})`);
  console.log(`  ✅ Admin:    admin@empresademo.com / Admin@123456!`);
  console.log(`  ✅ Operador: operador@empresademo.com / Oper@123456!`);

  console.log('\n🎉 Seed completado exitosamente!\n');
  console.log('📋 Credenciales:');
  console.log('  Super Admin: superadmin@beccafact.com / BeccaFact@2025!');
  console.log('  Admin Demo:  admin@empresademo.com / Admin@123456!');
  console.log('  Operador:    operador@empresademo.com / Oper@123456!');
  console.log('\n🏢 Empresa:');
  console.log(`  BECCASOFT SAS | NIT ${BECCASOFT_NIT}-${BECCASOFT_DV} | Mosquera, Cundinamarca`);
  console.log('  cityCode=25473 | departmentCode=25 | Certificado GSE 2026→2027 ✅');
  console.log('\n📌 Datos DIAN — clientes:');
  console.log('  - documentNumber: NIT SIN DV (el DV se calcula en el service → FAK24)');
  console.log('  - cityCode (DIVIPOLA): 11001=Bogotá, 05001=Medellín, 76001=Cali');
  console.log('  - departmentCode: 11=Bogotá, 05=Antioquia, 76=Valle del Cauca');
  console.log('  - NIT → AdditionalAccountID=1, TaxLevelCode listName="04" O-99');
  console.log('  - CC  → AdditionalAccountID=2, TaxLevelCode listName="49" R-99-PN');
  console.log('\n📌 Datos DIAN — productos:');
  console.log('  - unit: EA/HUR/NIU/NAR (tabla 13.3.6 UNece)');
  console.log('  - unspscCode (tabla 13.3.5 UNSPSC schemeID=001) → resuelve FAZ09');
  console.log('  - taxType: IVA → TaxScheme ID=01 Name=IVA');
}

main()
  .catch((e) => { console.error('❌ Error en seed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());