import React, { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Eye,
  EyeOff,
  Home,
  KeyRound,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { createTransaction, type AccountWithBalance } from '../repositories/financeRepo';
import {
  buildFamilyInviteUrl,
  buildLocalMemberSnapshot,
  generateFamilyPassphrase,
  isFamilySyncReady,
  loadCachedFamilyHub,
  loadFamilyFinanceConfig,
  saveFamilyFinanceConfig,
  syncFamilyFinanceHub,
  type FamilyFinanceConfig,
  type FamilyHubDocument,
  type FamilyMemberSnapshot,
} from '../services/familyFinanceSync';
import type { Category } from '../types/domain';
import { formatBRL, formatDateBR, todayISO } from '../utils/format';
import { buildQrSvgPath } from './PairingQrCode';

interface FamilyFinanceTabPanelProps {
  accounts: AccountWithBalance[];
  categories: Category[];
  month: string;
}

export const FamilyFinanceTabPanel: React.FC<FamilyFinanceTabPanelProps> = ({
  accounts,
  categories,
  month,
}) => {
  const { db, settings, dataVersion, bumpDataVersion, notify } = useApp();
  const [config, setConfig] = useState<FamilyFinanceConfig>(() =>
    loadFamilyFinanceConfig(settings?.user_name || 'Eu'),
  );
  const [memberName, setMemberName] = useState(config.memberName);
  const [familyKey, setFamilyKey] = useState(config.familyKey);
  const [shareBalance, setShareBalance] = useState(config.shareBalance);
  const [autoIncludeHousehold, setAutoIncludeHousehold] = useState(config.autoIncludeHousehold);
  const [autoSync, setAutoSync] = useState(config.autoSync);
  const [showKey, setShowKey] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [busy, setBusy] = useState(false);

  const [hub, setHub] = useState<FamilyHubDocument | null>(() => loadCachedFamilyHub());
  const [localSnapshot, setLocalSnapshot] = useState<FamilyMemberSnapshot | null>(null);

  // Quick Household Expense Form
  const [houseDesc, setHouseDesc] = useState('');
  const [houseAmount, setHouseAmount] = useState('');
  const houseDate = todayISO();
  const [houseStatus, setHouseStatus] = useState<'realized' | 'planned'>('realized');
  const [houseCat, setHouseCat] = useState('cat_moradia');

  useEffect(() => {
    if (!db) return;
    buildLocalMemberSnapshot(
      db,
      {
        memberId: config.memberId,
        memberName: memberName || settings?.user_name || 'Eu',
        shareBalance,
        autoIncludeHousehold,
      },
      month,
    )
      .then(setLocalSnapshot)
      .catch(() => {});
  }, [db, dataVersion, month, config.memberId, memberName, shareBalance, autoIncludeHousehold, settings?.user_name]);

  const persistConfig = (overrides?: Partial<FamilyFinanceConfig>): FamilyFinanceConfig => {
    const next: FamilyFinanceConfig = {
      ...config,
      enabled: Boolean(familyKey.trim().length >= 8),
      autoSync,
      familyKey: familyKey.trim(),
      memberName: memberName.trim() || settings?.user_name || 'Eu',
      shareBalance,
      autoIncludeHousehold,
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
    saveFamilyFinanceConfig(next);
    setConfig(next);
    return next;
  };

  const handleGenerateFamilyKey = () => {
    const generated = generateFamilyPassphrase();
    setFamilyKey(generated);
    setShowKey(true);
    setShowQr(true);
    persistConfig({ familyKey: generated, enabled: true });
    notify('Chave da Família gerada! Envie para a outra pessoa e clique em Sincronizar.');
  };

  const handleSyncFamily = async () => {
    if (!db) return;
    const active = persistConfig();
    if (!isFamilySyncReady(active)) {
      notify('Gere ou cole uma Chave da Família (8+ caracteres) e informe seu nome.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await syncFamilyFinanceHub(db, active, fetch, month);
      setHub(res.hub);
      persistConfig({
        enabled: true,
        lastSyncedAt: res.syncedAt,
        lastRevision: res.revision,
      });
      bumpDataVersion({ skipAutoSync: true });
      const count = Object.keys(res.hub.members).length;
      notify(`Financeiro da Família sincronizado (rev. ${res.revision} · ${count} pessoa(s))!`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao sincronizar família.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyInvite = async () => {
    try {
      const active = persistConfig();
      const url = buildFamilyInviteUrl(active.endpointUrl, active.familyKey);
      await navigator.clipboard.writeText(url);
      notify('Link de convite da Família copiado! Envie para a outra pessoa abrir no LifeHub.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Gere a Chave da Família primeiro.', 'error');
    }
  };

  const handleAddHouseholdExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    const val = Number(houseAmount.replace(',', '.'));
    if (!(val > 0)) return;
    try {
      const validCat = categories.some((c) => c.id === houseCat) ? houseCat : null;
      await createTransaction(db, {
        account_id: accounts[0]?.id ?? 'acc_principal',
        category_id: validCat,
        type: 'expense',
        source_type: 'outros',
        description: houseDesc.trim(),
        amount: val,
        date: houseDate,
        status: houseStatus,
        notes: '[Família] Despesa da casa',
      });
      setHouseDesc('');
      setHouseAmount('');
      bumpDataVersion();
      notify('Despesa da casa lançada no seu Financeiro e incluída na Família!');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao lançar despesa da casa.', 'error');
    }
  };

  // Merge live local snapshot + cached remote members for instant UI
  const membersList = useMemo(() => {
    const map: Record<string, FamilyMemberSnapshot> = { ...(hub?.members ?? {}) };
    if (localSnapshot) {
      map[localSnapshot.memberId] = localSnapshot;
    }
    return Object.values(map).sort((a, b) =>
      a.memberId === config.memberId ? -1 : b.memberId === config.memberId ? 1 : a.memberName.localeCompare(b.memberName),
    );
  }, [hub, localSnapshot, config.memberId]);

  const combinedBalance = useMemo(
    () => membersList.reduce((acc, m) => acc + (m.totalBalance ?? 0), 0),
    [membersList],
  );

  const allSharedExpenses = useMemo(() => {
    return membersList
      .flatMap((m) => m.sharedExpenses)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [membersList]);

  const allSharedBills = useMemo(() => {
    return membersList
      .flatMap((m) => m.sharedBills)
      .sort((a, b) => a.dayOfMonth - b.dayOfMonth);
  }, [membersList]);

  const totalHouseholdMonth = useMemo(
    () => allSharedExpenses.reduce((acc, e) => acc + e.amount, 0),
    [allSharedExpenses],
  );

  const totalHouseholdBills = useMemo(
    () => allSharedBills.filter((b) => b.type === 'expense').reduce((acc, b) => acc + b.amount, 0),
    [allSharedBills],
  );

  const qrSvg = useMemo(() => {
    if (!showQr || familyKey.trim().length < 8) return null;
    try {
      const url = buildFamilyInviteUrl(config.endpointUrl, familyKey);
      return buildQrSvgPath(url, 3);
    } catch {
      return null;
    }
  }, [showQr, config.endpointUrl, familyKey]);

  const expenseCategories = categories.filter((c) => c.kind === 'expense');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Consolidated Family KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lh-card">
          <p className="text-xs text-slate-500 dark:text-slate-400">Saldo Combinado da Família</p>
          <p className="mt-1 text-2xl font-bold text-emerald-500">{formatBRL(combinedBalance)}</p>
          <p className="mt-1 text-xs text-slate-500">{membersList.length} pessoa(s) no painel</p>
        </div>

        <div className="lh-card">
          <p className="text-xs text-slate-500 dark:text-slate-400">Despesas da Casa ({month})</p>
          <p className="mt-1 text-2xl font-bold text-rose-500">{formatBRL(totalHouseholdMonth)}</p>
          <p className="mt-1 text-xs text-slate-500">{allSharedExpenses.length} lançamento(s) compartilhados</p>
        </div>

        <div className="lh-card">
          <p className="text-xs text-slate-500 dark:text-slate-400">Contas Fixas da Casa / Mês</p>
          <p className="mt-1 text-2xl font-bold text-amber-500">{formatBRL(totalHouseholdBills)}</p>
          <p className="mt-1 text-xs text-slate-500">{allSharedBills.length} conta(s) recorrente(s)</p>
        </div>

        <div className="lh-card">
          <p className="text-xs text-slate-500 dark:text-slate-400">Status da Conexão E2EE</p>
          <p className="mt-1 text-lg font-bold">
            {config.lastRevision > 0 ? `Conectado (Rev. ${config.lastRevision})` : 'Local (aguardando sync)'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {config.lastSyncedAt
              ? `Atualizado ${new Date(config.lastSyncedAt).toLocaleTimeString('pt-BR')}`
              : 'Gere ou cole a Chave da Família abaixo'}
          </p>
        </div>
      </div>

      {/* Side-by-side Members Overview */}
      <div className="grid gap-4 sm:grid-cols-2">
        {membersList.map((m) => {
          const isMe = m.memberId === config.memberId;
          return (
            <div key={m.memberId} className="lh-card space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-500/15 text-sm font-bold text-brand-500">
                    {m.memberName.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <h4 className="text-sm font-bold">
                      {m.memberName} {isMe && <span className="text-xs font-normal opacity-60">(Você)</span>}
                    </h4>
                    <p className="text-[11px] opacity-65">
                      Atualizado em {new Date(m.updatedAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                </div>
                <span className="text-lg font-bold tabular-nums text-emerald-500">
                  {m.totalBalance !== null ? formatBRL(m.totalBalance) : 'Saldo oculto'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t pt-2 text-xs" style={{ borderColor: 'var(--lh-card-border)' }}>
                <div>
                  <span className="opacity-65">Receita mês</span>
                  <p className="font-semibold text-emerald-500">
                    {m.shareBalance ? formatBRL(m.monthlyIncome) : '—'}
                  </p>
                </div>
                <div>
                  <span className="opacity-65">Despesa mês</span>
                  <p className="font-semibold text-rose-500">{formatBRL(m.monthlyExpense)}</p>
                </div>
                <div>
                  <span className="opacity-65">Casa ({m.sharedExpenses.length})</span>
                  <p className="font-semibold">
                    {formatBRL(m.sharedExpenses.reduce((acc, e) => acc + e.amount, 0))}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Add Household Expense */}
      <form onSubmit={handleAddHouseholdExpense} className="lh-card space-y-3">
        <div className="flex items-center gap-2">
          <Home className="h-4 w-4 text-brand-500" />
          <h3 className="font-semibold">Lançar Despesa da Casa / Família</h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Entra no seu Financeiro pessoal e aparece automaticamente no consolidado da Família (além de qualquer lançamento em Moradia, Família ou Alimentação).
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input
            required
            value={houseDesc}
            onChange={(e) => setHouseDesc(e.target.value)}
            placeholder="Ex.: Conta de luz, Mercado, Aluguel..."
            className="lh-input sm:col-span-2"
          />
          <input
            required
            type="number"
            step="0.01"
            min="0.01"
            value={houseAmount}
            onChange={(e) => setHouseAmount(e.target.value)}
            placeholder="Valor (R$)"
            className="lh-input"
          />
          <select
            value={houseCat}
            onChange={(e) => setHouseCat(e.target.value)}
            className="lh-input"
          >
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <select
              value={houseStatus}
              onChange={(e) => setHouseStatus(e.target.value as 'realized' | 'planned')}
              className="lh-input flex-1"
            >
              <option value="realized">Pago</option>
              <option value="planned">Previsto</option>
            </select>
            <button type="submit" className="lh-btn-primary shrink-0 px-3">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </form>

      {/* Shared Household Expenses + Shared Fixed Bills */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="lh-card space-y-3">
          <h3 className="font-semibold">Despesas da Casa no Mês ({allSharedExpenses.length})</h3>
          {allSharedExpenses.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">
              Nenhuma despesa da casa registrada neste mês ainda.
            </p>
          ) : (
            <ul className="space-y-2">
              {allSharedExpenses.map((item) => (
                <li
                  key={`${item.memberId}_${item.id}`}
                  className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs"
                  style={{ borderColor: 'var(--lh-card-border)' }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{item.description}</span>
                      <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-bold text-brand-500">
                        {item.memberName}
                      </span>
                    </div>
                    <p className="text-[11px] opacity-65">
                      {formatDateBR(item.date)} · {item.categoryName} ·{' '}
                      {item.status === 'planned' ? 'Previsto' : 'Pago'}
                    </p>
                  </div>
                  <span className="shrink-0 font-bold tabular-nums text-rose-500">
                    -{formatBRL(item.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="lh-card space-y-3">
          <h3 className="font-semibold">Contas Fixas da Casa ({allSharedBills.length})</h3>
          {allSharedBills.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-500">
              Nenhuma conta fixa da casa cadastrada ainda.
            </p>
          ) : (
            <ul className="space-y-2">
              {allSharedBills.map((bill) => (
                <li
                  key={`${bill.memberId}_${bill.id}`}
                  className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs"
                  style={{ borderColor: 'var(--lh-card-border)' }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{bill.description}</span>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
                        {bill.memberName}
                      </span>
                    </div>
                    <p className="text-[11px] opacity-65">
                      Todo dia {String(bill.dayOfMonth).padStart(2, '0')} · {bill.categoryName}
                    </p>
                  </div>
                  <span className="shrink-0 font-bold tabular-nums text-rose-500">
                    -{formatBRL(bill.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Connect Another Person (Family E2EE Key + QR Code) */}
      <section className="lh-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-500/15 text-brand-500">
              <Users className="h-4 w-4" />
            </span>
            <div>
              <h3 className="font-semibold">Conectar Outra Pessoa (Cofre da Família E2EE)</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Usem a mesma <strong>Chave da Família</strong> nos dois apps (PC ou Celular) para ver saldo e despesas da casa em tempo real — criptografado com AES-256-GCM.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Seu nome na Família</label>
            <input
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              placeholder="Ex.: Wagner"
              className="lh-input"
            />
          </div>

          <div className="sm:col-span-2">
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium">Chave Secreta da Família (compartilhe só com seu par)</label>
              <button
                type="button"
                onClick={handleGenerateFamilyKey}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-500 hover:underline"
              >
                <KeyRound className="h-3 w-3" /> Gerar Nova Chave da Família
              </button>
            </div>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={familyKey}
                onChange={(e) => setFamilyKey(e.target.value)}
                placeholder="LH-FAM-XXXX-XXXX-XXXX (ou cole a chave recebida)"
                className="lh-input pr-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={shareBalance}
              onChange={(e) => {
                setShareBalance(e.target.checked);
                persistConfig({ shareBalance: e.target.checked });
              }}
              className="h-4 w-4 rounded"
            />
            Compartilhar meu saldo atual e receita do mês
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={autoIncludeHousehold}
              onChange={(e) => {
                setAutoIncludeHousehold(e.target.checked);
                persistConfig({ autoIncludeHousehold: e.target.checked });
              }}
              className="h-4 w-4 rounded"
            />
            Incluir automaticamente despesas de Moradia, Família e Mercado
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => {
                setAutoSync(e.target.checked);
                persistConfig({ autoSync: e.target.checked });
              }}
              className="h-4 w-4 rounded"
            />
            Sincronizar Família automaticamente a cada ação
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={handleSyncFamily}
            className="lh-btn-primary"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Sincronizando Família...' : 'Sincronizar Família Agora'}
          </button>

          <button
            type="button"
            disabled={familyKey.trim().length < 8}
            onClick={() => setShowQr((v) => !v)}
            className="lh-btn-secondary disabled:opacity-50"
          >
            <QrCode className="h-3.5 w-3.5" />
            {showQr ? 'Ocultar QR da Família' : 'QR Code de Convite'}
          </button>

          <button
            type="button"
            disabled={familyKey.trim().length < 8}
            onClick={handleCopyInvite}
            className="lh-btn-secondary disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" /> Copiar Link de Convite
          </button>
        </div>

        {qrSvg && (
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-brand-500/30 bg-brand-500/[0.04] p-4">
            <div className="rounded-xl border border-slate-200 bg-white p-2.5">
              <svg
                viewBox={`0 0 ${qrSvg.size} ${qrSvg.size}`}
                className="h-36 w-36"
                shapeRendering="crispEdges"
              >
                <rect width={qrSvg.size} height={qrSvg.size} fill="#ffffff" />
                <path d={qrSvg.path} fill="#0f172a" />
              </svg>
            </div>
            <div className="max-w-md space-y-1.5 text-xs">
              <p className="font-bold">Convide a outra pessoa pela Câmera</p>
              <p className="opacity-80">
                Ela pode ler este QR Code no celular (abre já conectada à Família!) ou colar a <strong>Chave da Família</strong> na aba <em>Financeiro → Família / Casal</em> no computador dela.
              </p>
              <p className="flex items-center gap-1 text-[11px] text-emerald-500">
                <ShieldCheck className="h-3.5 w-3.5" /> A chave pessoal do seu cofre continua separada e privada.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
