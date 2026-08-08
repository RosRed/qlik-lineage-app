import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Boxes, Globe, Clock, ShieldCheck, LayoutDashboard, ArrowRight, Loader2
} from 'lucide-react';
import { useAppsList } from '../context/AppsContext';
import { globalApi } from '../api/qlikApi';
import { PageHeader, PageBody, Card, StatCard } from '../components/ui/primitives';

/*
 * Point d'entrée par défaut : chiffres clés et raccourcis.
 * Vise à répondre à « qu'est-ce que je fais depuis cet écran ? » — l'ancienne
 * app renvoyait sur un onglet Vue d'ensemble vide tant qu'on n'avait pas
 * sélectionné d'app.
 */
export default function DashboardPage() {
  const { apps, loading: loadingApps } = useAppsList();
  const [globalData, setGlobalData] = useState(null);
  const [loadingGlobal, setLoadingGlobal] = useState(true);

  useEffect(() => {
    let cancelled = false;
    globalApi.getLineage()
      .then(d => { if (!cancelled) setGlobalData(d); })
      .catch(() => { /* silencieux : le tableau de bord reste utile sans le lineage global */ })
      .finally(() => { if (!cancelled) setLoadingGlobal(false); });
    return () => { cancelled = true; };
  }, []);

  const analyzedCount = apps.filter(a => a.analyzed).length;
  const stats = globalData?.stats;
  const problems = globalData
    ? globalData.orphans.length + globalData.multiProduced.length + globalData.duplicateExtractions.length
    : 0;

  return (
    <>
      <PageHeader
        icon={LayoutDashboard}
        title="Tableau de bord"
        subtitle="Vue synthétique de l'installation Qlik"
      />
      <PageBody>
        {loadingApps || loadingGlobal ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-24" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard icon={Boxes} label="Applications" value={apps.length} hint={`${analyzedCount} analysée${analyzedCount !== 1 ? 's' : ''}`} />
            <StatCard icon={Globe} label="QVD suivis" value={stats?.totalQvds ?? '—'} />
            <StatCard icon={ShieldCheck} label="Problèmes détectés" value={problems} tone="danger" hint="orphelins + doublons + écrasements" />
            <StatCard icon={Clock} label="Tâches" value={stats?.totalApps ? '→' : '—'} hint="Ouvrir la section" />
          </div>
        )}

        <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">
          Sections
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SectionCard
            to="/apps"
            icon={Boxes}
            title="Applications"
            description="Liste, filtres, création, édition du script et de l'analyse."
          />
          <SectionCard
            to="/global"
            icon={Globe}
            title="Lineage global"
            description="Flux QVD entre les apps, orphelins, doublons, apps par rôle."
          />
          <SectionCard
            to="/tasks"
            icon={Clock}
            title="Tâches de reload"
            description="Planifications, chaînes, recommandations de nettoyage."
          />
          <SectionCard
            to="/governance"
            icon={ShieldCheck}
            title="Gouvernance"
            description="Audits agrégés : apps périmées, connexions, tâches problématiques."
          />
        </div>
      </PageBody>
    </>
  );
}

function SectionCard({ to, icon: Icon, title, description }) {
  return (
    <Link to={to} className="block group">
      <Card className="p-4 flex items-start gap-3 transition-colors hover:border-accent">
        <div className="p-2 rounded-lg bg-accent-soft text-accent-ink shrink-0">
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
            {title}
            <ArrowRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity text-accent-ink" />
          </h3>
          <p className="text-sm text-ink-muted mt-0.5">{description}</p>
        </div>
      </Card>
    </Link>
  );
}
