import { round2 } from '../utils/format';

export interface ParsedStatementItem {
  date: string; // YYYY-MM-DD
  description: string;
  type: 'income' | 'expense';
  amount: number; // Always positive
  fitid?: string;
  external_hash: string;
}

export interface StatementParseResult {
  format: 'csv' | 'ofx';
  items: ParsedStatementItem[];
  skippedRows: number;
}

function normalizeDescription(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic 64-bit FNV-1a-like hex fingerprint (synchronous, offline, zero external deps).
 */
export function buildTransactionFingerprint(input: {
  accountId: string;
  date: string;
  type: 'income' | 'expense';
  amount: number;
  description: string;
  fitid?: string;
}): string {
  const canonical = input.fitid
    ? `ofx|${input.accountId}|${input.fitid.trim()}|${input.date}|${round2(input.amount).toFixed(2)}`
    : `stmt|${input.accountId}|${input.date}|${input.type}|${round2(input.amount).toFixed(2)}|${normalizeDescription(input.description)}`;

  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `imp_${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function parseBrazilianOrIsoDate(raw: string): string | null {
  const cleaned = raw.trim().replace(/^["']|["']$/g, '');
  // YYYY-MM-DD
  const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // DD/MM/YYYY or DD-MM-YYYY
  const br = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (br) {
    const d = br[1].padStart(2, '0');
    const m = br[2].padStart(2, '0');
    const y = br[3];
    return `${y}-${m}-${d}`;
  }

  // OFX YYYYMMDD...
  const ofx = cleaned.match(/^(\d{4})(\d{2})(\d{2})/);
  if (ofx) return `${ofx[1]}-${ofx[2]}-${ofx[3]}`;

  return null;
}

export function parseMoneyValue(raw: string): number | null {
  let cleaned = raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '');

  if (!cleaned) return null;

  // Detect Brazilian format "1.234,56" vs US format "1,234.56"
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > lastDot) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    cleaned = cleaned.replace(/,/g, '');
  }

  const num = Number(cleaned);
  return Number.isFinite(num) ? round2(num) : null;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cols.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

export function parseCsvStatement(
  content: string,
  accountId: string,
): StatementParseResult {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error('Arquivo CSV vazio ou sem linhas de dados.');
  }

  const headerLine = lines[0];
  const delimiter =
    (headerLine.match(/;/g)?.length ?? 0) >= (headerLine.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';

  const headers = splitCsvLine(headerLine, delimiter).map((h) => normalizeDescription(h));

  const dateIdx = headers.findIndex((h) =>
    ['data', 'date', 'dt', 'lancamento', 'data lancamento', 'data movimento'].some((k) =>
      h.includes(k),
    ),
  );
  const descIdx = headers.findIndex((h) =>
    ['descricao', 'historico', 'description', 'titulo', 'estabelecimento', 'memo', 'detalhe'].some(
      (k) => h.includes(k),
    ),
  );
  const amountIdx = headers.findIndex((h) =>
    ['valor', 'amount', 'quantia', 'total', 'preco'].some((k) => h.includes(k)),
  );
  const typeIdx = headers.findIndex((h) =>
    ['tipo', 'type', 'dc', 'natureza'].some((k) => h === k || h.includes(k)),
  );

  if (dateIdx < 0 || amountIdx < 0) {
    throw new Error(
      'Cabeçalho CSV não reconhecido. Esperado colunas como Data, Descrição e Valor.',
    );
  }

  const items: ParsedStatementItem[] = [];
  let skippedRows = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delimiter);
    const date = parseBrazilianOrIsoDate(cols[dateIdx] ?? '');
    const signedValue = parseMoneyValue(cols[amountIdx] ?? '');
    const description =
      (descIdx >= 0 ? cols[descIdx] : '')?.replace(/^["']|["']$/g, '').trim() ||
      'Lançamento importado';

    if (!date || signedValue === null || signedValue === 0) {
      skippedRows++;
      continue;
    }

    let type: 'income' | 'expense' = signedValue >= 0 ? 'income' : 'expense';
    if (typeIdx >= 0) {
      const tVal = normalizeDescription(cols[typeIdx] ?? '');
      if (tVal === 'd' || tVal.includes('deb') || tVal.includes('desp') || tVal.includes('sa')) {
        type = 'expense';
      } else if (tVal === 'c' || tVal.includes('cred') || tVal.includes('rec') || tVal.includes('ent')) {
        type = 'income';
      }
    }

    const amount = round2(Math.abs(signedValue));
    items.push({
      date,
      description: description.slice(0, 140),
      type,
      amount,
      external_hash: buildTransactionFingerprint({
        accountId,
        date,
        type,
        amount,
        description,
      }),
    });
  }

  return { format: 'csv', items, skippedRows };
}

function extractOfxTag(block: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}>([^<\\r\\n]+)`, 'i');
  const match = block.match(regex);
  return match ? match[1].trim() : null;
}

export function parseOfxStatement(
  content: string,
  accountId: string,
): StatementParseResult {
  const blocks = content.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|$)/gi);
  if (!blocks || blocks.length === 0) {
    throw new Error('Nenhuma transação (<STMTTRN>) encontrada no arquivo OFX.');
  }

  const items: ParsedStatementItem[] = [];
  let skippedRows = 0;

  for (const block of blocks) {
    const rawDate = extractOfxTag(block, 'DTPOSTED');
    const rawAmt = extractOfxTag(block, 'TRNAMT');
    const memo = extractOfxTag(block, 'MEMO');
    const name = extractOfxTag(block, 'NAME');
    const fitid = extractOfxTag(block, 'FITID') ?? undefined;
    const trnType = extractOfxTag(block, 'TRNTYPE')?.toUpperCase();

    const date = rawDate ? parseBrazilianOrIsoDate(rawDate) : null;
    const signedValue = rawAmt ? parseMoneyValue(rawAmt) : null;
    const description = (memo || name || 'Lançamento OFX').trim().slice(0, 140);

    if (!date || signedValue === null || signedValue === 0) {
      skippedRows++;
      continue;
    }

    let type: 'income' | 'expense' = signedValue >= 0 ? 'income' : 'expense';
    if (trnType === 'DEBIT') type = 'expense';
    if (trnType === 'CREDIT') type = 'income';

    const amount = round2(Math.abs(signedValue));
    items.push({
      date,
      description,
      type,
      amount,
      fitid,
      external_hash: buildTransactionFingerprint({
        accountId,
        date,
        type,
        amount,
        description,
        fitid,
      }),
    });
  }

  return { format: 'ofx', items, skippedRows };
}

export function parseStatementFile(
  fileName: string,
  content: string,
  accountId: string,
): StatementParseResult {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.ofx') || /<OFX>|<STMTTRN>/i.test(content)) {
    return parseOfxStatement(content, accountId);
  }
  return parseCsvStatement(content, accountId);
}
