import { describe, expect, it } from 'vitest';
import { handleSyncRequest, type VaultStoreLike } from '../../cloudflare-sync/src/handler';
import {
  detectInstallmentKind,
  groupInstallmentTransactions,
} from '../components/InstallmentsTabPanel';
import { createInMemoryTestDatabase } from '../db/client';
import {
  createRecurringRule,
  createTransaction,
  deleteInstallmentGroup,
  generateMonthlyRecurringTransactions,
  listRecurringRules,
  listTransactions,
  markNextInstallmentPaid,
  toggleTransactionStatus,
  updateRecurringRule,
} from '../repositories/financeRepo';
import {
  buildFamilyInviteUrl,
  generateFamilyPassphrase,
  parseFamilyInviteHash,
  syncFamilyFinanceHub,
  type FamilyFinanceConfig,
} from '../services/familyFinanceSync';

function createMockStore(): VaultStoreLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function createWorkerFetch(store: VaultStoreLike): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    return handleSyncRequest(req, { store });
  }) as typeof fetch;
}

describe('Aba Cartão & Parcelados + Financeiro da Família E2EE', () => {
  it('agrupa parcelados (cartão, moto, seguro), paga próxima parcela e remove grupo inteiro', async () => {
    const db = await createInMemoryTestDatabase();

    await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: null,
      type: 'expense',
      source_type: 'outros',
      description: 'Roupa Renner',
      amount: 300,
      date: '2026-11-25',
      status: 'planned',
      installments: 3,
      notes: '[Cartão: Nubank]',
    });

    await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: null,
      type: 'expense',
      source_type: 'outros',
      description: 'Parcela Moto',
      amount: 4800,
      date: '2026-11-25',
      status: 'realized',
      installments: 10,
      notes: '[Moto]',
    });

    await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: null,
      type: 'expense',
      source_type: 'outros',
      description: 'Seguro Moto Suhai',
      amount: 1200,
      date: '2026-11-25',
      status: 'planned',
      installments: 6,
      notes: '[Seguro] [Família]',
    });

    const all = await listTransactions(db);
    const groups = groupInstallmentTransactions(all);
    expect(groups).toHaveLength(3);

    const card = groups.find((g) => g.title === 'Roupa Renner')!;
    expect(card.kind).toBe('cartao');
    expect(card.issuer).toBe('Nubank');
    expect(card.totalCount).toBe(3);
    expect(card.paidCount).toBe(0);
    expect(card.remainingAmount).toBe(300);

    const moto = groups.find((g) => g.title === 'Parcela Moto')!;
    expect(moto.kind).toBe('moto');
    expect(moto.paidCount).toBe(1);
    expect(moto.remainingCount).toBe(9);

    const seguro = groups.find((g) => g.title === 'Seguro Moto Suhai')!;
    expect(detectInstallmentKind(seguro.items[0])).toEqual({
      kind: 'seguro',
      issuer: '',
      isFamily: true,
    });

    // Pay next installment of Roupa Renner (1/3)
    const paid = await markNextInstallmentPaid(db, card.groupId);
    expect(paid?.installment_number).toBe(1);
    expect(paid?.status).toBe('realized');

    // Delete entire Seguro group
    const removed = await deleteInstallmentGroup(db, seguro.groupId);
    expect(removed).toBe(6);

    const afterGroups = groupInstallmentTransactions(await listTransactions(db));
    expect(afterGroups).toHaveLength(2);
    expect(afterGroups.find((g) => g.title === 'Roupa Renner')?.paidCount).toBe(1);

    await db.close();
  });

  it('conecta 2 pessoas no Financeiro da Família E2EE compartilhando saldo e despesas da casa sem vazar texto claro', async () => {
    const kv = createMockStore();
    const workerFetch = createWorkerFetch(kv);
    const familyKey = generateFamilyPassphrase();
    const endpointUrl = 'https://lifehub-sync.demo.workers.dev';

    const inviteUrl = buildFamilyInviteUrl(endpointUrl, familyKey);
    expect(parseFamilyInviteHash(new URL(inviteUrl).hash)).toEqual({
      endpointUrl,
      familyKey,
    });

    const dbA = await createInMemoryTestDatabase();
    const dbB = await createInMemoryTestDatabase();

    // Person A: income + household expense + personal expense + household recurring bill
    await createTransaction(dbA, {
      account_id: 'acc_principal',
      category_id: 'cat_salario',
      type: 'income',
      source_type: 'salario',
      description: 'Salário Wagner',
      amount: 3000,
      date: '2026-11-05',
      status: 'realized',
    });
    await createTransaction(dbA, {
      account_id: 'acc_principal',
      category_id: 'cat_moradia',
      type: 'expense',
      source_type: 'outros',
      description: 'Aluguel da Casa',
      amount: 1200,
      date: '2026-11-10',
      status: 'realized',
    });
    await createTransaction(dbA, {
      account_id: 'acc_principal',
      category_id: 'cat_lazer',
      type: 'expense',
      source_type: 'outros',
      description: 'Jogo pessoal privado',
      amount: 150,
      date: '2026-11-12',
      status: 'realized',
    });
    await createRecurringRule(dbA, {
      account_id: 'acc_principal',
      category_id: 'cat_moradia',
      type: 'expense',
      description: 'Internet da Casa',
      amount: 120,
      day_of_month: 10,
    });

    // Person B: income + household expense
    await createTransaction(dbB, {
      account_id: 'acc_principal',
      category_id: 'cat_salario',
      type: 'income',
      source_type: 'salario',
      description: 'Salário Parceira',
      amount: 2500,
      date: '2026-11-05',
      status: 'realized',
    });
    await createTransaction(dbB, {
      account_id: 'acc_principal',
      category_id: 'cat_alimentacao',
      type: 'expense',
      source_type: 'outros',
      description: 'Supermercado do Mês',
      amount: 780,
      date: '2026-11-15',
      status: 'realized',
      notes: '[Família]',
    });

    const cfgA: FamilyFinanceConfig = {
      enabled: true,
      autoSync: true,
      endpointUrl,
      familyKey,
      memberId: 'mbr_wagner',
      memberName: 'Wagner',
      shareBalance: true,
      autoIncludeHousehold: true,
      lastSyncedAt: null,
      lastRevision: 0,
    };

    const cfgB: FamilyFinanceConfig = {
      ...cfgA,
      memberId: 'mbr_parceira',
      memberName: 'Ana',
    };

    // Person A syncs first, then Person B syncs
    const syncA = await syncFamilyFinanceHub(dbA, cfgA, workerFetch, '2026-11');
    expect(syncA.revision).toBe(1);

    // Ensure Cloudflare vault never stores plaintext
    const storedRaw = Array.from(kv.store.values()).join('');
    expect(storedRaw).not.toContain('Aluguel da Casa');
    expect(storedRaw).not.toContain('Wagner');

    const syncB = await syncFamilyFinanceHub(dbB, cfgB, workerFetch, '2026-11');
    expect(syncB.revision).toBe(2);
    expect(Object.keys(syncB.hub.members)).toHaveLength(2);

    const wagner = syncB.hub.members['mbr_wagner'];
    const ana = syncB.hub.members['mbr_parceira'];
    expect(wagner.totalBalance).toBe(1650); // 3000 - 1200 - 150
    expect(ana.totalBalance).toBe(1720); // 2500 - 780

    // Household expenses include Aluguel & Supermercado, NOT personal game!
    const allHousehold = [...wagner.sharedExpenses, ...ana.sharedExpenses];
    expect(allHousehold.map((e) => e.description)).toContain('Aluguel da Casa');
    expect(allHousehold.map((e) => e.description)).toContain('Supermercado do Mês');
    expect(allHousehold.map((e) => e.description)).not.toContain('Jogo pessoal privado');
    expect(wagner.sharedBills.map((b) => b.description)).toContain('Internet da Casa');

    await dbA.close();
    await dbB.close();
  });

  it('permite compras 1x no Cartão (próximo mês) sem misturar lançamentos avulsos comuns', async () => {
    const db = await createInMemoryTestDatabase();

    // Lançamento comum 1x (PIX) NÃO deve entrar na aba Cartão & Parcelados
    await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: 'cat_alimentacao',
      type: 'expense',
      source_type: 'outros',
      description: 'Almoço PIX',
      amount: 32,
      date: '2026-11-25',
      status: 'realized',
      installments: 1,
    });

    // Conta no cartão em 1x para pagar no próximo mês DEVE entrar na aba Cartão & Parcelados
    await createTransaction(db, {
      account_id: 'acc_principal',
      category_id: null,
      type: 'expense',
      source_type: 'outros',
      description: 'Farmácia Cartão',
      amount: 145.5,
      date: '2026-12-10',
      due_date: '2026-12-10',
      status: 'planned',
      installments: 1,
      force_installment_group: true,
      notes: '[Cartão: Nubank]',
    });

    const groups = groupInstallmentTransactions(await listTransactions(db));
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('Farmácia Cartão');
    expect(groups[0].totalCount).toBe(1);
    expect(groups[0].remainingCount).toBe(1);
    expect(groups[0].remainingAmount).toBe(145.5);
    expect(groups[0].nextDueDate).toBe('2026-12-10');

    // Quitar lançamento 1x
    const paid = await markNextInstallmentPaid(db, groups[0].groupId);
    expect(paid?.status).toBe('realized');
    expect(paid?.installment_number).toBe(1);
    expect(paid?.installment_total).toBe(1);

    const afterPay = groupInstallmentTransactions(await listTransactions(db));
    expect(afterPay[0].paidCount).toBe(1);
    expect(afterPay[0].remainingCount).toBe(0);

    // Excluir lançamento 1x
    const removed = await deleteInstallmentGroup(db, groups[0].groupId);
    expect(removed).toBe(1);
    expect(groupInstallmentTransactions(await listTransactions(db))).toHaveLength(0);

    await db.close();
  });

  it('edita recorrência mensal e sincroniza apenas lançamentos previstos sem alterar meses já pagos', async () => {
    const db = await createInMemoryTestDatabase();

    const rule = await createRecurringRule(db, {
      account_id: 'acc_principal',
      category_id: 'cat_moradia',
      type: 'expense',
      description: 'Internet Fibra',
      amount: 100,
      day_of_month: 10,
    });

    // Gera novembro e dezembro como previstos, e marca novembro como pago (realized)
    await generateMonthlyRecurringTransactions(db, '2026-11');
    await generateMonthlyRecurringTransactions(db, '2026-12');
    const novTxs = await listTransactions(db, { month: '2026-11' });
    await toggleTransactionStatus(db, novTxs[0].id);

    // Edita a regra para R$ 125 no dia 15 com sincronização dos previstos
    const res = await updateRecurringRule(db, rule.id, {
      account_id: 'acc_principal',
      category_id: 'cat_moradia',
      type: 'expense',
      description: 'Internet Fibra 500MB',
      amount: 125,
      day_of_month: 15,
      notes: 'Novo plano',
      syncPlannedTransactions: true,
    });

    expect(res.rule.description).toBe('Internet Fibra 500MB');
    expect(res.rule.amount).toBe(125);
    expect(res.rule.day_of_month).toBe(15);
    expect(res.updatedPlannedCount).toBe(1);

    const rules = await listRecurringRules(db);
    expect(rules[0].description).toBe('Internet Fibra 500MB');

    // Novembro já estava pago -> permanece intacto
    const novAfter = await listTransactions(db, { month: '2026-11' });
    expect(novAfter[0].status).toBe('realized');
    expect(novAfter[0].amount).toBe(100);
    expect(novAfter[0].date).toBe('2026-11-10');

    // Dezembro ainda previsto -> foi atualizado automaticamente
    const decAfter = await listTransactions(db, { month: '2026-12' });
    expect(decAfter[0].status).toBe('planned');
    expect(decAfter[0].description).toBe('Internet Fibra 500MB');
    expect(decAfter[0].amount).toBe(125);
    expect(decAfter[0].date).toBe('2026-12-15');

    await db.close();
  });
});
