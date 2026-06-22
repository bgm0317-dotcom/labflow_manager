// Google Calendar API — LabFlow 스케줄 자동 바쁨 등록
import { getAccessToken } from './driveUpload';
import { useAppStore } from './store';

const CALENDAR_ID = 'primary';
const TZ = 'Asia/Seoul';
export const CALENDAR_PREFIX = '[Axiom]';

/** "YYYY-MM-DD" + hour + minute → "YYYY-MM-DDThh:mm:00+09:00" */
function dt(dateStr: string, h: number, m: number): string {
  return `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`;
}

/** "HH:MM" + deltaMinutes → [hours, minutes] */
function addMin(timeStr: string, delta: number): [number, number] {
  const [h, m] = timeStr.split(':').map(Number);
  const total = ((h * 60 + m + delta) % 1440 + 1440) % 1440;
  return [Math.floor(total / 60), total % 60];
}

/** KST 기준 오늘 날짜 "YYYY-MM-DD" */
function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function listTodayLabFlowEvents(token: string, dateStr: string): Promise<{ id: string; summary: string }[]> {
  const timeMin = encodeURIComponent(`${dateStr}T00:00:00+09:00`);
  const timeMax = encodeURIComponent(`${dateStr}T23:59:59+09:00`);
  const q = encodeURIComponent(CALENDAR_PREFIX);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events?timeMin=${timeMin}&timeMax=${timeMax}&q=${q}&singleEvents=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).map((e: any) => ({ id: e.id as string, summary: e.summary as string }));
}

async function createEvent(token: string, summary: string, startDt: string, endDt: string): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary,
        start: { dateTime: startDt, timeZone: TZ },
        end: { dateTime: endDt, timeZone: TZ },
        transparency: 'opaque',
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw new Error(`캘린더 권한이 없습니다. 로그아웃 후 다시 로그인해 주세요. (${msg})`);
    }
    throw new Error(`이벤트 생성 실패: ${msg}`);
  }
}

export interface CalendarEventSpec {
  summary: string;
  start: string;
  end: string;
}

/**
 * 오늘 실험 스케줄 + 멤버 개인 Hyb task를 합쳐 캘린더 이벤트 스펙을 생성한다.
 *
 * - Day 1_96 / Day 1_384 / Day 2_AM / Wash: 실험 스케줄(store state)에서 직접 읽음
 * - Hyb #1 / #2 / #3: 해당 멤버에게 할당된 task 이름에서만 확인 (개인 담당)
 */
export function buildEventsForMember(memberTaskNames: string[], dateStr: string): CalendarEventSpec[] {
  const { todayProgressTargets, scheduleState, todayScheduleSummary } = useAppStore.getState();
  const events: CalendarEventSpec[] = [];

  // ── 실험 스케줄 기반 (멤버 task 무관) ──────────────────────────────────

  // Day 1_96: 10:40–11:30
  if (todayProgressTargets.day1_96) {
    events.push({ summary: `${CALENDAR_PREFIX} Day 1_96`, start: dt(dateStr, 10, 40), end: dt(dateStr, 11, 30) });
  }

  // Day 1_384: 16:40–17:30
  if (todayProgressTargets.day1_384) {
    events.push({ summary: `${CALENDAR_PREFIX} Day 1_384`, start: dt(dateStr, 16, 40), end: dt(dateStr, 17, 30) });
  }

  // Day 2_AM: startTime-15분 ~ startTime+60분
  if (todayProgressTargets.day2 && scheduleState.day2StartTime) {
    const [sh, sm] = addMin(scheduleState.day2StartTime, -15);
    const [eh, em] = addMin(scheduleState.day2StartTime, 60);
    events.push({ summary: `${CALENDAR_PREFIX} Day 2_AM`, start: dt(dateStr, sh, sm), end: dt(dateStr, eh, em) });
  }

  // Wash #1/#2/#3: 슬롯 이모지 기준으로 번호 결정 (🌅=1, 🌞=2, 🌙=3)
  const SLOT_NUMBER: Record<string, number> = { '🌅': 1, '🌞': 2, '🌙': 3 };
  todayScheduleSummary.wash.forEach((slot) => {
    const slotTime = scheduleState.washStartTimes[slot.emoji];
    if (slotTime) {
      const [sh, sm] = addMin(slotTime, -30);
      const [eh, em] = addMin(slotTime, 10);
      const num = SLOT_NUMBER[slot.emoji] ?? 1;
      events.push({ summary: `${CALENDAR_PREFIX} Wash #${num}`, start: dt(dateStr, sh, sm), end: dt(dateStr, eh, em) });
    }
  });

  // ── Hyb: 멤버 개인 task 기반 ──────────────────────────────────────────

  const HYB_TIMES: [number, number, number, number][] = [
    [8, 30, 9, 20],
    [12, 30, 13, 20],
    [16, 30, 17, 20],
  ];
  memberTaskNames.forEach(name => {
    const m = name.match(/^Hyb #([123])$/);
    if (m) {
      const idx = parseInt(m[1]) - 1;
      const [sh, sm, eh, em] = HYB_TIMES[idx];
      events.push({ summary: `${CALENDAR_PREFIX} ${name}`, start: dt(dateStr, sh, sm), end: dt(dateStr, eh, em) });
    }
  });

  return events;
}

/**
 * 멤버에게 할당된 task 목록을 기반으로 오늘 캘린더 이벤트를 추가한다.
 * 이미 같은 summary가 존재하면 생성하지 않는다 (삭제하지 않음).
 * @returns 추가된 이벤트 수
 */
export async function syncMemberCalendarEvents(taskNames: string[]): Promise<number> {
  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    throw new Error('Google 로그인이 필요합니다.');
  }

  const dateStr = kstToday();
  const existing = await listTodayLabFlowEvents(token, dateStr);
  const existingSummaries = new Set(existing.map(e => e.summary));

  const specs = buildEventsForMember(taskNames, dateStr);
  if (specs.length === 0) {
    throw new Error('오늘 스케줄에 해당하는 일정이 없습니다.\n(스케줄이 시트에서 불러와졌는지 확인해 주세요)');
  }

  const toCreate = specs.filter(s => !existingSummaries.has(s.summary));
  if (toCreate.length === 0) return 0; // 모두 이미 존재

  await Promise.all(toCreate.map(s => createEvent(token, s.summary, s.start, s.end)));
  return toCreate.length;
}
