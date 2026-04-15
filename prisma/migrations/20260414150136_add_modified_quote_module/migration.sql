-- DropForeignKey
ALTER TABLE "payroll_approval_requests" DROP CONSTRAINT "payroll_approval_requests_payrollBatchId_fkey";

-- DropForeignKey
ALTER TABLE "payroll_approval_requests" DROP CONSTRAINT "payroll_approval_requests_payrollRecordId_fkey";

-- AlterTable
ALTER TABLE "payroll_accounting_profiles" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameForeignKey
ALTER TABLE "payroll_dian_processing_jobs" RENAME CONSTRAINT "payroll_dian_processing_jobs_batch_fkey" TO "payroll_dian_processing_jobs_payrollBatchId_fkey";

-- RenameForeignKey
ALTER TABLE "payroll_dian_processing_jobs" RENAME CONSTRAINT "payroll_dian_processing_jobs_branch_fkey" TO "payroll_dian_processing_jobs_branchId_fkey";

-- RenameForeignKey
ALTER TABLE "payroll_dian_processing_jobs" RENAME CONSTRAINT "payroll_dian_processing_jobs_company_fkey" TO "payroll_dian_processing_jobs_companyId_fkey";

-- RenameForeignKey
ALTER TABLE "payroll_dian_processing_jobs" RENAME CONSTRAINT "payroll_dian_processing_jobs_record_fkey" TO "payroll_dian_processing_jobs_payrollRecordId_fkey";

-- RenameForeignKey
ALTER TABLE "payroll_dian_processing_jobs" RENAME CONSTRAINT "payroll_dian_processing_jobs_triggered_by_fkey" TO "payroll_dian_processing_jobs_triggeredById_fkey";

-- AddForeignKey
ALTER TABLE "payroll_approval_requests" ADD CONSTRAINT "payroll_approval_requests_payrollBatchId_fkey" FOREIGN KEY ("payrollBatchId") REFERENCES "payroll_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_approval_requests" ADD CONSTRAINT "payroll_approval_requests_payrollRecordId_fkey" FOREIGN KEY ("payrollRecordId") REFERENCES "payroll_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "payroll_approval_requests_company_batch_action_status_idx" RENAME TO "payroll_approval_requests_companyId_payrollBatchId_actionTy_idx";

-- RenameIndex
ALTER INDEX "payroll_approval_requests_company_record_action_status_idx" RENAME TO "payroll_approval_requests_companyId_payrollRecordId_actionT_idx";

-- RenameIndex
ALTER INDEX "payroll_attachments_company_record_idx" RENAME TO "payroll_attachments_companyId_payrollRecordId_idx";

-- RenameIndex
ALTER INDEX "payroll_dian_processing_jobs_batch_idx" RENAME TO "payroll_dian_processing_jobs_payrollBatchId_idx";

-- RenameIndex
ALTER INDEX "payroll_dian_processing_jobs_branch_idx" RENAME TO "payroll_dian_processing_jobs_branchId_idx";

-- RenameIndex
ALTER INDEX "payroll_dian_processing_jobs_company_status_created_idx" RENAME TO "payroll_dian_processing_jobs_companyId_status_createdAt_idx";

-- RenameIndex
ALTER INDEX "payroll_dian_processing_jobs_record_idx" RENAME TO "payroll_dian_processing_jobs_payrollRecordId_idx";

-- RenameIndex
ALTER INDEX "payroll_employment_events_companyId_employeeId_effectiveDate_id" RENAME TO "payroll_employment_events_companyId_employeeId_effectiveDat_idx";

-- RenameIndex
ALTER INDEX "payroll_enterprise_rules_companyId_processArea_actionType_isA_i" RENAME TO "payroll_enterprise_rules_companyId_processArea_actionType_i_idx";
