-- Annulation du lot 2 (gestion locative). SUPPRIME toutes les données locatives :
-- locataires, baux, échéances, paiements, quittances, relances, dépenses, documents (lignes).
-- Les fichiers du bucket « documents » ne sont pas supprimés par ce script.
begin;
drop policy if exists iz_documents_read on storage.objects;
drop policy if exists iz_documents_insert on storage.objects;
drop policy if exists iz_documents_delete on storage.objects;
drop table if exists public.email_outbox, public.job_runs, public.storage_deletions cascade;
drop table if exists public.reminders, public.receipts, public.deposit_movements, public.payment_allocations, public.payments cascade;
drop table if exists public.rent_charges, public.lease_tenants cascade;
drop table if exists public.expenses, public.documents cascade;
drop table if exists public.leases, public.tenants cascade;
drop function if exists public.iz_daily_tasks(date), public.iz_claim_outbox(int), public.iz_outbox_result(uuid, boolean, text),
  public.iz_queue_reminder(uuid), public.iz_charges_remaining(uuid[]), public.iz_auto_receipt(), public.iz_queue_receipt_email(uuid),
  public.iz__queue_receipt_email(uuid), public.iz_cancel_receipt(uuid, text), public.iz_issue_receipt(uuid, text), public.iz__issue_receipt(uuid, text),
  public.iz_generate_rent_charges(uuid, date), public.iz_document_deleted(), public.iz_reminder_rules(), public.iz_charge_rules(),
  public.iz_payment_rules(), public.iz_allocation_rules(), public.iz_charge_allocated(uuid), public.iz_lease_rules(), public.iz_today_paris(), public.iz_eur(numeric);
alter table public.user_settings drop column if exists rental_settings;
commit;
