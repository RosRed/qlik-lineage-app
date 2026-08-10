import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './layouts/AppShell.jsx';
import LoginPage from './pages/LoginPage.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { Loader2 } from 'lucide-react';
import AppDetailLayout from './layouts/AppDetailLayout.jsx';
import GlobalLayout from './layouts/GlobalLayout.jsx';

// Pages de premier niveau
import DashboardPage from './pages/DashboardPage.jsx';
import AppsListPage from './pages/AppsListPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import GovernancePage from './pages/GovernancePage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

// Pages d'une application (imbriquées sous /apps/:id)
import OverviewPage from './pages/app/OverviewPage.jsx';
import SourcesPage from './pages/app/SourcesPage.jsx';
import LineagePage from './pages/app/LineagePage.jsx';
import ModelPage from './pages/app/ModelPage.jsx';
import ChatPage from './pages/app/ChatPage.jsx';
import ScriptPage from './pages/app/ScriptPage.jsx';

// Pages du lineage global (imbriquées sous /global)
import SynthesePage from './pages/global/SynthesePage.jsx';
import QvdsPage from './pages/global/QvdsPage.jsx';
import GlobalAppsPage from './pages/global/GlobalAppsPage.jsx';
import ProblemesPage from './pages/global/ProblemesPage.jsx';
import GraphePage from './pages/global/GraphePage.jsx';
import DoublonsPage from './pages/global/DoublonsPage.jsx';
import ProducteursPage from './pages/global/ProducteursPage.jsx';

// Pages du monitoring SSIS (imbriquées sous /ssis)
import SsisLayout from './layouts/SsisLayout.jsx';
import SsisSettingsPage from './pages/ssis/SsisSettingsPage.jsx';
import SsisPlaceholderPage from './pages/ssis/SsisPlaceholderPage.jsx';
import SsisDashboardPage from './pages/ssis/DashboardPage.jsx';
import SsisExecutionsPage from './pages/ssis/ExecutionsPage.jsx';
import SsisErrorsPage from './pages/ssis/ErrorsPage.jsx';
import SsisNamedSnapshotsPage from './pages/ssis/NamedSnapshotsPage.jsx';
import SsisUpdateLogPage from './pages/ssis/UpdateLogPage.jsx';

/*
 * Table de routage complète. Chaque écran est joignable par une URL — le
 * bouton retour, le rafraîchissement et le partage de lien fonctionnent
 * enfin. `AppShell` porte le rail de navigation ; les enfants remplissent
 * l'<Outlet/> du shell.
 *
 * Anciennement, ce fichier faisait 156 lignes de mise en page + gestion
 * d'onglets par useState.
 */
export default function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas text-ink-faint">
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />

        <Route path="apps">
          <Route index element={<AppsListPage />} />
          <Route path=":id" element={<AppDetailLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="sources" element={<SourcesPage />} />
            <Route path="lineage" element={<LineagePage />} />
            <Route path="model" element={<ModelPage />} />
            <Route path="script" element={<ScriptPage />} />
            <Route path="chat" element={<ChatPage />} />
          </Route>
        </Route>

        <Route path="global" element={<GlobalLayout />}>
          <Route index element={<SynthesePage />} />
          <Route path="qvds" element={<QvdsPage />} />
          <Route path="apps" element={<GlobalAppsPage />} />
          <Route path="problemes" element={<ProblemesPage />} />
          <Route path="graphe" element={<GraphePage />} />
          <Route path="doublons" element={<DoublonsPage />} />
          <Route path="producteurs" element={<ProducteursPage />} />
        </Route>

        <Route path="ssis" element={<SsisLayout />}>
          <Route index element={<SsisDashboardPage />} />
          <Route path="executions" element={<SsisExecutionsPage />} />
          <Route path="errors" element={<SsisErrorsPage />} />
          <Route path="snapshots" element={<SsisNamedSnapshotsPage />} />
          <Route path="update-log" element={<SsisUpdateLogPage />} />
          <Route path="jobs" element={<SsisPlaceholderPage
            title="Jobs SQL Server Agent"
            description="Planification depuis msdb.dbo.sysjobs + historique sysjobhistory."
            phase="Vague 4 — à venir" />} />
          <Route path="settings" element={<SsisSettingsPage />} />
        </Route>

        <Route path="tasks" element={<TasksPage />} />
        <Route path="governance" element={<GovernancePage />} />
        <Route path="settings" element={<SettingsPage />} />

        {/* URL inconnue → tableau de bord. Évite un écran blanc. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
