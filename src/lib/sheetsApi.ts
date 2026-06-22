// Google Sheets API v4 utilities

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

function colToLetter(col: number): string {
  // col: 1-indexed
  let result = '';
  while (col > 0) {
    col--;
    result = String.fromCharCode(65 + (col % 26)) + result;
    col = Math.floor(col / 26);
  }
  return result;
}

export function cellRef(sheetName: string, row: number, col: number): string {
  return `'${sheetName}'!${colToLetter(col)}${row}`;
}

async function apiFetch(url: string, token: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Sheets API error ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function sheetsGetMetadata(spreadsheetId: string, token: string) {
  return apiFetch(`${BASE}/${spreadsheetId}?fields=sheets.properties`, token);
}

export async function sheetsBatchGet(spreadsheetId: string, ranges: string[], token: string) {
  const q = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
  return apiFetch(`${BASE}/${spreadsheetId}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE`, token);
}

export async function sheetsGetValues(spreadsheetId: string, range: string, token: string) {
  return apiFetch(`${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`, token);
}

export async function sheetsUpdate(spreadsheetId: string, range: string, values: any[][], token: string) {
  return apiFetch(
    `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    token,
    { method: 'PUT', body: JSON.stringify({ values }) }
  );
}

export async function sheetsBatchUpdate(spreadsheetId: string, data: { range: string; values: any[][] }[], token: string) {
  return apiFetch(
    `${BASE}/${spreadsheetId}/values:batchUpdate`,
    token,
    { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) }
  );
}

export async function sheetsDeleteRows(spreadsheetId: string, sheetId: number, startRowIndex: number, endRowIndex: number, token: string) {
  return apiFetch(
    `${BASE}/${spreadsheetId}:batchUpdate`,
    token,
    { method: 'POST', body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: startRowIndex, endIndex: endRowIndex } } }] }) }
  );
}

export async function sheetsClear(spreadsheetId: string, range: string, token: string) {
  return apiFetch(
    `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
    token,
    { method: 'POST' }
  );
}

// rowIndices: 0-based 행 인덱스 배열 (비연속 행도 가능)
export async function sheetsSetTextColorRows(
  spreadsheetId: string,
  sheetId: number,
  rowIndices: number[],
  startColIndex: number,
  endColIndex: number,
  color: { red: number; green: number; blue: number },
  token: string
) {
  const requests = rowIndices.map(row => ({
    repeatCell: {
      range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: startColIndex, endColumnIndex: endColIndex },
      cell: { userEnteredFormat: { textFormat: { foregroundColor: color } } },
      fields: 'userEnteredFormat.textFormat.foregroundColor',
    },
  }));
  return apiFetch(
    `${BASE}/${spreadsheetId}:batchUpdate`,
    token,
    { method: 'POST', body: JSON.stringify({ requests }) }
  );
}

export async function sheetsAppend(spreadsheetId: string, range: string, values: any[][], token: string) {
  return apiFetch(
    `${BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    token,
    { method: 'POST', body: JSON.stringify({ values }) }
  );
}

// 이름이 고정된 특수 시트 → category 매핑
const FIXED_SHEET_CATEGORIES: Record<string, string> = {
  'Notice':   'Notice',
  'CHQ list': 'CHECK',
};
const SKIP_SHEETS = new Set(['Chip info']); // 동기화 불필요

export async function syncSheetsData(spreadsheetId: string, token: string) {
  // 1. 전체 시트 목록 조회
  const meta = await sheetsGetMetadata(spreadsheetId, token);
  const allSheets: { sheetId: number; title: string }[] = meta.sheets.map((s: any) => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title,
  }));

  const fixedSheets  = allSheets.filter(s => s.title in FIXED_SHEET_CATEGORIES);
  const weeklySheets = allSheets.filter(s => !(s.title in FIXED_SHEET_CATEGORIES) && !SKIP_SHEETS.has(s.title));

  // 2. 주차별 시트의 A1 셀을 읽어서 CURRENT / UPCOMING / ARCHIVE 분류
  type SheetEntry = { sheetId: number; title: string; category: string };
  const categorizedWeekly: SheetEntry[] = [];

  if (weeklySheets.length > 0) {
    const a1Ranges = weeklySheets.map(s => `'${s.title}'!A1`);
    const a1Batch  = await sheetsBatchGet(spreadsheetId, a1Ranges, token);
    (a1Batch.valueRanges as any[]).forEach((vr, i) => {
      const category = String(vr.values?.[0]?.[0] || '').toUpperCase().trim();
      if (category === 'CURRENT' || category === 'UPCOMING' || category === 'ARCHIVE') {
        categorizedWeekly.push({ ...weeklySheets[i], category });
      }
    });
  }

  // 3. 필요한 시트 전체 데이터 일괄 조회 (ARCHIVE는 통계용으로 포함)
  const toFetch: SheetEntry[] = [
    ...categorizedWeekly,
    ...fixedSheets.map(s => ({ ...s, category: FIXED_SHEET_CATEGORIES[s.title] })),
  ];
  if (toFetch.length === 0) throw new Error('읽을 수 있는 시트가 없습니다.');

  const fullRanges = toFetch.map(s => `'${s.title}'!A1:Z100`);
  const fullBatch  = await sheetsBatchGet(spreadsheetId, fullRanges, token);

  // 4. tables 구조로 변환 (기존 store 코드와 호환)
  const tables: Record<string, { sheetId: number; sheetName: string; values: any[][] }[]> = {};
  (fullBatch.valueRanges as any[]).forEach((vr, i) => {
    const { sheetId, title, category } = toFetch[i];
    if (!tables[category]) tables[category] = [];
    tables[category].push({ sheetId, sheetName: title, values: vr.values || [] });
  });

  return tables;
}
