import { calculateWorkSessionMetrics } from './calculations';
import {
  PLATFORM_LABELS,
  type Account,
  type Category,
  type Transaction,
  type WorkSession,
} from '../types/domain';
import { formatDateBR } from '../utils/format';

function csvEscape(value: string | number | null | undefined): string {
  const str = value == null ? '' : String(value);
  if (/[;"\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDecimalBR(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

/**
 * Generates an Excel/LibreOffice-friendly Brazilian CSV (UTF-8 BOM + `;` delimiter).
 */
export function buildTransactionsCsv(
  transactions: Transaction[],
  accounts: Account[],
  categories: Category[],
): string {
  const accMap = new Map(accounts.map((a) => [a.id, a.name]));
  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  const header = [
    'Data',
    'Tipo',
    'Origem',
    'Status',
    'Conta',
    'Categoria',
    'Descrição',
    'Valor (BRL)',
    'Parcela',
    'Observações',
  ];

  const rows = transactions.map((tx) => {
    const signed = tx.type === 'expense' ? -tx.amount : tx.amount;
    const parcela =
      tx.installment_number && tx.installment_total
        ? `${tx.installment_number}/${tx.installment_total}`
        : '';
    return [
      formatDateBR(tx.date),
      tx.type === 'income' ? 'Receita' : tx.type === 'expense' ? 'Despesa' : 'Transferência',
      tx.source_type,
      tx.status === 'realized' ? 'Realizado' : 'Previsto',
      accMap.get(tx.account_id) ?? tx.account_id,
      tx.category_id ? (catMap.get(tx.category_id) ?? '') : 'Transferência',
      tx.description,
      formatDecimalBR(signed),
      parcela,
      tx.notes,
    ]
      .map(csvEscape)
      .join(';');
  });

  return `\uFEFF${header.join(';')}\n${rows.join('\n')}`;
}

export function buildWorkSessionsCsv(sessions: WorkSession[]): string {
  const header = [
    'Data',
    'Plataforma',
    'Início',
    'Fim',
    'Horas',
    'Km',
    'Bruto (BRL)',
    'Combustível (BRL)',
    'Litros',
    'Pedágio/Estac. (BRL)',
    'Manutenção Est. (BRL)',
    'Depreciação Est. (BRL)',
    'Líquido Operacional (BRL)',
    'Líquido/h (BRL)',
    'Líquido/km (BRL)',
    'Observações',
  ];

  const rows = sessions.map((s) => {
    const m = calculateWorkSessionMetrics(s);
    return [
      formatDateBR(s.date),
      PLATFORM_LABELS[s.platform],
      s.start_time,
      s.end_time,
      formatDecimalBR(m.durationHours),
      formatDecimalBR(m.km),
      formatDecimalBR(m.gross),
      formatDecimalBR(m.fuelCost),
      formatDecimalBR(s.fuel_liters),
      formatDecimalBR(m.tollsParking),
      formatDecimalBR(m.estimatedMaintenance),
      formatDecimalBR(m.estimatedDepreciation),
      formatDecimalBR(m.operationalNet),
      formatDecimalBR(m.operationalNetPerHour),
      formatDecimalBR(m.operationalNetPerKm),
      s.notes,
    ]
      .map(csvEscape)
      .join(';');
  });

  return `\uFEFF${header.join(';')}\n${rows.join('\n')}`;
}

export function downloadTextFile(content: string, fileName: string, mimeType = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
