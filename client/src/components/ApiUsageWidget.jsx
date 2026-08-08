import React, { useState, useEffect, useCallback } from 'react';
import { Zap, Brain, TrendingUp, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';

export default function ApiUsageWidget() {
  const [stats, setStats] = useState(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch('/api/usage')
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000); // refresh toutes les 30s
    return () => clearInterval(id);
  }, [load]);

  const reset = async () => {
    if (!confirm('Réinitialiser les statistiques d\'utilisation ?')) return;
    await fetch('/api/usage', { method: 'DELETE' });
    load();
  };

  if (!stats) return null;

  const totalCalls = stats.totals?.calls || 0;
  const totalCostUsd = ((stats.totals?.cost_cents || 0) / 100).toFixed(4);
  const todayCalls = stats.today?.calls || 0;
  const todayCost = ((stats.today?.cost_cents || 0) / 100).toFixed(4);
  const localSaved = stats.localSaved || 0;

  // Séparer analyze et chat
  const byType = Object.fromEntries((stats.byType || []).map(r => [r.type, r]));
  const analyzeCalls = (byType['analyze']?.total_calls || 0);
  const chatCalls = (byType['chat']?.total_calls || 0);

  return (
    <div className="border-t border-gray-800 text-xs">
      {/* Header cliquable */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-gray-600 hover:text-gray-400 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <TrendingUp size={11} />
          <span>{totalCalls > 0 ? `${totalCalls} appel(s) Claude · $${totalCostUsd}` : 'Stats API'}</span>
        </div>
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {/* Total */}
          <div className="bg-gray-900 rounded-lg p-2.5 space-y-1.5">
            <p className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold mb-1">Total</p>
            <div className="flex justify-between text-gray-400">
              <span className="flex items-center gap-1"><Brain size={10} className="text-violet-400" /> Analyses</span>
              <span className="font-mono">{analyzeCalls}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span className="flex items-center gap-1"><Brain size={10} className="text-blue-400" /> Chat Claude</span>
              <span className="font-mono">{chatCalls}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span className="flex items-center gap-1"><Zap size={10} className="text-yellow-400" /> Local / Cache</span>
              <span className="font-mono text-yellow-500">{localSaved}</span>
            </div>
            <div className="border-t border-gray-800 pt-1.5 flex justify-between text-gray-300 font-medium">
              <span>Coût estimé</span>
              <span className="font-mono text-emerald-400">${totalCostUsd}</span>
            </div>
          </div>

          {/* Aujourd'hui */}
          {todayCalls > 0 && (
            <div className="bg-gray-900 rounded-lg p-2.5">
              <p className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold mb-1">Aujourd'hui</p>
              <div className="flex justify-between text-gray-400">
                <span>{todayCalls} appel(s)</span>
                <span className="font-mono">${todayCost}</span>
              </div>
            </div>
          )}

          {/* Tokens */}
          {stats.totals?.input_tokens > 0 && (
            <div className="text-gray-700 space-y-0.5">
              <div className="flex justify-between">
                <span>Tokens input</span>
                <span className="font-mono">{(stats.totals.input_tokens || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Tokens output</span>
                <span className="font-mono">{(stats.totals.output_tokens || 0).toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* Reset */}
          <button
            onClick={reset}
            className="flex items-center gap-1 text-gray-700 hover:text-red-400 transition-colors mt-1"
          >
            <RotateCcw size={10} />
            Réinitialiser
          </button>
        </div>
      )}
    </div>
  );
}
