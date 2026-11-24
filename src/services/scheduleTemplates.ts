import {
  EVENT_CATEGORY_META,
  type ChildWeekendMode,
  type EventCategory,
} from '../types/domain';
import { addDaysISO, startOfWeekISO } from '../utils/format';
import { isChildWeekend } from './recurrence';

export type ScheduleTemplateId = 'apps_5d' | 'apps_4d' | 'apps_6d' | 'clt' | 'ti';

export interface ScheduleTemplateMeta {
  id: ScheduleTemplateId;
  name: string;
  description: string;
}

export const SCHEDULE_TEMPLATES: ScheduleTemplateMeta[] = [
  {
    id: 'apps_5d',
    name: 'Aplicativos — Padrão 5 dias',
    description:
      'Seg–Sex 06:00–12:30 Uber/99, pausa/almoço 12:30–14:00, academia Seg/Qua/Sex 14:30, corrida Ter/Qui 19:00, estudos/carreira 16:00.',
  },
  {
    id: 'apps_4d',
    name: 'Aplicativos — Semana 4 dias',
    description:
      'Seg/Ter/Qui/Sex manhã em aplicativos; Quarta-feira reservada para entrevistas, estudos concentrados, família ou descanso.',
  },
  {
    id: 'apps_6d',
    name: 'Aplicativos — Semana 6 dias',
    description:
      'Inclui sábado manhã (06:00–12:00) somente quando o fim de semana NÃO estiver reservado para o filho.',
  },
  {
    id: 'clt',
    name: 'Trabalho CLT (Portaria 12h–20h)',
    description:
      'Turno 12:00–20:00 com blocos de deslocamento Magé–Rio, treinos e estudos pela manhã sem comprometer o sono.',
  },
  {
    id: 'ti',
    name: 'Emprego de TI (Comercial)',
    description:
      'Expediente 09:00–18:00 Seg–Sex com academia/corrida, estudos noturnos leves e fins de semana protegidos.',
  },
];

export interface EventDraft {
  title: string;
  category: EventCategory;
  start_at: string;
  end_at: string;
  all_day: number;
  color: string;
  location: string;
  notes: string;
  source_template: string;
}

function makeBlock(
  dateISO: string,
  startHHMM: string,
  endHHMM: string,
  title: string,
  category: EventCategory,
  templateId: ScheduleTemplateId,
  notes = '',
): EventDraft {
  return {
    title,
    category,
    start_at: `${dateISO}T${startHHMM}:00`,
    end_at: `${dateISO}T${endHHMM}:00`,
    all_day: 0,
    color: EVENT_CATEGORY_META[category].color,
    location: '',
    notes,
    source_template: templateId,
  };
}

export function buildWeekEventsFromTemplate(
  templateId: ScheduleTemplateId,
  referenceDateISO: string,
  childWeekendMode: ChildWeekendMode,
  childWeekendAnchor: string | null,
): EventDraft[] {
  const monday = startOfWeekISO(referenceDateISO);
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i)); // 0=Mon .. 6=Sun
  const events: EventDraft[] = [];

  const sat = days[5];
  const sun = days[6];
  const hasChildThisWeekend = isChildWeekend(sat, childWeekendMode, childWeekendAnchor);

  if (templateId === 'apps_5d' || templateId === 'apps_4d' || templateId === 'apps_6d') {
    const workDayIndices =
      templateId === 'apps_4d' ? [0, 1, 3, 4] : [0, 1, 2, 3, 4];

    for (const idx of workDayIndices) {
      const d = days[idx];
      events.push(
        makeBlock(d, '06:00', '12:30', 'Uber Moto / 99Moto', 'trabalho', templateId),
        makeBlock(d, '12:30', '14:00', 'Deslocamento, almoço e pausa', 'pausa', templateId),
      );
    }

    if (templateId === 'apps_4d') {
      events.push(
        makeBlock(
          days[2],
          '09:00',
          11 + ':30',
          'Bloco livre: entrevistas, estudos ou descanso',
          'estudos',
          templateId,
          'Dia útil reservado na semana de 4 dias.',
        ),
      );
    }

    // Academia: Seg, Qua, Sex 14:30-15:30
    for (const idx of [0, 2, 4]) {
      events.push(makeBlock(days[idx], '14:30', '15:30', 'Academia', 'academia', templateId));
    }

    // Tarde carreira/estudos conforme tabela 4 do blueprint
    events.push(
      makeBlock(days[0], '16:00', '17:00', 'Estudos TI', 'estudos', templateId),
      makeBlock(days[1], '16:00', '17:00', 'Candidaturas e currículo TI', 'entrevista', templateId),
      makeBlock(days[2], '16:00', '17:00', 'Projeto / Portfólio TI', 'estudos', templateId),
      makeBlock(days[3], '16:00', '17:00', 'Estudos TI', 'estudos', templateId),
      makeBlock(days[4], '16:00', '17:00', 'Revisão semanal', 'geral', templateId),
    );

    // Corrida: Ter, Qui 19:00-20:00
    events.push(
      makeBlock(days[1], '19:00', '20:00', 'Corrida noturna', 'corrida', templateId),
      makeBlock(days[3], '19:00', '20:00', 'Corrida noturna', 'corrida', templateId),
    );

    // Sábado opcional no modo 6 dias — SOMENTE se não for fim de semana com o filho
    if (templateId === 'apps_6d' && !hasChildThisWeekend) {
      events.push(
        makeBlock(
          sat,
          '06:00',
          '12:00',
          'Uber Moto / 99Moto (Sábado)',
          'trabalho',
          templateId,
          'Incluído porque não há reserva de fim de semana com o filho.',
        ),
      );
    }
  } else if (templateId === 'clt') {
    for (let idx = 0; idx < 5; idx++) {
      const d = days[idx];
      events.push(
        makeBlock(d, '10:45', '12:00', 'Deslocamento Magé → Rio', 'deslocamento', templateId),
        makeBlock(d, '12:00', '20:00', 'Turno Portaria (CLT)', 'trabalho', templateId),
        makeBlock(d, '20:00', '21:15', 'Deslocamento Rio → Magé', 'deslocamento', templateId),
      );
    }
    // Treinos e estudos pela manhã antes do turno CLT
    for (const idx of [0, 2, 4]) {
      events.push(makeBlock(days[idx], '07:30', '08:30', 'Academia', 'academia', templateId));
    }
    events.push(
      makeBlock(days[1], '07:30', '08:30', 'Corrida matinal', 'corrida', templateId),
      makeBlock(days[3], '07:30', '08:30', 'Corrida matinal', 'corrida', templateId),
      makeBlock(days[0], '09:00', '10:00', 'Estudos TI', 'estudos', templateId),
      makeBlock(days[2], '09:00', '10:00', 'Candidaturas TI', 'entrevista', templateId),
      makeBlock(days[4], '09:00', '10:00', 'Estudos TI / Revisão', 'estudos', templateId),
    );
  } else if (templateId === 'ti') {
    for (let idx = 0; idx < 5; idx++) {
      const d = days[idx];
      events.push(
        makeBlock(d, '09:00', '18:00', 'Expediente TI', 'trabalho', templateId),
      );
    }
    for (const idx of [0, 2, 4]) {
      events.push(makeBlock(days[idx], '18:30', '19:30', 'Academia', 'academia', templateId));
    }
    events.push(
      makeBlock(days[1], '19:00', '20:00', 'Corrida', 'corrida', templateId),
      makeBlock(days[3], '19:00', '20:00', 'Corrida', 'corrida', templateId),
      makeBlock(days[0], '20:00', '21:00', 'Estudos / Certificação TI', 'estudos', templateId),
      makeBlock(days[2], '20:00', '21:00', 'Projeto / Laboratório TI', 'estudos', templateId),
    );
  }

  if (hasChildThisWeekend) {
    events.push(
      makeBlock(
        sat,
        '08:00',
        '20:00',
        'Fim de semana com o filho (bloqueado para trabalho)',
        'filho',
        templateId,
        'Reservado automaticamente conforme regra de fins de semana.',
      ),
      makeBlock(
        sun,
        '08:00',
        '19:00',
        'Fim de semana com o filho (bloqueado para trabalho)',
        'filho',
        templateId,
        'Reservado automaticamente conforme regra de fins de semana.',
      ),
    );
  } else {
    events.push(
      makeBlock(sun, '16:00', '17:30', 'Descanso e planejamento leve da semana', 'pausa', templateId),
    );
  }

  return events;
}
