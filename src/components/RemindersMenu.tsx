import React, { useEffect, useState } from 'react';
import { Bell, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { listCalendarEvents, listTasks } from '../repositories/calendarRepo';
import { listUpcomingBills } from '../repositories/financeRepo';
import {
  buildDiscreteReminders,
  dispatchLocalNotification,
  type DiscreteReminder,
} from '../services/reminders';
import { todayISO } from '../utils/format';

export const RemindersMenu: React.FC = () => {
  const { db, settings, dataVersion, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [reminders, setReminders] = useState<DiscreteReminder[]>([]);

  useEffect(() => {
    if (!db || settings?.reminders_enabled === 0) {
      setReminders([]);
      return;
    }
    let active = true;
    const today = todayISO();
    (async () => {
      const [bills, events, tasks] = await Promise.all([
        listUpcomingBills(db, today, 10),
        listCalendarEvents(db, {
          startISO: `${today}T00:00:00`,
          endISO: `${today}T23:59:59`,
        }),
        listTasks(db, 'todo'),
      ]);
      if (!active) return;
      setReminders(
        buildDiscreteReminders({
          todayISO: today,
          upcomingBills: bills,
          todayEvents: events,
          pendingTasks: tasks,
        }),
      );
    })();
    return () => {
      active = false;
    };
  }, [db, settings?.reminders_enabled, dataVersion]);

  const handleDispatch = async (rem: DiscreteReminder) => {
    const sent = await dispatchLocalNotification(rem);
    if (sent) {
      notify('Notificação local discreta enviada (sem valores financeiros).');
    } else {
      notify('Notificações do sistema não autorizadas ou indisponíveis neste navegador.', 'info');
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-brand-400/60 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
        aria-label="Abrir lembretes locais discretos"
      >
        <Bell className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Lembretes</span>
        {reminders.length > 0 && (
          <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
            {reminders.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xl animate-scale-in dark:border-white/[0.1] dark:bg-[#0f172a]">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Lembretes Locais</h3>
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500">
              <ShieldCheck className="h-3 w-3" /> Sem valores (R$)
            </span>
          </div>

          {settings?.reminders_enabled === 0 ? (
            <p className="text-xs text-slate-500">
              Lembretes locais desativados em Configurações.
            </p>
          ) : reminders.length === 0 ? (
            <p className="text-xs text-slate-500">
              Nenhum vencimento nos próximos 3 dias, nem pendências urgentes para hoje.
            </p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {reminders.map((rem) => (
                <li
                  key={rem.id}
                  className={`rounded-xl border p-2.5 text-xs ${
                    rem.severity === 'warning'
                      ? 'border-amber-500/40 bg-amber-500/10'
                      : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{rem.title}</p>
                    <button
                      type="button"
                      onClick={() => handleDispatch(rem)}
                      className="shrink-0 text-[10px] font-medium text-brand-500 hover:underline"
                    >
                      Notificar
                    </button>
                  </div>
                  <p className="mt-1 text-slate-600 dark:text-slate-300">{rem.discreteMessage}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
