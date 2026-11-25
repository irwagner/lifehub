import { describe, expect, it } from 'vitest';
import { createInMemoryTestDatabase } from '../db/client';
import { listCalendarEvents, listTasks } from '../repositories/calendarRepo';
import { listTransactions } from '../repositories/financeRepo';
import { listIdeas } from '../repositories/ideasRepo';
import { getSettings } from '../repositories/settingsRepo';
import { listWorkSessions } from '../repositories/workRepo';
import {
  askLifeHubAssistant,
  buildCompactLifeHubContext,
  executeProposedAiAction,
  extractProposedActions,
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
    // syncFinance=true creates both gross income + fuel expense transactions
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

  it('oculta valores em R$ no contexto quando shareFinancialContext está desativado e faz fallback automático em HTTP 429', async () => {
    const db = await createInMemoryTestDatabase();

    const hiddenCtx = await buildCompactLifeHubContext(db, false);
    expect(hiddenCtx).toContain('[OCULTO]');
    expect(hiddenCtx).not.toContain('R$');

    const calledUrls: string[] = [];
    const mockFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.includes('gemini-3.5-flash-lite:')) {
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
                parts: [{ text: 'Tudo certo! Usei o modelo reserva.' }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const cfg: GeminiAiConfig = {
      apiKey: 'test-key-local',
      model: 'gemini-3.5-flash-lite',
      shareFinancialContext: false,
    };

    const reply = await askLifeHubAssistant(db, cfg, [], 'Qual o foco de hoje?', mockFetch);
    expect(reply.modelUsed).toBe('gemini-3.1-flash-lite');
    expect(reply.text).toContain('modelo reserva');
    expect(calledUrls).toHaveLength(2);

    await db.close();
  });
});
