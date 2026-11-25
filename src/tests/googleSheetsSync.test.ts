import { describe, expect, it } from 'vitest';
import { createInMemoryTestDatabase } from '../db/client';
import {
  createGoal,
  createRecurringRule,
  createTransaction,
} from '../repositories/financeRepo';
import { getSettings } from '../repositories/settingsRepo';
import { createWorkSession } from '../repositories/workRepo';
import {
  buildGoogleSheetsPayload,
  generateGoogleAppsScriptCode,
  generateSheetsSecretToken,
  normalizeGoogleSheetsWebhookUrl,
  syncFinanceToGoogleSheets,
  testGoogleSheetsConnection,
} from '../services/googleSheetsSync';

describe('Backup Financeiro Automático no Google Sheets', () => {
  it('valida estritamente apenas URLs HTTPS do Google Apps Script', () => {
    expect(
      normalizeGoogleSheetsWebhookUrl('https://script.google.com/macros/s/AKfycb123/exec'),
    ).toBe('https://script.google.com/macros/s/AKfycb123/exec');

    expect(() =>
      normalizeGoogleSheetsWebhookUrl('http://script.google.com/macros/s/AKfycb123/exec'),
    ).toThrow(/HTTPS/i);

    expect(() =>
      normalizeGoogleSheetsWebhookUrl('https://evil.example.com/hook'),
    ).toThrow(/Google Apps Script/i);
  });

  it('gera script Apps Script pronto com o token secreto embutido e as 5 abas financeiras', () => {
    const token = generateSheetsSecretToken();
    expect(token.startsWith('LHGS_')).toBe(true);
    expect(token.length).toBeGreaterThanOrEqual(24);

    const code = generateGoogleAppsScriptCode(token);
    expect(code).toContain(token);
    expect(code).toContain("function doPost(e)");
    expect(code).toContain("'Resumo'");
    expect(code).toContain("'Lançamentos'");
    expect(code).toContain("'Contas Fixas'");
    expect(code).toContain("'Uber e 99 Moto'");
    expect(code).toContain("'Metas'");
  });

  it('monta payload financeiro completo do SQLite e envia via POST text/plain CORS-safe', async () => {
    const db = await createInMemoryTestDatabase();
    const settings = await getSettings(db);

    await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: 'cat_salario',
      type: 'income',
      source_type: 'salario',
      description: '1ª Parcela 13º',
      amount: 1514.79,
      date: '2026-11-25',
      status: 'realized',
    });
    await createRecurringRule(db, {
      account_id: 'acc_principal',
      category_id: 'cat_familia',
      type: 'expense',
      description: 'Pensão filho',
      amount: 620,
      day_of_month: 1,
    });
    await createWorkSession(
      db,
      {
        date: '2026-11-25',
        platform: 'uber_moto',
        start_time: '07:00',
        end_time: '12:00',
        gross_amount: 200,
        km_total: 85,
        fuel_cost: 30,
      },
      settings,
    );
    await createGoal(db, { name: 'Reserva Emergência', target_amount: 5000, current_amount: 1000 });

    const token = generateSheetsSecretToken();
    const payload = await buildGoogleSheetsPayload(db, token);
    expect(payload.transactions).toHaveLength(1);
    expect(payload.recurringRules).toHaveLength(1);
    expect(payload.recurringRules[0][3]).toBe(-620);
    expect(payload.workSessions).toHaveLength(1);
    expect(payload.goals).toHaveLength(1);

    let capturedContentType = '';
    let capturedBody = '';
    const mockFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      capturedContentType = headers['Content-Type'] ?? '';
      capturedBody = String(init?.body ?? '');
      const parsed = JSON.parse(capturedBody) as { action?: string; secret?: string };
      if (parsed.secret !== token) {
        return new Response(JSON.stringify({ ok: false, error: 'Token secreto inválido.' }), {
          status: 200,
        });
      }
      if (parsed.action === 'ping') {
        return new Response(
          JSON.stringify({ ok: true, message: 'Planilha conectada!' }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ ok: true, syncedAt: '2026-11-25T22:38:00.000Z' }),
        { status: 200 },
      );
    }) as typeof fetch;

    const ping = await testGoogleSheetsConnection(
      { webhookUrl: 'https://script.google.com/macros/s/AKfycbDEMO/exec', secretToken: token },
      mockFetch,
    );
    expect(ping.ok).toBe(true);
    expect(capturedContentType).toContain('text/plain');

    const syncRes = await syncFinanceToGoogleSheets(
      db,
      { webhookUrl: 'https://script.google.com/macros/s/AKfycbDEMO/exec', secretToken: token },
      mockFetch,
    );
    expect(syncRes.ok).toBe(true);
    expect(syncRes.transactionsCount).toBe(1);
    expect(syncRes.recurringCount).toBe(1);
    expect(syncRes.workSessionsCount).toBe(1);
    expect(syncRes.goalsCount).toBe(1);

    await db.close();
  });
});
