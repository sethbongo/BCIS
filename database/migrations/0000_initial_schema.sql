CREATE TYPE "public"."adjustment_type" AS ENUM('DEBIT', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."allocation_type" AS ENUM('AUTO', 'MANUAL', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."batch_outcome" AS ENUM('PENDING', 'COLLECTED', 'PARTIAL', 'NOT_HOME', 'PROMISED', 'REFUSED');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('OPEN', 'IN_PROGRESS', 'SUBMITTED', 'REMITTED', 'RECONCILED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."invoice_item_type" AS ENUM('SUBSCRIPTION', 'INSTALLATION_FEE', 'RECONNECTION_FEE', 'DISCOUNT', 'PENALTY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID', 'CREDITED');--> statement-breakpoint
CREATE TYPE "public"."invoice_type" AS ENUM('MONTHLY', 'ONE_TIME');--> statement-breakpoint
CREATE TYPE "public"."ledger_source" AS ENUM('INVOICE', 'INVOICE_VOID', 'PAYMENT', 'PAYMENT_REVERSAL', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'GCASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('POSTED', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."proof_status" AS ENUM('PENDING', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('ISSUED', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."reconnection_status" AS ENUM('REQUESTED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."service_account_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'DISCONNECTED', 'TERMINATED');--> statement-breakpoint
CREATE TYPE "public"."service_type_code" AS ENUM('INTERNET', 'CABLE', 'COMBO');--> statement-breakpoint
CREATE TYPE "public"."subscriber_status" AS ENUM('ACTIVE', 'INACTIVE', 'TERMINATED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."variance_type" AS ENUM('BALANCED', 'SHORTAGE', 'OVERAGE');--> statement-breakpoint
CREATE TABLE "adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"adjustment_no" varchar(20) NOT NULL,
	"subscriber_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"type" "adjustment_type" NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjustments_adjustmentNo_unique" UNIQUE("adjustment_no"),
	CONSTRAINT "adjustments_amount_ck" CHECK (amount > 0)
);
--> statement-breakpoint
CREATE TABLE "application_settings" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" integer,
	"actor_username" varchar(40),
	"action" varchar(60) NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" varchar(40),
	"subscriber_id" integer,
	"reason" text,
	"old_values" jsonb,
	"new_values" jsonb,
	"ip" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "backup_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(10) NOT NULL,
	"name" varchar(80) NOT NULL,
	"status" varchar(12) NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"checksum" char(64),
	"verified_at" timestamp with time zone,
	"verification_result" text,
	"notes" text,
	"created_by" integer,
	"created_by_name" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"subscriber_id" integer NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"current_bill" bigint DEFAULT 0 NOT NULL,
	"arrears" bigint DEFAULT 0 NOT NULL,
	"total_due" bigint DEFAULT 0 NOT NULL,
	"collected_amount" bigint DEFAULT 0 NOT NULL,
	"outcome" "batch_outcome" DEFAULT 'PENDING' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "billing_cycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" char(7) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"last_generated_at" timestamp with time zone,
	"last_generated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_cycles_period_unique" UNIQUE("period")
);
--> statement-breakpoint
CREATE TABLE "collection_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"route_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_areas_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "collection_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_no" varchar(20) NOT NULL,
	"collector_id" integer NOT NULL,
	"area_id" integer NOT NULL,
	"collection_date" date NOT NULL,
	"status" "batch_status" DEFAULT 'OPEN' NOT NULL,
	"expected_total" bigint DEFAULT 0 NOT NULL,
	"cash_collected" bigint DEFAULT 0 NOT NULL,
	"non_cash_collected" bigint DEFAULT 0 NOT NULL,
	"cash_remitted" bigint DEFAULT 0 NOT NULL,
	"difference" bigint DEFAULT 0 NOT NULL,
	"variance_type" "variance_type",
	"variance_reason" text,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"reconciled_by" integer,
	"reconciled_at" timestamp with time zone,
	"closed_by" integer,
	"closed_at" timestamp with time zone,
	CONSTRAINT "collection_batches_batchNo_unique" UNIQUE("batch_no"),
	CONSTRAINT "collection_batches_variance_ck" CHECK (status not in ('RECONCILED','CLOSED') or (variance_type is not null and difference = cash_remitted - cash_collected and ((variance_type = 'BALANCED') = (difference = 0)) and (difference = 0 or variance_reason is not null)))
);
--> statement-breakpoint
CREATE TABLE "collector_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"collector_id" integer NOT NULL,
	"area_id" integer NOT NULL,
	"assigned_from" date NOT NULL,
	"assigned_to" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"assigned_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collector_remittances" (
	"id" serial PRIMARY KEY NOT NULL,
	"remittance_no" varchar(20) NOT NULL,
	"batch_id" integer NOT NULL,
	"collector_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"notes" text,
	"received_by" integer,
	"remitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collector_remittances_remittanceNo_unique" UNIQUE("remittance_no"),
	CONSTRAINT "collector_remittances_amount_ck" CHECK (amount >= 0)
);
--> statement-breakpoint
CREATE TABLE "collectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"phone" varchar(20),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collectors_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"item_type" "invoice_item_type" NOT NULL,
	"description" varchar(200) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount" bigint NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "invoice_items_amount_ck" CHECK (amount = quantity * unit_amount and quantity > 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_no" varchar(20),
	"type" "invoice_type" DEFAULT 'MONTHLY' NOT NULL,
	"subscriber_id" integer NOT NULL,
	"service_account_id" integer NOT NULL,
	"billing_cycle_id" integer,
	"billing_period" char(7),
	"period_start" date,
	"period_end" date,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"adjustments_total" bigint DEFAULT 0 NOT NULL,
	"amount_paid" bigint DEFAULT 0 NOT NULL,
	"balance" bigint NOT NULL,
	"status" "invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by" integer,
	"voided_at" timestamp with time zone,
	"voided_by" integer,
	"void_reason" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoiceNo_unique" UNIQUE("invoice_no"),
	CONSTRAINT "invoices_amounts_ck" CHECK (total >= 0 and amount_paid >= 0 and balance >= 0 and total = subtotal - discount_total),
	CONSTRAINT "invoices_balance_ck" CHECK (status in ('VOID','DRAFT') or balance = total + adjustments_total - amount_paid),
	CONSTRAINT "invoices_finalized_ck" CHECK (status = 'DRAFT' or invoice_no is not null)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subscriber_id" integer NOT NULL,
	"service_account_id" integer,
	"entry_date" date NOT NULL,
	"source_type" "ledger_source" NOT NULL,
	"source_id" integer NOT NULL,
	"reference_no" varchar(30) NOT NULL,
	"description" varchar(200) NOT NULL,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_one_side_ck" CHECK (debit >= 0 and credit >= 0 and (debit = 0) <> (credit = 0))
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"name" varchar(30) PRIMARY KEY NOT NULL,
	"prefix" varchar(10) NOT NULL,
	"padding" integer DEFAULT 6 NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"type" "allocation_type" DEFAULT 'AUTO' NOT NULL,
	"is_reversed" boolean DEFAULT false NOT NULL,
	"reversed_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_amount_ck" CHECK (amount > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_proofs" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscriber_id" integer NOT NULL,
	"payment_id" integer,
	"method" "payment_method" DEFAULT 'GCASH' NOT NULL,
	"reference_no" varchar(80) NOT NULL,
	"sender_name" varchar(120) NOT NULL,
	"sender_number" varchar(20) NOT NULL,
	"amount" bigint NOT NULL,
	"transaction_date" date NOT NULL,
	"notes" text,
	"stored_name" varchar(80) NOT NULL,
	"file_name" varchar(200) NOT NULL,
	"mime_type" varchar(60) NOT NULL,
	"file_size" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"status" "proof_status" DEFAULT 'PENDING' NOT NULL,
	"submitted_by" integer,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	CONSTRAINT "payment_proofs_ck" CHECK (amount > 0 and (status <> 'VERIFIED' or (payment_id is not null and reviewed_by is not null and reviewed_at is not null)))
);
--> statement-breakpoint
CREATE TABLE "payment_reversals" (
	"id" serial PRIMARY KEY NOT NULL,
	"reversal_no" varchar(20) NOT NULL,
	"payment_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"reversed_by" integer NOT NULL,
	"reversed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reversals_reversalNo_unique" UNIQUE("reversal_no"),
	CONSTRAINT "payment_reversals_paymentId_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscriber_id" integer NOT NULL,
	"payment_date" date NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference_no" varchar(80),
	"notes" text,
	"status" "payment_status" DEFAULT 'POSTED' NOT NULL,
	"unapplied_amount" bigint DEFAULT 0 NOT NULL,
	"received_by" integer,
	"collector_id" integer,
	"collection_batch_id" integer,
	"idempotency_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotencyKey_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_amount_ck" CHECK (amount > 0 and unapplied_amount >= 0 and unapplied_amount <= amount)
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(60) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_no" varchar(20) NOT NULL,
	"payment_id" integer NOT NULL,
	"status" "receipt_status" DEFAULT 'ISSUED' NOT NULL,
	"issued_by" integer,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_by" integer,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"print_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "receipts_receiptNo_unique" UNIQUE("receipt_no"),
	CONSTRAINT "receipts_paymentId_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "reconnection_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_account_id" integer NOT NULL,
	"suspension_id" integer,
	"request_date" date NOT NULL,
	"completion_date" date,
	"fee_amount" bigint DEFAULT 0 NOT NULL,
	"fee_invoice_id" integer,
	"technician_user_id" integer,
	"status" "reconnection_status" DEFAULT 'REQUESTED' NOT NULL,
	"requested_by" integer,
	"completed_by" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	CONSTRAINT "roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "service_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_no" varchar(20) NOT NULL,
	"subscriber_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"address_id" integer NOT NULL,
	"activation_date" date NOT NULL,
	"billing_start_date" date NOT NULL,
	"due_day" integer NOT NULL,
	"current_rate" bigint NOT NULL,
	"monthly_discount" bigint DEFAULT 0 NOT NULL,
	"status" "service_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"collector_id" integer,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_accounts_accountNo_unique" UNIQUE("account_no"),
	CONSTRAINT "service_accounts_ck" CHECK (due_day between 1 and 28 and current_rate > 0 and monthly_discount >= 0 and monthly_discount <= current_rate)
);
--> statement-breakpoint
CREATE TABLE "service_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_account_id" integer NOT NULL,
	"event_type" varchar(40) NOT NULL,
	"from_status" varchar(20),
	"to_status" varchar(20),
	"description" text NOT NULL,
	"effective_date" date NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"service_type_id" integer NOT NULL,
	"monthly_price" bigint NOT NULL,
	"installation_fee" bigint DEFAULT 0 NOT NULL,
	"reconnection_fee" bigint DEFAULT 0 NOT NULL,
	"speed_mbps" integer,
	"channel_count" integer,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_plans_code_unique" UNIQUE("code"),
	CONSTRAINT "service_plans_price_ck" CHECK (monthly_price > 0 and installation_fee >= 0 and reconnection_fee >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" "service_type_code" NOT NULL,
	"name" varchar(60) NOT NULL,
	CONSTRAINT "service_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" char(64) NOT NULL,
	"client_name" varchar(80),
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "subscriber_addresses" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscriber_id" integer NOT NULL,
	"label" varchar(40),
	"line1" varchar(160) NOT NULL,
	"barangay" varchar(80) NOT NULL,
	"city" varchar(80) NOT NULL,
	"province" varchar(80) NOT NULL,
	"landmark" varchar(160),
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_no" varchar(20) NOT NULL,
	"first_name" varchar(80) NOT NULL,
	"last_name" varchar(80) NOT NULL,
	"full_name" varchar(170) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"alt_phone" varchar(20),
	"email" varchar(160),
	"due_day" integer DEFAULT 15 NOT NULL,
	"status" "subscriber_status" DEFAULT 'ACTIVE' NOT NULL,
	"collection_area_id" integer,
	"collector_id" integer,
	"route_sequence" integer,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscribers_accountNo_unique" UNIQUE("account_no"),
	CONSTRAINT "subscribers_due_day_ck" CHECK (due_day between 1 and 28)
);
--> statement-breakpoint
CREATE TABLE "suspension_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_account_id" integer NOT NULL,
	"reason" text NOT NULL,
	"effective_date" date NOT NULL,
	"arrears_at_suspension" bigint DEFAULT 0 NOT NULL,
	"approved_by" integer,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"lifted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(40) NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"email" varchar(160),
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_settings" ADD CONSTRAINT "application_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_history" ADD CONSTRAINT "backup_history_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_accounts" ADD CONSTRAINT "batch_accounts_batch_id_collection_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."collection_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_accounts" ADD CONSTRAINT "batch_accounts_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_cycles" ADD CONSTRAINT "billing_cycles_last_generated_by_users_id_fk" FOREIGN KEY ("last_generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_area_id_collection_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."collection_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_assignments" ADD CONSTRAINT "collector_assignments_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_assignments" ADD CONSTRAINT "collector_assignments_area_id_collection_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."collection_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_assignments" ADD CONSTRAINT "collector_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_remittances" ADD CONSTRAINT "collector_remittances_batch_id_collection_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."collection_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_remittances" ADD CONSTRAINT "collector_remittances_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_remittances" ADD CONSTRAINT "collector_remittances_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billing_cycle_id_billing_cycles_id_fk" FOREIGN KEY ("billing_cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_collection_batch_id_collection_batches_id_fk" FOREIGN KEY ("collection_batch_id") REFERENCES "public"."collection_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconnection_records" ADD CONSTRAINT "reconnection_records_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconnection_records" ADD CONSTRAINT "reconnection_records_suspension_id_suspension_records_id_fk" FOREIGN KEY ("suspension_id") REFERENCES "public"."suspension_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconnection_records" ADD CONSTRAINT "reconnection_records_fee_invoice_id_invoices_id_fk" FOREIGN KEY ("fee_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconnection_records" ADD CONSTRAINT "reconnection_records_technician_user_id_users_id_fk" FOREIGN KEY ("technician_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconnection_records" ADD CONSTRAINT "reconnection_records_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconnection_records" ADD CONSTRAINT "reconnection_records_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_plan_id_service_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."service_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_address_id_subscriber_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."subscriber_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_events" ADD CONSTRAINT "service_events_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_events" ADD CONSTRAINT "service_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_addresses" ADD CONSTRAINT "subscriber_addresses_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_collection_area_id_collection_areas_id_fk" FOREIGN KEY ("collection_area_id") REFERENCES "public"."collection_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension_records" ADD CONSTRAINT "suspension_records_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension_records" ADD CONSTRAINT "suspension_records_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjustments_invoice_idx" ON "adjustments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "audit_logs_at_idx" ON "audit_logs" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX "audit_logs_subscriber_idx" ON "audit_logs" USING btree ("subscriber_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_accounts_uq" ON "batch_accounts" USING btree ("batch_id","subscriber_id");--> statement-breakpoint
CREATE INDEX "batch_accounts_subscriber_idx" ON "batch_accounts" USING btree ("subscriber_id");--> statement-breakpoint
CREATE INDEX "collection_batches_collector_idx" ON "collection_batches" USING btree ("collector_id","collection_date");--> statement-breakpoint
CREATE INDEX "collection_batches_area_idx" ON "collection_batches" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "collection_batches_status_idx" ON "collection_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "collector_assignments_collector_idx" ON "collector_assignments" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "collector_assignments_area_idx" ON "collector_assignments" USING btree ("area_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collector_assignments_active_uq" ON "collector_assignments" USING btree ("collector_id","area_id") WHERE is_active;--> statement-breakpoint
CREATE INDEX "collector_remittances_batch_idx" ON "collector_remittances" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_account_period_uq" ON "invoices" USING btree ("service_account_id","billing_period") WHERE billing_period is not null and status <> 'VOID';--> statement-breakpoint
CREATE INDEX "invoices_subscriber_idx" ON "invoices" USING btree ("subscriber_id");--> statement-breakpoint
CREATE INDEX "invoices_due_status_idx" ON "invoices" USING btree ("due_date","status");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_period_idx" ON "invoices" USING btree ("billing_period");--> statement-breakpoint
CREATE INDEX "invoices_open_idx" ON "invoices" USING btree ("subscriber_id","due_date") WHERE balance > 0 and status in ('UNPAID','PARTIALLY_PAID','OVERDUE');--> statement-breakpoint
CREATE INDEX "ledger_subscriber_date_idx" ON "ledger_entries" USING btree ("subscriber_id","entry_date","id");--> statement-breakpoint
CREATE INDEX "ledger_source_idx" ON "ledger_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_payment_idx" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_invoice_idx" ON "payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payment_proofs_status_idx" ON "payment_proofs" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "payment_proofs_reference_idx" ON "payment_proofs" USING btree (upper(reference_no));--> statement-breakpoint
CREATE INDEX "payment_proofs_subscriber_idx" ON "payment_proofs" USING btree ("subscriber_id");--> statement-breakpoint
CREATE INDEX "payments_subscriber_idx" ON "payments" USING btree ("subscriber_id","payment_date");--> statement-breakpoint
CREATE INDEX "payments_date_idx" ON "payments" USING btree ("payment_date");--> statement-breakpoint
CREATE INDEX "payments_reference_idx" ON "payments" USING btree ("reference_no");--> statement-breakpoint
CREATE INDEX "payments_batch_idx" ON "payments" USING btree ("collection_batch_id");--> statement-breakpoint
CREATE INDEX "payments_collector_idx" ON "payments" USING btree ("collector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gcash_reference_uq" ON "payments" USING btree (upper(reference_no)) WHERE method = 'GCASH' and status = 'POSTED';--> statement-breakpoint
CREATE INDEX "receipts_status_idx" ON "receipts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reconnection_records_account_idx" ON "reconnection_records" USING btree ("service_account_id");--> statement-breakpoint
CREATE INDEX "reconnection_records_status_idx" ON "reconnection_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "service_accounts_subscriber_idx" ON "service_accounts" USING btree ("subscriber_id");--> statement-breakpoint
CREATE INDEX "service_accounts_plan_idx" ON "service_accounts" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "service_accounts_status_idx" ON "service_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "service_accounts_collector_idx" ON "service_accounts" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "service_events_account_idx" ON "service_events" USING btree ("service_account_id","effective_date");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriber_addresses_subscriber_idx" ON "subscriber_addresses" USING btree ("subscriber_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriber_addresses_primary_uq" ON "subscriber_addresses" USING btree ("subscriber_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "subscribers_name_idx" ON "subscribers" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "subscribers_phone_idx" ON "subscribers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "subscribers_area_idx" ON "subscribers" USING btree ("collection_area_id");--> statement-breakpoint
CREATE INDEX "subscribers_collector_idx" ON "subscribers" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "subscribers_status_idx" ON "subscribers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "suspension_records_account_idx" ON "suspension_records" USING btree ("service_account_id");