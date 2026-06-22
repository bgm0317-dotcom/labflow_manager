import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * "X1-2, P3" 형태의 문자열을 ["X1", "X2", "P3"] 배열로 변환합니다.
 */
export function parseChipString(str: string): string[] {
  if (!str) return [];

  const parts = str.split(',').map(p => p.trim()).filter(Boolean);
  const chips: string[] = [];

  parts.forEach(part => {
    // 범위 패턴: "X1-3", "P10-12"
    const rangeMatch = part.match(/^([A-Za-z]+)(\d+)-(\d+)$/);
    if (rangeMatch) {
      const prefix = rangeMatch[1];
      const start = parseInt(rangeMatch[2], 10);
      const end = parseInt(rangeMatch[3], 10);
      for (let i = start; i <= end; i++) {
        chips.push(`${prefix}${i}`);
      }
    } else if (/^[A-Za-z]+\d+(_[A-Za-z0-9]+)?$/.test(part)) {
      // 유효한 chip ID: P1, X3, M12, A5, P1_R, X3_RE 등 허용
      // "----", "R", "재실험" 등은 무시
      chips.push(part);
    }
  });

  return Array.from(new Set(chips));
}

/** _R, _RE, _r, _re 등 재실험 chip 판별 */
export function isReExpChip(chipId: string): boolean {
  return /_[Rr][Ee]?(\d*)$/.test(chipId);
}

export function calculateSamples(chips: string[], excludeReExp = false): number {
  return chips.reduce((total, chip) => {
    if (excludeReExp && isReExpChip(chip)) return total;
    const ucChip = chip.toUpperCase();
    if (ucChip.startsWith('P') || ucChip.startsWith('X') || ucChip.startsWith('M')) return total + 96;
    if (ucChip.startsWith('A')) return total + 384;
    return total;
  }, 0);
}

/**
 * 칩 목록을 종류별로 분류하여 카운트합니다.
 */
export function categorizeChips(chips: string[]) {
  const stats = { PMDA1: 0, PangenomiX: 0, AX3: 0, AX2_96: 0, total: 0 };
  chips.forEach(chip => {
    const uc = chip.toUpperCase();
    if (uc.startsWith('P')) stats.PMDA1++;
    else if (uc.startsWith('X')) stats.PangenomiX++;
    else if (uc.startsWith('A')) stats.AX3++;
    else if (uc.startsWith('M')) stats.AX2_96++;
  });
  stats.total = stats.PMDA1 + stats.PangenomiX + stats.AX3 + stats.AX2_96;
  return stats;
}

/**
 * Google Sheets에서 오는 다양한 날짜 형식을 Date로 변환합니다.
 * - "2026. 3. 16." (한국 형식)
 * - "2026-03-16"
 * - "2026/03/16"
 * - Serial number (Sheets 숫자 날짜)
 */
export function parseSheetDate(dateStr: string | number): Date | null {
  if (!dateStr && dateStr !== 0) return null;

  // Sheets serial number (숫자형 날짜)
  if (typeof dateStr === 'number') {
    // Sheets epoch: 1899-12-30, UTC 기준 → 로컬 날짜로 보정
    const ms = (dateStr - 25569) * 86400 * 1000;
    const utc = new Date(ms);
    // UTC 년/월/일을 로컬 날짜로 직접 생성 (timezone offset 제거)
    const d = new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    return isNaN(d.getTime()) ? null : d;
  }

  const s = String(dateStr).trim();

  // "2026. 3. 16." 또는 "2026. 03. 16"
  const koMatch = s.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/);
  if (koMatch) {
    return new Date(Number(koMatch[1]), Number(koMatch[2]) - 1, Number(koMatch[3]));
  }

  // ISO / 슬래시 형식
  const d = new Date(s.split(' ')[0]);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * ISO 주차 문자열을 반환합니다. 예: "2026-W12"
 */
export function getISOWeekString(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // 일요일=0 → 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // 해당 주 목요일로 이동
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * 날짜 문자열이 오늘과 같은 월인지 확인합니다.
 */
export function isSameMonth(dateStr: string | number, targetDate: Date = new Date()): boolean {
  const d = parseSheetDate(dateStr);
  if (!d) return false;
  return d.getMonth() === targetDate.getMonth() && d.getFullYear() === targetDate.getFullYear();
}

/**
 * 주말(토, 일) 여부를 확인합니다.
 */
export function isWorkDay(date: Date = new Date()): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6; // 0: Sunday, 6: Saturday
}
