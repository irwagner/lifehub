import type { SqlExecutor } from '../db/types';
import { createCalendarEvent, createTask, applyScheduleTemplateToWeek } from '../repositories/calendarRepo';
import { createJobApplication, createStudySession } from '../repositories/careerRepo';
import { createFamilyPlan } from '../repositories/familyRepo';
import { createGoal, createTransaction } from '../repositories/financeRepo';
import { logHabitSession } from '../repositories/habitsRepo';
import { createIdea } from '../repositories/ideasRepo';
import { getSettings, updateSettings } from '../repositories/settingsRepo';
import { createVehicle, createVehicleExpense, createWorkSession } from '../repositories/workRepo';
import { addDaysISO, startOfWeekISO, todayISO } from '../utils/format';
import { clearAllUserData } from './backup';
import { normalizeToSaturday } from './recurrence';

/**
 * Loads realistic, clearly labeled demonstration data aligned with the LifeHub blueprint.
 * ONLY called when explicitly requested by the user — never runs automatically on first boot.
 */
export async function loadDemoData(
  db: SqlExecutor,
  referenceDateISO = todayISO(),
): Promise<void> {
  await clearAllUserData(db);

  const upcomingSat = normalizeToSaturday(referenceDateISO);
  const weekMon = startOfWeekISO(referenceDateISO);

  const settings = await updateSettings(db, {
    user_name: 'Demo',
    routine_mode: 'apps',
    work_days_per_week: 5,
    monthly_net_goal: 3800,
    clt_reference_net: 2745,
    maintenance_per_km: 0.18,
    depreciation_per_km: 0.1,
    vehicle_monthly_payment: 0,
    child_weekend_mode: 'alternating',
    child_weekend_anchor: upcomingSat,
    commute_minutes: 60,
    study_weekly_goal_hours: 6,
    onboarding_completed: 1,
    demo_data_loaded: 1,
  });

  // Vehicles (Fazer 150 quitada ativa + Haojue DR 160 como cenário planejado ilustrativo)
  const fazer = await createVehicle(db, {
    name: 'Yamaha Fazer 150',
    model_year: '2021',
    status: 'owned',
    estimated_value: 10000,
    financing_amount: 0,
    monthly_payment: 0,
    total_installments: 0,
    maintenance_per_km: 0.18,
    depreciation_per_km: 0.1,
    is_active: 1,
    notes: 'Moto atual quitada (dados de demonstração).',
  });

  await createVehicle(db, {
    name: 'Haojue DR 160 (Cenário Planejado)',
    model_year: '2026',
    status: 'planned',
    estimated_value: 20900,
    financing_amount: 10900,
    monthly_payment: 428,
    total_installments: 36,
    maintenance_per_km: 0.16,
    depreciation_per_km: 0.12,
    is_active: 0,
    notes: 'Estimativa ilustrativa (36x ~R$ 428), sujeita a orçamento e CET — NÃO é proposta aprovada.',
  });

  await createVehicleExpense(db, {
    vehicle_id: fazer.id,
    date: addDaysISO(referenceDateISO, -5),
    category: 'oleo',
    description: 'Troca de óleo e filtro (Demo)',
    amount: 68,
    odometer_km: 34250,
    notes: 'Manutenção preventiva.',
  });

  // Work sessions (apenas Uber Moto e 99Moto — sem iFood)
  await createWorkSession(
    db,
    {
      vehicle_id: fazer.id,
      date: weekMon,
      platform: 'ambos',
      start_time: '06:00',
      end_time: '12:30',
      gross_amount: 215,
      km_start: 34300,
      km_end: 34418,
      fuel_liters: 3.6,
      fuel_cost: 22.5,
      tolls_parking: 0,
      notes: 'Manhã forte no centro (Demo).',
    },
    settings,
  );

  await createWorkSession(
    db,
    {
      vehicle_id: fazer.id,
      date: addDaysISO(weekMon, 1),
      platform: 'uber_moto',
      start_time: '06:00',
      end_time: '12:30',
      gross_amount: 198,
      km_start: 34418,
      km_end: 34528,
      fuel_liters: 3.3,
      fuel_cost: 20.8,
      tolls_parking: 0,
      notes: 'Fluxo constante até 12h30 (Demo).',
    },
    settings,
  );

  await createWorkSession(
    db,
    {
      vehicle_id: fazer.id,
      date: addDaysISO(weekMon, 2),
      platform: '99_moto',
      start_time: '06:00',
      end_time: '12:45',
      gross_amount: 228,
      km_start: 34528,
      km_end: 34652,
      fuel_liters: 3.8,
      fuel_cost: 24.0,
      tolls_parking: 5.0,
      notes: 'Boa demanda matinal (Demo).',
    },
    settings,
  );

  // Finance transactions
  await createTransaction(db, {
    account_id: 'acc_principal',
    category_id: 'cat_salario',
    type: 'income',
    source_type: 'salario',
    description: 'Referência salário líquido CLT (Demo)',
    amount: 2745,
    date: `${referenceDateISO.slice(0, 7)}-05`,
    status: 'realized',
    notes: 'Valor de referência para demonstração.',
  });

  await createTransaction(db, {
    account_id: 'acc_principal',
    category_id: 'cat_apps',
    type: 'income',
    source_type: 'aplicativos',
    description: 'Repasse semanal Uber Moto / 99Moto (Demo)',
    amount: 641,
    date: referenceDateISO,
    status: 'realized',
    notes: 'Lançamento demonstrativo.',
  });

  await createTransaction(db, {
    account_id: 'acc_principal',
    category_id: 'cat_moradia',
    type: 'expense',
    source_type: 'outros',
    description: 'Contas da casa (água, luz, internet) — Demo',
    amount: 460,
    date: `${referenceDateISO.slice(0, 7)}-10`,
    status: 'realized',
  });

  await createTransaction(db, {
    account_id: 'acc_principal',
    category_id: 'cat_alimentacao',
    type: 'expense',
    source_type: 'outros',
    description: 'Mercado mensal (Demo)',
    amount: 680,
    date: addDaysISO(referenceDateISO, -2),
    status: 'realized',
  });

  await createTransaction(db, {
    account_id: 'acc_principal',
    category_id: 'cat_saude',
    type: 'expense',
    source_type: 'outros',
    description: 'Mensalidade Academia (Demo)',
    amount: 119.9,
    date: addDaysISO(referenceDateISO, 4),
    due_date: addDaysISO(referenceDateISO, 4),
    status: 'planned',
  });

  await createGoal(db, {
    name: 'Reserva de Emergência (6 meses)',
    target_amount: 15000,
    current_amount: 3200,
    notes: 'Prioridade antes de qualquer financiamento.',
  });

  // Schedule & Tasks
  const freshSettings = await getSettings(db);
  await applyScheduleTemplateToWeek(db, 'apps_5d', referenceDateISO, freshSettings, true);

  await createCalendarEvent(db, {
    title: 'Entrevista Técnica — Suporte N2 (Demo)',
    category: 'entrevista',
    start_at: `${addDaysISO(referenceDateISO, 1)}T16:00:00`,
    end_at: `${addDaysISO(referenceDateISO, 1)}T17:00:00`,
    notes: 'Revisar Active Directory, DHCP/DNS e troubleshooting Windows.',
  });

  await createTask(db, {
    title: 'Validar contracheque do mês e conferir descontos',
    priority: 'high',
    category: 'financeiro',
    due_date: referenceDateISO,
  });
  await createTask(db, {
    title: 'Enviar 3 candidaturas para vagas de Suporte/Redes',
    priority: 'high',
    category: 'carreira',
    due_date: addDaysISO(referenceDateISO, 1),
  });
  await createTask(db, {
    title: 'Calibrar pneus e revisar corrente da moto',
    priority: 'medium',
    category: 'trabalho',
    due_date: addDaysISO(referenceDateISO, 2),
  });

  // Habits
  await logHabitSession(db, {
    habit_id: 'hab_academia',
    date: weekMon,
    duration_minutes: 60,
    notes: 'Treino A — força (Demo)',
  });
  await logHabitSession(db, {
    habit_id: 'hab_corrida',
    date: addDaysISO(weekMon, 1),
    duration_minutes: 40,
    notes: '5 km ritmo leve (Demo)',
  });

  // Family
  await createFamilyPlan(db, {
    weekend_start: upcomingSat,
    title: 'Parque e almoço com meu filho (Demo)',
    budget_amount: 120,
    checklist: [
      { id: 'c1', label: 'Garrafa de água e lanche', done: true },
      { id: 'c2', label: 'Protetor solar e roupa extra', done: false },
    ],
    notes: 'Fim de semana reservado — sem trabalho em aplicativos.',
  });

  // Studies & Career
  await createStudySession(db, {
    track_id: 'trk_redes',
    date: weekMon,
    duration_minutes: 75,
    topic: 'TCP/IP, sub-redes e diagnóstico com tracert/nslookup',
    notes: 'Laboratório prático concluído.',
  });
  await createStudySession(db, {
    track_id: 'trk_suporte',
    date: addDaysISO(weekMon, 1),
    duration_minutes: 60,
    topic: 'Windows Event Viewer e permissões NTFS',
  });

  await createJobApplication(db, {
    company: 'TechInfra RJ (Demo)',
    role: 'Analista de Suporte Técnico Júnior',
    applied_date: addDaysISO(referenceDateISO, -3),
    status: 'interview',
    salary_info: 'R$ 3.200 + VR/VT',
    next_step: 'Entrevista técnica amanhã às 16:00',
  });
  await createJobApplication(db, {
    company: 'NetSecure Serviços (Demo)',
    role: 'Técnico de Redes / Infraestrutura',
    applied_date: addDaysISO(referenceDateISO, -1),
    status: 'applied',
    salary_info: 'R$ 3.600',
    next_step: 'Aguardar retorno do RH',
  });

  // Ideas
  await createIdea(db, {
    title: 'Checklist de manutenção preventiva da moto por km',
    description: 'Automatizar lembretes locais de óleo (1.000 km), relação e freios.',
    tags: 'moto, lifehub',
    status: 'planning',
    impact: 5,
    effort: 2,
  });
  await createIdea(db, {
    title: 'Portfólio no GitHub com scripts PowerShell de suporte',
    description: 'Scripts reais de diagnóstico de rede, limpeza de spooler e inventário de máquinas.',
    tags: 'carreira, ti, powershell',
    status: 'doing',
    impact: 5,
    effort: 3,
  });
}
