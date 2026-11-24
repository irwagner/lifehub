import React, { useEffect, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import ptBrLocale from '@fullcalendar/core/locales/pt-br';
import { CheckCircle2, Circle, Trash2, Wand2 } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { useApp } from '../context/AppContext';
import {
  applyScheduleTemplateToWeek,
  deleteCalendarEvent,
  deleteTask,
  listCalendarEvents,
  listTasks,
  toggleTaskStatus,
  updateCalendarEvent,
  updateCalendarEventTiming,
} from '../repositories/calendarRepo';
import {
  SCHEDULE_TEMPLATES,
  type ScheduleTemplateId,
} from '../services/scheduleTemplates';
import {
  EVENT_CATEGORY_META,
  type CalendarEvent,
  type EventCategory,
  type TaskItem,
} from '../types/domain';
import { formatDateBR, todayISO } from '../utils/format';

function toLocalISOString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}

export const CalendarPage: React.FC = () => {
  const { db, settings, dataVersion, bumpDataVersion, openQuickAction, notify } = useApp();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<ScheduleTemplateId>('apps_5d');
  const [taskFilter, setTaskFilter] = useState<'all' | 'todo' | 'done'>('todo');
  const [applying, setApplying] = useState(false);

  // Event edit modal state
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState<EventCategory>('geral');
  const [editDate, setEditDate] = useState('');
  const [editStart, setEditStart] = useState('09:00');
  const [editEnd, setEditEnd] = useState('10:00');
  const [editLocation, setEditLocation] = useState('');
  const [editNotes, setEditNotes] = useState('');

  useEffect(() => {
    if (!db) return;
    let active = true;
    (async () => {
      const [evts, tks] = await Promise.all([
        listCalendarEvents(db),
        listTasks(db, taskFilter === 'all' ? undefined : taskFilter),
      ]);
      if (active) {
        setEvents(evts);
        setTasks(tks);
      }
    })();
    return () => {
      active = false;
    };
  }, [db, dataVersion, taskFilter]);

  const handleApplyTemplate = async () => {
    if (!db || !settings) return;
    setApplying(true);
    try {
      const created = await applyScheduleTemplateToWeek(
        db,
        selectedTemplate,
        todayISO(),
        settings,
        true,
      );
      bumpDataVersion();
      notify(`Template aplicado: ${created.length} blocos criados para esta semana.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao aplicar template.', 'error');
    } finally {
      setApplying(false);
    }
  };

  const handleEventDropOrResize = async (info: {
    event: { id: string; start: Date | null; end: Date | null; allDay: boolean };
    revert: () => void;
  }) => {
    if (!db || !info.event.start) {
      info.revert();
      return;
    }
    const start = info.event.start;
    const end = info.event.end ?? new Date(start.getTime() + 60 * 60 * 1000);
    try {
      await updateCalendarEventTiming(
        db,
        info.event.id,
        toLocalISOString(start),
        toLocalISOString(end),
        info.event.allDay ? 1 : 0,
      );
      bumpDataVersion();
      notify('Horário atualizado no SQLite.');
    } catch (err) {
      info.revert();
      notify(err instanceof Error ? err.message : 'Erro ao mover evento.', 'error');
    }
  };

  const handleEventClick = (info: { event: { id: string } }) => {
    const found = events.find((e) => e.id === info.event.id);
    if (!found) return;
    setEditingEvent(found);
    setEditTitle(found.title);
    setEditCategory(found.category);
    setEditDate(found.start_at.slice(0, 10));
    setEditStart(found.start_at.slice(11, 16) || '09:00');
    setEditEnd(found.end_at.slice(11, 16) || '10:00');
    setEditLocation(found.location);
    setEditNotes(found.notes);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !editingEvent) return;
    try {
      await updateCalendarEvent(db, editingEvent.id, {
        title: editTitle,
        category: editCategory,
        start_at: `${editDate}T${editStart}:00`,
        end_at: `${editDate}T${editEnd}:00`,
        location: editLocation,
        notes: editNotes,
      });
      setEditingEvent(null);
      bumpDataVersion();
      notify('Compromisso atualizado.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao atualizar evento.', 'error');
    }
  };

  const handleDeleteEditing = async () => {
    if (!db || !editingEvent) return;
    await deleteCalendarEvent(db, editingEvent.id);
    setEditingEvent(null);
    bumpDataVersion();
    notify('Compromisso removido.');
  };

  const handleToggleTask = async (id: string) => {
    if (!db) return;
    await toggleTaskStatus(db, id);
    bumpDataVersion();
  };

  const handleDeleteTask = async (id: string) => {
    if (!db) return;
    await deleteTask(db, id);
    bumpDataVersion();
    notify('Tarefa excluída.');
  };

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Calendário & Tarefas</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Arraste ou redimensione para reagendar. Clique em qualquer evento para editar ou excluir.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value as ScheduleTemplateId)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-900"
          >
            {SCHEDULE_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={applying}
            onClick={handleApplyTemplate}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Wand2 className="h-3.5 w-3.5" />
            {applying ? 'Aplicando...' : 'Aplicar template na semana'}
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-4">
        {/* FullCalendar */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 xl:col-span-3">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            locale={ptBrLocale}
            firstDay={1}
            slotMinTime="05:00:00"
            slotMaxTime="23:00:00"
            allDaySlot={true}
            editable={true}
            selectable={false}
            nowIndicator={true}
            height={680}
            slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'timeGridDay,timeGridWeek,dayGridMonth',
            }}
            events={events.map((ev) => ({
              id: ev.id,
              title: ev.title,
              start: ev.start_at,
              end: ev.end_at,
              allDay: ev.all_day === 1,
              backgroundColor: ev.color,
              borderColor: ev.color,
            }))}
            eventDrop={handleEventDropOrResize}
            eventResize={handleEventDropOrResize}
            eventClick={handleEventClick}
          />
        </div>

        {/* Tasks sidebar */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Tarefas</h3>
            <button
              type="button"
              onClick={() => openQuickAction('task')}
              className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700"
            >
              + Nova
            </button>
          </div>

          <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1 text-xs dark:bg-slate-800">
            {(['todo', 'done', 'all'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setTaskFilter(f)}
                className={`flex-1 rounded-md py-1 font-medium ${
                  taskFilter === f
                    ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {f === 'todo' ? 'Pendentes' : f === 'done' ? 'Concluídas' : 'Todas'}
              </button>
            ))}
          </div>

          {tasks.length === 0 ? (
            <EmptyState
              title="Sem tarefas neste filtro"
              description="Adicione tarefas para acompanhar suas prioridades."
            />
          ) : (
            <ul className="space-y-2">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 p-2.5 dark:border-slate-800"
                >
                  <button
                    type="button"
                    onClick={() => handleToggleTask(task.id)}
                    className="mt-0.5 shrink-0 text-slate-400 hover:text-emerald-500"
                  >
                    {task.status === 'done' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-xs font-medium ${
                        task.status === 'done' ? 'line-through opacity-60' : ''
                      }`}
                    >
                      {task.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {task.priority === 'high'
                        ? 'Alta'
                        : task.priority === 'medium'
                          ? 'Média'
                          : 'Baixa'}
                      {task.due_date ? ` · ${formatDateBR(task.due_date)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteTask(task.id)}
                    className="text-slate-400 hover:text-rose-500"
                    aria-label="Excluir tarefa"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Event Edit Modal */}
      <Modal
        open={Boolean(editingEvent)}
        title="Editar Compromisso"
        onClose={() => setEditingEvent(null)}
      >
        <form onSubmit={handleSaveEdit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Título</label>
            <input
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Categoria</label>
              <select
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value as EventCategory)}
                className={inputClass}
              >
                {Object.entries(EVENT_CATEGORY_META).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Data</label>
              <input
                required
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Início</label>
              <input
                required
                type="time"
                value={editStart}
                onChange={(e) => setEditStart(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Fim</label>
              <input
                required
                type="time"
                value={editEnd}
                onChange={(e) => setEditEnd(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Local (opcional)</label>
            <input
              value={editLocation}
              onChange={(e) => setEditLocation(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Observações</label>
            <textarea
              rows={2}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleDeleteEditing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-500 hover:bg-rose-500/20"
            >
              <Trash2 className="h-3.5 w-3.5" /> Excluir
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditingEvent(null)}
                className="rounded-lg px-4 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-brand-600 px-5 py-2 text-xs font-semibold text-white hover:bg-brand-700"
              >
                Salvar Alterações
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};
