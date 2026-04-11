import { 
  IsString, 
  IsEmail, 
  IsNumber, 
  IsOptional, 
  IsNotEmpty, 
  IsISO8601, 
  Length, 
  Min
} from 'class-validator';
import { PartialType } from '@nestjs/swagger'; // Opcional, si usas Swagger

export class CreateEmployeeDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsNotEmpty({ message: 'El tipo de documento es obligatorio' })
  @IsString()
  @Length(2, 5) // CC, CE, NIT, etc.
  documentType: string;

  @IsNotEmpty({ message: 'El número de documento es obligatorio' })
  @IsString()
  @Length(5, 20)
  documentNumber: string;

  @IsNotEmpty()
  @IsString()
  firstName: string;

  @IsNotEmpty()
  @IsString()
  lastName: string;

  @IsOptional()
  @IsEmail({}, { message: 'El formato del correo electrónico no es válido' })
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsNotEmpty()
  @IsString()
  position: string;

  @IsNumber()
  @Min(0, { message: 'El salario base no puede ser negativo' })
  baseSalary: number;

  @IsNotEmpty()
  @IsString()
  contractType: string;

  @IsNotEmpty()
  @IsISO8601({}, { message: 'La fecha de ingreso debe tener formato YYYY-MM-DD' })
  hireDate: string;

  @IsOptional()
  @IsISO8601({}, { message: 'La fecha fin debe tener formato YYYY-MM-DD' })
  contractEndDate?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  @Length(5, 5, { message: 'El código DIVIPOLA debe tener exactamente 5 dígitos' })
  cityCode?: string;

  @IsOptional()
  @IsString()
  departmentCode?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @IsOptional()
  @IsString()
  bankAccount?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankCode?: string;

  @IsOptional()
  @IsString()
  payrollPolicyId?: string;

  @IsOptional()
  @IsString()
  payrollTypeConfigId?: string;
}

export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}
