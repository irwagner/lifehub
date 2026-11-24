import React from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { OnboardingWizard } from './components/OnboardingWizard';
import { QuickActionsModal } from './components/QuickActionsModal';
import { AppProvider, useApp } from './context/AppContext';
import { CalendarPage } from './pages/CalendarPage';
import { CareerPage } from './pages/CareerPage';
import { DashboardPage } from './pages/DashboardPage';
import { FamilyPage } from './pages/FamilyPage';
import { FinancePage } from './pages/FinancePage';
import { HealthPage } from './pages/HealthPage';
import { IdeasPage } from './pages/IdeasPage';
import { SettingsPage } from './pages/SettingsPage';
import { WorkPage } from './pages/WorkPage';

const AppShell: React.FC = () => {
  const { loading, initError, settings, activeSection } = useApp();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 font-bold text-white">
            LH
          </div>
          <p className="text-sm font-medium">Inicializando banco SQLite local do LifeHub...</p>
        </div>
      </div>
    );
  }

  if (initError || !settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
        <div className="max-w-md rounded-2xl border border-rose-500/40 bg-slate-900 p-6">
          <h1 className="text-lg font-bold text-rose-400">Erro ao abrir o banco local</h1>
          <p className="mt-2 text-sm text-slate-300">
            {initError ?? 'Não foi possível carregar as configurações iniciais.'}
          </p>
        </div>
      </div>
    );
  }

  if (settings.onboarding_completed === 0) {
    return <OnboardingWizard />;
  }

  return (
    <Layout>
      {activeSection === 'dashboard' && <DashboardPage />}
      {activeSection === 'calendar' && <CalendarPage />}
      {activeSection === 'finance' && <FinancePage />}
      {activeSection === 'work' && <WorkPage />}
      {activeSection === 'health' && <HealthPage />}
      {activeSection === 'family' && <FamilyPage />}
      {activeSection === 'career' && <CareerPage />}
      {activeSection === 'ideas' && <IdeasPage />}
      {activeSection === 'settings' && <SettingsPage />}
      <QuickActionsModal />
    </Layout>
  );
};

export function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </ErrorBoundary>
  );
}

export default App;
