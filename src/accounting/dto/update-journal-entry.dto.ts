import { PartialType } from '@nestjs/swagger';
import { CreateJournalEntryDto } from './create-journal-entry.dto';

// Solo los comprobantes en estado DRAFT pueden actualizarse
export class UpdateJournalEntryDto extends PartialType(CreateJournalEntryDto) {}
