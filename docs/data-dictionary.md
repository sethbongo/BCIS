# Data Dictionary

Generated from the live PostgreSQL catalogue by `npm run docs:build`. Money columns are `bigint` integer centavos.

## adjustments

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('adjustments_id_seq'::regclass)` |
| adjustment_no | varchar(20) | yes |  |  |
| subscriber_id | integer | yes | FK → subscribers |  |
| invoice_id | integer | yes | FK → invoices |  |
| type | enum adjustment_type | yes |  |  |
| amount | bigint | yes |  |  |
| reason | text | yes |  |  |
| created_by | integer |  | FK → users |  |
| created_at | timestamptz | yes |  | `now()` |

Constraints:

- **CHECK** `adjustments_amount_ck`: `CHECK ((amount > 0))`
- **UNIQUE** `adjustments_adjustmentNo_unique`: `UNIQUE (adjustment_no)`

Indexes:

- `adjustments_invoice_idx`: `btree (invoice_id)`

## application_settings

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| key | varchar(60) | yes | PK |  |
| value | jsonb | yes |  |  |
| updated_by | integer |  | FK → users |  |
| updated_at | timestamptz | yes |  | `now()` |

## audit_logs

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | bigint | yes | PK | `nextval('audit_logs_id_seq'::regclass)` |
| at | timestamptz | yes |  | `now()` |
| actor_id | integer |  | FK → users |  |
| actor_username | varchar(40) |  |  |  |
| action | varchar(60) | yes |  |  |
| entity_type | varchar(40) | yes |  |  |
| entity_id | varchar(40) |  |  |  |
| subscriber_id | integer |  |  |  |
| reason | text |  |  |  |
| old_values | jsonb |  |  |  |
| new_values | jsonb |  |  |  |
| ip | varchar(64) |  |  |  |

Indexes:

- `audit_logs_actor_idx`: `btree (actor_id, at)`
- `audit_logs_at_idx`: `btree (at)`
- `audit_logs_entity_idx`: `btree (entity_type, entity_id)`
- `audit_logs_subscriber_idx`: `btree (subscriber_id)`

## backup_history

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('backup_history_id_seq'::regclas` |
| kind | varchar(10) | yes |  |  |
| name | varchar(80) | yes |  |  |
| status | varchar(12) | yes |  |  |
| size_bytes | bigint | yes |  | `0` |
| checksum | char(64) |  |  |  |
| verified_at | timestamptz |  |  |  |
| verification_result | text |  |  |  |
| notes | text |  |  |  |
| created_by | integer |  | FK → users |  |
| created_by_name | varchar(120) |  |  |  |
| created_at | timestamptz | yes |  | `now()` |

## batch_accounts

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('batch_accounts_id_seq'::regclas` |
| batch_id | integer | yes | FK → collection_batches |  |
| subscriber_id | integer | yes | FK → subscribers |  |
| sequence | integer | yes |  | `0` |
| current_bill | bigint | yes |  | `0` |
| arrears | bigint | yes |  | `0` |
| total_due | bigint | yes |  | `0` |
| collected_amount | bigint | yes |  | `0` |
| outcome | enum batch_outcome | yes |  | `'PENDING'::batch_outcome` |
| notes | text |  |  |  |

Indexes:

- `batch_accounts_subscriber_idx`: `btree (subscriber_id)`
- `batch_accounts_uq` (unique): `btree (batch_id, subscriber_id)`

## billing_cycles

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('billing_cycles_id_seq'::regclas` |
| period | char(7) | yes |  |  |
| period_start | date | yes |  |  |
| period_end | date | yes |  |  |
| last_generated_at | timestamptz |  |  |  |
| last_generated_by | integer |  | FK → users |  |
| created_at | timestamptz | yes |  | `now()` |

Constraints:

- **UNIQUE** `billing_cycles_period_unique`: `UNIQUE (period)`

## collection_areas

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('collection_areas_id_seq'::regcl` |
| code | varchar(20) | yes |  |  |
| name | varchar(100) | yes |  |  |
| description | text |  |  |  |
| route_notes | text |  |  |  |
| is_active | boolean | yes |  | `true` |
| created_at | timestamptz | yes |  | `now()` |

Constraints:

- **UNIQUE** `collection_areas_code_unique`: `UNIQUE (code)`

## collection_batches

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('collection_batches_id_seq'::reg` |
| batch_no | varchar(20) | yes |  |  |
| collector_id | integer | yes | FK → collectors |  |
| area_id | integer | yes | FK → collection_areas |  |
| collection_date | date | yes |  |  |
| status | enum batch_status | yes |  | `'OPEN'::batch_status` |
| expected_total | bigint | yes |  | `0` |
| cash_collected | bigint | yes |  | `0` |
| non_cash_collected | bigint | yes |  | `0` |
| cash_remitted | bigint | yes |  | `0` |
| difference | bigint | yes |  | `0` |
| variance_type | enum variance_type |  |  |  |
| variance_reason | text |  |  |  |
| notes | text |  |  |  |
| created_by | integer |  | FK → users |  |
| created_at | timestamptz | yes |  | `now()` |
| started_at | timestamptz |  |  |  |
| submitted_at | timestamptz |  |  |  |
| reconciled_by | integer |  | FK → users |  |
| reconciled_at | timestamptz |  |  |  |
| closed_by | integer |  | FK → users |  |
| closed_at | timestamptz |  |  |  |

Constraints:

- **CHECK** `collection_batches_variance_ck`: `CHECK (((status <> ALL (ARRAY['RECONCILED'::batch_status, 'CLOSED'::batch_status])) OR ((variance_type IS NOT NULL) AND (difference = (cash_remitted - cash_collected)) AND ((variance_type = 'BALANCED'::variance_type) = (difference = 0)) AND ((difference = 0) OR (variance_reason IS NOT NULL)))))`
- **UNIQUE** `collection_batches_batchNo_unique`: `UNIQUE (batch_no)`

Indexes:

- `collection_batches_area_idx`: `btree (area_id)`
- `collection_batches_collector_idx`: `btree (collector_id, collection_date)`
- `collection_batches_status_idx`: `btree (status)`

## collector_assignments

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('collector_assignments_id_seq'::` |
| collector_id | integer | yes | FK → collectors |  |
| area_id | integer | yes | FK → collection_areas |  |
| assigned_from | date | yes |  |  |
| assigned_to | date |  |  |  |
| is_active | boolean | yes |  | `true` |
| assigned_by | integer |  | FK → users |  |
| created_at | timestamptz | yes |  | `now()` |

Indexes:

- `collector_assignments_active_uq` (unique): `btree (collector_id, area_id) WHERE is_active`
- `collector_assignments_area_idx`: `btree (area_id)`
- `collector_assignments_collector_idx`: `btree (collector_id)`

## collector_remittances

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('collector_remittances_id_seq'::` |
| remittance_no | varchar(20) | yes |  |  |
| batch_id | integer | yes | FK → collection_batches |  |
| collector_id | integer | yes | FK → collectors |  |
| amount | bigint | yes |  |  |
| notes | text |  |  |  |
| received_by | integer |  | FK → users |  |
| remitted_at | timestamptz | yes |  | `now()` |

Constraints:

- **CHECK** `collector_remittances_amount_ck`: `CHECK ((amount >= 0))`
- **UNIQUE** `collector_remittances_remittanceNo_unique`: `UNIQUE (remittance_no)`

Indexes:

- `collector_remittances_batch_idx`: `btree (batch_id)`

## collectors

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('collectors_id_seq'::regclass)` |
| code | varchar(20) | yes |  |  |
| full_name | varchar(120) | yes |  |  |
| phone | varchar(20) |  |  |  |
| is_active | boolean | yes |  | `true` |
| created_at | timestamptz | yes |  | `now()` |

Constraints:

- **UNIQUE** `collectors_code_unique`: `UNIQUE (code)`

## invoice_items

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('invoice_items_id_seq'::regclass` |
| invoice_id | integer | yes | FK → invoices |  |
| item_type | enum invoice_item_type | yes |  |  |
| description | varchar(200) | yes |  |  |
| quantity | integer | yes |  | `1` |
| unit_amount | bigint | yes |  |  |
| amount | bigint | yes |  |  |

Constraints:

- **CHECK** `invoice_items_amount_ck`: `CHECK (((amount = (quantity * unit_amount)) AND (quantity > 0)))`

Indexes:

- `invoice_items_invoice_idx`: `btree (invoice_id)`

## invoices

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('invoices_id_seq'::regclass)` |
| invoice_no | varchar(20) |  |  |  |
| type | enum invoice_type | yes |  | `'MONTHLY'::invoice_type` |
| subscriber_id | integer | yes | FK → subscribers |  |
| service_account_id | integer | yes | FK → service_accounts |  |
| billing_cycle_id | integer |  | FK → billing_cycles |  |
| billing_period | char(7) |  |  |  |
| period_start | date |  |  |  |
| period_end | date |  |  |  |
| invoice_date | date | yes |  |  |
| due_date | date | yes |  |  |
| subtotal | bigint | yes |  |  |
| discount_total | bigint | yes |  | `0` |
| total | bigint | yes |  |  |
| adjustments_total | bigint | yes |  | `0` |
| amount_paid | bigint | yes |  | `0` |
| balance | bigint | yes |  |  |
| status | enum invoice_status | yes |  | `'DRAFT'::invoice_status` |
| finalized_at | timestamptz |  |  |  |
| finalized_by | integer |  | FK → users |  |
| voided_at | timestamptz |  |  |  |
| voided_by | integer |  | FK → users |  |
| void_reason | text |  |  |  |
| created_by | integer |  | FK → users |  |
| created_at | timestamptz | yes |  | `now()` |

Constraints:

- **CHECK** `invoices_amounts_ck`: `CHECK (((total >= 0) AND (amount_paid >= 0) AND (balance >= 0) AND (total = (subtotal - discount_total))))`
- **CHECK** `invoices_balance_ck`: `CHECK (((status = ANY (ARRAY['VOID'::invoice_status, 'DRAFT'::invoice_status])) OR (balance = ((total + adjustments_total) - amount_paid))))`
- **CHECK** `invoices_finalized_ck`: `CHECK (((status = 'DRAFT'::invoice_status) OR (invoice_no IS NOT NULL)))`
- **UNIQUE** `invoices_invoiceNo_unique`: `UNIQUE (invoice_no)`

Indexes:

- `invoices_account_period_uq` (unique): `btree (service_account_id, billing_period) WHERE ((billing_period IS NOT NULL) AND (status <> 'VOID'::invoice_status))`
- `invoices_due_status_idx`: `btree (due_date, status)`
- `invoices_open_idx`: `btree (subscriber_id, due_date) WHERE ((balance > 0) AND (status = ANY (ARRAY['UNPAID'::invoice_status, 'PARTIALLY_PAID'::invoice_status, 'OVERDUE'::invoice_status])))`
- `invoices_period_idx`: `btree (billing_period)`
- `invoices_status_idx`: `btree (status)`
- `invoices_subscriber_idx`: `btree (subscriber_id)`

## ledger_entries

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | bigint | yes | PK | `nextval('ledger_entries_id_seq'::regclas` |
| subscriber_id | integer | yes | FK → subscribers |  |
| service_account_id | integer |  | FK → service_accounts |  |
| entry_date | date | yes |  |  |
| source_type | enum ledger_source | yes |  |  |
| source_id | integer | yes |  |  |
| reference_no | varchar(30) | yes |  |  |
| description | varchar(200) | yes |  |  |
| debit | bigint | yes |  | `0` |
| credit | bigint | yes |  | `0` |
| created_by | integer |  | FK → users |  |
| created_at | timestamptz | yes |  | `now()` |

Constraints:

- **CHECK** `ledger_one_side_ck`: `CHECK (((debit >= 0) AND (credit >= 0) AND ((debit = 0) <> (credit = 0))))`

Indexes:

- `ledger_source_idx`: `btree (source_type, source_id)`
- `ledger_subscriber_date_idx`: `btree (subscriber_id, entry_date, id)`

## number_sequences

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| name | varchar(30) | yes | PK |  |
| prefix | varchar(10) | yes |  |  |
| padding | integer | yes |  | `6` |
| next_value | bigint | yes |  | `1` |

## payment_allocations

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('payment_allocations_id_seq'::re` |
| payment_id | integer | yes | FK → payments |  |
| invoice_id | integer | yes | FK → invoices |  |
| amount | bigint | yes |  |  |
| type | enum allocation_type | yes |  | `'AUTO'::allocation_type` |
| is_reversed | boolean | yes |  | `false` |
| reversed_at | timestamptz |  |  |  |
| created_by | integer |  | FK → users |  |
| created_at | timestamptz | yes |  | `now()` |

Constraints:

- **CHECK** `payment_allocations_amount_ck`: `CHECK ((amount > 0))`

Indexes:

- `payment_allocations_invoice_idx`: `btree (invoice_id)`
- `payment_allocations_payment_idx`: `btree (payment_id)`

## payment_proofs

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('payment_proofs_id_seq'::regclas` |
| subscriber_id | integer | yes | FK → subscribers |  |
| payment_id | integer |  | FK → payments |  |
| method | enum payment_method | yes |  | `'GCASH'::payment_method` |
| reference_no | varchar(80) | yes |  |  |
| sender_name | varchar(120) | yes |  |  |
| sender_number | varchar(20) | yes |  |  |
| amount | bigint | yes |  |  |
| transaction_date | date | yes |  |  |
| notes | text |  |  |  |
| stored_name | varchar(80) | yes |  |  |
| file_name | varchar(200) | yes |  |  |
| mime_type | varchar(60) | yes |  |  |
| file_size | integer | yes |  |  |
| sha256 | char(64) | yes |  |  |
| status | enum proof_status | yes |  | `'PENDING'::proof_status` |
| submitted_by | integer |  | FK → users |  |
| submitted_at | timestamptz | yes |  | `now()` |
| reviewed_by | integer |  | FK → users |  |
| reviewed_at | timestamptz |  |  |  |
| rejection_reason | text |  |  |  |

Constraints:

- **CHECK** `payment_proofs_ck`: `CHECK (((amount > 0) AND ((status <> 'VERIFIED'::proof_status) OR ((payment_id IS NOT NULL) AND (reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL)))))`

Indexes:

- `payment_proofs_reference_idx`: `btree (upper((reference_no)::text))`
- `payment_proofs_status_idx`: `btree (status, submitted_at)`
- `payment_proofs_subscriber_idx`: `btree (subscriber_id)`

## payment_reversals

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('payment_reversals_id_seq'::regc` |
| reversal_no | varchar(20) | yes |  |  |
| payment_id | integer | yes | FK → payments |  |
| amount | bigint | yes |  |  |
| reason | text | yes |  |  |
| reversed_by | integer | yes | FK → users |  |
| reversed_at | timestamptz | yes |  | `now()` |

Constraints:

- **UNIQUE** `payment_reversals_paymentId_unique`: `UNIQUE (payment_id)`
- **UNIQUE** `payment_reversals_reversalNo_unique`: `UNIQUE (reversal_no)`

## payments

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('payments_id_seq'::regclass)` |
| subscriber_id | integer | yes | FK → subscribers |  |
| payment_date | date | yes |  |  |
| paid_at | timestamptz | yes |  | `now()` |
| amount | bigint | yes |  |  |
| method | enum payment_method | yes |  |  |
| reference_no | varchar(80) |  |  |  |
| notes | text |  |  |  |
| status | enum payment_status | yes |  | `'POSTED'::payment_status` |
| unapplied_amount | bigint | yes |  | `0` |
| received_by | integer |  | FK → users |  |
| collector_id | integer |  | FK → collectors |  |
| collection_batch_id | integer |  | FK → collection_batches |  |
| idempotency_key | uuid |  |  |  |
| created_at | timestamptz | yes |  | `now()` |

Constraints:

- **CHECK** `payments_amount_ck`: `CHECK (((amount > 0) AND (unapplied_amount >= 0) AND (unapplied_amount <= amount)))`
- **UNIQUE** `payments_idempotencyKey_unique`: `UNIQUE (idempotency_key)`

Indexes:

- `payments_batch_idx`: `btree (collection_batch_id)`
- `payments_collector_idx`: `btree (collector_id)`
- `payments_date_idx`: `btree (payment_date)`
- `payments_gcash_reference_uq` (unique): `btree (upper((reference_no)::text)) WHERE ((method = 'GCASH'::payment_method) AND (status = 'POSTED'::payment_status))`
- `payments_reference_idx`: `btree (reference_no)`
- `payments_subscriber_idx`: `btree (subscriber_id, payment_date)`

## permissions

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('permissions_id_seq'::regclass)` |
| code | varchar(60) | yes |  |  |
| description | text | yes |  | `''::text` |

Constraints:

- **UNIQUE** `permissions_code_unique`: `UNIQUE (code)`

## receipts

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('receipts_id_seq'::regclass)` |
| receipt_no | varchar(20) | yes |  |  |
| payment_id | integer | yes | FK → payments |  |
| status | enum receipt_status | yes |  | `'ISSUED'::receipt_status` |
| issued_by | integer |  | FK → users |  |
| issued_at | timestamptz | yes |  | `now()` |
| voided_by | integer |  | FK → users |  |
| voided_at | timestamptz |  |  |  |
| void_reason | text |  |  |  |
| print_count | integer | yes |  | `0` |

Constraints:

- **UNIQUE** `receipts_paymentId_unique`: `UNIQUE (payment_id)`
- **UNIQUE** `receipts_receiptNo_unique`: `UNIQUE (receipt_no)`

Indexes:

- `receipts_status_idx`: `btree (status)`

## reconnection_records

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('reconnection_records_id_seq'::r` |
| service_account_id | integer | yes | FK → service_accounts |  |
| suspension_id | integer |  | FK → suspension_records |  |
| request_date | date | yes |  |  |
| completion_date | date |  |  |  |
| fee_amount | bigint | yes |  | `0` |
| fee_invoice_id | integer |  | FK → invoices |  |
| technician_user_id | integer |  | FK → users |  |
| status | enum reconnection_status | yes |  | `'REQUESTED'::reconnection_status` |
| requested_by | integer |  | FK → users |  |
| completed_by | integer |  | FK → users |  |
| notes | text |  |  |  |
| created_at | timestamptz | yes |  | `now()` |

Indexes:

- `reconnection_records_account_idx`: `btree (service_account_id)`
- `reconnection_records_status_idx`: `btree (status)`

## role_permissions

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| role_id | integer | yes | PK, FK → roles |  |
| permission_id | integer | yes | PK, FK → permissions |  |

Indexes:

- `role_permissions_role_id_permission_id_pk` (unique): `btree (role_id, permission_id)`

## roles

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('roles_id_seq'::regclass)` |
| code | varchar(40) | yes |  |  |
| name | varchar(80) | yes |  |  |
| description | text | yes |  | `''::text` |

Constraints:

- **UNIQUE** `roles_code_unique`: `UNIQUE (code)`

## service_accounts

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('service_accounts_id_seq'::regcl` |
| account_no | varchar(20) | yes |  |  |
| subscriber_id | integer | yes | FK → subscribers |  |
| plan_id | integer | yes | FK → service_plans |  |
| address_id | integer | yes | FK → subscriber_addresses |  |
| activation_date | date | yes |  |  |
| billing_start_date | date | yes |  |  |
| due_day | integer | yes |  |  |
| current_rate | bigint | yes |  |  |
| monthly_discount | bigint | yes |  | `0` |
| status | enum service_account_status | yes |  | `'ACTIVE'::service_account_status` |
| collector_id | integer |  | FK → collectors |  |
| notes | text |  |  |  |
| created_by | integer |  | FK → users |  |
| created_at | timestamptz | yes |  | `now()` |
| updated_at | timestamptz | yes |  | `now()` |

Constraints:

- **CHECK** `service_accounts_ck`: `CHECK ((((due_day >= 1) AND (due_day <= 28)) AND (current_rate > 0) AND (monthly_discount >= 0) AND (monthly_discount <= current_rate)))`
- **UNIQUE** `service_accounts_accountNo_unique`: `UNIQUE (account_no)`

Indexes:

- `service_accounts_collector_idx`: `btree (collector_id)`
- `service_accounts_plan_idx`: `btree (plan_id)`
- `service_accounts_status_idx`: `btree (status)`
- `service_accounts_subscriber_idx`: `btree (subscriber_id)`

## service_events

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('service_events_id_seq'::regclas` |
| service_account_id | integer | yes | FK → service_accounts |  |
| event_type | varchar(40) | yes |  |  |
| from_status | varchar(20) |  |  |  |
| to_status | varchar(20) |  |  |  |
| description | text | yes |  |  |
| effective_date | date | yes |  |  |
| created_by | integer |  | FK → users |  |
| created_at | timestamptz | yes |  | `now()` |

Indexes:

- `service_events_account_idx`: `btree (service_account_id, effective_date)`

## service_plans

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('service_plans_id_seq'::regclass` |
| code | varchar(20) | yes |  |  |
| name | varchar(100) | yes |  |  |
| service_type_id | integer | yes | FK → service_types |  |
| monthly_price | bigint | yes |  |  |
| installation_fee | bigint | yes |  | `0` |
| reconnection_fee | bigint | yes |  | `0` |
| speed_mbps | integer |  |  |  |
| channel_count | integer |  |  |  |
| description | text |  |  |  |
| is_active | boolean | yes |  | `true` |
| created_at | timestamptz | yes |  | `now()` |
| updated_at | timestamptz | yes |  | `now()` |

Constraints:

- **CHECK** `service_plans_price_ck`: `CHECK (((monthly_price > 0) AND (installation_fee >= 0) AND (reconnection_fee >= 0)))`
- **UNIQUE** `service_plans_code_unique`: `UNIQUE (code)`

## service_types

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('service_types_id_seq'::regclass` |
| code | enum service_type_code | yes |  |  |
| name | varchar(60) | yes |  |  |

Constraints:

- **UNIQUE** `service_types_code_unique`: `UNIQUE (code)`

## sessions

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | uuid | yes | PK | `gen_random_uuid()` |
| user_id | integer | yes | FK → users |  |
| token_hash | char(64) | yes |  |  |
| client_name | varchar(80) |  |  |  |
| ip | varchar(64) |  |  |  |
| created_at | timestamptz | yes |  | `now()` |
| last_seen_at | timestamptz | yes |  | `now()` |
| expires_at | timestamptz | yes |  |  |
| locked_at | timestamptz |  |  |  |
| revoked_at | timestamptz |  |  |  |

Constraints:

- **UNIQUE** `sessions_tokenHash_unique`: `UNIQUE (token_hash)`

Indexes:

- `sessions_user_idx`: `btree (user_id)`

## subscriber_addresses

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('subscriber_addresses_id_seq'::r` |
| subscriber_id | integer | yes | FK → subscribers |  |
| label | varchar(40) |  |  |  |
| line1 | varchar(160) | yes |  |  |
| barangay | varchar(80) | yes |  |  |
| city | varchar(80) | yes |  |  |
| province | varchar(80) | yes |  |  |
| landmark | varchar(160) |  |  |  |
| is_primary | boolean | yes |  | `false` |
| created_at | timestamptz | yes |  | `now()` |

Indexes:

- `subscriber_addresses_primary_uq` (unique): `btree (subscriber_id) WHERE is_primary`
- `subscriber_addresses_subscriber_idx`: `btree (subscriber_id)`
- `subscriber_addresses_trgm_idx`: `gin (((((((line1)::text || ' '::text) || (barangay)::text) || ' '::text) || (city)::text)) gin_trgm_ops)`

## subscribers

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('subscribers_id_seq'::regclass)` |
| account_no | varchar(20) | yes |  |  |
| first_name | varchar(80) | yes |  |  |
| last_name | varchar(80) | yes |  |  |
| full_name | varchar(170) | yes |  |  |
| phone | varchar(20) | yes |  |  |
| alt_phone | varchar(20) |  |  |  |
| email | varchar(160) |  |  |  |
| due_day | integer | yes |  | `15` |
| status | enum subscriber_status | yes |  | `'ACTIVE'::subscriber_status` |
| collection_area_id | integer |  | FK → collection_areas |  |
| collector_id | integer |  | FK → collectors |  |
| route_sequence | integer |  |  |  |
| notes | text |  |  |  |
| created_by | integer |  | FK → users |  |
| created_at | timestamptz | yes |  | `now()` |
| updated_at | timestamptz | yes |  | `now()` |

Constraints:

- **CHECK** `subscribers_due_day_ck`: `CHECK (((due_day >= 1) AND (due_day <= 28)))`
- **UNIQUE** `subscribers_accountNo_unique`: `UNIQUE (account_no)`

Indexes:

- `subscribers_area_idx`: `btree (collection_area_id)`
- `subscribers_collector_idx`: `btree (collector_id)`
- `subscribers_name_idx`: `btree (full_name)`
- `subscribers_name_trgm_idx`: `gin (full_name gin_trgm_ops)`
- `subscribers_phone_idx`: `btree (phone)`
- `subscribers_phone_trgm_idx`: `gin (phone gin_trgm_ops)`
- `subscribers_status_idx`: `btree (status)`

## suspension_records

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('suspension_records_id_seq'::reg` |
| service_account_id | integer | yes | FK → service_accounts |  |
| reason | text | yes |  |  |
| effective_date | date | yes |  |  |
| arrears_at_suspension | bigint | yes |  | `0` |
| approved_by | integer |  | FK → users |  |
| notes | text |  |  |  |
| is_active | boolean | yes |  | `true` |
| lifted_at | timestamptz |  |  |  |
| created_at | timestamptz | yes |  | `now()` |

Indexes:

- `suspension_records_account_idx`: `btree (service_account_id)`

## user_roles

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| user_id | integer | yes | PK, FK → users |  |
| role_id | integer | yes | PK, FK → roles |  |

Indexes:

- `user_roles_user_id_role_id_pk` (unique): `btree (user_id, role_id)`

## users

| Column | Type | Required | Key | Default |
|---|---|---|---|---|
| id | integer | yes | PK | `nextval('users_id_seq'::regclass)` |
| username | varchar(40) | yes |  |  |
| full_name | varchar(120) | yes |  |  |
| email | varchar(160) |  |  |  |
| password_hash | text | yes |  |  |
| is_active | boolean | yes |  | `true` |
| failed_login_count | integer | yes |  | `0` |
| locked_until | timestamptz |  |  |  |
| last_login_at | timestamptz |  |  |  |
| created_at | timestamptz | yes |  | `now()` |
| updated_at | timestamptz | yes |  | `now()` |

Constraints:

- **UNIQUE** `users_username_unique`: `UNIQUE (username)`
