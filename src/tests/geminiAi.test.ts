import { describe, expect, it } from 'vitest';
import { createInMemoryTestDatabase } from '../db/client';
import { listCalendarEvents, listTasks } from '../repositories/calendarRepo';
import { listJobApplications } from '../repositories/careerRepo';
import {
  listBudgetsForMonth,
  listGoals,
  listRecurringRules,
  listTransactions,
} from '../repositories/financeRepo';
import { listHabitsWithProgress } from '../repositories/habitsRepo';
import { listIdeas } from '../repositories/ideasRepo';
import { listProjectsWithTasks } from '../repositories/projectsRepo';
import { getSettings } from '../repositories/settingsRepo';
import { listWorkSessions } from '../repositories/workRepo';
import {
  askLifeHubAssistant,
  buildCompactLifeHubContext,
  buildModelChain,
  classifyPromptTask,
  executeProposedAiAction,
  extractProposedActions,
  GEMINI_MODEL_ROUTING_GUIDE,
  loadAiMemory,
  normalizeEventCategory,
  normalizeFlexibleTime,
  normalizeWeekdays,
  removeAiMemoryFact,
  type GeminiAiConfig,
} from '../services/geminiAi';

describe('Assistente IA Gemini (ações estruturadas, privacidade e fallback)', () => {
  it('extrai ações válidas do bloco lifehub_actions e rejeita plataforma iFood', () => {
    const raw = `Beleza! Preparei os lançamentos abaixo:
\`\`\`lifehub_actions
[
  {"type":"create_transaction","summary":"Despesa: Gasolina R$ 35,00","payload":{"txType":"expense","description":"Gasolina","amount":35,"date":"2026-11-25","category_id":"cat_combustivel"}},
  {"type":"create_work_session","summary":"Inválido iFood","payload":{"platform":"ifood","gross_amount":100,"km_total":50}},
  {"type":"create_work_session","summary":"Uber Moto: R$ 210 bruto","payload":{"platform":"uber_moto","date":"2026-11-25","gross_amount":210,"km_total":95,"fuel_cost":35,"syncFinance":true}},
  {"type":"create_task","summary":"Tarefa: Estudar Redes","payload":{"title":"Estudar Redes","priority":"high"}}
]
\`\`\``;

    const { cleanText, actions } = extractProposedActions(raw);
    expect(cleanText).toContain('Preparei os lançamentos');
    expect(cleanText).not.toContain('lifehub_actions');
    expect(actions).toHaveLength(3);
    expect(actions.map((a) => a.type)).toEqual([
      'create_transaction',
      'create_work_session',
      'create_task',
    ]);
  });

  it('aceita receita natural com valor em formato brasileiro e bloco json fallback (ex.: primeira parcela hoje)', async () => {
    const db = await createInMemoryTestDatabase();
    const settings = await getSettings(db);

    const raw = `Anotei sua primeira parcela no financeiro!
\`\`\`json
{
  "actions": [
    {
      "type": "create_transaction",
      "summary": "Receita: Primeira parcela R$ 1.250,50",
      "payload": {
        "txType": "receita",
        "description": "Primeira parcela",
        "amount": "R$ 1.250,50",
        "date": "25/11/2026",
        "source_type": "salario",
        "category_id": "cat_inexistente",
        "status": "realized"
      }
    }
  ]
}
\`\`\``;

    const { cleanText, actions } = extractProposedActions(raw);
    expect(cleanText).toContain('primeira parcela');
    expect(cleanText).not.toContain('create_transaction');
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('create_transaction');
    if (actions[0].type === 'create_transaction') {
      expect(actions[0].payload.txType).toBe('income');
      expect(actions[0].payload.amount).toBe(1250.5);
      expect(actions[0].payload.date).toBe('2026-11-25');
    }

    const doneMsg = await executeProposedAiAction(db, settings, actions[0]);
    expect(doneMsg).toContain('Primeira parcela');
    const txs = await listTransactions(db);
    expect(txs).toHaveLength(1);
    expect(txs[0].type).toBe('income');
    expect(txs[0].amount).toBe(1250.5);

    await db.close();
  });

  it('executa ações aprovadas no SQLite real (transação, jornada+financeiro, tarefa, evento e ideia)', async () => {
    const db = await createInMemoryTestDatabase();
    const settings = await getSettings(db);

    const { actions } = extractProposedActions(`\`\`\`lifehub_actions
[
  {"type":"create_work_session","summary":"Uber Moto","payload":{"platform":"uber_moto","date":"2026-11-25","start_time":"07:00","end_time":"12:00","gross_amount":200,"km_total":90,"fuel_cost":30,"syncFinance":true}},
  {"type":"create_task","summary":"Revisar CV","payload":{"title":"Revisar CV TI","priority":"high","due_date":"2026-11-26"}},
  {"type":"create_event","summary":"Estudo Linux","payload":{"title":"Laboratório Linux","category":"estudos","date":"2026-11-25","start_time":"19:00","end_time":"20:30"}},
  {"type":"create_idea","summary":"Script","payload":{"title":"Script backup PowerShell","impact":5,"effort":2}}
]
\`\`\``);

    for (const act of actions) {
      await executeProposedAiAction(db, settings, act);
    }

    expect(await listWorkSessions(db)).toHaveLength(1);
    expect(await listTransactions(db)).toHaveLength(2);
    expect((await listTasks(db)).some((t) => t.title === 'Revisar CV TI')).toBe(true);
    expect(
      (
        await listCalendarEvents(db, {
          startISO: '2026-11-25T00:00:00',
          endISO: '2026-11-25T23:59:59',
        })
      ).some((e) => e.title === 'Laboratório Linux'),
    ).toBe(true);
    expect((await listIdeas(db)).some((i) => i.title === 'Script backup PowerShell')).toBe(true);

    await db.close();
  });

  it('tenta os melhores modelos primeiro (auto) e faz fallback automático para os mais leves em 429/404', async () => {
    const db = await createInMemoryTestDatabase();

    const chain = buildModelChain('auto');
    expect(chain[0]).toBe('gemini-4-hydrogen');
    expect(chain[1]).toBe('gemini-3.8-flash');
    expect(chain[chain.length - 1]).toBe('gemma-4-31b-it');

    const hiddenCtx = await buildCompactLifeHubContext(db, false);
    expect(hiddenCtx).toContain('[OCULTO]');
    expect(hiddenCtx).not.toContain('R$');

    const calledUrls: string[] = [];
    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.includes('gemini-4-hydrogen:')) {
        return new Response(
          JSON.stringify({ error: { message: 'Quota exceeded' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'Tudo certo! Usei o segundo melhor modelo.' }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const cfg: GeminiAiConfig = {
      apiKey: 'test-key-local',
      model: 'auto',
      shareFinancialContext: false,
      autoExecuteActions: true,
    };

    const reply = await askLifeHubAssistant(db, cfg, [], 'Qual o foco de hoje?', mockFetch);
    expect(reply.modelUsed).toBe('gemini-3.8-flash');
    expect(reply.text).toContain('segundo melhor');
    expect(calledUrls).toHaveLength(2);
    expect(calledUrls[0]).toContain('gemini-4-hydrogen:');
    expect(calledUrls[1]).toContain('gemini-3.8-flash:');

    await db.close();
  });

  it('corrige lançamento anterior (Realizado -> Previsto dia 01), cria recorrência fixa, salva memória e faz fallback em resposta vazia', async () => {
    const db = await createInMemoryTestDatabase();
    const settings = await getSettings(db);

    // 1. Initial creation (13º + Pensão wrongly marked realized today)
    const initial = extractProposedActions(`\`\`\`lifehub_actions
[
  {"type":"create_transaction","summary":"Receita 13º","payload":{"txType":"income","description":"1ª Parcela 13º Salário","amount":1514.79,"date":"2026-11-25","status":"realized"}},
  {"type":"create_transaction","summary":"Pensão","payload":{"txType":"expense","description":"Pensão do filho","amount":620,"date":"2026-11-25","status":"realized"}}
]
\`\`\``);
    for (const act of initial.actions) {
      await executeProposedAiAction(db, settings, act);
    }

    const beforeTxs = await listTransactions(db);
    const pensao = beforeTxs.find((t) => t.description.includes('Pensão'));
    expect(pensao?.status).toBe('realized');

    // 2. Follow-up correction: change Pensão to planned on 2026-12-01 + recurring rule day 01 + save memory
    const correction = extractProposedActions(`\`\`\`lifehub_actions
[
  {"type":"update_transaction","summary":"Mover pensão para previsto dia 01","payload":{"transaction_id":"${pensao!.id}","status":"planned","date":"2026-12-01","due_date":"2026-12-01"}},
  {"type":"create_recurring_rule","summary":"Recorrência pensão dia 01","payload":{"txType":"expense","description":"Pensão do filho","amount":620,"day_of_month":1}},
  {"type":"save_memory","summary":"Lembrar dia de pagamento","payload":{"fact":"Pagamentos fixos mensais saem sempre no dia 01."}}
]
\`\`\``);

    for (const act of correction.actions) {
      await executeProposedAiAction(db, settings, act);
    }

    const afterTxs = await listTransactions(db);
    const updatedPensao = afterTxs.find((t) => t.id === pensao!.id);
    expect(updatedPensao?.status).toBe('planned');
    expect(updatedPensao?.date).toBe('2026-12-01');

    const rules = await listRecurringRules(db);
    expect(rules).toHaveLength(1);
    expect(rules[0].day_of_month).toBe(1);
    expect(rules[0].amount).toBe(620);

    const ctxAfter = await buildCompactLifeHubContext(db, true);
    expect(ctxAfter).toContain(pensao!.id);
    expect(ctxAfter).toContain('dia 01');

    // 3. Fallback on empty response (HTTP 200 with empty parts -> internal 502 -> next model!)
    let callCount = 0;
    const mockEmptyThenOk = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: '' }] } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Corrigido para dia 01!' }] } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const reply = await askLifeHubAssistant(
      db,
      {
        apiKey: 'test-key',
        model: 'gemini-3.8-flash',
        shareFinancialContext: true,
        autoExecuteActions: true,
      },
      [],
      'não, só sai dia 01',
      mockEmptyThenOk,
    );
    expect(callCount).toBe(2);
    expect(reply.modelUsed).toBe('gemini-4-hydrogen');
    expect(reply.text).toContain('Corrigido');

    // Clean up memory created during test
    for (const m of loadAiMemory()) removeAiMemoryFact(m.id);
    await db.close();
  });

  it('aceita despesa fixa sem day_of_month explícito e já gera lançamento Previsto visível no Financeiro', async () => {
    const db = await createInMemoryTestDatabase();
    const settings = await getSettings(db);

    const parsed = extractProposedActions(`Anotei sua despesa fixa mensal!
\`\`\`
{"type":"create_recurring_rule","summary":"Despesa fixa: Internet R$ 119,90","payload":{"description":"Internet Fibra","amount":"R$ 119,90"}}
\`\`\``);

    expect(parsed.actions).toHaveLength(1);
    await executeProposedAiAction(db, settings, parsed.actions[0]);

    const rules = await listRecurringRules(db);
    expect(rules).toHaveLength(1);
    expect(rules[0].description).toBe('Internet Fibra');
    expect(rules[0].day_of_month).toBe(1);
    expect(rules[0].type).toBe('expense');

    const txs = await listTransactions(db);
    expect(txs).toHaveLength(1);
    expect(txs[0].description).toBe('Internet Fibra');
    expect(txs[0].status).toBe('planned');
    expect(txs[0].amount).toBe(119.9);

    await db.close();
  });

  it('executa cenários reais completos: cartão 1x próx. mês, parcelado 6x, editar/apagar recorrência, rotina semanal, template, hábitos, metas, orçamento, projetos e vagas TI', async () => {
    const db = await createInMemoryTestDatabase();
    const settings = await getSettings(db);

    // 1. Parcelamentos (cartão 1x próximo mês + moto 6x por parcela), fixo, meta, orçamento, rotina semanal, hábito, projeto e vaga
    const batch1 = extractProposedActions(`Tudo pronto! Lancei sua rotina, parcelamentos e carreira TI:
\`\`\`lifehub_actions
[
  {"type":"create_installment","summary":"Cartão 1x próx. mês: Fone R$ 180","payload":{"kind":"cartão","description":"Fone Bluetooth","amount":"R$ 180,00","amount_mode":"total","installments":1,"next_month":true,"issuer":"Nubank","first_paid":false}},
  {"type":"create_installment","summary":"Moto 6x R$ 350/mês","payload":{"kind":"moto","description":"Seguro anual moto","amount":350,"amount_mode":"parcela","installments":6,"first_date":"2026-12-05","first_paid":true}},
  {"type":"create_recurring_rule","summary":"Internet fixa","payload":{"description":"Internet Casa","amount":110,"day_of_month":10}},
  {"type":"create_goal","summary":"Meta reserva","payload":{"name":"Reserva Emergência","target_amount":5000,"current_amount":800,"target_date":"2027-06-01"}},
  {"type":"upsert_budget","summary":"Orçamento alimentação","payload":{"month":"2026-11","category_id":"cat_alimentacao","limit_amount":650}},
  {"type":"create_event","summary":"Dentista com horário flexível","payload":{"title":"Consulta Dentista","category":"saúde","date":"2026-11-27","start_time":"9h30"}},
  {"type":"create_routine_schedule","summary":"Rotina Academia Seg/Qua/Sex","payload":{"title":"Academia","category":"treino","weekdays":["seg","qua","sex"],"start_time":"14h30","weeks":2,"start_date":"2026-11-30"}},
  {"type":"log_habit","summary":"Treino feito","payload":{"habit_name":"Academia","date":"2026-11-26","duration_minutes":55}},
  {"type":"create_project","summary":"Projeto Lab Linux","payload":{"title":"Homelab Redes TI","category":"portfolio_ti","deliverable":"Repositório GitHub","initial_tasks":["Instalar Ubuntu Server","Configurar WireGuard"]}},
  {"type":"create_job_application","summary":"Vaga Suporte N2","payload":{"company":"TechCorp","role":"Suporte TI N2","status":"applied","salary_info":"R$ 3.600"}}
]
\`\`\``);

    expect(batch1.actions).toHaveLength(10);
    for (const act of batch1.actions) {
      await executeProposedAiAction(db, settings, act);
    }

    const txs = await listTransactions(db);
    // 1x cartão + 6x moto + 1 prevista gerada pela recorrência Internet = 8
    expect(txs).toHaveLength(8);
    const foneTx = txs.find((t) => t.description.includes('Fone Bluetooth'));
    expect(foneTx?.installment_group_id).toBeTruthy();
    expect(foneTx?.installment_number).toBe(1);
    expect(foneTx?.installment_total).toBe(1);
    expect(foneTx?.notes).toContain('[Cartão]');
    expect(foneTx?.notes).toContain('[Nubank]');
    expect(foneTx?.status).toBe('planned');

    const motoTxs = txs.filter((t) => t.description.includes('Seguro anual moto'));
    expect(motoTxs).toHaveLength(6);
    expect(motoTxs.every((t) => t.amount === 350)).toBe(true);
    expect(motoTxs.filter((t) => t.status === 'realized')).toHaveLength(1);

    // 2. Edit recurring rule + sync planned, then delete event & complete task
    const rulesBefore = await listRecurringRules(db);
    expect(rulesBefore).toHaveLength(1);

    const taskBatch = extractProposedActions(`\`\`\`lifehub_actions
[
  {"type":"update_recurring_rule","summary":"Ajustar Internet para 129,90","payload":{"rule_id":"${rulesBefore[0].id}","amount":129.9,"day_of_month":15,"sync_planned":true}},
  {"type":"create_task","summary":"Enviar currículo","payload":{"title":"Enviar currículo TechCorp","priority":"high"}},
  {"type":"apply_schedule_template","summary":"Aplicar rotina Apps 5d","payload":{"template_id":"apps_5d","date":"2026-12-07"}}
]
\`\`\``);
    expect(taskBatch.actions).toHaveLength(3);
    for (const act of taskBatch.actions) {
      await executeProposedAiAction(db, settings, act);
    }

    const rulesAfterEdit = await listRecurringRules(db);
    expect(rulesAfterEdit[0].amount).toBe(129.9);
    expect(rulesAfterEdit[0].day_of_month).toBe(15);

    // Complete task + delete dentist event + delete recurring rule
    const cleanupBatch = extractProposedActions(`\`\`\`lifehub_actions
[
  {"type":"complete_task","summary":"Concluir currículo","payload":{"match_title":"TechCorp"}},
  {"type":"delete_event","summary":"Cancelar dentista","payload":{"match_title":"Dentista"}},
  {"type":"delete_recurring_rule","summary":"Remover internet","payload":{"rule_id":"${rulesBefore[0].id}"}}
]
\`\`\``);
    expect(cleanupBatch.actions).toHaveLength(3);
    for (const act of cleanupBatch.actions) {
      await executeProposedAiAction(db, settings, act);
    }

    expect(await listRecurringRules(db)).toHaveLength(0);
    expect((await listTasks(db, 'done')).some((t) => t.title.includes('TechCorp'))).toBe(true);

    const eventsAll = await listCalendarEvents(db);
    expect(eventsAll.some((e) => e.title.includes('Dentista'))).toBe(false);
    // 6 Academia routine events (3 days x 2 weeks) + template blocks for week 2026-12-07
    expect(eventsAll.filter((e) => e.title === 'Academia' && e.recurrence_rule === 'WEEKLY:2')).toHaveLength(6);
    expect(eventsAll.some((e) => e.source_template === 'apps_5d')).toBe(true);

    expect((await listGoals(db)).some((g) => g.name === 'Reserva Emergência')).toBe(true);
    expect((await listBudgetsForMonth(db, '2026-11')).some((b) => b.limit_amount === 650)).toBe(true);
    expect((await listHabitsWithProgress(db, '2026-11-26')).some((h) => h.completedThisWeek >= 1)).toBe(true);
    expect((await listProjectsWithTasks(db)).some((p) => p.title === 'Homelab Redes TI' && p.tasks.length === 2)).toBe(true);
    expect((await listJobApplications(db)).some((j) => j.company === 'TechCorp')).toBe(true);

    await db.close();
  });

  it('mapeia corretamente o melhor modelo Gemini para cada tipo de tarefa no modo smart e normaliza entradas PT-BR', () => {
    expect(GEMINI_MODEL_ROUTING_GUIDE).toHaveLength(7);
    expect(normalizeFlexibleTime('7h')).toBe('07:00');
    expect(normalizeFlexibleTime('7h30')).toBe('07:30');
    expect(normalizeFlexibleTime('19:05:00')).toBe('19:05');
    expect(normalizeEventCategory('saúde')).toBe('saude');
    expect(normalizeEventCategory('treino musculação')).toBe('academia');
    expect(normalizeWeekdays(['seg', 'qua', 'sex'])).toEqual([1, 3, 5]);
    expect(normalizeWeekdays('seg a sex')).toEqual([1, 2, 3, 4, 5]);

    // Quick everyday entry -> Flash Lite (500/day, fast, preserves flagship quota)
    expect(classifyPromptTask('Gastei 35 reais de gasolina hoje')).toBe('quick_entry');
    expect(buildModelChain('smart', 'Gastei 35 reais de gasolina hoje')[0]).toBe('gemini-3.5-flash-lite');

    // Routine / calendar planning -> Flash Lite primary (tested 100% in 5s, 500/day) + 3-flash-preview fallback
    expect(classifyPromptTask('Monte minha rotina semanal de academia e estudos de TI')).toBe('routine_planning');
    const routineChain = buildModelChain('smart', 'Monte minha rotina semanal de academia e estudos de TI');
    expect(routineChain[0]).toBe('gemini-3.5-flash-lite');
    expect(routineChain[1]).toBe('gemini-3-flash-preview');

    // Deep financial analysis -> Gemini 4 Hydrogen
    expect(classifyPromptTask('Analise minhas finanças e compare CLT vs Uber Moto este mês')).toBe('deep_analysis');
    expect(buildModelChain('smart', 'Analise minhas finanças e compare CLT vs Uber Moto este mês')[0]).toBe('gemini-4-hydrogen');
  });

  it('faz fallback automático quando um modelo sofre timeout (AbortError -> 504)', async () => {
    const db = await createInMemoryTestDatabase();
    let attempt = 0;
    const mockTimeoutThenOk = (async () => {
      attempt++;
      if (attempt === 1) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Fallback pós-timeout funcionou!' }] } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const reply = await askLifeHubAssistant(
      db,
      {
        apiKey: 'test-key',
        model: 'smart',
        shareFinancialContext: false,
        autoExecuteActions: true,
      },
      [],
      'Gastei 20 reais de café',
      mockTimeoutThenOk,
    );
    expect(attempt).toBe(2);
    expect(reply.modelUsed).toBe('gemini-3-flash-preview');
    expect(reply.text).toContain('Fallback pós-timeout');
    await db.close();
  });
});
