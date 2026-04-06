import { PartialType } from '@nestjs/swagger';
import { CreateAccountDto } from './create-account.dto';

// Todos los campos de CreateAccountDto son opcionales al actualizar
export class UpdateAccountDto extends PartialType(CreateAccountDto) {}
