import { describe, expect, it } from 'vitest';
import { createInMemoryTestDatabase } from '../db/client';
import {
  createRecurringRule,
  createTransaction,
  generateMonthlyRecurringTransactions,
  getMultiMonthComparison,
  importStatementItems,
  listBudgetsForMonth,
  listTransactions,
  upsertCategoryBudget,
} from '../repositories/financeRepo';
import { exportBackupJson, restoreBackupJson, clearAllUserData } from '../services/backup';
import {
  parseCsvStatement,
  parseOfxStatement,
  parseStatementFile,
} from '../services/importParser';
import { buildDiscreteReminders } from '../services/reminders';

describe('Importação CSV/OFX, Deduplicação, Recorrências, Orçamentos e Lembretes', () => {
  it('faz parse de extrato CSV brasileiro (;, DD/MM/YYYY, vírgula decimal)', () => {
    const csv = [
      'Data;Descrição;Valor',
      '10/11/2026;Posto Ipiranga;-45,50',
      '05/11/2026;Salário Portaria;2.745,00',
      '12/11/2026;Linha Zerada;0,00',
    ].join('\n');

    const res = parseCsvStatement(csv, 'acc_principal');
    expect(res.format).toBe('csv');
    expect(res.items).toHaveLength(2);
    expect(res.skippedRows).toBe(1);

    expect(res.items[0]).toMatchObject({
      date: '2026-11-10',
      description: 'Posto Ipiranga',
      type: 'expense',
      amount: 45.5,
    });
    expect(res.items[1]).toMatchObject({
      date: '2026-11-05',
      description: 'Salário Portaria',
      type: 'income',
      amount: 2745,
    });
  });

  it('faz parse de arquivo OFX (<STMTTRN>, FITID, DTPOSTED, TRNAMT)', () => {
    const ofx = `
      <OFX>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>DEBIT
            <DTPOSTED>20261114120000[-3:BRT]
            <TRNAMT>-119.90
            <FITID>FIT-001
            <MEMO>Academia Mensalidade
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>CREDIT
            <DTPOSTED>20261115080000[-3:BRT]
            <TRNAMT>320.00
            <FITID>FIT-002
            <NAME>Repasse Uber Moto
          </STMTTRN>
        </BANKTRANLIST>
      </OFX>
    `;

    const res = parseOfxStatement(ofx, 'acc_principal');
    expect(res.format).toBe('ofx');
    expect(res.items).toHaveLength(2);
    expect(res.items[0]).toMatchObject({
      date: '2026-11-14',
      type: 'expense',
      amount: 119.9,
      description: 'Academia Mensalidade',
      fitid: 'FIT-001',
    });
    expect(res.items[1]).toMatchObject({
      date: '2026-11-15',
      type: 'income',
      amount: 320,
      description: 'Repasse Uber Moto',
      fitid: 'FIT-002',
    });
  });

  it('previne duplicidades na importação repetida e dentro do mesmo lote', async () => {
    const db = await createInMemoryTestDatabase();
    const csv = [
      'Data,Descrição,Valor',
      '2026-11-10,Mercado Bairro,-150.00',
      '2026-11-10,Mercado Bairro,-150.00',
      '2026-11-11,Repasse 99Moto,185.50',
    ].join('\n');

    const parsed = parseStatementFile('extrato.csv', csv, 'acc_principal');
    const first = await importStatementItems(db, 'acc_principal', parsed.items);
    expect(first.importedCount).toBe(2);
    expect(first.duplicateCount).toBe(1);

    // Re-importing the exact same file must insert 0 new entries
    const second = await importStatementItems(db, 'acc_principal', parsed.items);
    expect(second.importedCount).toBe(0);
    expect(second.duplicateCount).toBe(3);

    const txs = await listTransactions(db, { month: '2026-11' });
    expect(txs).toHaveLength(2);
    await db.close();
  });

  it('gera lançamentos de recurring_rules de forma idempotente e ajusta dia 31 em fevereiro', async () => {
    const db = await createInMemoryTestDatabase();
    await createRecurringRule(db, {
      account_id: 'acc_principal',
      category_id: 'cat_moradia',
      type: 'expense',
      description: 'Internet Fibra',
      amount: 99.9,
      day_of_month: 31,
    });

    const firstFeb = await generateMonthlyRecurringTransactions(db, '2026-02');
    expect(firstFeb).toEqual({ created: 1, skipped: 0 });

    const secondFeb = await generateMonthlyRecurringTransactions(db, '2026-02');
    expect(secondFeb).toEqual({ created: 0, skipped: 1 });

    const txs = await listTransactions(db, { month: '2026-02' });
    expect(txs).toHaveLength(1);
    expect(txs[0].date).toBe('2026-02-28');
    expect(txs[0].status).toBe('planned');
    await db.close();
  });

  it('calcula orçamento por categoria (orçado vs realizado) e comparativo multi-mês', async () => {
    const db = await createInMemoryTestDatabase();
    await upsertCategoryBudget(db, '2026-11', 'cat_alimentacao', 800);
    await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: 'cat_alimentacao',
      type: 'expense',
      description: 'Supermercado',
      amount: 640,
      date: '2026-11-12',
      status: 'realized',
    });
    await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: 'cat_salario',
      type: 'income',
      source_type: 'salario',
      description: 'Salário Outubro',
      amount: 2745,
      date: '2026-10-05',
      status: 'realized',
    });

    const budgets = await listBudgetsForMonth(db, '2026-11');
    expect(budgets).toHaveLength(1);
    expect(budgets[0].spent_amount).toBe(640);
    expect(budgets[0].remaining_amount).toBe(160);
    expect(budgets[0].usage_pct).toBe(80);

    const comp = await getMultiMonthComparison(db, '2026-11', 3);
    expect(comp.map((c) => c.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(comp[1].income).toBe(2745);
    expect(comp[2].expense).toBe(640);

    // Backup v3 round-trip preserves budgets and recurring rules
    const backup = await exportBackupJson(db);
    expect(backup.schemaVersion).toBe(3);
    expect(backup.tableCounts.budgets).toBe(1);
    await clearAllUserData(db);
    await restoreBackupJson(db, JSON.parse(JSON.stringify(backup)));
    expect(await listBudgetsForMonth(db, '2026-11')).toHaveLength(1);

    await db.close();
  });

  it('gera lembretes locais discretos SEM expor valores financeiros sensíveis (R$)', () => {
    const reminders = buildDiscreteReminders({
      todayISO: '2026-11-24',
      upcomingBills: [
        {
          id: 'tx_bill',
          account_id: 'acc_principal',
          destination_account_id: null,
          category_id: 'cat_moradia',
          type: 'expense',
          source_type: 'outros',
          description: 'Aluguel',
          amount: 1450.75,
          date: '2026-11-25',
          due_date: '2026-11-25',
          status: 'planned',
          installment_group_id: null,
          installment_number: null,
          installment_total: null,
          external_hash: null,
          notes: '',
          created_at: '',
          updated_at: '',
        },
      ],
      todayEvents: [],
      pendingTasks: [],
    });

    expect(reminders).toHaveLength(1);
    expect(reminders[0].discreteMessage).toContain('Aluguel');
    expect(reminders[0].discreteMessage).not.toContain('1450');
    expect(reminders[0].discreteMessage).not.toContain('1.450');
    expect(reminders[0].discreteMessage).not.toContain('R$');
  });
});
