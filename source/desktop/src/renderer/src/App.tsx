import type { Permission } from '@bcis/shared';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Guard, homePath, Shell } from './components/Shell';
import { Spinner } from './components/ui';
import { useAuth } from './lib/auth';
import { AccountPage, AdminPage } from './pages/Admin';
import { BatchDetailPage } from './pages/BatchDetail';
import { CurrentBillingPage, GenerateBillingPage, InvoicesPage } from './pages/Billing';
import { AreasPage, BatchesPage, CollectorsPage, RemittancePage } from './pages/Collections';
import { DashboardPage } from './pages/Dashboard';
import { GcashPage } from './pages/Gcash';
import { LoginPage } from './pages/Login';
import { PaymentHistoryPage, ReceivePaymentPage } from './pages/Payments';
import { AgingPage, OutstandingPage, OverduePage, SuspensionCandidatesPage } from './pages/Receivables';
import { ReportsPage } from './pages/Reports';
import { ServiceAccountsPage } from './pages/ServiceAccounts';
import { ServicesPage } from './pages/Services';
import { SubscriberProfilePage } from './pages/SubscriberProfile';
import { NewSubscriberPage, SubscribersPage } from './pages/Subscribers';

const page = (permissions: Permission[], element: ReactNode) => <Guard permissions={permissions}>{element}</Guard>;

export function App() {
  const { user, loading, can } = useAuth();
  if (loading) return <Spinner label="Starting…" />;
  if (!user) return <LoginPage />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to={homePath(can)} replace />} />
        <Route path="/dashboard" element={page(['dashboard.view'], <DashboardPage />)} />
        <Route path="/subscribers" element={page(['subscriber.view'], <SubscribersPage />)} />
        <Route path="/subscribers/new" element={page(['subscriber.create'], <NewSubscriberPage />)} />
        <Route path="/subscribers/:id" element={page(['subscriber.view'], <SubscriberProfilePage />)} />
        <Route path="/service-accounts" element={page(['service.view'], <ServiceAccountsPage />)} />
        <Route path="/billing/current" element={page(['billing.view'], <CurrentBillingPage />)} />
        <Route path="/billing/generate" element={page(['billing.generate'], <GenerateBillingPage />)} />
        <Route path="/billing/invoices" element={page(['billing.view'], <InvoicesPage />)} />
        <Route path="/payments/receive" element={page(['payment.create'], <ReceivePaymentPage />)} />
        <Route path="/payments/history" element={page(['payment.view'], <PaymentHistoryPage />)} />
        <Route path="/payments/gcash" element={page(['gcash.submit', 'gcash.verify'], <GcashPage />)} />
        <Route path="/collections/collectors" element={page(['collection.view'], <CollectorsPage />)} />
        <Route path="/collections/areas" element={page(['collection.view'], <AreasPage />)} />
        <Route path="/collections/batches" element={page(['collection.view'], <BatchesPage />)} />
        <Route path="/collections/batches/:id" element={page(['collection.view'], <BatchDetailPage />)} />
        <Route path="/collections/remittance" element={page(['collection.view'], <RemittancePage />)} />
        <Route path="/receivables/outstanding" element={page(['receivable.view'], <OutstandingPage />)} />
        <Route path="/receivables/overdue" element={page(['receivable.view'], <OverduePage />)} />
        <Route path="/receivables/aging" element={page(['receivable.view'], <AgingPage />)} />
        <Route path="/receivables/suspension" element={page(['receivable.view'], <SuspensionCandidatesPage />)} />
        <Route path="/services" element={page(['service.view', 'plan.view'], <ServicesPage />)} />
        <Route path="/reports" element={page(['report.view'], <ReportsPage />)} />
        <Route path="/admin" element={page(['user.manage', 'settings.manage', 'audit.view', 'backup.create'], <AdminPage />)} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
