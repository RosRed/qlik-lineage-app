import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Database, Download, CheckCircle2, XCircle, CalendarClock, Link2,
  Wrench, HelpCircle, Boxes, AlertTriangle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { globalApi } from '../../api/qlikApi';
import {
  PageBody, StatCard, Badge, SearchInput, Select, Button, Spinner,
  EmptyState, ErrorNote
} from '../../components/ui/primitives';
import { QvdStatusBadge } from '../../components/global/bits.jsx';
import { downloadAuthed } from '../../lib/downloadAuthed';

/*
 * Vue « qui produit ce QVD » : le format le plus court possible.
 *
 * Chaque ligne = un couple (QVD, batch producteur). Un QVD produit par 2
 * batchs occupe 2 lignes ; le nom du QVD n'est répété que sur la première.
 *
 * Objectif : répondre en un coup d'œil aux trois questions posées :
 *   • quel batch génère ce QVD
 *   • ce batch est-il publié ?
 *   • est-il planifié ?
 * L'historique du dernier reload est ajouté parce que sans lui, publié +
 * planifié ne suffit pas à décider (une app publiée peut ne pas avoir tourné
 * depuis un an).
 */

// ─── Formattage temporel : « il y a X » lisible en un coup d'œil ─────────────

function relativeDate(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  const d = Math.floor(ms / 86400000);
  if (d < 0) return 'à venir';
  if (d === 0) {
    const h = Math.floor(ms / 3600000);
    if (h < 1) return `il y a ${Math.max(1, Math.floor(ms / 60000))} min`;
    return `il y a ${h} h`;
  }
  if (d === 1) return 'hier';
  if (d < 7) return `il y a ${d} j`;
  if (d < 30) return `il y a ${Math.floor(d / 7)} sem.`;
  if (d < 365) return `il y a ${Math.floor(d / 30)} mois`;
  return `il y a ${Math.floor(d / 365)} an${Math.floor(d / 365) > 1 ? 's' : ''}`;
}

// ─── Cellules « oui / non » avec icône, plus lisibles qu'un badge texte ──────

function YesNoCell({ yes, yesLabel = 'oui', noLabel = 'non', unknown = false, title }) {
  if (unknown) {
    return (
      <span className="inline-flex items-center gap-1 text-ink-faint text-[13px]" title={title}>
        <HelpCircle size={13} />
        <span>inconnu</span>
      </span>
    );
  }
  return yes ? (
    <span className="inline-flex items-center gap-1 text-accent-ink text-[13px]" title={title}>
      <CheckCircle2 size={14} />
      <span>{yesLabel}</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-ink-faint text-[13px]" title={title}>
      <XCircle size={14} />
      <span>{noLabel}</span>
    </span>
  );
}

// ─── Cellule « planification » : distingue schedule / chain / manuel ─────────

function ScheduleCell({ prod }) {
  if (!prod.hasTaskData) {
    return <YesNoCell unknown title="Connexion Qlik non configurée ou API QRS indisponible" />;
  }
  if (prod.taskCount === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-danger text-[13px]" title="Aucune tâche de reload trouvée">
        <AlertTriangle size={14} />
        <span>aucune tâche</span>
      </span>
    );
  }
  if (prod.scheduled) {
    return (
      <span className="inline-flex items-center gap-1 text-accent-ink text-[13px]" title="Au moins une tâche planifiée">
        <CalendarClock size={14} />
        <span>planifiée</span>
      </span>
    );
  }
  if (prod.chained) {
    return (
      <span className="inline-flex items-center gap-1 text-info text-[13px]" title="Déclenchée par une chaîne de tâches">
        <Link2 size={14} />
        <span>chaînée</span>
      </span>
    );
  }
  if (prod.enabledTaskCount === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-warn text-[13px]" title="Tâches présentes mais toutes désactivées">
        <XCircle size={14} />
        <span>désactivée</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-warn text-[13px]" title="Lancée à la main">
      <Wrench size={14} />
      <span>manuelle</span>
    </span>
  );
}

// ─── Statut synthétique ──────────────────────────────────────────────────────

const STATUS_TONES = {
  scheduled: 'accent', chained: 'accent',
  manual: 'warn', disabled: 'warn',
  no_task: 'danger', unknown: 'default'
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ProducteursPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [publishedFilter, setPublishedFilter] = useState('');
  const [scheduleFilter, setScheduleFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    globalApi.producers()
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.error || e.message || 'Erreur de chargement'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Aplatit en 1 ligne par (QVD, producteur) — plus lisible qu'un tableau imbriqué.
  const flat = useMemo(() => {
    if (!data) return [];
    const list = [];
    for (const row of data.rows) {
      row.producers.forEach((p, i) => {
        list.push({
          qvd: row.qvd,
          qvdStatus: row.qvdStatus,
          consumerCount: row.consumerCount,
          producer: p,
          // Le nom du QVD n'est répété que sur la première ligne du groupe :
          // gain de lecture, sans perte d'info dans l'export CSV.
          isFirstOfGroup: i === 0,
          isLastOfGroup: i === row.producers.length - 1
        });
      });
    }
    return list;
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return flat.filter(x => {
      if (q && !x.qvd.toLowerCase().includes(q) && !x.producer.appName.toLowerCase().includes(q)) return false;
      if (publishedFilter === 'yes' && !x.producer.published) return false;
      if (publishedFilter === 'no' && x.producer.published) return false;
      if (scheduleFilter && x.producer.status.code !== scheduleFilter) return false;
      return true;
    });
  }, [flat, search, publishedFilter, scheduleFilter]);

  if (loading) return <Spinner label="Chargement des producteurs…" />;
  if (error) return <PageBody><ErrorNote>{error}</ErrorNote></PageBody>;
  if (!data) return null;

  const s = data.stats;

  return (
    <PageBody>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard icon={Database} label="QVD produits" value={s.qvdCount} />
        <StatCard icon={Boxes} label="Batchs distincts" value={s.producerBatchCount} />
        <StatCard
          icon={CalendarClock}
          label="Batchs planifiés"
          value={data.hasTaskData ? s.scheduledBatchCount : '—'}
          hint={data.hasTaskData ? `sur ${s.producerBatchCount}` : 'Connexion Qlik requise'}
        />
        <StatCard
          icon={AlertTriangle}
          label="QVD sans planification"
          value={data.hasTaskData ? s.qvdWithoutSchedule : '—'}
          tone={data.hasTaskData && s.qvdWithoutSchedule > 0 ? 'warn' : 'default'}
          hint="produits uniquement par des batchs non planifiés"
        />
      </div>

      {!data.hasTaskData && (
        <div className="mb-4">
          <ErrorNote>
            <strong>Données de planification indisponibles.</strong>{' '}
            {data.taskDataError
              ? `Erreur QRS : ${data.taskDataError}`
              : 'La connexion Qlik n\'est pas configurée — les colonnes « planifiée » sont marquées « inconnu ».'}
          </ErrorNote>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Chercher un QVD ou un batch…"
          className="w-full max-w-xs"
        />
        <Select value={publishedFilter} onChange={setPublishedFilter} aria-label="Publication">
          <option value="">Publication : toutes</option>
          <option value="yes">Publiées</option>
          <option value="no">Non publiées</option>
        </Select>
        {data.hasTaskData && (
          <Select value={scheduleFilter} onChange={setScheduleFilter} aria-label="Planification">
            <option value="">Planification : toutes</option>
            <option value="scheduled">Planifiée</option>
            <option value="chained">Chaînée</option>
            <option value="manual">Manuelle</option>
            <option value="disabled">Désactivée</option>
            <option value="no_task">Sans tâche</option>
          </Select>
        )}
        <span className="text-xs text-ink-faint tabular-nums">
          {filtered.length} / {flat.length} ligne{flat.length > 1 ? 's' : ''}
        </span>
        <div className="flex-1" />
        <Button icon={Download}
          onClick={() => downloadAuthed(globalApi.exportProducersUrl(), { filename: 'producteurs.csv' })
            .catch(e => toast.error(e.error || e.message || 'Échec du téléchargement'))}>
          Export Excel
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Database} title="Aucun résultat" description="Retirez un filtre ou élargissez la recherche." />
      ) : (
        <div className="border border-line rounded-xl overflow-hidden">
          <table className="w-full text-[13px] table-fixed">
            <colgroup>
              <col style={{ width: '48px' }} />
              <col style={{ minWidth: '220px', width: '24%' }} />
              <col style={{ minWidth: '220px', width: '26%' }} />
              <col style={{ width: '110px' }} />
              <col style={{ width: '140px' }} />
              <col style={{ width: '130px' }} />
              <col style={{ width: '110px' }} />
            </colgroup>
            <thead className="bg-raised sticky top-0">
              <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted border-b border-line">
                <th className="py-2 pl-3 pr-2 text-right">#</th>
                <th className="py-2 pr-3">QVD</th>
                <th className="py-2 pr-3">Batch producteur</th>
                <th className="py-2 pr-3">Publiée</th>
                <th className="py-2 pr-3">Planification</th>
                <th className="py-2 pr-3">Dernier reload</th>
                <th className="py-2 pr-3">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((x, i) => (
                <tr
                  key={`${x.qvd}-${x.producer.appId}`}
                  className={`hover:bg-raised ${x.isFirstOfGroup ? '' : 'border-t-0'}`}
                >
                  <td className="py-2 pl-3 pr-2 text-right tabular-nums text-ink-faint align-top">
                    {i + 1}
                  </td>
                  <td className="py-2 pr-3 align-top">
                    {/* Le nom n'est répété que sur la 1re ligne d'un groupe (QVD à plusieurs producteurs). */}
                    {x.isFirstOfGroup ? (
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-info break-words" title={x.qvd}>{x.qvd}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <QvdStatusBadge status={x.qvdStatus} />
                            {x.consumerCount > 0
                              ? <span className="text-[11px] text-ink-faint">→ {x.consumerCount} app{x.consumerCount > 1 ? 's' : ''}</span>
                              : <span className="text-[11px] text-danger">personne ne lit</span>}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <span className="text-ink-faint text-[11px] pl-3">↳ même QVD</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 align-top">
                    <Link
                      to={`/apps/${x.producer.appId}`}
                      className="text-ink hover:text-accent-ink font-medium block truncate"
                      title={x.producer.appName}
                    >
                      {x.producer.appName}
                    </Link>
                    {(x.producer.stream || x.producer.owner) && (
                      <div className="text-[11px] text-ink-faint truncate">
                        {x.producer.stream || 'Non publiée'}
                        {x.producer.owner && ` · ${x.producer.owner}`}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 align-top">
                    <YesNoCell
                      yes={x.producer.published}
                      yesLabel="publiée"
                      noLabel="privée"
                      title={x.producer.published ? 'Publiée sur le stream' : 'Non publiée (brouillon)'}
                    />
                  </td>
                  <td className="py-2 pr-3 align-top">
                    <ScheduleCell prod={x.producer} />
                  </td>
                  <td className="py-2 pr-3 align-top text-ink-muted">
                    {x.producer.lastRunAt
                      ? <span title={new Date(x.producer.lastRunAt).toLocaleString('fr-FR')}>
                          {relativeDate(x.producer.lastRunAt)}
                        </span>
                      : <span className="text-ink-faint">jamais</span>}
                  </td>
                  <td className="py-2 pr-3 align-top">
                    <Badge tone={STATUS_TONES[x.producer.status.code] || 'default'}>
                      {x.producer.status.label}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageBody>
  );
}
