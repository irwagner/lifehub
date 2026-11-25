import { describe, expect, it } from 'vitest';
import { createInMemoryTestDatabase } from '../db/client';
import { listCalendarEvents, listTasks } from '../repositories/calendarRepo';
import { listRecurringRules, listTransactions } from '../repositories/financeRepo';
import { listIdeas } from '../repositories/ideasRepo';
import { getSettings } from '../repositories/settingsRepo';
import { listWorkSessions } from '../repositories/workRepo';
import {
  askLifeHubAssistant,
  buildCompactLifeHubContext,
  buildModelChain,
  executeProposedAiAction,
  extractProposedActions,
  loadAiMemory,
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
});
