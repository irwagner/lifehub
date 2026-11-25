import type { SqlExecutor } from '../db/types';
import { loadDashboardSnapshot } from '../repositories/dashboardRepo';
import {
  listAccounts,
  listCategories,
  listGoals,
  listRecurringRules,
  listTransactions,
} from '../repositories/financeRepo';
import { listWorkSessions } from '../repositories/workRepo';
import { calculateWorkSessionMetrics } from './calculations';
import { PLATFORM_LABELS } from '../types/domain';
import { todayISO } from '../utils/format';

export interface GoogleSheetsConfig {
  enabled: boolean;
  autoSync: boolean;
  webhookUrl: string;
  secretToken: string;
  lastSyncedAt: string | null;
  lastRowCount: number;
  updatedAt?: string;
}

export interface GoogleSheetsPayload {
  action: 'sync';
  secret: string;
  exportedAt: string;
  summary: Array<[string, string | number]>;
  transactions: Array<Array<string | number>>;
  recurringRules: Array<Array<string | number>>;
  workSessions: Array<Array<string | number>>;
  goals: Array<Array<string | number>>;
}

export interface GoogleSheetsSyncResult {
  ok: true;
  syncedAt: string;
  transactionsCount: number;
  recurringCount: number;
  workSessionsCount: number;
  goalsCount: number;
  sheetUrl?: string;
}

const SHEETS_CONFIG_STORAGE_KEY = 'lifehub_google_sheets_config_v1';

export function generateSheetsSecretToken(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = 'LHGS_';
  for (let i = 0; i < bytes.length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function normalizeGoogleSheetsWebhookUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Cole a URL do App da Web do Google Apps Script (https://script.google.com/macros/s/.../exec).');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('URL do Google Sheets inválida.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('A URL do Google Apps Script deve usar HTTPS.');
  }
  if (parsed.hostname !== 'script.google.com' && !parsed.hostname.endsWith('.googleusercontent.com')) {
    throw new Error(
      'Por segurança, informe uma URL oficial do Google Apps Script (https://script.google.com/macros/s/.../exec).',
    );
  }
  return parsed.toString();
}

export function isGoogleSheetsReady(cfg: GoogleSheetsConfig): boolean {
  return Boolean(cfg.webhookUrl.trim() && cfg.secretToken.trim().length >= 8);
}

export function loadGoogleSheetsConfig(): GoogleSheetsConfig {
  try {
    const raw = localStorage.getItem(SHEETS_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GoogleSheetsConfig>;
      return {
        enabled: Boolean(parsed.enabled),
        autoSync: parsed.autoSync !== false,
        webhookUrl: typeof parsed.webhookUrl === 'string' ? parsed.webhookUrl : '',
        secretToken:
          typeof parsed.secretToken === 'string' && parsed.secretToken.trim().length >= 8
            ? parsed.secretToken.trim()
            : generateSheetsSecretToken(),
        lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : null,
        lastRowCount: typeof parsed.lastRowCount === 'number' ? parsed.lastRowCount : 0,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
      };
    }
  } catch {
    // ignore corrupted storage
  }
  const initial: GoogleSheetsConfig = {
    enabled: false,
    autoSync: true,
    webhookUrl: '',
    secretToken: generateSheetsSecretToken(),
    lastSyncedAt: null,
    lastRowCount: 0,
  };
  saveGoogleSheetsConfig(initial);
  return initial;
}

export function saveGoogleSheetsConfig(cfg: GoogleSheetsConfig): void {
  try {
    localStorage.setItem(
      SHEETS_CONFIG_STORAGE_KEY,
      JSON.stringify({
        ...cfg,
        updatedAt: cfg.updatedAt ?? new Date().toISOString(),
      }),
    );
  } catch {
    // ignore storage errors
  }
}

export async function buildGoogleSheetsPayload(
  db: SqlExecutor,
  secretToken: string,
): Promise<GoogleSheetsPayload> {
  const today = todayISO();
  const [snap, accounts, categories, transactions, recurringRules, workSessions, goals] =
    await Promise.all([
      loadDashboardSnapshot(db, today),
      listAccounts(db),
      listCategories(db),
      listTransactions(db),
      listRecurringRules(db),
      listWorkSessions(db),
      listGoals(db),
    ]);

  const accMap = new Map(accounts.map((a) => [a.id, a.name]));
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const exportedAt = new Date().toISOString();

  const summary: Array<[string, string | number]> = [
    ['Última sincronização', new Date(exportedAt).toLocaleString('pt-BR')],
    ['Saldo Atual Total (R$)', snap.totalBalance],
    ['Receitas Realizadas no Mês (R$)', snap.monthlyFinance.realizedIncome],
    ['Despesas Realizadas no Mês (R$)', snap.monthlyFinance.realizedExpense],
    ['Saldo Líquido do Mês (R$)', snap.monthlyFinance.realizedNet],
    ['Receitas Previstas no Mês (R$)', snap.monthlyFinance.plannedIncome],
    ['Despesas Previstas no Mês (R$)', snap.monthlyFinance.plannedExpense],
    ['Meta Mensal Líquida (R$)', snap.settings.monthly_net_goal],
    ['Uber/99 Bruto Semana (R$)', snap.workWeek.totalGross],
    ['Uber/99 Líquido Operacional Semana (R$)', snap.workWeek.totalOperationalNet],
    ['Total de Lançamentos', transactions.length],
    ['Total de Contas Fixas Mensais', recurringRules.length],
  ];

  const txRows = transactions.map((tx) => [
    tx.date,
    tx.description,
    tx.type === 'income' ? 'Receita' : tx.type === 'expense' ? 'Despesa' : 'Transferência',
    tx.type === 'expense' ? -Math.abs(tx.amount) : tx.amount,
    tx.status === 'planned' ? 'Previsto' : 'Realizado',
    tx.category_id ? (catMap.get(tx.category_id) ?? tx.category_id) : 'Sem categoria',
    accMap.get(tx.account_id) ?? tx.account_id,
    tx.source_type,
    tx.due_date ?? '',
    tx.notes ?? '',
    tx.id,
  ]);

  const recurringRows = recurringRules.map((r) => [
    r.day_of_month,
    r.description,
    r.type === 'income' ? 'Receita Fixa' : 'Despesa Fixa',
    r.type === 'expense' ? -Math.abs(r.amount) : r.amount,
    r.category_id ? (catMap.get(r.category_id) ?? r.category_id) : 'Sem categoria',
    accMap.get(r.account_id) ?? r.account_id,
    r.active ? 'Ativa' : 'Pausada',
    r.notes ?? '',
    r.id,
  ]);

  const workRows = workSessions.map((ws) => {
    const m = calculateWorkSessionMetrics(ws);
    return [
      ws.date,
      PLATFORM_LABELS[ws.platform] ?? ws.platform,
      ws.start_time,
      ws.end_time,
      ws.km_total,
      ws.gross_amount,
      ws.fuel_cost,
      ws.tolls_parking,
      m.estimatedMaintenance,
      m.operationalNet,
      m.operationalNetPerHour,
      ws.notes ?? '',
      ws.id,
    ];
  });

  const goalRows = goals.map((g) => {
    const pct = g.target_amount > 0 ? Math.round((g.current_amount / g.target_amount) * 100) : 0;
    return [g.name, g.current_amount, g.target_amount, `${pct}%`, g.target_date ?? '', g.notes ?? '', g.id];
  });

  return {
    action: 'sync',
    secret: secretToken.trim(),
    exportedAt,
    summary,
    transactions: txRows,
    recurringRules: recurringRows,
    workSessions: workRows,
    goals: goalRows,
  };
}

/**
 * Generates a ready-to-paste Google Apps Script bound to the user's Google Sheet.
 * Receives CORS-safe text/plain JSON POSTs and formats 5 tabs automatically.
 */
export function generateGoogleAppsScriptCode(secretToken: string): string {
  const safeToken = secretToken.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `// =========================================================================
// LifeHub -> Google Sheets (Backup Financeiro Automático)
// Cole este script em: Planilha Google -> Extensões -> Apps Script
// Depois clique em: Implantar -> Nova implantação -> App da Web
//   - Executar como: Eu
//   - Quem pode acessar: Qualquer pessoa (protegido pelo TOKEN abaixo)
// =========================================================================

const LIFEHUB_SECRET = '${safeToken}';

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.secret !== LIFEHUB_SECRET) {
      return jsonResponse({ ok: false, error: 'Token secreto inválido.' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (body.action === 'ping') {
      return jsonResponse({
        ok: true,
        message: 'Conexão confirmada com a planilha "' + ss.getName() + '".',
        sheetUrl: ss.getUrl()
      });
    }

    writeTable(
      ss,
      'Resumo',
      ['Indicador', 'Valor'],
      body.summary || [],
      [2]
    );

    writeTable(
      ss,
      'Lançamentos',
      ['Data', 'Descrição', 'Tipo', 'Valor (R$)', 'Status', 'Categoria', 'Conta', 'Origem', 'Vencimento', 'Observações', 'ID'],
      body.transactions || [],
      [4]
    );

    writeTable(
      ss,
      'Contas Fixas',
      ['Dia', 'Descrição', 'Tipo', 'Valor (R$)', 'Categoria', 'Conta', 'Status', 'Observações', 'ID'],
      body.recurringRules || [],
      [4]
    );

    writeTable(
      ss,
      'Uber e 99 Moto',
      ['Data', 'Plataforma', 'Início', 'Fim', 'KM', 'Bruto (R$)', 'Combustível', 'Pedágio', 'Manut. Est.', 'Líquido Oper.', 'Líq./Hora', 'Notas', 'ID'],
      body.workSessions || [],
      [6, 7, 8, 9, 10, 11]
    );

    writeTable(
      ss,
      'Metas',
      ['Meta', 'Atual (R$)', 'Alvo (R$)', 'Progresso', 'Data Alvo', 'Notas', 'ID'],
      body.goals || [],
      [2, 3]
    );

    return jsonResponse({
      ok: true,
      syncedAt: body.exportedAt || new Date().toISOString(),
      sheetUrl: ss.getUrl(),
      transactionsCount: (body.transactions || []).length,
      recurringCount: (body.recurringRules || []).length
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function writeTable(ss, sheetName, headers, rows, currencyCols) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  sheet.clearContents();
  const allRows = [headers].concat(rows);
  sheet.getRange(1, 1, allRows.length, headers.length).setValues(allRows);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  if (rows.length > 0 && currencyCols && currencyCols.length > 0) {
    currencyCols.forEach(function (colIdx) {
      if (colIdx <= headers.length) {
        sheet.getRange(2, colIdx, rows.length, 1).setNumberFormat('R$ #,##0.00');
      }
    });
  }
  sheet.autoResizeColumns(1, headers.length);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
}

async function postToAppsScript(
  webhookUrl: string,
  payload: unknown,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  const url = normalizeGoogleSheetsWebhookUrl(webhookUrl);
  // Use text/plain to avoid CORS preflight OPTIONS (Apps Script does not serve OPTIONS)
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Google Sheets respondeu com HTTP ${res.status}. Verifique se a implantação está ativa.`);
  }

  const text = await res.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      'Resposta inesperada do Google Apps Script. Confirme se escolheu "Quem pode acessar: Qualquer pessoa" ao implantar.',
    );
  }

  if (parsed.ok !== true) {
    throw new Error(
      typeof parsed.error === 'string' && parsed.error
        ? parsed.error
        : 'O Google Sheets recusou a sincronização.',
    );
  }

  return parsed;
}

export async function testGoogleSheetsConnection(
  config: Pick<GoogleSheetsConfig, 'webhookUrl' | 'secretToken'>,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; message: string; sheetUrl?: string }> {
  const cleanSecret = config.secretToken.trim();
  if (cleanSecret.length < 8) {
    throw new Error('Token secreto do Google Sheets inválido.');
  }
  const resp = await postToAppsScript(
    config.webhookUrl,
    { action: 'ping', secret: cleanSecret },
    fetchFn,
  );
  return {
    ok: true,
    message:
      typeof resp.message === 'string' && resp.message
        ? resp.message
        : 'Conexão confirmada com o Google Sheets!',
    sheetUrl: typeof resp.sheetUrl === 'string' ? resp.sheetUrl : undefined,
  };
}

export async function syncFinanceToGoogleSheets(
  db: SqlExecutor,
  config: Pick<GoogleSheetsConfig, 'webhookUrl' | 'secretToken'>,
  fetchFn: typeof fetch = fetch,
): Promise<GoogleSheetsSyncResult> {
  const cleanSecret = config.secretToken.trim();
  if (cleanSecret.length < 8) {
    throw new Error('Token secreto do Google Sheets inválido.');
  }
  const payload = await buildGoogleSheetsPayload(db, cleanSecret);
  const resp = await postToAppsScript(config.webhookUrl, payload, fetchFn);
  return {
    ok: true,
    syncedAt: typeof resp.syncedAt === 'string' ? resp.syncedAt : payload.exportedAt,
    transactionsCount: payload.transactions.length,
    recurringCount: payload.recurringRules.length,
    workSessionsCount: payload.workSessions.length,
    goalsCount: payload.goals.length,
    sheetUrl: typeof resp.sheetUrl === 'string' ? resp.sheetUrl : undefined,
  };
}
