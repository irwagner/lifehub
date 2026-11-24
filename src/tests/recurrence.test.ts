import { describe, expect, it } from 'vitest';
import {
  generateUpcomingChildWeekends,
  isChildWeekend,
  normalizeToSaturday,
} from '../services/recurrence';
import { buildWeekEventsFromTemplate } from '../services/scheduleTemplates';

describe('Recorrência de Fins de Semana com o Filho e Templates', () => {
  it('normaliza qualquer dia para o sábado do fim de semana correspondente', () => {
    expect(normalizeToSaturday('2026-11-28')).toBe('2026-11-28'); // Sábado
    expect(normalizeToSaturday('2026-11-29')).toBe('2026-11-28'); // Domingo -> sábado anterior
    expect(normalizeToSaturday('2026-11-24')).toBe('2026-11-28'); // Terça -> próximo sábado
  });

  it('NÃO presume data inicial quando modo alternado está sem data âncora', () => {
    expect(isChildWeekend('2026-11-28', 'alternating', null)).toBe(false);
    expect(generateUpcomingChildWeekends('2026-11-24', 4, 'alternating', null)).toEqual([]);
  });

  it('calcula corretamente fins de semana alternados a partir da data âncora escolhida', () => {
    const anchor = '2026-11-28'; // Sábado âncora
    expect(isChildWeekend('2026-11-28', 'alternating', anchor)).toBe(true);
    expect(isChildWeekend('2026-11-29', 'alternating', anchor)).toBe(true);
    expect(isChildWeekend('2026-12-05', 'alternating', anchor)).toBe(false);
    expect(isChildWeekend('2026-12-12', 'alternating', anchor)).toBe(true);
    expect(isChildWeekend('2026-12-13', 'alternating', anchor)).toBe(true);
    expect(isChildWeekend('2026-11-27', 'alternating', anchor)).toBe(false); // Sexta-feira

    const next3 = generateUpcomingChildWeekends('2026-11-24', 3, 'alternating', anchor);
    expect(next3.map((w) => w.saturday)).toEqual(['2026-11-28', '2026-12-12', '2026-12-26']);
  });

  it('reserva todos os fins de semana quando modo = all', () => {
    const next2 = generateUpcomingChildWeekends('2026-11-24', 2, 'all', null);
    expect(next2.map((w) => w.saturday)).toEqual(['2026-11-28', '2026-12-05']);
  });

  it('template de 6 dias bloqueia trabalho no sábado quando há filho e libera quando não há', () => {
    // Semana de 2026-11-23 (sábado = 2026-11-28)
    const withChild = buildWeekEventsFromTemplate(
      'apps_6d',
      '2026-11-24',
      'alternating',
      '2026-11-28',
    );
    expect(withChild.some((e) => e.start_at.startsWith('2026-11-28') && e.category === 'trabalho')).toBe(false);
    expect(withChild.some((e) => e.start_at.startsWith('2026-11-28') && e.category === 'filho')).toBe(true);

    // Semana seguinte (sábado = 2026-12-05, sem filho)
    const withoutChild = buildWeekEventsFromTemplate(
      'apps_6d',
      '2026-12-01',
      'alternating',
      '2026-11-28',
    );
    expect(withoutChild.some((e) => e.start_at.startsWith('2026-12-05') && e.category === 'trabalho')).toBe(true);
  });

  it('templates CLT, TI e Apps 4d geram blocos coerentes', () => {
    const clt = buildWeekEventsFromTemplate('clt', '2026-11-24', 'custom', null);
    expect(clt.filter((e) => e.category === 'trabalho')).toHaveLength(5);
    expect(clt.some((e) => e.category === 'deslocamento')).toBe(true);

    const apps4d = buildWeekEventsFromTemplate('apps_4d', '2026-11-24', 'custom', null);
    expect(apps4d.filter((e) => e.category === 'trabalho')).toHaveLength(4);
  });
});
