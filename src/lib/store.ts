import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ViewType, UserSession, RecurringTask, TeamMember, Issue, Announcement, ScheduleData, PlateTimelineEntry, ChipQCEntry, PlateIssue, ChipImageIssue, MonthlyStat, PhotoEntry, DailyPhotos, ScheduledTaskDef, ChipInfoRow, CalendarEvent } from './types';
import { parseChipString, calculateSamples, isSameMonth, categorizeChips, parseSheetDate, getISOWeekString } from './utils';
import { db, auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ref, set as dbSet, update as dbUpdate, onValue, onDisconnect, runTransaction } from 'firebase/database';

// Firebase auth가 준비될 때까지 최대 5초 대기
function waitForAuth(): Promise<void> {
  if (auth.currentUser) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) { unsub(); resolve(); }
    });
    setTimeout(() => { unsub(); resolve(); }, 5000);
  });
}

// 세션 ID: 브라우저 탭 단위 (새로고침해도 유지)
let _sessionId: string = sessionStorage.getItem('_labflow_sid') || '';
if (!_sessionId) {
  _sessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessionStorage.setItem('_labflow_sid', _sessionId);
}
export const SESSION_ID = _sessionId;

// KST(UTC+9) 기준 오늘 날짜 문자열 (YYYY-MM-DD)
function todayKST(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
}

import { getAccessToken } from './driveUpload';
import { syncSheetsData, sheetsUpdate, sheetsBatchUpdate, sheetsClear, sheetsAppend, sheetsGetValues, sheetsGetMetadata, sheetsSetTextColorRows, sheetsDeleteRows, cellRef } from './sheetsApi';
import { SCHEDULE_SPREADSHEET_ID, REAGENT_LOG_SPREADSHEET_ID, CHIP_IMAGE_SPREADSHEET_ID } from './types';

interface AppState {
  view: ViewType;
  setView: (view: ViewType) => void;

  user: UserSession | null;
  setUser: (user: UserSession | null) => void;

  // Online presence
  onlineUsers: { sessionId: string; name: string; photoUrl: string; connectedAt: number }[];

  // Mobile sidebar
  isMobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;

  // Dashboard
  announcements: Announcement[];
  setAnnouncements: (a: Announcement[]) => void;
  addAnnouncement: (a: Announcement) => Promise<void>;
  removeAnnouncement: (id: string) => Promise<void>;
  updateAnnouncement: (id: string, patch: Partial<Omit<Announcement, 'id'>>) => Promise<void>;
  teamMembers: TeamMember[];
  addTeamMember: (member: TeamMember) => void;
  removeTeamMember: (name: string) => void;
  updateTeamMemberEmoji: (name: string, emoji: string) => void;
  tasks: RecurringTask[];
  setTasks: (t: RecurringTask[]) => void;
  toggleTask: (taskId: string, assignee?: string) => void;
  addTask: (task: RecurringTask) => void;
  removeTask: (taskId: string) => void;
  resetTasks: () => void;
  reorderTaskBefore: (taskId: string, beforeTaskId: string) => void;
  swapTasks: (taskIdA: string, taskIdB: string) => void;
  reorderMemberTasks: (orderedIds: string[]) => void;
  removeTasksByAssignee: (name: string) => void;
  addTaskAssignee: (taskId: string, assignee: string) => void;
  removeTaskAssignee: (taskId: string, assignee: string) => void;

  // Stats
  weeklySamples: number;
  monthlySamples: number;
  monthlyChartData: MonthlyStat[];
  weeklyStatsByDay: { date: string, day: string, PMDA1: number, PangenomiX: number, AX3: number, AX2_96: number, total: number, chips96: string, chips384: string }[];
  todayBatches: Record<string, string>;
  statusMessages: Record<string, string>;
  updateStatusMessage: (name: string, message: string) => void;
  todayProgressTargets: { day1_96: boolean, day1_384: boolean, day2: boolean, hyb: boolean, wash: boolean };
  todayScheduleSummary: {
    day2Chips96: string[]; day2Chips384: string[];
    prevFinishTime96: string; prevFinishTime384: string; // 어제 Day 1 완료 시각
    hyb:  { emoji: string; chips96: string[]; chips384: string[]; chipCols: Record<string, number> }[];
    wash: { emoji: string; chips96: string[]; chips384: string[] }[];
  };
  tomorrowScheduleSummary: {
    day1Chips96: string[]; day1Chips384: string[];
    day2Chips96: string[]; day2Chips384: string[];
    hyb:  { emoji: string; chips96: string[]; chips384: string[] }[];
    wash: { emoji: string; chips96: string[]; chips384: string[] }[];
    date: string | null;
  };
  todayColIdx: number | null;
  saveWashStartTime: (slotEmoji: string) => Promise<void>;
  chipQCPending: number;
  chqList: ChipQCEntry[];
  setChqList: (list: ChipQCEntry[]) => void;

  // Daily Photos (Drive 업로드 후 Firebase 임시 저장)
  dailyPhotos: DailyPhotos;
  addDailyPhoto: (photoType: 'dna' | 'pellet', entry: PhotoEntry) => void;
  removeDailyPhoto: (photoType: 'dna' | 'pellet', fileId: string) => Promise<void>;

  // 재실험 샘플 타임라인
  reExperimentTracking: Record<string, { chipId: string; addedDate: string; steps: Record<string, boolean>; stepTimes?: Record<string, string> }>;
  updateReExperimentStep: (chipId: string, step: string, done: boolean) => void;
  removeReExperimentChip: (chipId: string) => void;

  // 당일 시약 체크 상태 (Firebase 실시간 동기화, daily reset)
  // key = "Process-Format" (e.g. "Day 1-96", "Day 2_AM-384", "Wash RGT-")
  reagentCheckState: Record<string, {
    checkState: Record<string, Record<string, boolean>>;
    groupFinishTimes: Record<string, string>;   // reagentName → finish time
    groupUsers: Record<string, string>;          // reagentName → user name (completer)
    savedGroups: Record<string, boolean>;        // reagentName → saved to sheet
  }>;
  updateReagentCheck: (
    logKey: string,
    patch: Partial<{ checkState: Record<string, Record<string, boolean>>; groupFinishTimes: Record<string, string>; groupUsers: Record<string, string>; savedGroups: Record<string, boolean> }>
  ) => void;

  // Issues
  issues: Issue[];
  setIssues: (i: Issue[]) => void;
  addIssue: (issue: Issue, token?: string) => Promise<void>;

  // Plate Issues
  plateIssues: PlateIssue[];
  addPlateIssue: (issue: PlateIssue, token?: string) => Promise<void>;

  // Chip Image Issues
  chipImageIssues: ChipImageIssue[];
  addChipImageIssue: (issue: ChipImageIssue) => Promise<void>;

  // Issue Updates
  updateIssueStatus: (id: string, status: 'Open' | 'Resolved', result: string) => Promise<void>;
  updatePlateIssueStatus: (id: string, status: 'Open' | 'Resolved', result: string) => Promise<void>;
  updateChipImageCHQStatus: (id: string, result: string) => Promise<void>;

  // Selection
  selectedIssue: Issue | null;
  setSelectedIssue: (i: Issue | null) => void;
  selectedPlateIssue: PlateIssue | null;
  setSelectedPlateIssue: (i: PlateIssue | null) => void;
  selectedChipImageId: string | null;
  setSelectedChipImageId: (id: string | null) => void;

  // Schedule  
  scheduleData: ScheduleData | null;
  setScheduleData: (d: ScheduleData | null) => void;

  // Timeline
  timelineEntries: PlateTimelineEntry[];
  setTimelineEntries: (e: PlateTimelineEntry[]) => void;
  addTimelineEntry: (e: PlateTimelineEntry) => void;
  chipInfoRows: ChipInfoRow[];

  // Scheduled (recurring) tasks
  scheduledTasks: ScheduledTaskDef[];
  addScheduledTask: (task: Omit<ScheduledTaskDef, 'id'>) => void;
  removeScheduledTask: (id: string) => void;
  completeScheduledTask: (id: string, byName?: string) => void;
  toggleScheduledTaskDate: (id: string, date: string, byName?: string) => void;
  moveScheduledTaskDate: (id: string, fromDate: string, toDate: string) => void;

  // Calendar range events
  calendarEvents: CalendarEvent[];
  addCalendarEvent: (event: Omit<CalendarEvent, 'id'>) => void;
  removeCalendarEvent: (id: string) => void;
  updateCalendarEvent: (id: string, patch: Partial<Omit<CalendarEvent, 'id'>>) => void;
  updateScheduledTask: (id: string, patch: Partial<Omit<ScheduledTaskDef, 'id' | 'doneHistory' | 'dateOverrides'>>) => void;
  fetchDay1FinishFromSheet: () => Promise<void>;
  fetchBarcodesFromChipInfo: (format: '96' | '384', cacheOnly?: boolean) => Promise<void>;

  // Actions
  saveReagentLog: (params: {
    process: string;
    chips: string[];
    reagentNames: string[];
    lot1: string;
    lot2: string;
    groupFinishTimes: Record<string, string>;
    groupUsers: Record<string, string>;
    chipBarcodes?: Record<string, string>;
    volumesByReagent?: Record<string, number>;
  }) => Promise<void>;
  recordDay1: (type: '96' | '384', chips: string, finishTime: string) => Promise<void>;
  deleteDay1: (type: '96' | '384') => Promise<void>;

  // Day 1 shared state (Firebase, daily reset)
  day1Data: {
    '384': { chipInput: string; chipBarcodes: Record<string, string>; finishTime: string; reExperimentChips: Record<string, boolean>; chipsRegistered: boolean };
    '96':  { chipInput: string; chipBarcodes: Record<string, string>; finishTime: string; reExperimentChips: Record<string, boolean>; chipsRegistered: boolean };
  };
  updateDay1: (format: '384' | '96', patch: Partial<{ chipInput: string; chipBarcodes: Record<string, string>; finishTime: string; reExperimentChips: Record<string, boolean>; chipsRegistered: boolean }>) => void;
  registerChips: (format: '384' | '96') => Promise<void>;

  // Schedule shared state (Firebase, daily reset)
  scheduleState: {
    hybTimes: Record<string, Record<string, string>>;  // slotEmoji → chip → time
    hybDone:  Record<string, Record<string, boolean>>; // slotEmoji → chip → done
    spindownDone: Record<string, boolean>;             // slotEmoji → done
    spindownSaved: Record<string, boolean>;            // chip → saved in sheet
    washStartTimes: Record<string, string>;            // slotEmoji → time
  };
  updateScheduleState: (patch: Partial<{
    hybTimes: Record<string, Record<string, string>>;
    hybDone:  Record<string, Record<string, boolean>>;
    spindownDone: Record<string, boolean>;
    spindownSaved: Record<string, boolean>;
    washStartTimes: Record<string, string>;
  }>) => void;
  saveHybTimes: (slotEmoji?: string) => Promise<void>;
  saveSpindownNote: (slotEmoji: string, chips: string[]) => Promise<void>;
  toggleHybDone: (slotEmoji: string, chip: string) => void;

  // 시약 바코드(Lot#) 저장 완료 상태 (Firebase 일별 유지)
  reagentLotSaved: Record<string, boolean>; // process key → saved today
  markReagentLotSaved: (process: string) => void;

  // Firebase
  subscribeToFirestore: () => () => void;

  // KR Holidays (fetched from Google Calendar)
  krHolidays: Set<string>;
  fetchKrHolidays: () => Promise<void>;

  // Sync Logic
  isLoading: boolean;
  lastSync: string | null;
  syncError: string | null;
  syncWithSheets: () => Promise<void>;
}


export const useAppStore = create<AppState>()(
  persist(
    (set, get) => {
      const todayStr = todayKST();
      return {
        view: 'dashboard',
        setView: (view) => set({ view }),

      user: null,
      setUser: (user) => {
        set({ user });
        if (user) {
          const presRef = ref(db, `shared/presence/${SESSION_ID}`);
          dbSet(presRef, { name: user.name, photoUrl: user.photoUrl || '', connectedAt: Date.now() });
          onDisconnect(presRef).remove();
        } else {
          dbSet(ref(db, `shared/presence/${SESSION_ID}`), null);
        }
      },

      onlineUsers: [],

isMobileSidebarOpen: false,
      setMobileSidebarOpen: (isMobileSidebarOpen) => set({ isMobileSidebarOpen }),

      weeklySamples: 0,
      monthlySamples: 0,
      monthlyChartData: [],
      weeklyStatsByDay: [],
      todayBatches: {},
      statusMessages: {},
      todayProgressTargets: { day1_96: false, day1_384: false, day2: false, hyb: false, wash: false },
      todayScheduleSummary: { day2Chips96: [], day2Chips384: [], prevFinishTime96: '', prevFinishTime384: '', hyb: [] as { emoji: string; chips96: string[]; chips384: string[]; chipCols: Record<string, number> }[], wash: [] as { emoji: string; chips96: string[]; chips384: string[] }[] },
      tomorrowScheduleSummary: { day1Chips96: [], day1Chips384: [], day2Chips96: [], day2Chips384: [], hyb: [] as { emoji: string; chips96: string[]; chips384: string[] }[], wash: [] as { emoji: string; chips96: string[]; chips384: string[] }[], date: null },
      todayColIdx: null,
      updateStatusMessage: (name, message) => {
        const next = { ...get().statusMessages, [name]: message };
        set({ statusMessages: next });
        dbSet(ref(db, 'shared/statusMessages'), { messages: next });
      },
      chipQCPending: 0,
      chqList: [],
      setChqList: (chqList) => set({ chqList, chipQCPending: chqList.filter(i => !i.isCompleted).length }),

      dailyPhotos: { dna: [], pellet: [] },
      addDailyPhoto: (photoType, entry) => {
        const todayStr = todayKST();
        const next = {
          ...get().dailyPhotos,
          [photoType]: [...get().dailyPhotos[photoType], entry],
        };
        set({ dailyPhotos: next });
        dbSet(ref(db, 'shared/dailyPhotos'), { lastReset: todayStr, ...next });
      },
      removeDailyPhoto: async (photoType, fileId) => {
        const next = {
          ...get().dailyPhotos,
          [photoType]: get().dailyPhotos[photoType].filter(p => p.fileId !== fileId),
        };
        set({ dailyPhotos: next });
        dbSet(ref(db, 'shared/dailyPhotos'), { lastReset: todayKST(), ...next });
        try {
          const { deleteFileFromDrive } = await import('./driveUpload');
          const token = await getAccessToken();
          await deleteFileFromDrive(fileId, token);
        } catch (e) {
          console.warn('Drive 파일 삭제 실패 (Firebase에서는 제거됨):', e);
        }
      },

      reagentCheckState: {},
      updateReagentCheck: (logKey, patch) => {
        const todayStr = todayKST();
        const current = get().reagentCheckState[logKey] || { checkState: {}, groupFinishTimes: {}, groupUsers: {}, savedGroups: {} };

        // Per-component deep merge: preserves concurrent edits from other users
        const mergedCheckState: Record<string, Record<string, boolean>> = { ...(current.checkState || {}) };
        if (patch.checkState) {
          Object.entries(patch.checkState).forEach(([rName, comps]) => {
            mergedCheckState[rName] = { ...(current.checkState?.[rName] || {}), ...comps };
          });
        }
        const merged = {
          checkState: mergedCheckState,
          groupFinishTimes: { ...(current.groupFinishTimes || {}), ...(patch.groupFinishTimes || {}) },
          groupUsers:        { ...(current.groupUsers || {}),        ...(patch.groupUsers || {}) },
          savedGroups:       { ...(current.savedGroups || {}),       ...(patch.savedGroups || {}) },
        };

        const next = { ...get().reagentCheckState, [logKey]: merged };
        set({ reagentCheckState: next });
        waitForAuth().then(() =>
          dbSet(ref(db, 'shared/reagentCheckState'), { lastReset: todayStr, logs: next })
        ).catch((err) => console.error('[Firebase] reagentCheckState 저장 실패:', err));
      },

      reExperimentTracking: {},
      updateReExperimentStep: (chipId, step, done) => {
        const next = {
          ...get().reExperimentTracking,
          [chipId]: {
            ...get().reExperimentTracking[chipId],
            steps: { ...get().reExperimentTracking[chipId]?.steps, [step]: done },
          },
        };
        set({ reExperimentTracking: next });
        dbSet(ref(db, 'shared/reExperimentTracking'), next);
      },
      removeReExperimentChip: (chipId) => {
        const next = { ...get().reExperimentTracking };
        delete next[chipId];
        set({ reExperimentTracking: next });
        dbSet(ref(db, 'shared/reExperimentTracking'), next);
      },

      day1Data: {
        '384': { chipInput: '', chipBarcodes: {}, finishTime: '', reExperimentChips: {}, chipsRegistered: false },
        '96':  { chipInput: '', chipBarcodes: {}, finishTime: '', reExperimentChips: {}, chipsRegistered: false },
      },

      updateDay1: (format, patch) => {
        const next = { ...get().day1Data, [format]: { ...get().day1Data[format], ...patch } };
        set({ day1Data: next });
        dbSet(ref(db, 'shared/day1'), { lastReset: todayKST(), ...next });
      },

      scheduleState: {
        hybTimes: {},
        hybDone: {},
        spindownDone: {},
        spindownSaved: {},
        washStartTimes: {},
      },

      updateScheduleState: (patch) => {
        const next = { ...get().scheduleState, ...patch };
        set({ scheduleState: next });
        const { washStartTimes: _wst, ...stateForFB } = next;
        dbSet(ref(db, 'shared/scheduleState'), { lastReset: todayKST(), ...stateForFB });
      },

      saveHybTimes: async (slotEmoji?: string) => {
        const token = await getAccessToken();
        const tables = await syncSheetsData(SCHEDULE_SPREADSHEET_ID, token);
        const currentSheet = tables.CURRENT?.[0];
        if (!currentSheet) throw new Error("CURRENT 시트를 찾을 수 없습니다.");

        const sheetName = currentSheet.sheetName;
        const values = currentSheet.values;
        const row1 = values[0] || [];

        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        let colIdx = -1;
        for (const base of [1, 5, 9, 13, 17, 21]) {
          const d = parseSheetDate(row1[base]);
          if (d && !isNaN(d.getTime())) {
            const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (dStr === todayStr) { colIdx = base; break; }
          }
        }
        if (colIdx === -1) throw new Error("오늘 날짜 컬럼을 찾을 수 없습니다.");

        const { hybTimes } = get().scheduleState;
        // 슬롯별 칩 위치 행: 🌅→row3, 🌞→row7, 🌙→row11 (0-indexed: 2, 6, 10)
        // 시각 입력 위치 행: Row + 1 (0-indexed: 3, 7, 11)
        const SLOT_CHIP_ROWS: Record<string, number> = { '🌅': 2, '🌞': 6, '🌙': 10 };
        const updates: { range: string; values: any[][] }[] = [];

        // slotEmoji가 지정된 경우 해당 슬롯만, 없으면 전체
        const targetEntries = slotEmoji
          ? Object.entries(SLOT_CHIP_ROWS).filter(([e]) => e === slotEmoji)
          : Object.entries(SLOT_CHIP_ROWS);

        targetEntries.forEach(([emoji, chipRowIdx]) => {
          const times = hybTimes[emoji] || {};
          if (Object.keys(times).length === 0) return;

          const rowValues = values[chipRowIdx] || [];
          // 오늘 날짜에 해당하는 4개 컬럼(colIdx ~ colIdx+3)에서 칩 찾기
          for (let c = colIdx; c <= colIdx + 3; c++) {
            const cellVal = String(rowValues[c] || '').trim();
            if (!cellVal) continue;
            
            // 셀에 여러 칩이 있을 수 있으므로 분리해서 체크
            const chipsInCell = cellVal.split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
            
            // 이 셀에 있는 칩들 중 시각 입력 대상이 있는지 확인
            const matchedTimes: string[] = [];
            Object.entries(times).forEach(([chip, time]) => {
              if (time && chipsInCell.includes(chip.toLowerCase())) {
                matchedTimes.push(time);
              }
            });

            if (matchedTimes.length > 0) {
              const timeRow = chipRowIdx + 2; // 1-indexed row number (rowIdx + 1 + 1)
              const timeVal = matchedTimes.join(', ');
              updates.push({ range: cellRef(sheetName, timeRow, c + 1), values: [[timeVal]] });
            }
          }
        });

        if (updates.length > 0) {
          await sheetsBatchUpdate(SCHEDULE_SPREADSHEET_ID, updates, token);
          console.log(`[HybSave] ${updates.length}개 위치 업데이트 완료`);
        }

        // 슬롯별 저장 시: 해당 슬롯의 Spindown만, 전체 저장 시: 모든 슬롯
        const allCheckedChips: string[] = [];
        const { hybDone } = get().scheduleState;
        const spindownEntries = slotEmoji
          ? [[slotEmoji, hybDone[slotEmoji] || {}]] as [string, Record<string, boolean>][]
          : Object.entries(hybDone);
        spindownEntries.forEach(([, chips]) => {
          Object.entries(chips).forEach(([chip, done]) => {
            if (done) allCheckedChips.push(chip);
          });
        });
        
        if (allCheckedChips.length > 0) {
          console.log(`[HybSave] ${allCheckedChips.length}개 칩의 Spindown 여부 기록 시도...`);
          await get().saveSpindownNote('BATCH', allCheckedChips);
        }
      },

      saveSpindownNote: async (slotEmoji, chips) => {
        if (chips.length === 0) return;
        const token = await getAccessToken();
        const headerRes = await sheetsGetValues(SCHEDULE_SPREADSHEET_ID, "'Chip info'!1:1", token);
        const headers: string[] = (headerRes.values?.[0] || []).map((h: any) => String(h).trim());
        
        console.log('[Spindown] Full Headers:', headers);

        const pCol = headers.findIndex(h => /^#?p$/i.test(h) || /^chip/i.test(h));
        const hybDateCol = headers.findIndex(h => {
          const hl = h.toLowerCase();
          return (hl.includes('hyb') && hl.includes('date')) || hl.includes('일시') || hl.includes('날짜');
        });
        const issueCol = headers.findIndex(h => h.includes('issue') || h.includes('이슈') || h.includes('Issue'));
        
        console.log('[Spindown] Found Indices:', { pCol, hybDateCol, issueCol });

        if (issueCol < 0) {
          console.warn('[Spindown] 필수 컬럼(이슈)를 찾지 못함');
          return;
        }

        const existingRes = await sheetsGetValues(SCHEDULE_SPREADSHEET_ID, "'Chip info'!A2:Z1000", token);
        const existingRows: any[][] = existingRes.values || [];
        
        const now = new Date();
        const targetY = String(now.getFullYear());
        const targetM = String(now.getMonth() + 1);
        const targetD = String(now.getDate());
        
        const NOTE = 'Hyb 후 spindown';
        const updates: { range: string; values: any[][] }[] = [];
        const tempSavedMap: Record<string, boolean> = {};

        chips.forEach(chip => {
          const chipNorm = chip.trim().toLowerCase();
          
          let foundIdx = -1;
          for (let i = existingRows.length - 1; i >= 0; i--) {
            const row = existingRows[i];
            const rowStr = row.map(v => String(v || '').trim().toLowerCase());
            
            // 1. 칩 이름이 행의 어느 컬럼에라도 있는지 확인
            const pMatch = rowStr.some(v => v === chipNorm || v.split(/[,\s]+/).includes(chipNorm));
            
            if (pMatch) {
              if (hybDateCol >= 0) {
                const rawVal = row[hybDateCol];
                const d = parseSheetDate(rawVal);
                let dateMatch = false;
                if (d) {
                  dateMatch = d.getFullYear() === Number(targetY) && 
                              (d.getMonth() + 1) === Number(targetM) && 
                              d.getDate() === Number(targetD);
                } else {
                  const s = String(rawVal);
                  const nums: string[] = s.match(/\d+/g) || [];
                  dateMatch = nums.includes(targetY) && 
                              (nums.includes(targetM) || nums.includes(targetM.padStart(2, '0'))) && 
                              (nums.includes(targetD) || nums.includes(targetD.padStart(2, '0')));
                }
                
                if (dateMatch) {
                  foundIdx = i;
                  break;
                }
              } else {
                foundIdx = i;
                break;
              }
            }
          }

          if (foundIdx === -1) {
            console.warn(`[Spindown] 행 검색 최종 실패: chip="${chip}" (Expected: ${targetY}.${targetM}.${targetD})`);
            return;
          }

          const sheetRow = foundIdx + 2;
          const existing = String(existingRows[foundIdx][issueCol] || '').trim();
          if (!existing.includes(NOTE)) {
            const updated = existing ? `${existing}, ${NOTE}` : NOTE;
            updates.push({ range: cellRef('Chip info', sheetRow, issueCol + 1), values: [[updated]] });
          }
          tempSavedMap[chip] = true;
        });

        if (updates.length > 0) {
          await sheetsBatchUpdate(SCHEDULE_SPREADSHEET_ID, updates, token);
          get().updateScheduleState({ spindownSaved: { ...get().scheduleState.spindownSaved, ...tempSavedMap } });
          console.log(`[Spindown] 기록 완료: ${Object.keys(tempSavedMap).join(', ')}`);
        } else if (Object.keys(tempSavedMap).length > 0) {
          get().updateScheduleState({ spindownSaved: { ...get().scheduleState.spindownSaved, ...tempSavedMap } });
        }
      },

      toggleHybDone: (slotEmoji, chip) => {
        const cur = get().scheduleState;
        const slotDone = { ...(cur.hybDone[slotEmoji] || {}) };
        slotDone[chip] = !slotDone[chip];
        const next = { ...cur, hybDone: { ...cur.hybDone, [slotEmoji]: slotDone } };
        set({ scheduleState: next });
        const { washStartTimes: _wst, ...stateForFB } = next;
        dbSet(ref(db, 'shared/scheduleState'), { lastReset: todayKST(), ...stateForFB });
      },

      reagentLotSaved: {},
      markReagentLotSaved: (process) => {
        const next = { ...get().reagentLotSaved, [process]: true };
        set({ reagentLotSaved: next });
        dbSet(ref(db, 'shared/reagentLotSaved'), { lastReset: todayKST(), saved: next });
      },

      saveWashStartTime: async (_slotEmoji) => {
        // washStartTimes는 updateScheduleState → Firebase에 이미 저장됨
      },

      registerChips: async (format) => {
        const { chipInput, chipBarcodes, reExperimentChips } = get().day1Data[format];
        const chips = parseChipString(chipInput);
        if (chips.length === 0) throw new Error('#p가 없습니다.');
        const token = await getAccessToken();

        // 1. Chip info 시트 헤더 읽기 (컬럼 위치 동적 파악)
        const headerRes = await sheetsGetValues(SCHEDULE_SPREADSHEET_ID, "'Chip info'!1:1", token);
        const headers: string[] = (headerRes.values?.[0] || []).map((h: any) => String(h).trim());
        const colOf = (name: string) => headers.indexOf(name); // 0-based

        const startDateCol = colOf('Start date');
        const barcodeCol   = colOf('Chip barcode');
        const pCol         = colOf('#p');
        const isoWeekCol   = colOf('ISO week');
        const bCol         = colOf('#b');

        const maxCol = Math.max(startDateCol, barcodeCol, pCol, isoWeekCol, bCol);
        if (maxCol === -1) throw new Error('Chip info 시트에서 필요한 헤더를 찾을 수 없습니다.');

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const isoWeek  = getISOWeekString(today);

        // 2. 기존 데이터 읽어서 오늘 날짜 + 같은 #p 매핑 (행 번호 포함)
        const existingRes = await sheetsGetValues(SCHEDULE_SPREADSHEET_ID, "'Chip info'!A2:Z500", token);
        const existingRows: any[][] = existingRes.values || [];
        // #p → 1-based 시트 행 번호
        const existingRowMap = new Map<string, number>();
        existingRows.forEach((row, idx) => {
          const rawDate = startDateCol >= 0 ? row[startDateCol] : null;
          const rowP    = pCol >= 0 ? String(row[pCol] || '').trim() : '';
          if (!rawDate || !rowP) return;
          const parsedDate = parseSheetDate(rawDate);
          const parsedStr  = parsedDate ? parsedDate.toISOString().split('T')[0] : String(rawDate);
          if (parsedStr === todayStr) existingRowMap.set(rowP, idx + 2); // +2: header + 0-based→1-based
        });

        const newChips      = chips.filter(c => !existingRowMap.has(c));
        const existingChips = chips.filter(c =>  existingRowMap.has(c));

        // 3. 신규 칩 추가
        let appendedStartRow = -1;
        if (newChips.length > 0) {
          const rows = newChips.map(chip => {
            const row = new Array(maxCol + 1).fill('');
            const barcode = chipBarcodes[chip] || '';
            if (startDateCol >= 0) row[startDateCol] = todayStr;
            if (barcodeCol   >= 0) row[barcodeCol]   = barcode;
            if (pCol         >= 0) row[pCol]          = chip;
            if (isoWeekCol   >= 0) row[isoWeekCol]    = isoWeek;
            if (bCol         >= 0) row[bCol]          = barcode.slice(-3);
            return row;
          });
          const appendRes = await sheetsAppend(SCHEDULE_SPREADSHEET_ID, "'Chip info'!A:A", rows, token);
          const match = appendRes.updates?.updatedRange?.match(/[A-Z]+(\d+)/);
          if (match) appendedStartRow = parseInt(match[1]);
        }

        // 4. 기존 칩 → barcode 업데이트 (barcode가 있는 경우만)
        const barcodeUpdates: { range: string; values: any[][] }[] = [];
        existingChips.forEach(chip => {
          const barcode = chipBarcodes[chip] || '';
          if (!barcode) return;
          const sheetRow = existingRowMap.get(chip)!;
          const sheetName = 'Chip info';
          if (barcodeCol >= 0) barcodeUpdates.push({ range: cellRef(sheetName, sheetRow, barcodeCol + 1), values: [[barcode]] });
          if (bCol       >= 0) barcodeUpdates.push({ range: cellRef(sheetName, sheetRow, bCol + 1),       values: [[barcode.slice(-3)]] });
        });
        if (barcodeUpdates.length > 0) {
          await sheetsBatchUpdate(SCHEDULE_SPREADSHEET_ID, barcodeUpdates, token);
        }

        // 5. 재실험 칩 빨간 글씨
        const reExpChips = chips.filter(c => reExperimentChips[c]);
        if (reExpChips.length > 0 && pCol >= 0) {
          const meta = await sheetsGetMetadata(SCHEDULE_SPREADSHEET_ID, token);
          const sheetId = meta.sheets.find((s: any) => s.properties.title === 'Chip info')?.properties.sheetId;
          if (sheetId !== undefined) {
            const redRowIndices: number[] = [];
            reExpChips.forEach(c => {
              if (existingRowMap.has(c)) {
                redRowIndices.push(existingRowMap.get(c)! - 1); // 0-based
              } else if (appendedStartRow > 0) {
                redRowIndices.push(appendedStartRow - 1 + newChips.indexOf(c));
              }
            });
            if (redRowIndices.length > 0) {
              await sheetsSetTextColorRows(
                SCHEDULE_SPREADSHEET_ID, sheetId,
                redRowIndices, pCol, pCol + 1,
                { red: 1, green: 0, blue: 0 }, token
              );
            }
          }
        }

        // 재실험 칩을 Firebase tracking에 추가 (Day 1 완료 상태로 시작)
        if (reExpChips.length > 0) {
          const addedDate = new Date().toISOString().split('T')[0];
          const current = get().reExperimentTracking;
          const updated = { ...current };
          reExpChips.forEach(chip => {
            updated[chip] = {
              chipId: chip,
              addedDate,
              steps: { 'Day 1': true, 'Day 2': false, 'Hyb': false, 'Wash': false, 'Scan': false },
            };
          });
          set({ reExperimentTracking: updated });
          dbSet(ref(db, 'shared/reExperimentTracking'), updated);
        }

        // Chip info 등록 완료 플래그 설정 (중복 append 방지)
        const next = { ...get().day1Data[format], chipsRegistered: true };
        const updatedDay1 = { ...get().day1Data, [format]: next };
        set({ day1Data: updatedDay1 });
        dbSet(ref(db, 'shared/day1'), { lastReset: todayKST(), ...updatedDay1 });
      },

      saveReagentLog: async ({ process, chips: rawChips, reagentNames, lot1, lot2, groupFinishTimes, groupUsers, chipBarcodes = {}, volumesByReagent }) => {
        const chips = rawChips.flatMap(c => parseChipString(c));
        const token = await getAccessToken();

        const headerRes = await sheetsGetValues(REAGENT_LOG_SPREADSHEET_ID, "'Reagent log'!1:1", token);
        const headersRaw: string[] = (headerRes.values?.[0] || []).map((h: any) => String(h).trim());
        const headersLower = headersRaw.map(h => h.toLowerCase());
        const colOf = (name: string) => headersLower.indexOf(name.toLowerCase());

        const dateCol    = colOf('Date');
        const finishCol  = colOf('Finish time');
        const pCol       = colOf('#p');
        const barcodeCol = colOf('barcode');
        const processCol = colOf('Process');
        const reagentCol = colOf('Reagent');
        const lot1Col    = colOf('Lot # 1') >= 0 ? colOf('Lot # 1') : colOf('Lot #1');
        const lot2Col    = colOf('Lot # 2') >= 0 ? colOf('Lot # 2') : colOf('Lot #2');
        const userCol    = colOf('User');
        const volumeCol  = colOf('Volume') >= 0 ? colOf('Volume') : colOf('Vol (mL)');

        const maxCol = Math.max(...[dateCol, finishCol, pCol, barcodeCol, processCol, reagentCol, lot1Col, lot2Col, userCol, volumeCol].filter(c => c >= 0));
        if (maxCol < 0) throw new Error('Reagent log 시트에서 헤더를 찾을 수 없습니다.');

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const displayDate = `${today.getFullYear()}. ${today.getMonth() + 1}. ${today.getDate()}.`;

        // 바코드 약어 맵
        const REAGENT_ABBR: Record<string, string> = {
          'Denaturation Master Mix': 'Den',
          'Amplification Master Mix': 'Amp',
          'Fragmentation Master Mix': 'Frag',
          'Precipitation Master Mix': 'Precip',
          'Hybridization Cocktail': 'Hyb',
          'Stain 1': 'S1',
          'Stain 2': 'S2',
          'Stabilization Master Mix': 'Stbl',
          'Ligation Master Mix': 'Lig',
          'Ligation Enzyme': 'Lig enz'
        };

        const barcodeMap: Record<string, string> = { ...chipBarcodes };
        const missingChips = chips.filter(c => !barcodeMap[c]);

        if (missingChips.length > 0) {
          // 주간 스케줄 시트의 Chip info 탭에서 #p + start date로 검색
          //   Day 1:               start date == 오늘
          //   Day 2 / Wash / Lig:  start date == 오늘 - 1
          const expectedStartDate = (() => {
            if (process === 'Day 1') return todayStr;
            const d = new Date(today);
            d.setDate(d.getDate() - 1);
            return d.toISOString().split('T')[0];
          })();

          try {
            const ciRes = await sheetsGetValues(SCHEDULE_SPREADSHEET_ID, "'Chip info'!A:Z", token);
            const ciValues: any[][] = ciRes.values || [];
            if (ciValues.length > 1) {
              const ciHeaders = ciValues[0].map((h: any) => String(h).trim().toLowerCase());
              const ciPCol = ciHeaders.findIndex(h => h === '#p');
              const ciBarcodeCol = ciHeaders.findIndex(h => h === 'chip barcode' || h === 'barcode' || h === 'chip_barcode');
              const ciStartDateCol = ciHeaders.findIndex(h => h === 'start date' || (h.includes('start') && h.includes('date')));

              if (ciPCol >= 0 && ciBarcodeCol >= 0) {
                for (const chip of missingChips) {
                  const target = chip.toLowerCase();
                  const match = ciValues.slice(1).reverse().find(row => {
                    const cellP = String(row[ciPCol] ?? '').trim().toLowerCase();
                    if (!String(row[ciBarcodeCol] ?? '').trim()) return false;
                    const pMatch = cellP === target || cellP.split(/[,\s]+/).map(s => s.trim()).filter(Boolean).includes(target);
                    if (!pMatch) return false;
                    if (ciStartDateCol < 0) return true;
                    const rawDate = row[ciStartDateCol];
                    if (!rawDate && rawDate !== 0) return true;
                    const rowDate = parseSheetDate(rawDate);
                    if (!rowDate) return true;
                    return rowDate.toISOString().split('T')[0] === expectedStartDate;
                  });
                  if (match) barcodeMap[chip] = String(match[ciBarcodeCol]).trim();
                }
              }
            }
          } catch (e) { console.warn('Chip info 바코드 검색 실패:', e); }
        }

        // 최종 폴백: 시트 검색 후에도 누락된 칩은 day1Data 바코드맵에서 재확인
        chips.forEach(c => {
          if (!barcodeMap[c] && chipBarcodes[c]) barcodeMap[c] = chipBarcodes[c];
        });

        // Wash RGT: deduplicate chips across slots (#1/#2/#3 → unique #p list)
        const uniqueChips = [...new Set(chips)];

        const rows: any[][] = [];
        for (const reagentRaw of reagentNames) {
          const reagent = REAGENT_ABBR[reagentRaw] || reagentRaw;
          for (const chip of uniqueChips) {
            const row = new Array(maxCol + 1).fill('');
            const barcode = barcodeMap[chip] || '';
            const finishTime = groupFinishTimes[reagentRaw] || '';

            if (dateCol    >= 0) row[dateCol]    = displayDate;
            // ⚠️ Finish time은 '15:48' 같은 문자열을 Sheets가 시간 소수점으로 변환하므로
            //    접두 샬인표(')  를 쓴 순수 텍스트로 실제 데이터는 샬인표 없이 저장됨
            if (finishCol  >= 0) row[finishCol]  = finishTime ? `'${finishTime}` : '';
            if (pCol       >= 0) row[pCol]       = chip;
            if (barcodeCol >= 0) row[barcodeCol] = barcode;
            if (processCol >= 0) row[processCol] = '';
            if (reagentCol >= 0) row[reagentCol] = reagent;
            if (lot1Col    >= 0) row[lot1Col]    = lot1;
            if (lot2Col    >= 0) row[lot2Col]    = lot2;
            if (userCol    >= 0) row[userCol]    = groupUsers[reagentRaw] || '';
            if (volumeCol  >= 0 && volumesByReagent) row[volumeCol] = volumesByReagent[reagentRaw] !== undefined ? Math.round(volumesByReagent[reagentRaw] * 1000) / 1000 : '';
            rows.push(row);
          }
        }

        await sheetsAppend(REAGENT_LOG_SPREADSHEET_ID, "'Reagent log'!A:A", rows, token);
      },

      krHolidays: new Set<string>(),
      fetchKrHolidays: async () => {
        const thisYear = new Date().getFullYear();
        // Google Calendar의 한국 공휴일 캘린더에는 법정공휴일 외에 기념일(어버이날, 스승의날 등)도 포함됨
        // 법정공휴일만 인식하도록 비공식 기념일 이름 필터 적용
        const NON_OFFICIAL = /어버이날|스승의날|식목일|제헌절|납세자의날|정보보호의날|소방의날/;
        const filterOfficial = (items: { date: string; name: string }[]) =>
          items.filter(e => !NON_OFFICIAL.test(e.name)).map(e => e.date);

        // Firebase에서 올해 데이터 확인
        const snap = await new Promise<any>(resolve =>
          onValue(ref(db, `shared/krHolidays/${thisYear}`), resolve, { onlyOnce: true })
        );
        if (snap.exists()) {
          const raw: string[] = Object.values(snap.val());
          // Firebase 캐시에 기념일이 섞여 있을 수 있으므로 날짜 기반 필터도 적용
          // MM-DD가 알려진 비공식 기념일인 날짜는 제외
          const NON_OFFICIAL_MONTH_DAYS = new Set(['05-08','05-15','04-05','07-17']);
          const filtered = raw.filter(d => !NON_OFFICIAL_MONTH_DAYS.has(d.slice(5)));
          set({ krHolidays: new Set(filtered) });
          return;
        }
        // 없으면 Google Calendar API로 fetch 후 Firebase에 저장
        const calId = encodeURIComponent('ko.south_korea#holiday@group.v.calendar.google.com');
        const timeMin = encodeURIComponent(new Date(thisYear, 0, 1).toISOString());
        const timeMax = encodeURIComponent(new Date(thisYear, 11, 31, 23, 59, 59).toISOString());
        try {
          const token = await getAccessToken();
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&maxResults=100`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!res.ok) throw new Error(`Calendar API error: ${res.status}`);
          const data = await res.json();
          const items: { date: string; name: string }[] = [];
          for (const item of data.items ?? []) {
            const d: string | undefined = item.start?.date ?? item.start?.dateTime?.slice(0, 10);
            if (d) items.push({ date: d, name: String(item.summary || '') });
          }
          const dates = filterOfficial(items);
          // Firebase에 저장 (배열을 객체로: {0: date, 1: date, ...})
          await dbSet(ref(db, `shared/krHolidays/${thisYear}`), Object.fromEntries(dates.map((d, i) => [i, d])));
          set({ krHolidays: new Set(dates) });
        } catch (e) {
          console.warn('공휴일 데이터 fetch 실패:', e);
        }
      },

      subscribeToFirestore: () => {
        const unsubTasks = onValue(ref(db, 'shared/tasks'), (snap) => {
          const rawItems = snap.val()?.items;
          if (rawItems) {
            // Firebase may convert arrays to objects with numeric keys — normalize back
            const items: RecurringTask[] = Array.isArray(rawItems) ? rawItems : Object.values(rawItems);
            set({ tasks: items });
          } else {
            // Firebase에 데이터 없음 — localStorage에서 마이그레이션
            const fromStore = get().tasks;
            let local: RecurringTask[] = fromStore.length > 0 ? fromStore : [];
            if (local.length === 0) {
              try {
                const raw = localStorage.getItem('axiom-storage');
                if (raw) local = (JSON.parse(raw)?.state?.tasks as RecurringTask[]) || [];
              } catch {}
            }
            if (local.length > 0) {
              dbSet(ref(db, 'shared/tasks'), { items: local, lastReset: todayKST() });
              set({ tasks: local });
            }
          }
        });
        const unsubStatus = onValue(ref(db, 'shared/statusMessages'), (snap) => {
          if (snap.exists()) set({ statusMessages: snap.val().messages || {} });
        });

        const emptyFormat = { chipInput: '', chipBarcodes: {} as Record<string, string>, finishTime: '', reExperimentChips: {} as Record<string, boolean>, chipsRegistered: false };
        const toFormat = (v: any) => ({
          chipInput: v?.chipInput || '',
          chipBarcodes: (v?.chipBarcodes && typeof v.chipBarcodes === 'object') ? v.chipBarcodes : {},
          finishTime: v?.finishTime || '',
          reExperimentChips: (v?.reExperimentChips && typeof v.reExperimentChips === 'object') ? v.reExperimentChips : {},
          chipsRegistered: v?.chipsRegistered || false,
        });
        const unsubDay1 = onValue(ref(db, 'shared/day1'), (snap) => {
          
          const val = snap.val();
          if (!val) return;
          if (val.lastReset !== todayStr) {
            const reset = { lastReset: todayStr, '384': emptyFormat, '96': emptyFormat };
            dbSet(ref(db, 'shared/day1'), reset);
            set({ day1Data: { '384': { ...emptyFormat }, '96': { ...emptyFormat } } });
          } else {
            set({
              day1Data: {
                '384': toFormat(val['384']),
                '96':  toFormat(val['96']),
              },
            });
          }
        });

        const emptySchedule = { hybTimes: {}, hybDone: {}, spindownDone: {}, spindownSaved: {} };
        const unsubSchedule = onValue(ref(db, 'shared/scheduleState'), (snap) => {

          const val = snap.val();
          if (!val) return;
          if (val.lastReset !== todayStr) {
            dbSet(ref(db, 'shared/scheduleState'), { lastReset: todayStr, ...emptySchedule });
            set({ scheduleState: { ...get().scheduleState, ...emptySchedule } });
          } else {
            set({
              scheduleState: {
                hybTimes:      val.hybTimes      || {},
                hybDone:       val.hybDone       || {},
                spindownDone:  val.spindownDone  || {},
                spindownSaved: val.spindownSaved || {},
                washStartTimes: get().scheduleState.washStartTimes,
              },
            });
          }
        });

        // washStartTimes는 scheduleState와 별도 경로로 관리 (다른 write에 의해 덮어쓰이지 않도록)
        const unsubWashTimes = onValue(ref(db, 'shared/washStartTimes'), (snap) => {
          const val = snap.val();
          const times: Record<string, string> = {};
          if (val) Object.entries(val).forEach(([k, v]) => { if (typeof v === 'string') times[k] = v; });
          set({ scheduleState: { ...get().scheduleState, washStartTimes: times } });
        });

        const emptyPhotos: DailyPhotos = { dna: [], pellet: [] };
        const unsubPhotos = onValue(ref(db, 'shared/dailyPhotos'), (snap) => {
          
          const val = snap.val();
          if (!val) return;
          if (val.lastReset !== todayStr) {
            dbSet(ref(db, 'shared/dailyPhotos'), { lastReset: todayStr, ...emptyPhotos });
            set({ dailyPhotos: { ...emptyPhotos } });
          } else {
            const dna = val.dna ? (Array.isArray(val.dna) ? val.dna : Object.values(val.dna)) : [];
            const pellet = val.pellet ? (Array.isArray(val.pellet) ? val.pellet : Object.values(val.pellet)) : [];
            set({ dailyPhotos: { dna, pellet } });
          }
        });

        const unsubReExp = onValue(ref(db, 'shared/reExperimentTracking'), (snap) => {
          if (snap.exists()) set({ reExperimentTracking: snap.val() || {} });
        });

        const unsubReagentLog = onValue(ref(db, 'shared/reagentCheckState'), (snap) => {
          const val = snap.val();
          if (!val) return;
          if (val.lastReset !== todayStr) {
            // 로컬 상태만 초기화 — Firebase에 쓰지 않음
            // IndexedDB 캐시가 오래된 값을 먼저 발화할 때 오늘의 서버 데이터를 덮어쓰는 race condition 방지
            set({ reagentCheckState: {} });
          } else {
            set({ reagentCheckState: val.logs || {} });
          }
        });

        const unsubChipImages = onValue(ref(db, 'shared/chipImageIssues'), (snap) => {
          if (snap.exists()) {
            const val = snap.val();
            set({ chipImageIssues: Array.isArray(val) ? val : [] });
          }
        });

        const DEFAULT_MEMBERS: TeamMember[] = [
          { name: '박근모', emoji: '🐻' },
          { name: '원미나', emoji: '🐱' },
        ];

        const unsubTeamMembers = onValue(ref(db, 'shared/teamMembers'), (snap) => {
          const parseItems = (val: any): TeamMember[] => {
            if (Array.isArray(val)) return val;
            if (val && typeof val === 'object' && val.items) {
              return Array.isArray(val.items) ? val.items : Object.values(val.items);
            }
            return [];
          };

          let items: TeamMember[] = snap.exists() ? parseItems(snap.val()) : [];

          // Ensure all default members exist (merge — don't remove extras)
          let changed = false;
          DEFAULT_MEMBERS.forEach(def => {
            if (!items.some(m => m.name === def.name)) {
              items = [...items, def];
              changed = true;
            }
          });

          // Sort to match default order: 박근모, 원미나, then others
          const order = DEFAULT_MEMBERS.map(m => m.name);
          items = [
            ...order.map(name => items.find(m => m.name === name)!).filter(Boolean),
            ...items.filter(m => !order.includes(m.name)),
          ];

          set({ teamMembers: items });
        });

        const unsubScheduledTasks = onValue(ref(db, 'shared/scheduledTasks'), (snap) => {
          const val = snap.val();
          if (val && typeof val === 'object') {
            // { _k: true, items: {...} } 신형 또는 구형 배열 형식 모두 처리
            const raw = val._k !== undefined
              ? (val.items ? (Array.isArray(val.items) ? val.items : Object.values(val.items)) : [])
              : (Array.isArray(val) ? val : Object.values(val));
            const arr: ScheduledTaskDef[] = (raw as any[]).map((t: any) => {
              const rawHistory = Array.isArray(t.doneHistory) ? t.doneHistory : (t.doneHistory ? Object.values(t.doneHistory) : []);
              const doneHistory = rawHistory.map((e: any) => typeof e === 'string' ? { date: e } : e);
              return { ...t, doneHistory };
            });
            set({ scheduledTasks: arr });
          } else {
            // Firebase에 데이터 없음 — localStorage에서 마이그레이션
            const fromStore = get().scheduledTasks;
            let local: ScheduledTaskDef[] = fromStore.length > 0 ? fromStore : [];
            if (local.length === 0) {
              try {
                const raw = localStorage.getItem('axiom-storage');
                if (raw) local = (JSON.parse(raw)?.state?.scheduledTasks as ScheduledTaskDef[]) || [];
              } catch {}
            }
            if (local.length > 0) {
              dbSet(ref(db, 'shared/scheduledTasks'), { _k: true, items: local });
              set({ scheduledTasks: local });
            }
          }
        });

        const unsubCalendarEvents = onValue(ref(db, 'shared/calendarEvents'), (snap) => {
          const val = snap.val();
          if (val && typeof val === 'object') {
            // { _k: true, items: {...} } 신형 또는 구형 배열 형식 모두 처리
            const raw = val._k !== undefined
              ? (val.items ? (Array.isArray(val.items) ? val.items : Object.values(val.items)) : [])
              : (Array.isArray(val) ? val : Object.values(val));
            set({ calendarEvents: raw as CalendarEvent[] });
          } else {
            set({ calendarEvents: [] });
          }
        });

        const unsubPresence = onValue(ref(db, 'shared/presence'), (snap) => {
          if (snap.exists()) {
            const val = snap.val() as Record<string, { name: string; photoUrl: string; connectedAt: number }>;
            const users = Object.entries(val).map(([sessionId, u]) => ({ sessionId, ...u }));
            set({ onlineUsers: users });
          } else {
            set({ onlineUsers: [] });
          }
        });

        const unsubReagentLotSaved = onValue(ref(db, 'shared/reagentLotSaved'), (snap) => {
          const val = snap.val();
          if (!val) return;
          if (val.lastReset !== todayStr) {
            set({ reagentLotSaved: {} });
          } else {
            set({ reagentLotSaved: val.saved || {} });
          }
        });

        return () => { unsubTasks(); unsubStatus(); unsubDay1(); unsubSchedule(); unsubWashTimes(); unsubPhotos(); unsubReExp(); unsubReagentLog(); unsubChipImages(); unsubTeamMembers(); unsubScheduledTasks(); unsubPresence(); unsubReagentLotSaved(); };
      },

      isLoading: false,
      lastSync: null,
      syncError: null,

      recordDay1: async (type, chips, finishTime) => {
        set({ isLoading: true });
        try {
          // 1. 현재 동기화된 데이터에서 오늘 날짜에 해당하는 열 찾기
          const schedule = get().scheduleData as any;
          const currentSheet = schedule?.current;
          if (!currentSheet) throw new Error("현재 시트 정보가 없습니다. 먼저 동기화해주세요.");

          const row1 = currentSheet.values[0] || [];
          const now = new Date();
          now.setHours(0, 0, 0, 0);

          const targetColBases = [1, 5, 9, 13, 17, 21]; // B, F, J, N, R, V
          let colIdx = -1;

          for (const base of targetColBases) {
            const d = parseSheetDate(row1[base]);
            if (d && !isNaN(d.getTime())) {
              d.setHours(0, 0, 0, 0);
              if (d.getTime() === now.getTime()) {
                colIdx = (type === '96') ? base : base + 1;
                break;
              }
            }
          }

          if (colIdx === -1) {
            throw new Error("오늘 날짜에 해당하는 스케줄 컬럼을 찾을 수 없습니다.");
          }

          const token = await getAccessToken();
          const sheetName = currentSheet.sheetName;
          const updates: { range: string; values: any[][] }[] = [
            { range: cellRef(sheetName, 16, colIdx + 1), values: [[chips.trim()]] },
          ];
          if (finishTime) {
            updates.push({ range: cellRef(sheetName, 17, colIdx + 1), values: [[finishTime]] });
          }
          await sheetsBatchUpdate(SCHEDULE_SPREADSHEET_ID, updates, token);

          // 재실험 칩 Firebase tracking 등록 (registerChips 호출 여부와 무관하게 항상 처리)
          const { reExperimentChips } = get().day1Data[type];
          const parsedChips = parseChipString(chips);
          const reExpChipList = parsedChips.filter(c => reExperimentChips[c]);
          if (reExpChipList.length > 0) {
            const addedDate = new Date().toISOString().split('T')[0];
            const current = get().reExperimentTracking;
            const updated = { ...current };
            reExpChipList.forEach(chip => {
              if (!updated[chip]) {
                updated[chip] = {
                  chipId: chip,
                  addedDate,
                  steps: { 'Day 1': true, 'Day 2': false, 'Hyb': false, 'Wash': false, 'Scan': false },
                };
              }
            });
            set({ reExperimentTracking: updated });
            dbSet(ref(db, 'shared/reExperimentTracking'), updated);
          }

          await get().syncWithSheets();
        } catch (e: any) {
          console.error(e);
          throw e; // 상위 컴포넌트(ScheduleView)에서 처리
        } finally {
          set({ isLoading: false });
        }
      },

      fetchDay1FinishFromSheet: async () => {
        const schedule = get().scheduleData as any;
        const currentSheet = schedule?.current;
        if (!currentSheet) throw new Error("먼저 동기화해주세요.");
        const row1 = currentSheet.values[0] || [];
        const now = new Date(); now.setHours(0, 0, 0, 0);
        let colIdx = -1;
        for (const base of [1, 5, 9, 13, 17, 21]) {
          const d = parseSheetDate(row1[base]);
          if (d && !isNaN(d.getTime())) { d.setHours(0, 0, 0, 0); if (d.getTime() === now.getTime()) { colIdx = base; break; } }
        }
        if (colIdx === -1) throw new Error("오늘 날짜 컬럼을 찾을 수 없습니다.");
        const row17 = currentSheet.values[16] || [];
        const parseT = (v: any): string => {
          if (!v && v !== 0) return '';
          if (typeof v === 'number') { const m = Math.round(v * 24 * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
          if (typeof v === 'string' && /^\d{1,2}:\d{2}/.test(v.trim())) return v.trim().substring(0, 5);
          return '';
        };
        const ft96 = parseT(row17[colIdx]);
        const ft384 = parseT(row17[colIdx + 1]);
        if (ft96)  get().updateDay1('96',  { finishTime: ft96 });
        if (ft384) get().updateDay1('384', { finishTime: ft384 });
        if (!ft96 && !ft384) throw new Error("시트에 완료 시각이 없습니다.");
      },

      fetchBarcodesFromChipInfo: async (format: '96' | '384', cacheOnly = false) => {
        const { chipInput } = get().day1Data[format];
        const chips = parseChipString(chipInput);
        if (chips.length === 0) throw new Error('#p를 먼저 입력해주세요.');

        const found: Record<string, string> = {};

        // 캐시(chipInfoRows)에서 먼저 조회 — Start date(Day 1) = 오늘인 항목만 사용
        const cached = get().chipInfoRows;
        const todayForBarcode = todayKST();
        for (const chip of chips) {
          const row = cached.find(r => {
            if (r.plateId.trim().toLowerCase() !== chip.toLowerCase()) return false;
            if (!r.barcode) return false;
            const day1Step = r.steps.find(s => s.label === 'Day 1');
            if (day1Step) return day1Step.date === todayForBarcode;
            return true; // Start date 컬럼 없으면 허용
          });
          if (row?.barcode) found[chip] = row.barcode;
        }

        // cacheOnly=true(자동 조회)일 때는 API 호출 없이 종료
        // → 백그라운드 타이머에서 getAccessToken()을 호출하면 사용자가 저장 시
        //   GIS 토큰 요청과 충돌하여 403이 발생할 수 있음
        if (!cacheOnly) {
          const missing = chips.filter(c => !found[c]);
          if (missing.length > 0) {
            const token = await getAccessToken();
            const res = await sheetsGetValues(SCHEDULE_SPREADSHEET_ID, "'Chip info'!A:Z", token);
            const values: any[][] = res.values || [];
            if (values.length > 1) {
              const headers = values[0].map((h: any) => String(h).trim());
              const pCol = headers.indexOf('#p');
              const barcodeCol = headers.findIndex(h => /^chip\s*barcode$/i.test(h));
              const startDateCol = headers.findIndex(h => /^start\s*date$/i.test(h));
              if (pCol >= 0 && barcodeCol >= 0) {
                for (const chip of missing) {
                  for (let i = values.length - 1; i >= 1; i--) {
                    const row = values[i];
                    if (String(row[pCol] || '').trim().toLowerCase() !== chip.toLowerCase()) continue;
                    const barcode = String(row[barcodeCol] || '').trim();
                    if (!barcode) continue;
                    // Start date 필터: Chip info에서 #p가 중복될 수 있으므로 오늘 날짜와 일치해야 함
                    if (startDateCol >= 0) {
                      const rawDate = row[startDateCol];
                      if (rawDate !== undefined && rawDate !== null && rawDate !== '') {
                        const rowDate = parseSheetDate(rawDate);
                        if (rowDate) {
                          const rowDateStr = `${rowDate.getFullYear()}-${String(rowDate.getMonth()+1).padStart(2,'0')}-${String(rowDate.getDate()).padStart(2,'0')}`;
                          if (rowDateStr !== todayForBarcode) continue;
                        }
                      }
                    }
                    found[chip] = barcode;
                    break;
                  }
                }
              }
            }
          }
        }

        if (Object.keys(found).length === 0) throw new Error('시트에서 바코드를 찾을 수 없습니다.');
        get().updateDay1(format, { chipBarcodes: { ...get().day1Data[format].chipBarcodes, ...found } });
      },

      deleteDay1: async (type: '96' | '384') => {
        set({ isLoading: true });
        try {
          const schedule = get().scheduleData as any;
          const currentSheet = schedule?.current;
          if (!currentSheet) throw new Error("현재 시트 정보가 없습니다.");

          const row1 = currentSheet.values[0] || [];
          const now = new Date();
          now.setHours(0, 0, 0, 0);

          const targetColBases = [1, 5, 9, 13, 17, 21];
          let colIdx = -1;

          for (const base of targetColBases) {
            const d = parseSheetDate(row1[base]);
            if (d && !isNaN(d.getTime())) {
              d.setHours(0, 0, 0, 0);
              if (d.getTime() === now.getTime()) {
                colIdx = (type === '96') ? base : base + 1;
                break;
              }
            }
          }

          if (colIdx === -1) throw new Error("스케줄 열을 찾을 수 없습니다.");

          const token = await getAccessToken();
          const sheetName = currentSheet.sheetName;
          await sheetsClear(SCHEDULE_SPREADSHEET_ID, cellRef(sheetName, 16, colIdx + 1), token);
          await sheetsClear(SCHEDULE_SPREADSHEET_ID, cellRef(sheetName, 17, colIdx + 1), token);
          await get().syncWithSheets();
        } catch (e: any) {
          console.error(e);
          throw e;
        } finally {
          set({ isLoading: false });
        }
      },

      syncWithSheets: async () => {
        set({ isLoading: true });
        try {
          const token = await getAccessToken();
          const tables = await syncSheetsData(SCHEDULE_SPREADSHEET_ID, token);

          // 1. 공지사항(공유사항) 파싱
          const noticeSheet = (Object.values(tables) as any[]).flat().find((s: any) => s.sheetName === 'Notice');
          if (noticeSheet) {
            const rows = noticeSheet.values.slice(1);
            const toDateStr = (v: any) => {
              if (!v) return undefined;
              const d = parseSheetDate(v);
              return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : undefined;
            };
            const mappedAnnouncements: Announcement[] = rows
              .filter((row: any[]) => row[1])
              .map((row: any[], idx: number) => ({
                id: `sheet-ann-${idx}`,
                date: toDateStr(row[0]) || new Date().toISOString().split('T')[0],
                content: row[1],
                author: row[2] || "알 수 없음",
                remindDate: toDateStr(row[3]),
              }));
            set({ announcements: mappedAnnouncements });
          }

          // 2. 샘플 수 계산 (주간/월간/연간 차트)
          let weeklyTotal = 0;
          let monthlyTotal = 0;
          const monthMap: Record<string, number> = {};
          const now = new Date();
          const currentWeekData: any[] = [];
          const days = ["일", "월", "화", "수", "목", "금", "토"];

          // CURRENT 시트 이번 주 상세 분석 및 배치 추출
          const currentISOWeek = getISOWeekString(now);
          if (tables.CURRENT?.[0]) {
            const values = tables.CURRENT[0].values;
            const row1 = values[0] || [];
            const row16 = values[15] || [];

            [1, 5, 9, 13, 17, 21].forEach(colIdx => {
              const dateRaw = row1[colIdx];
              if (!dateRaw && dateRaw !== 0) return;
              const d = parseSheetDate(dateRaw);
              if (!d || isNaN(d.getTime())) return;
              const normalizedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

              const dayName = days[d.getDay()];
              const chip96Str = String(row16[colIdx] || "");
              const chip384Str = String(row16[colIdx + 1] || "");

              const chips96 = parseChipString(chip96Str);
              const chips384 = parseChipString(chip384Str);
              const allChips = [...chips96, ...chips384];

              const stats = categorizeChips(allChips);
              const sampleCount = calculateSamples(allChips, true); // reExp 제외

              // 이번 ISO 주에 해당하는 날짜만 weeklyTotal에 합산
              if (getISOWeekString(d) === currentISOWeek) {
                weeklyTotal += sampleCount;
              }

              currentWeekData.push({
                date: normalizedDate,
                day: dayName,
                ...stats,
                chips96: chip96Str,
                chips384: chip384Str
              });
            });
          }

          // 오늘 배치 추출 (Reagent View용) 및 프로그레스 타겟 계산
          const todayBatchInfo: Record<string, string> = {};
          let todayTargets = { day1_96: false, day1_384: false, day2: false, hyb: false, wash: false };
          const today = new Date();
          const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

          // 혹시 어제 밤 늦게 작업할 경우를 위해 날짜 검색 시 앞뒤 공백 제거
          const todayIdx = currentWeekData.findIndex(d => d.date.trim() === todayStr);

          if (todayIdx !== -1) {
            const todayData = currentWeekData[todayIdx];
            todayBatchInfo['Day 1 (96)'] = todayData.chips96;
            todayBatchInfo['Day 1 (384)'] = todayData.chips384;

            // Schedule 탭 day1Data 동기화: Firebase가 비어있고 시트에 값이 있으면 채움
            const cur1Data = get().day1Data;
            if (tables.CURRENT?.[0]?.values) {
              const syncValues = tables.CURRENT[0].values;
              const syncColBases = [1, 5, 9, 13, 17, 21];
              let syncColIdx = -1;
              for (const base of syncColBases) {
                const d = parseSheetDate((syncValues[0] || [])[base]);
                if (d && !isNaN(d.getTime())) {
                  d.setHours(0, 0, 0, 0);
                  const today2 = new Date(); today2.setHours(0, 0, 0, 0);
                  if (d.getTime() === today2.getTime()) { syncColIdx = base; break; }
                }
              }
              if (syncColIdx !== -1) {
                const row17 = syncValues[16] || [];
                const parseTimeCell2 = (v: any): string | null => {
                  if (v === undefined || v === null || v === '') return null;
                  if (typeof v === 'number') {
                    const totalMin = Math.round(v * 24 * 60);
                    const h = Math.floor(totalMin / 60) % 24;
                    const m = totalMin % 60;
                    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                  }
                  if (typeof v === 'string' && /^\d{1,2}:\d{2}/.test(v.trim())) return v.trim().substring(0, 5);
                  return null;
                };
                const ft96  = parseTimeCell2(row17[syncColIdx])     || '';
                const ft384 = parseTimeCell2(row17[syncColIdx + 1]) || '';
                (['96', '384'] as const).forEach(fmt => {
                  const sheetVal    = fmt === '96' ? todayData.chips96 : todayData.chips384;
                  const sheetFinish = fmt === '96' ? ft96 : ft384;
                  const patch: Partial<typeof cur1Data['96']> = {};
                  if (sheetVal   && !cur1Data[fmt].chipInput)  patch.chipInput  = sheetVal;
                  if (sheetFinish && !cur1Data[fmt].finishTime) patch.finishTime = sheetFinish;
                  if (Object.keys(patch).length > 0) get().updateDay1(fmt, patch);
                });
              } else {
                (['96', '384'] as const).forEach(fmt => {
                  const sheetVal = fmt === '96' ? todayData.chips96 : todayData.chips384;
                  if (sheetVal && !cur1Data[fmt].chipInput) get().updateDay1(fmt, { chipInput: sheetVal });
                });
              }
            } else {
              (['96', '384'] as const).forEach(fmt => {
                const sheetVal = fmt === '96' ? todayData.chips96 : todayData.chips384;
                if (sheetVal && !cur1Data[fmt].chipInput) get().updateDay1(fmt, { chipInput: sheetVal });
              });
            }

            // Day 2는 전 단계(보통 전날) 배치 — 96/384 분리 저장
            const prevIdx = todayIdx > 0 ? todayIdx - 1 : -1;
            if (prevIdx !== -1) {
              const prevData = currentWeekData[prevIdx];
              todayBatchInfo['Day 2_AM (96)']  = prevData.chips96  || '';
              todayBatchInfo['Day 2_AM (384)'] = prevData.chips384 || '';
              todayBatchInfo['Day 2_PM (96)']  = prevData.chips96  || '';
              todayBatchInfo['Day 2_PM (384)'] = prevData.chips384 || '';
              todayBatchInfo['Ligation Enzyme'] = [prevData.chips96, prevData.chips384].filter(Boolean).join(', ');
              todayBatchInfo['Wash RGT'] = [prevData.chips96, prevData.chips384].filter(Boolean).join(', ');
            }

            // 오늘 일정(Lab Progress) 분석
            if (tables.CURRENT?.[0]?.values) {
              const values = tables.CURRENT[0].values;
              const colIdx = [1, 5, 9, 13, 17, 21][todayIdx];
              console.log('[Schedule] todayIdx:', todayIdx, 'colIdx:', colIdx, 'total rows:', values.length);

              // 96/384 구분: currentWeekData의 row16에서 known set 구성
              const knownAll96 = new Set<string>();
              const knownAll384 = new Set<string>();
              currentWeekData.forEach(d => {
                parseChipString(d.chips96 || '').forEach(c => knownAll96.add(c));
                parseChipString(d.chips384 || '').forEach(c => knownAll384.add(c));
              });
              const splitChipsSafe = (all: string[]): { chips96: string[]; chips384: string[]; chipCols: Record<string, number> } => {
                const chips96: string[] = [], chips384: string[] = [];
                all.forEach(c => { if (knownAll384.has(c)) chips384.push(c); else chips96.push(c); });
                return { chips96, chips384, chipCols: {} };
              };
              const row16 = values[15] || [];
              
              todayTargets.day1_96 = String(row16[colIdx] || "").trim() !== "";
              todayTargets.day1_384 = String(row16[colIdx + 1] || "").trim() !== "";
              todayTargets.day2 = String(row16[colIdx + 2] || "").trim() !== "" || String(row16[colIdx + 3] || "").trim() !== "";
              
              // Hyb는 3, 7, 11 (인덱스 2, 6, 10)
              todayTargets.hyb = [2, 6, 10].some(r => {
                const row = values[r] || [];
                return [colIdx, colIdx+1, colIdx+2, colIdx+3].some(c => String(row[c] || "").trim() !== "");
              });
              
              // Wash는 5, 9, 13 (인덱스 4, 8, 12)
              todayTargets.wash = [4, 8, 12].some(r => {
                const row = values[r] || [];
                return [colIdx, colIdx+1, colIdx+2, colIdx+3].some(c => String(row[c] || "").trim() !== "");
              });

              // todayScheduleSummary 계산
              const SLOT_EMOJIS = ['🌅', '🌞', '🌙'];

              // Hyb/Wash 행은 96/384가 컬럼으로 분리되지 않으므로 prefix로 분류
              // A로 시작 → 384, 그 외(P/X/M) → 96
              const classifyByPrefix = (all: string[]) => {
                const chips96: string[] = [], chips384: string[] = [];
                all.forEach(c => { if (c.toUpperCase().startsWith('A')) chips384.push(c); else chips96.push(c); });
                return { chips96, chips384 };
              };

              const hybSlots: { emoji: string; chips96: string[]; chips384: string[]; chipCols: Record<string, number> }[] = [];
              [2, 6, 10].forEach((rowIdx, i) => {
                const row = values[rowIdx] || [];
                const all = parseChipString(
                  [colIdx, colIdx+1, colIdx+2, colIdx+3]
                    .map(c => String(row[c] || '').trim()).filter(Boolean).join(', ')
                );
                if (all.length > 0) {
                  const { chips96, chips384 } = classifyByPrefix(all);
                  hybSlots.push({ emoji: SLOT_EMOJIS[i], chips96, chips384, chipCols: {} });
                }
              });
              const washSlots: { emoji: string; chips96: string[]; chips384: string[] }[] = [];
              [4, 8, 12].forEach((rowIdx, i) => {
                const row = values[rowIdx] || [];
                const all = parseChipString(
                  [colIdx, colIdx+1, colIdx+2, colIdx+3]
                    .map(c => String(row[c] || '').trim()).filter(Boolean).join(', ')
                );
                if (all.length > 0) {
                  const { chips96, chips384 } = classifyByPrefix(all);
                  washSlots.push({ emoji: SLOT_EMOJIS[i], chips96, chips384 });
                }
              });

              // 시트에서 Wash 시작 시각 자동 로드 (rows 6, 10, 14 = indices 5, 9, 13)
              // wash 시각은 colIdx부터 colIdx+4 범위의 컬럼 중 처음 발견되는 시각 값 사용
              const parseTimeCell = (v: any): string | null => {
                if (v === undefined || v === null || v === '') return null;
                if (typeof v === 'number') {
                  const totalMin = Math.round(v * 24 * 60);
                  const h = Math.floor(totalMin / 60) % 24;
                  const m = totalMin % 60;
                  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                }
                if (typeof v === 'string' && /^\d{1,2}:\d{2}/.test(v.trim())) {
                  return v.trim().substring(0, 5);
                }
                return null;
              };
              const sheetWashTimes: Record<string, string> = {};
              [5, 9, 13].forEach((rowIdx, i) => {
                const row = values[rowIdx] || [];
                console.log(`[Wash] row${rowIdx+1} colIdx=${colIdx}, raw cells:`, row.slice(colIdx, colIdx + 8).map((v: any) => `[${typeof v}]${v}`));
                // colIdx부터 colIdx+5 범위에서 첫 번째 유효 시각 탐색
                for (let c = colIdx; c <= colIdx + 5; c++) {
                  const t = parseTimeCell(row[c]);
                  if (t) { sheetWashTimes[SLOT_EMOJIS[i]] = t; break; }
                }
              });
              console.log('[Wash] sheetWashTimes:', sheetWashTimes);
              
              // 시트에서 Hyb 시작 시각 자동 로드 (rows 4, 8, 12 = indices 3, 7, 11)
              const sheetHybTimes: Record<string, Record<string, string>> = { ...get().scheduleState.hybTimes };
              [3, 7, 11].forEach((rowIdx, i) => {
                const emoji = SLOT_EMOJIS[i];
                const chipRow = values[rowIdx - 1] || []; // 칩 이름이 적힌 행
                const timeRow = values[rowIdx] || [];     // 시각이 적힌 행
                
                if (!sheetHybTimes[emoji]) sheetHybTimes[emoji] = {};

                // 오늘 날짜 4개 컬럼(colIdx ~ colIdx+3) 순회
                for (let c = colIdx; c <= colIdx + 3; c++) {
                  const t = parseTimeCell(timeRow[c]);
                  const chipVal = String(chipRow[c] || '').trim();
                  if (t && chipVal) {
                    const chipsInCell = parseChipString(chipVal);
                    chipsInCell.forEach(chip => {
                      // 이미 앱 상태에 값이 있더라도 시트 값을 우선(또는 업데이트)
                      sheetHybTimes[emoji][chip] = t;
                    });
                  }
                }
              });

              if (Object.keys(sheetWashTimes).length > 0) {
                // washStartTimes는 별도 Firebase 경로로 저장 (scheduleState와 독립)
                const newWashTimes = { ...get().scheduleState.washStartTimes, ...sheetWashTimes };
                set({ scheduleState: { ...get().scheduleState, washStartTimes: newWashTimes } });
                dbSet(ref(db, 'shared/washStartTimes'), newWashTimes);
              }
              if (Object.keys(sheetHybTimes).length > 0) {
                get().updateScheduleState({ hybTimes: sheetHybTimes });
              }

              // oggi (오늘) Spindown 기록 상태 로드 (Chip info에서)
              try {
                const ciRes = tables['Chip info']?.[0] || await sheetsGetValues(SCHEDULE_SPREADSHEET_ID, "'Chip info'!A:Z", token);
                const ciValues: any[][] = ciRes.values || [];
                if (ciValues.length > 1) {
                  const ciHeaders = ciValues[0].map((h: any) => String(h).trim().toLowerCase());
                  const cP = ciHeaders.indexOf('#p');
                  const cHybDate = ciHeaders.findIndex(h => h.includes('hyb') && h.includes('date'));
                  const cIssue = ciHeaders.findIndex(h => h.includes('issue') || h.includes('이슈'));
                  
                  if (cP >= 0 && cHybDate >= 0 && cIssue >= 0) {
                    const statusUpdate: Record<string, Record<string, boolean>> = { ...get().scheduleState.hybDone };
                    const savedUpdate: Record<string, boolean> = { ...get().scheduleState.spindownSaved };
                    const NOTE = 'Hyb 후 spindown';
                    const todayStr2 = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                    const todayNum = todayStr2.replace(/\D/g, '');

                    ciValues.slice(1).forEach(row => {
                      const rawDate = row[cHybDate];
                      if (!rawDate) return;
                      const d = parseSheetDate(rawDate);
                      const dStr = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(rawDate);
                      if (dStr.replace(/\D/g, '') === todayNum) {
                        const chip = String(row[cP] || '').trim();
                        const issue = String(row[cIssue] || '');
                        if (chip && issue.includes(NOTE)) {
                          savedUpdate[chip] = true;
                          // 모든 슬롯을 순회하여 해당 칩이 있다면 체크 상태로 표시
                          SLOT_EMOJIS.forEach(emoji => {
                            if (!statusUpdate[emoji]) statusUpdate[emoji] = {};
                            statusUpdate[emoji][chip] = true;
                          });
                        }
                      }
                    });
                    get().updateScheduleState({ hybDone: statusUpdate, spindownSaved: savedUpdate });
                  }
                }
              } catch (e) { console.warn('[Sync] Spindown 로드 실패:', e); }

              const prevIdx2 = todayIdx > 0 ? todayIdx - 1 : -1;
              let day2Chips96: string[] = [];
              let day2Chips384: string[] = [];
              let prevFinishTime96 = '';
              let prevFinishTime384 = '';
              if (prevIdx2 !== -1) {
                const prev = currentWeekData[prevIdx2];
                day2Chips96  = parseChipString(prev.chips96  || '');
                day2Chips384 = parseChipString(prev.chips384 || '');
                // 어제 Day 1 완료 시각 (row17, 어제 colIdx)
                const prevColIdx = [1, 5, 9, 13, 17, 21][prevIdx2];
                const row17 = values[16] || [];
                prevFinishTime96  = parseTimeCell(row17[prevColIdx])     || '';
                prevFinishTime384 = parseTimeCell(row17[prevColIdx + 1]) || '';
              }
              set({ todayScheduleSummary: { day2Chips96, day2Chips384, prevFinishTime96, prevFinishTime384, hyb: hybSlots, wash: washSlots } });

              // 내일 스케줄 계산
              const tmrIdx = todayIdx + 1;
              if (tmrIdx < currentWeekData.length) {
                const tmrColIdx = [1, 5, 9, 13, 17, 21][tmrIdx];
                const tmrRow16 = values[15] || [];
                const tmrDay1Chips96  = parseChipString(String(tmrRow16[tmrColIdx] || ''));
                const tmrDay1Chips384 = parseChipString(String(tmrRow16[tmrColIdx + 1] || ''));
                // Day 2 for tomorrow = today's Day 1 chips
                const tmrDay2Chips96  = parseChipString(todayData.chips96 || '');
                const tmrDay2Chips384 = parseChipString(todayData.chips384 || '');

                const tmrHyb: { emoji: string; chips96: string[]; chips384: string[] }[] = [];
                [2, 6, 10].forEach((rowIdx, i) => {
                  const row = values[rowIdx] || [];
                  const all = parseChipString(
                    [tmrColIdx, tmrColIdx+1, tmrColIdx+2, tmrColIdx+3]
                      .map(c => String(row[c] || '').trim()).filter(Boolean).join(', ')
                  );
                  if (all.length > 0) {
                    const { chips96, chips384 } = classifyByPrefix(all);
                    tmrHyb.push({ emoji: SLOT_EMOJIS[i], chips96, chips384 });
                  }
                });
                const tmrWash: { emoji: string; chips96: string[]; chips384: string[] }[] = [];
                [4, 8, 12].forEach((rowIdx, i) => {
                  const row = values[rowIdx] || [];
                  const all = parseChipString(
                    [tmrColIdx, tmrColIdx+1, tmrColIdx+2, tmrColIdx+3]
                      .map(c => String(row[c] || '').trim()).filter(Boolean).join(', ')
                  );
                  if (all.length > 0) {
                    const { chips96, chips384 } = classifyByPrefix(all);
                    tmrWash.push({ emoji: SLOT_EMOJIS[i], chips96, chips384 });
                  }
                });
                set({ tomorrowScheduleSummary: { day1Chips96: tmrDay1Chips96, day1Chips384: tmrDay1Chips384, day2Chips96: tmrDay2Chips96, day2Chips384: tmrDay2Chips384, hyb: tmrHyb, wash: tmrWash, date: currentWeekData[tmrIdx].date } });
              }
            }
          }

          // 일요일/공휴일 등 시트에 없는 날: 내일(다음 평일) 스케줄 설정
          // 내일이 다음 주 월요일인 경우 UPCOMING 시트에서 찾음
          if (todayIdx === -1) {
            const tomorrow2 = new Date(today);
            tomorrow2.setDate(tomorrow2.getDate() + 1);
            const tmrStr2 = `${tomorrow2.getFullYear()}-${String(tomorrow2.getMonth() + 1).padStart(2, '0')}-${String(tomorrow2.getDate()).padStart(2, '0')}`;
            const SLOT_EMOJIS2 = ['🌅', '🌞', '🌙'];

            // 먼저 CURRENT에서 찾고, 없으면 UPCOMING에서 찾음
            let tmrSheetValues2: any[][] | null = null;
            let tmrColIdx2 = -1;
            let tmrDateStr2 = '';

            const searchInSheet = (sheetValues: any[][], sourceLabel: string) => {
              const row1 = sheetValues[0] || [];
              const colIdxList = [1, 5, 9, 13, 17, 21];
              for (let ci = 0; ci < colIdxList.length; ci++) {
                const colIdx = colIdxList[ci];
                const dateRaw = row1[colIdx];
                if (!dateRaw && dateRaw !== 0) continue;
                const d = parseSheetDate(dateRaw);
                if (!d || isNaN(d.getTime())) continue;
                const normalizedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                if (normalizedDate.trim() === tmrStr2) {
                  tmrSheetValues2 = sheetValues;
                  tmrColIdx2 = colIdx;
                  tmrDateStr2 = normalizedDate;
                  return true;
                }
              }
              return false;
            };

            if (tables.CURRENT?.[0]?.values) searchInSheet(tables.CURRENT[0].values, 'CURRENT');
            if (tmrColIdx2 === -1 && tables.UPCOMING?.[0]?.values) searchInSheet(tables.UPCOMING[0].values, 'UPCOMING');

            if (tmrSheetValues2 !== null && tmrColIdx2 !== -1) {
              const sv = tmrSheetValues2;
              // 96/384 구분: CURRENT + UPCOMING 양쪽에서 known set 구성
              const known96b = new Set<string>();
              const known384b = new Set<string>();
              currentWeekData.forEach(d => {
                parseChipString(d.chips96  || '').forEach(c => known96b.add(c));
                parseChipString(d.chips384 || '').forEach(c => known384b.add(c));
              });
              // UPCOMING 시트의 row16도 포함
              if (tables.UPCOMING?.[0]?.values) {
                const upRow16 = tables.UPCOMING[0].values[15] || [];
                [1, 5, 9, 13, 17, 21].forEach(ci => {
                  parseChipString(String(upRow16[ci] || '')).forEach(c => known96b.add(c));
                  parseChipString(String(upRow16[ci + 1] || '')).forEach(c => known384b.add(c));
                });
              }
              const splitSafe2 = (all: string[]) => {
                const c96: string[] = [], c384: string[] = [];
                all.forEach(c => { if (known384b.has(c)) c384.push(c); else c96.push(c); });
                return { chips96: c96, chips384: c384 };
              };
              const tmrRow16b = sv[15] || [];
              const tmrDay1Chips96b = parseChipString(String(tmrRow16b[tmrColIdx2] || ''));
              const tmrDay1Chips384b = parseChipString(String(tmrRow16b[tmrColIdx2 + 1] || ''));
              const buildSlots2 = (rowIndices: number[]) => {
                const slots: { emoji: string; chips96: string[]; chips384: string[] }[] = [];
                rowIndices.forEach((rowIdx, i) => {
                  const row = sv[rowIdx] || [];
                  const all = parseChipString(
                    [tmrColIdx2, tmrColIdx2+1, tmrColIdx2+2, tmrColIdx2+3]
                      .map(c => String(row[c] || '').trim()).filter(Boolean).join(',')
                  );
                  if (all.length > 0) {
                    const chips96: string[] = [], chips384: string[] = [];
                    all.forEach(c => { if (c.toUpperCase().startsWith('A')) chips384.push(c); else chips96.push(c); });
                    slots.push({ emoji: SLOT_EMOJIS2[i], chips96, chips384 });
                  }
                });
                return slots;
              };
              set({ tomorrowScheduleSummary: {
                day1Chips96: tmrDay1Chips96b,
                day1Chips384: tmrDay1Chips384b,
                day2Chips96: [],
                day2Chips384: [],
                hyb: buildSlots2([2, 6, 10]),
                wash: buildSlots2([4, 8, 12]),
                date: tmrDateStr2
              }});
            }
          }

          // 전 시트 월간/연간 데이터 연동 (단순 카운트)
          const allSheets = [...(tables.ARCHIVE || []), ...(tables.CURRENT || [])];
          allSheets.forEach(sheet => {
            const values = sheet.values;
            const row1 = values[0] || [];
            const row16 = values[15] || [];

            [1, 5, 9, 13, 17, 21].forEach(colIdx => {
              const dateRaw = row1[colIdx];
              if (!dateRaw) return;
              const d = parseSheetDate(dateRaw);
              if (!d) return;
              const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

              const chipsStr = (row16[colIdx] || '') + ',' + (row16[colIdx + 1] || '');
              const chips = parseChipString(chipsStr);
              const count = calculateSamples(chips, true); // reExp 제외

              if (isSameMonth(dateRaw)) monthlyTotal += count;
              if (d.getFullYear() === now.getFullYear()) {
                monthMap[monthKey] = (monthMap[monthKey] || 0) + count;
              }
            });
          });

          const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const monthlyChartData = Object.entries(monthMap)
            .filter(([month]) => month <= currentMonthKey)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, samples]) => ({ month: month.split('-')[1] + '월', samples }));

          set({
            weeklySamples: weeklyTotal,
            monthlySamples: monthlyTotal,
            monthlyChartData,
            weeklyStatsByDay: currentWeekData,
            todayBatches: todayBatchInfo
          });

          // 3. QC 미완료 (CHQ list) — Chip info 시트의 CHQ date 열 기반
          try {
            const chipInfoRes = await sheetsGetValues(SCHEDULE_SPREADSHEET_ID, "'Chip info'!A1:Z500", token);
            const chipInfoValues: any[][] = chipInfoRes.values || [];
            if (chipInfoValues.length > 1) {
              const headers: string[] = chipInfoValues[0].map((h: any) => String(h).trim());
              const col = (name: string) => headers.indexOf(name);
              const startDateCol = col('Start date');
              const barcodeCol   = col('Chip barcode');
              const pCol         = col('#p');
              const bCol         = col('#b');
              const chqDateCol   = col('CHQ date');
              const washDateCol  = col('Wash date');
              const issueCol     = [col('Issue'), col('실험 이슈'), col('이슈')].find(c => c >= 0) ?? -1;
              const deadlineCol  = [col('납기'), col('Deadline'), col('납기일')].find(c => c >= 0) ?? -1;

              const mappedCHQ: ChipQCEntry[] = chipInfoValues.slice(1)
                .filter((row: any[]) => {
                  if (!row[pCol] && !row[barcodeCol]) return false; // 빈 행 제외
                  // Wash date가 오늘 이전이어야 함
                  if (washDateCol < 0) return false;
                  const washD = parseSheetDate(row[washDateCol]);
                  if (!washD) return false;
                  washD.setHours(0, 0, 0, 0);
                  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
                  if (washD >= todayMidnight) return false;
                  // CHQ date가 비어있어야 함
                  const chqRaw = chqDateCol >= 0 ? row[chqDateCol] : '';
                  return !chqRaw || String(chqRaw).trim() === '';
                })
                .map((row: any[], idx: number) => {
                  const chqDateRaw = chqDateCol >= 0 ? row[chqDateCol] : '';
                  const isCompleted = !!(chqDateRaw && String(chqDateRaw).trim() !== '');
                  const startDateD = startDateCol >= 0 ? parseSheetDate(row[startDateCol]) : null;
                  return {
                    id: `chq-chipinfo-${idx}`,
                    isCompleted,
                    washDate: startDateD ? startDateD.toISOString().split('T')[0] : '',
                    chipBarcode: String(row[barcodeCol] || ''),
                    batchNo: String(row[bCol] || ''),
                    plateNo: String(row[pCol] || ''),
                    issue: issueCol >= 0 ? String(row[issueCol] || '') : '',
                    deadline: (() => {
                      if (deadlineCol < 0 || !row[deadlineCol]) return '';
                      const d = parseSheetDate(row[deadlineCol]);
                      if (d) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                      return String(row[deadlineCol]);
                    })(),
                  };
                });
              set({ chqList: mappedCHQ, chipQCPending: mappedCHQ.filter(i => !i.isCompleted).length });

              // Build chip info rows for Timeline view
              const STEP_COLS: { colName: string; label: string }[] = [
                { colName: 'Start date',  label: 'Day 1' },
                { colName: 'Day 2 date',  label: 'Day 2' },
                { colName: 'Hyb date',    label: 'Hyb' },
                { colName: 'Wash date',   label: 'Wash' },
                { colName: 'CHQ date',    label: 'Scan / CHQ' },
              ];
              const typeCol = [col('Chip type'), col('Chip Type'), col('Type')].find(c => c >= 0) ?? -1;
              const equipCol = [col('Scanner'), col('GTMC'), col('장비'), col('스캐너'), col('GTMC 장비')].find(c => c >= 0) ?? -1;
              const builtRows: ChipInfoRow[] = chipInfoValues.slice(1)
                .filter((row: any[]) => row[pCol])
                .map((row: any[]) => {
                  const steps = STEP_COLS
                    .map(s => {
                      const c = col(s.colName);
                      if (c < 0 || !row[c]) return null;
                      const d = parseSheetDate(row[c]);
                      if (!d) return null;
                      return { label: s.label, date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` };
                    })
                    .filter((s): s is { label: string; date: string } => s !== null);
                  return {
                    plateId: String(row[pCol] || '').trim(),
                    batchId: String(row[bCol] || '').trim(),
                    barcode: String(row[barcodeCol] || '').trim(),
                    chipType: typeCol >= 0 ? String(row[typeCol] || '').trim() : '',
                    equipment: equipCol >= 0 ? String(row[equipCol] || '').trim() : '',
                    steps,
                  };
                })
                .filter((r: ChipInfoRow) => r.plateId);
              set({ chipInfoRows: builtRows });
            }
          } catch (e) {
            // Chip info 읽기 실패 시 CHECK 시트 fallback
            if (tables.CHECK?.[0]) {
              const values = tables.CHECK[0].values;
              const mappedCHQ: ChipQCEntry[] = values.slice(1).map((row: any, idx: number) => ({
                id: `chq-${idx}`,
                isCompleted: row[0] === true || row[11] === "완료",
                washDate: (() => { const d = parseSheetDate(row[1]); return d ? d.toISOString().split('T')[0] : ''; })(),
                chipBarcode: String(row[2] || ""),
                batchNo: String(row[3] || ""),
                plateNo: String(row[4] || ""),
                issue: String(row[5] || ""),
                deadline: (() => { const d = parseSheetDate(row[6]); return d ? d.toISOString().split('T')[0] : ''; })(),
              }));
              set({ chqList: mappedCHQ, chipQCPending: mappedCHQ.filter(i => !i.isCompleted).length });
            }
          }

          // 4. 재실험 추적 자동 업데이트 (시트 기반)
          try {
            const reExpCurrent = get().reExperimentTracking;
            if (Object.keys(reExpCurrent).length > 0) {
              const nowMs = Date.now();
              const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
              const updatedReExp: typeof reExpCurrent = {};

              const fmtDate = (d: Date) =>
                `${d.getMonth() + 1}/${d.getDate()}`;
              const fmtTime = (val: any): string | null => {
                if (typeof val === 'number') {
                  const m = Math.round(val * 24 * 60);
                  const h = Math.floor(m / 60) % 24;
                  const mm = m % 60;
                  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
                }
                if (typeof val === 'string' && val.includes(':')) return val.substring(0, 5);
                return null;
              };

              // Chip info 재조회 (위 try 블록이 실패했을 수 있으므로 새로 시도)
              let ciValues: any[][] = [];
              try {
                const ciRes = await sheetsGetValues(SCHEDULE_SPREADSHEET_ID, "'Chip info'!A1:Z500", token);
                ciValues = ciRes.values || [];
              } catch { /* silent */ }
              const ciHeaders = ciValues[0]?.map((h: any) => String(h).trim()) || [];
              const ciPCol = ciHeaders.indexOf('#p');
              const ciBCol = ciHeaders.indexOf('#b');
              const ciBarCol = ciHeaders.indexOf('barcode');
              const ciWashCol = ciHeaders.indexOf('Wash date');
              const ciChqCol = ciHeaders.indexOf('CHQ date');

              const ciTypeCol = ciHeaders.findIndex((h: string) => h.toLowerCase() === 'chip type' || h.toLowerCase() === 'type');
              const ciEquipCol = ciHeaders.findIndex((h: string) => ['scanner', 'gtmc', '장비', '스캐너', 'gtmc 장비'].includes(h.toLowerCase()));

              if (ciPCol >= 0 && ciValues.length > 1) {
                const infoRows: ChipInfoRow[] = ciValues.slice(1).map(row => ({
                  plateId: String(row[ciPCol] || '').trim(),
                  batchId: ciBCol >= 0 ? String(row[ciBCol] || '').trim() : '',
                  barcode: ciBarCol >= 0 ? String(row[ciBarCol] || '').trim() : '',
                  chipType: ciTypeCol >= 0 ? String(row[ciTypeCol] || '').trim() : '',
                  equipment: ciEquipCol >= 0 ? String(row[ciEquipCol] || '').trim() : '',
                  steps: [] // Not strictly needed for basic matching but kept for type
                })).filter(r => r.plateId);
                if (get().chipInfoRows.length === 0) {
                  set({ chipInfoRows: infoRows });
                }
              }

              Object.values(reExpCurrent).forEach(chipData => {
                const chipId = chipData.chipId;
                const steps = { ...chipData.steps };
                const stepTimes: Record<string, string> = { ...(chipData.stepTimes || {}) };

                // ── 스케줄 시트에서 Day 1 / Hyb 완료 감지 ──
                allSheets.forEach(sheet => {
                  const v = sheet.values;
                  [1, 5, 9, 13, 17, 21].forEach(colBase => {
                    const dateRaw = (v[0] || [])[colBase];
                    if (!dateRaw) return;
                    const sheetDate = parseSheetDate(dateRaw);
                    if (!sheetDate) return;

                    // Day 1: row 15 contains chip, row 16 has finish time
                    const day1Str = String(v[15]?.[colBase] || '') + ',' + String(v[15]?.[colBase + 1] || '');
                    if (parseChipString(day1Str).includes(chipId)) {
                      const ft = v[16]?.[colBase];
                      const ftStr = fmtTime(ft);
                      if (ftStr) {
                        steps['Day 1'] = true;
                        if (!stepTimes['Day 1']) stepTimes['Day 1'] = `${fmtDate(sheetDate)} ${ftStr}`;
                        // Day 2: next day after Day 1 date, after 17:00
                        const day2Date = new Date(sheetDate);
                        day2Date.setDate(day2Date.getDate() + 1);
                        if (nowMs >= day2Date.getTime() + 17 * 3600_000) {
                          steps['Day 2'] = true;
                          if (!stepTimes['Day 2']) stepTimes['Day 2'] = `${fmtDate(day2Date)} 17:00`;
                        }
                      }
                    }

                    // Hyb: rows 2/6/10 have chips, rows 3/7/11 have times
                    [2, 6, 10].forEach((hybRow, si) => {
                      const timeRow = hybRow + 1;
                      [colBase, colBase + 1, colBase + 2, colBase + 3].forEach(col => {
                        if (parseChipString(String(v[hybRow]?.[col] || '')).includes(chipId)) {
                          const ht = v[timeRow]?.[col];
                          const htStr = fmtTime(ht);
                          if (htStr) {
                            steps['Hyb'] = true;
                            if (!stepTimes['Hyb']) {
                              const slotOffset = si === 0 ? 1 : si === 1 ? 0 : 0; // 🌅=+1d, 🌞/🌙=same day
                              const hybDate = new Date(sheetDate);
                              hybDate.setDate(hybDate.getDate() + slotOffset + 1);
                              stepTimes['Hyb'] = `${fmtDate(hybDate)} ${htStr}`;
                            }
                          }
                        }
                      });
                    });
                  });
                });

                // ── Chip info에서 Wash / CHQ 완료 감지 ──
                // addedDate 이후에 기록된 wash/chq만 이번 재실험의 완료로 인정
                const addedMs = chipData.addedDate ? new Date(chipData.addedDate).getTime() : 0;
                if (ciPCol >= 0 && ciValues.length > 1) {
                  const ciRow = ciValues.slice(1).find(row => String(row[ciPCol] || '').trim() === chipId);
                  if (ciRow) {
                    if (ciWashCol >= 0) {
                      const washD = parseSheetDate(ciRow[ciWashCol]);
                      if (washD) {
                        // wash date가 addedDate 이후이고, wash date 당일 자정(KST) 이후여야 완료
                        const washMidnight = new Date(washD); washMidnight.setHours(0, 0, 0, 0);
                        const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
                        const washDateMs = washMidnight.getTime();
                        if (washDateMs >= addedMs && washDateMs < todayMidnight.getTime()) {
                          steps['Wash'] = true;
                          if (!stepTimes['Wash']) stepTimes['Wash'] = `${fmtDate(washD)} 완료`;
                        }
                      }
                    }
                    if (ciChqCol >= 0) {
                      const chqRaw = ciRow[ciChqCol];
                      if (chqRaw && String(chqRaw).trim() !== '') {
                        const chqD = parseSheetDate(chqRaw);
                        if (chqD && chqD.getTime() >= addedMs && chqD.getTime() <= nowMs) {
                          steps['Scan'] = true;
                          if (!stepTimes['Scan']) stepTimes['Scan'] = `${fmtDate(chqD)} CHQ 완료`;
                        }
                      }
                    }
                  }
                }

                updatedReExp[chipId] = { ...chipData, steps, stepTimes };
              });

              set({ reExperimentTracking: updatedReExp });
              dbSet(ref(db, 'shared/reExperimentTracking'), updatedReExp);
            }
          } catch (e) {
            console.warn('재실험 추적 자동 업데이트 실패:', e);
          }

          // 5. 스케줄 시트 GID 식별
          const schData: any = {
            currentId: tables.CURRENT?.[0]?.sheetId,
            currentName: tables.CURRENT?.[0]?.sheetName || "CURRENT",
            upcomingId: tables.UPCOMING?.[0]?.sheetId,
            upcomingName: tables.UPCOMING?.[0]?.sheetName || "UPCOMING",
            current: tables.CURRENT?.[0],
            upcoming: tables.UPCOMING?.[0]
          };
          set({ scheduleData: schData });

          // 6. 이슈 데이터 로드 (장비 issue, 실험 issue)
          if (CHIP_IMAGE_SPREADSHEET_ID) {
            try {
              // (1) 장비 issue
              const equipRes = await sheetsGetValues(CHIP_IMAGE_SPREADSHEET_ID, "'장비 issue'!A1:Z1000", token);
              const equipRows = equipRes.values || [];
              if (equipRows.length > 1) {
                const headers = equipRows[0].map((h: any) => String(h).trim());
                const colOf = (name: string) => headers.indexOf(name);
                const issues: Issue[] = equipRows.slice(1).map((row, idx) => {
                  const dateRaw = row[colOf('발생일자')];
                  const d = parseSheetDate(dateRaw);
                  const photosRaw = String(row[colOf('참고 사진 URL')] || '');
                  const photos = photosRaw.split(',').map(s => {
                    const [url, thumb] = s.trim().split('|');
                    return { fileId: '', viewUrl: url, thumbnailBase64: thumb };
                  }).filter(p => p.viewUrl);
                  
                  return {
                    id: `sheet-eq-${idx}`,
                    date: d ? d.toISOString().split('T')[0] : String(dateRaw || ''),
                    type: String(row[colOf('GTMC 장비')] || ''),
                    plateId: String(row[colOf('#p')] || ''),
                    barcode: String(row[colOf('Barcode')] || ''),
                    summary: String(row[colOf('사건 개요')] || ''),
                    description: String(row[colOf('상세 내용')] || ''),
                    estimatedCause: String(row[colOf('추정 원인')] || ''),
                    followUpAction: String(row[colOf('후속 조치')] || ''),
                    reporter: String(row[colOf('보고자')] || ''),
                    status: (row[colOf('해결 여부')] === 'Resolved' ? 'Resolved' : 'Open') as 'Open' | 'Resolved',
                    experimentResult: String(row[colOf('실험결과')] || ''),
                    photos: photos.length > 0 ? photos : undefined
                  };
                }).filter(i => i.description || i.summary);
                set({ issues: issues.reverse() }); // 최신순
              }

              // (2) 실험 issue
              const plateRes = await sheetsGetValues(CHIP_IMAGE_SPREADSHEET_ID, "'실험 issue'!A1:Z1000", token);
              const plateRows = plateRes.values || [];
              if (plateRows.length > 1) {
                const headers = plateRows[0].map((h: any) => String(h).trim());
                const colOf = (name: string) => headers.indexOf(name);
                const pIssues: PlateIssue[] = plateRows.slice(1).map((row, idx) => {
                  const dateRaw = row[colOf('발생일자')];
                  const d = parseSheetDate(dateRaw);
                  const photosRaw = String(row[colOf('참고 사진 URL')] || '');
                  const photos = photosRaw.split(',').map(s => {
                    const [url, thumb] = s.trim().split('|');
                    return { fileId: '', viewUrl: url, thumbnailBase64: thumb };
                  }).filter(p => p.viewUrl);

                  return {
                    id: `sheet-pl-${idx}`,
                    date: d ? d.toISOString().split('T')[0] : String(dateRaw || ''),
                    step: String(row[colOf('실험과정')] || ''),
                    plateId: String(row[colOf('#p')] || ''),
                    barcode: String(row[colOf('Barcode')] || ''),
                    summary: String(row[colOf('사건 개요')] || ''),
                    description: String(row[colOf('상세 내용')] || ''),
                    estimatedCause: String(row[colOf('추정 원인')] || ''),
                    followUpAction: String(row[colOf('후속 조치')] || ''),
                    reporter: String(row[colOf('보고자')] || ''),
                    status: (row[colOf('해결 여부')] === 'Resolved' ? 'Resolved' : 'Open') as 'Open' | 'Resolved',
                    experimentResult: String(row[colOf('실험결과')] || ''),
                    photos: photos.length > 0 ? photos : undefined
                  };
                }).filter(i => i.description || i.summary);
                set({ plateIssues: pIssues.reverse() });
              }

              // (3) Chip image 이슈
              const chipRes = await sheetsGetValues(CHIP_IMAGE_SPREADSHEET_ID, "'Chip image issue'!A1:Z500", token);
              const chipRows = chipRes.values || [];
              if (chipRows.length > 1) {
                const h = chipRows[0].map((v: any) => String(v).trim());
                const col = (name: string) => h.indexOf(name);
                const cIssues: ChipImageIssue[] = chipRows.slice(1).map((row, idx) => {
                  const photosRaw = String(row[col('Chip image URL')] || '');
                  const photos = photosRaw.split(',').map(s => {
                    const [url, thumb] = s.trim().split('|');
                    return { fileId: '', viewUrl: url, thumbnailBase64: thumb };
                  }).filter(p => p.viewUrl);

                  const dateRaw = row[h.findIndex((a: string) => ['Scan 날짜', 'Wash 날짜'].includes(a.trim()))];
                  const d = parseSheetDate(dateRaw);
                  const findCol = (names: string[]) => h.findIndex((a: string) => names.includes(a.trim().toLowerCase()));

                  return {
                    id: `sheet-ch-${idx}`,
                    date: d ? d.toISOString().split('T')[0] : String(dateRaw || ''),
                    equipment: String(row[findCol(['gtmc 장비'])] || ''),
                    imageType: String(row[findCol(['image 유형'])] || ''),
                    chipType: String(row[findCol(['chip 종류'])] || ''),
                    plateId: String(row[findCol(['#p'])] || ''),
                    barcode: String(row[findCol(['barcode', '바코드'])] || ''),
                    chipPosition: String(row[findCol(['chip position', '포지션'])] || ''),
                    description: String(row[findCol(['description', '상세 내용'])] || ''),
                    callRate: String(row[findCol(['call rate'])] || ''),
                    dqc: String(row[findCol(['dqc'])] || ''),
                    qcCallRate: String(row[findCol(['qc call rate'])] || ''),
                    chqResult: String(row[findCol(['chq result'])] || ''),
                    photos: photos.length > 0 ? photos : undefined,
                    reporter: String(row[findCol(['보고자', 'reporter'])] || '')
                  };
                }).filter(i => i.plateId || i.barcode);
                set({ chipImageIssues: cIssues.reverse() });
              }
            } catch (e) {
              console.warn('이슈 기록 로드 실패:', e);
            }
          }

          set({
            lastSync: new Date().toISOString(),
            isLoading: false,
            syncError: null,
          });
        } catch (error: any) {
          console.error("Sheets Sync Error:", error);
          set({ isLoading: false, syncError: error?.message || String(error) });
        }
      },

      announcements: [],
      setAnnouncements: (announcements) => set({ announcements }),
      addAnnouncement: async (a) => {
        set((state) => ({ announcements: [a, ...state.announcements] }));
        try {
          const token = await getAccessToken();
          await sheetsAppend(SCHEDULE_SPREADSHEET_ID, 'Notice!A:D', [
            [a.date, a.content, a.author, a.remindDate || '']
          ], token);
        } catch (e) {
          console.error('공지 저장 실패:', e);
        }
      },
      updateAnnouncement: async (id, patch) => {
        const ann = get().announcements.find(a => a.id === id);
        if (!ann) return;
        const updated = { ...ann, ...patch };
        set((state) => ({ announcements: state.announcements.map(a => a.id === id ? updated : a) }));
        try {
          const token = await getAccessToken();
          const res = await sheetsGetValues(SCHEDULE_SPREADSHEET_ID, 'Notice!A:D', token);
          const rows: any[][] = res.values || [];
          const rowIdx = rows.findIndex(r => String(r[1]) === String(ann.content));
          if (rowIdx >= 1) {
            await sheetsUpdate(SCHEDULE_SPREADSHEET_ID, `Notice!A${rowIdx + 1}:D${rowIdx + 1}`,
              [[updated.date, updated.content, updated.author, updated.remindDate || '']], token);
          }
        } catch (e) { console.error('공지 수정 실패:', e); }
      },
      removeAnnouncement: async (id) => {
        const ann = get().announcements.find(a => a.id === id);
        set((state) => ({ announcements: state.announcements.filter(a => a.id !== id) }));
        if (!ann) return;
        try {
          const token = await getAccessToken();
          const res = await sheetsGetValues(SCHEDULE_SPREADSHEET_ID, 'Notice!A:B', token);
          const rows: any[][] = res.values || [];
          const rowIdx = rows.findIndex(r => String(r[1]) === String(ann.content));
          if (rowIdx >= 1) {
            const meta = await sheetsGetMetadata(SCHEDULE_SPREADSHEET_ID, token);
            const sheetId = meta.sheets.find((s: any) => s.properties.title === 'Notice')?.properties.sheetId;
            if (sheetId !== undefined) {
              await sheetsDeleteRows(SCHEDULE_SPREADSHEET_ID, sheetId, rowIdx, rowIdx + 1, token);
            }
          }
        } catch (e) {
          console.error('공지 삭제 실패:', e);
        }
      },

      teamMembers: [
        { name: '박근모', emoji: '🐻' },
        { name: '원미나', emoji: '🐱' },
      ],
      addTeamMember: (member) => {
        if (get().teamMembers.some(m => m.name === member.name)) return;
        const next = [...get().teamMembers, member];
        set({ teamMembers: next });
        dbSet(ref(db, 'shared/teamMembers'), { items: next, lastReset: todayStr });
      },
      removeTeamMember: (name) => {
        const next = get().teamMembers.filter(m => m.name !== name);
        set({ teamMembers: next });
        dbSet(ref(db, 'shared/teamMembers'), { items: next, lastReset: todayStr });
      },
      updateTeamMemberEmoji: (name, emoji) => {
        const next = get().teamMembers.map(m => m.name === name ? { ...m, emoji } : m);
        set({ teamMembers: next });
        dbSet(ref(db, 'shared/teamMembers'), { items: next, lastReset: todayStr });
      },

      tasks: [],
      setTasks: (tasks) => set({ tasks }),
      toggleTask: (taskId, assignee) => {
        const next = get().tasks.map(t => {
          if (t.id !== taskId) return t;
          const completing = !t.completed;
          const cur = t.assignees ?? (t.assignee ? [t.assignee] : []);
          const assignees = assignee && !cur.includes(assignee) ? [...cur, assignee] : cur.length > 0 ? cur : assignee ? [assignee] : [];
          return { ...t, completed: completing, completedAt: completing ? new Date().toLocaleTimeString() : undefined, assignees };
        });
        set({ tasks: next });
        dbSet(ref(db, 'shared/tasks'), { items: next, lastReset: todayKST() });
      },
      addTask: (task) => {
        set((state) => ({ tasks: [...state.tasks, task] }));
        runTransaction(ref(db, 'shared/tasks'), (current) => {
          const rawItems = current?.items;
          const arr: RecurringTask[] = rawItems
            ? (Array.isArray(rawItems) ? rawItems : Object.values(rawItems))
            : [];
          if (arr.some((t: RecurringTask) => t.task === task.task && t.category === task.category && !t.assignees && !t.assignee)) return current;
          return { items: [...arr, task], lastReset: current?.lastReset || todayKST() };
        }).catch(e => console.error('addTask 실패:', e));
      },
      removeTask: (taskId) => {
        const next = get().tasks.filter(t => t.id !== taskId);
        set({ tasks: next });
        dbSet(ref(db, 'shared/tasks'), { items: next, lastReset: todayKST() });
      },
      reorderTaskBefore: (taskId, beforeTaskId) => {
        const all = [...get().tasks];
        const fromIdx = all.findIndex(t => t.id === taskId);
        const toIdx = all.findIndex(t => t.id === beforeTaskId);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
        const [moved] = all.splice(fromIdx, 1);
        const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
        all.splice(insertAt, 0, moved);
        set({ tasks: all });
        dbSet(ref(db, 'shared/tasks'), { items: all, lastReset: todayKST() });
      },
      swapTasks: (taskIdA, taskIdB) => {
        const all = [...get().tasks];
        const idxA = all.findIndex(t => t.id === taskIdA);
        const idxB = all.findIndex(t => t.id === taskIdB);
        if (idxA < 0 || idxB < 0) return;
        [all[idxA], all[idxB]] = [all[idxB], all[idxA]];
        set({ tasks: all });
        dbSet(ref(db, 'shared/tasks'), { items: all, lastReset: todayKST() });
      },
      reorderMemberTasks: (orderedIds) => {
        const all = [...get().tasks];
        const idToTask = new Map(all.map(t => [t.id, t]));
        const slots = orderedIds
          .map(id => all.findIndex(t => t.id === id))
          .filter(i => i >= 0)
          .sort((a, b) => a - b);
        const tasksInNewOrder = orderedIds.map(id => idToTask.get(id)).filter(Boolean) as typeof all;
        tasksInNewOrder.forEach((task, i) => { all[slots[i]] = task; });
        set({ tasks: all });
        dbSet(ref(db, 'shared/tasks'), { items: all, lastReset: todayKST() });
      },
      resetTasks: () => {
        set({ tasks: [] });
        dbSet(ref(db, 'shared/tasks'), { items: [], lastReset: todayKST() });
      },
      removeTasksByAssignee: (name) => {
        const next = get().tasks.filter(t => {
          const assignees = t.assignees ?? (t.assignee ? [t.assignee] : []);
          return !assignees.includes(name);
        });
        set({ tasks: next });
        dbSet(ref(db, 'shared/tasks'), { items: next, lastReset: todayKST() });
      },
      addTaskAssignee: (taskId, assignee) => {
        set((state) => ({
          tasks: state.tasks.map(t => {
            if (t.id !== taskId) return t;
            const cur = t.assignees ?? (t.assignee ? [t.assignee] : []);
            if (cur.includes(assignee) || cur.length >= 3) return t;
            return { ...t, assignees: [...cur, assignee] };
          }),
        }));
        runTransaction(ref(db, 'shared/tasks'), (current) => {
          if (!current) return current;
          const rawItems = current.items;
          const arr: RecurringTask[] = rawItems
            ? (Array.isArray(rawItems) ? rawItems : Object.values(rawItems))
            : [];
          const updated = arr.map((t: any) => {
            if (t.id !== taskId) return t;
            const cur = t.assignees ?? (t.assignee ? [t.assignee] : []);
            if (cur.includes(assignee) || cur.length >= 3) return t;
            return { ...t, assignees: [...cur, assignee] };
          });
          return { items: updated, lastReset: current.lastReset || todayKST() };
        }).catch(e => console.error('addTaskAssignee 실패:', e));
      },
      removeTaskAssignee: (taskId, assignee) => {
        set((state) => ({
          tasks: state.tasks.flatMap(t => {
            if (t.id !== taskId) return [t];
            const cur = t.assignees ?? (t.assignee ? [t.assignee] : []);
            const next = cur.filter(a => a !== assignee);
            return next.length === 0 ? [] : [{ ...t, assignees: next, assignee: undefined }];
          }),
        }));
        runTransaction(ref(db, 'shared/tasks'), (current) => {
          if (!current) return current;
          const arr: RecurringTask[] = Array.isArray(current.items) ? current.items : Object.values(current.items ?? {});
          const updated = arr.flatMap((t: any) => {
            if (t.id !== taskId) return [t];
            const cur = t.assignees ?? (t.assignee ? [t.assignee] : []);
            const next = cur.filter((a: string) => a !== assignee);
            return next.length === 0 ? [] : [{ ...t, assignees: next, assignee: undefined }];
          });
          return { items: updated, lastReset: current.lastReset || todayKST() };
        }).catch(e => console.error('removeTaskAssignee 실패:', e));
      },
      issues: [],
      setIssues: (issues) => set({ issues }),
      addIssue: async (issue, token) => {
        set((state) => ({ issues: [issue, ...state.issues] }));
        try {
          if (!token) token = await getAccessToken();
          const photoUrls = (issue.photos || []).map((p: any) => p.viewUrl).filter(Boolean).join(', ')
            || issue.photoUrl || '';
          const COLS = ['발생일자', 'GTMC 장비', '#p', 'Barcode', '사건 개요', '상세 내용', '추정 원인', '후속 조치', '보고자', '해결 여부', '실험결과', '참고 사진 URL'];
          const VALS = [issue.date, issue.type, issue.plateId || '', issue.barcode || '', issue.summary || '', issue.description, issue.estimatedCause || '', issue.followUpAction || '', issue.reporter, issue.status, issue.experimentResult || '', photoUrls];
          const headerRes = await sheetsGetValues(CHIP_IMAGE_SPREADSHEET_ID, "'장비 issue'!1:1", token);
          const headers: string[] = (headerRes.values?.[0] || []).map((h: any) => String(h).trim());
          if (headers.length === 0) {
            await sheetsAppend(CHIP_IMAGE_SPREADSHEET_ID, "'장비 issue'!A:A", [VALS], token);
          } else {
            const row = new Array(headers.length).fill('');
            COLS.forEach((col, i) => { const idx = headers.indexOf(col); if (idx >= 0) row[idx] = VALS[i]; });
            await sheetsAppend(CHIP_IMAGE_SPREADSHEET_ID, "'장비 issue'!A:A", [row], token);
          }
        } catch (e) { console.error('장비 issue 시트 저장 실패:', e); throw e; }
      },

      plateIssues: [],
      addPlateIssue: async (issue, token) => {
        set((state) => ({ plateIssues: [issue, ...state.plateIssues] }));
        try {
          if (!token) token = await getAccessToken();
          const photoUrls = (issue.photos || []).map((p: any) => p.viewUrl).filter(Boolean).join(', ')
            || issue.photoUrl || '';
          const COLS = ['발생일자', '실험과정', '#p', 'Barcode', '사건 개요', '상세 내용', '추정 원인', '후속 조치', '보고자', '해결 여부', '실험결과', '참고 사진 URL'];
          const VALS = [issue.date, issue.step, issue.plateId || '', issue.barcode || '', issue.summary || '', issue.description, issue.estimatedCause || '', issue.followUpAction || '', issue.reporter, issue.status, issue.experimentResult || '', photoUrls];
          const headerRes = await sheetsGetValues(CHIP_IMAGE_SPREADSHEET_ID, "'실험 issue'!1:1", token);
          const headers: string[] = (headerRes.values?.[0] || []).map((h: any) => String(h).trim());
          if (headers.length === 0) {
            await sheetsAppend(CHIP_IMAGE_SPREADSHEET_ID, "'실험 issue'!A:A", [VALS], token);
          } else {
            const row = new Array(headers.length).fill('');
            COLS.forEach((col, i) => { const idx = headers.indexOf(col); if (idx >= 0) row[idx] = VALS[i]; });
            await sheetsAppend(CHIP_IMAGE_SPREADSHEET_ID, "'실험 issue'!A:A", [row], token);
          }
        } catch (e) { console.error('실험 issue 시트 저장 실패:', e); throw e; }
      },

      chipImageIssues: [],
      addChipImageIssue: async (issue) => {
        const next = [issue, ...get().chipImageIssues];
        set({ chipImageIssues: next });
        dbSet(ref(db, 'shared/chipImageIssues'), next);

        // Save to sheet if spreadsheet ID is configured
        if (CHIP_IMAGE_SPREADSHEET_ID) {
          try {
            const token = await getAccessToken();
            const headerRes = await sheetsGetValues(CHIP_IMAGE_SPREADSHEET_ID, "'Chip image issue'!1:1", token);
            const headers: string[] = (headerRes.values?.[0] || []).map((h: any) => String(h).trim());
            const colOf = (names: string[]) => headers.findIndex(h => names.includes(h.toLowerCase()));

            const cols = {
              date: colOf(['scan 날짜', 'wash 날짜', '날짜']),
              equipment: colOf(['gtmc 장비']),
              imageType: colOf(['image 유형']),
              chipType: colOf(['chip 종류']),
              plateId: colOf(['#p', 'plate id']),
              barcode: colOf(['barcode', '바코드']),
              chipPosition: colOf(['chip position', '포지션']),
              description: colOf(['description', '상세 내용']),
              callRate: colOf(['call rate']),
              dqc: colOf(['dqc']),
              qcCallRate: colOf(['qc call rate']),
              chqResult: colOf(['chq result']),
              imageUrl: colOf(['chip image url', '사진 url']),
              reporter: colOf(['보고자', 'reporter']),
            };
            const maxCol = Math.max(...Object.values(cols));
            if (maxCol >= 0) {
              const row = new Array(maxCol + 1).fill('');
              Object.entries(cols).forEach(([key, idx]) => {
                if (idx >= 0) {
                  if (key === 'imageUrl') {
                    row[idx] = (issue.photos || []).map((p: any) => p.viewUrl).join(', ') || (issue as any).imageUrl || '';
                  } else {
                    row[idx] = (issue as any)[key] || '';
                  }
                }
              });
              await sheetsAppend(CHIP_IMAGE_SPREADSHEET_ID, "'Chip image issue'!A:A", [row], token);
            }
          } catch (e) {
            console.error('Chip image sheet save failed:', e);
          }
        }
      },

      updateIssueStatus: async (id, status, result) => {
        set((state) => ({
          issues: state.issues.map((i) => (i.id === id ? { ...i, status, experimentResult: result } : i)),
          selectedIssue: state.selectedIssue?.id === id ? { ...state.selectedIssue, status, experimentResult: result } : state.selectedIssue,
        }));
        if (!CHIP_IMAGE_SPREADSHEET_ID || !id.startsWith('sheet-eq-')) return;
        try {
          const token = await getAccessToken();
          const idx = parseInt(id.replace('sheet-eq-', ''));
          const rowNumber = idx + 2;
          const headerRes = await sheetsGetValues(CHIP_IMAGE_SPREADSHEET_ID, "'장비 issue'!1:1", token);
          const headers: string[] = (headerRes.values?.[0] || []).map((h: any) => String(h).trim());
          const colStatus = headers.indexOf('해결 여부');
          const colResult = headers.indexOf('실험결과');
          const getCell = (c: number) => {
            const char = String.fromCharCode(65 + c);
            return `'장비 issue'!${char}${rowNumber}`;
          };
          if (colStatus >= 0) await sheetsUpdate(CHIP_IMAGE_SPREADSHEET_ID, getCell(colStatus), [[status]], token);
          if (colResult >= 0) await sheetsUpdate(CHIP_IMAGE_SPREADSHEET_ID, getCell(colResult), [[result]], token);
        } catch (e) { console.error('장비 issue 업데이트 실패:', e); }
      },

      updatePlateIssueStatus: async (id, status, result) => {
        set((state) => ({
          plateIssues: state.plateIssues.map((i) => (i.id === id ? { ...i, status, experimentResult: result } : i)),
          selectedPlateIssue: state.selectedPlateIssue?.id === id ? { ...state.selectedPlateIssue, status, experimentResult: result } : state.selectedPlateIssue,
        }));
        if (!CHIP_IMAGE_SPREADSHEET_ID || !id.startsWith('sheet-pl-')) return;
        try {
          const token = await getAccessToken();
          const idx = parseInt(id.replace('sheet-pl-', ''));
          const rowNumber = idx + 2;
          const headerRes = await sheetsGetValues(CHIP_IMAGE_SPREADSHEET_ID, "'실험 issue'!1:1", token);
          const headers: string[] = (headerRes.values?.[0] || []).map((h: any) => String(h).trim());
          const colStatus = headers.indexOf('해결 여부');
          const colResult = headers.indexOf('실험결과');
          const getCell = (c: number) => {
            const char = String.fromCharCode(65 + c);
            return `'실험 issue'!${char}${rowNumber}`;
          };
          if (colStatus >= 0) await sheetsUpdate(CHIP_IMAGE_SPREADSHEET_ID, getCell(colStatus), [[status]], token);
          if (colResult >= 0) await sheetsUpdate(CHIP_IMAGE_SPREADSHEET_ID, getCell(colResult), [[result]], token);
        } catch (e) { console.error('실험 issue 업데이트 실패:', e); }
      },

      updateChipImageCHQStatus: async (id, result) => {
        set((state) => ({
          chipImageIssues: state.chipImageIssues.map((i) => (i.id === id ? { ...i, chqResult: result } : i)),
        }));
        if (!CHIP_IMAGE_SPREADSHEET_ID || !id.startsWith('sheet-ch-')) return;
        try {
          const token = await getAccessToken();
          const idx = parseInt(id.replace('sheet-ch-', ''));
          const rowNumber = idx + 2;
          const headerRes = await sheetsGetValues(CHIP_IMAGE_SPREADSHEET_ID, "'Chip image issue'!1:1", token);
          const headers: string[] = (headerRes.values?.[0] || []).map((h: any) => String(h).trim());
          const colCHQ = headers.indexOf('CHQ result');
          if (colCHQ >= 0) {
            const char = String.fromCharCode(65 + colCHQ);
            await sheetsUpdate(CHIP_IMAGE_SPREADSHEET_ID, `'Chip image issue'!${char}${rowNumber}`, [[result]], token);
          }
        } catch (e) { console.error('Chip image CHQ 업데이트 실패:', e); }
      },

      selectedIssue: null,
      setSelectedIssue: (selectedIssue) => set({ selectedIssue }),
      selectedPlateIssue: null,
      setSelectedPlateIssue: (selectedPlateIssue) => set({ selectedPlateIssue }),
      selectedChipImageId: null,
      setSelectedChipImageId: (selectedChipImageId) => set({ selectedChipImageId }),

      scheduleData: null,
      setScheduleData: (scheduleData) => set({ scheduleData }),

      timelineEntries: [],
      setTimelineEntries: (timelineEntries) => set({ timelineEntries }),
      addTimelineEntry: (entry) => set((state) => ({ timelineEntries: [entry, ...state.timelineEntries] })),
      chipInfoRows: [],

      calendarEvents: [],
      addCalendarEvent: (event) => {
        const newEvent: CalendarEvent = { ...event, id: Date.now().toString() };
        const next = [...get().calendarEvents, newEvent];
        set({ calendarEvents: next });
        dbSet(ref(db, 'shared/calendarEvents'), { _k: true, items: next });
      },
      removeCalendarEvent: (id) => {
        const next = get().calendarEvents.filter(e => e.id !== id);
        set({ calendarEvents: next });
        dbSet(ref(db, 'shared/calendarEvents'), { _k: true, items: next });
      },
      updateCalendarEvent: (id, patch) => {
        const next = get().calendarEvents.map(e => e.id === id ? { ...e, ...patch } : e);
        set({ calendarEvents: next });
        dbSet(ref(db, 'shared/calendarEvents'), { _k: true, items: next });
      },

      scheduledTasks: [],
      addScheduledTask: (task) => {
        const newTask: ScheduledTaskDef = { ...task, id: Date.now().toString() };
        const next = [...get().scheduledTasks, newTask];
        set({ scheduledTasks: next });
        dbSet(ref(db, 'shared/scheduledTasks'), { _k: true, items: next });
      },
      removeScheduledTask: (id) => {
        const next = get().scheduledTasks.filter(t => t.id !== id);
        set({ scheduledTasks: next });
        dbSet(ref(db, 'shared/scheduledTasks'), { _k: true, items: next });
      },
      updateScheduledTask: (id, patch) => {
        const next = get().scheduledTasks.map(t => t.id === id ? { ...t, ...patch } : t);
        set({ scheduledTasks: next });
        dbSet(ref(db, 'shared/scheduledTasks'), { _k: true, items: next });
      },
      completeScheduledTask: (id, byName) => {
        const today = new Date().toISOString().split('T')[0];
        const next = get().scheduledTasks.map(t => {
          if (t.id !== id) return t;
          const existing: import('./types').ScheduledTaskDoneEntry[] = (t.doneHistory ?? []).map((e: any) =>
            typeof e === 'string' ? { date: e } : e
          );
          const alreadyIdx = existing.findIndex(e => e.date === today);
          let history: import('./types').ScheduledTaskDoneEntry[];
          if (alreadyIdx >= 0) {
            history = existing.filter((_, i) => i !== alreadyIdx);
          } else {
            const now = new Date();
            const kstTotalMin = now.getUTCHours() * 60 + now.getUTCMinutes() + 9 * 60;
            const kstHour = String(Math.floor(kstTotalMin / 60) % 24).padStart(2, '0');
            const kstMin = String(kstTotalMin % 60).padStart(2, '0');
            const kstTime = `${kstHour}:${kstMin}`;
            const kstDateOffset = kstTotalMin >= 24 * 60 ? 1 : 0;
            const kstDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + kstDateOffset));
            const completedDate = `${kstDate.getUTCFullYear()}-${String(kstDate.getUTCMonth() + 1).padStart(2, '0')}-${String(kstDate.getUTCDate()).padStart(2, '0')}`;
            history = [...existing, { date: today, by: byName, time: kstTime, completedDate }].sort((a, b) => a.date.localeCompare(b.date));
          }
          const lastEntry = history[history.length - 1];
          return { ...t, lastDone: lastEntry?.date ?? undefined, doneHistory: history };
        });
        set({ scheduledTasks: next });
        dbSet(ref(db, 'shared/scheduledTasks'), { _k: true, items: next });
      },
      toggleScheduledTaskDate: (id, date, byName) => {
        const next = get().scheduledTasks.map(t => {
          if (t.id !== id) return t;
          const existing: import('./types').ScheduledTaskDoneEntry[] = (t.doneHistory ?? []).map((e: any) =>
            typeof e === 'string' ? { date: e } : e
          );
          const has = existing.some(e => e.date === date);
          let history: import('./types').ScheduledTaskDoneEntry[];
          if (has) {
            history = existing.filter(e => e.date !== date);
          } else {
            const now = new Date();
            const kstTotalMin = now.getUTCHours() * 60 + now.getUTCMinutes() + 9 * 60;
            const kstHour = String(Math.floor(kstTotalMin / 60) % 24).padStart(2, '0');
            const kstMin = String(kstTotalMin % 60).padStart(2, '0');
            const kstTime = `${kstHour}:${kstMin}`;
            const kstDateOffset = now.getUTCHours() * 60 + now.getUTCMinutes() + 9 * 60 >= 24 * 60 ? 1 : 0;
            const kstDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + kstDateOffset));
            const completedDate = `${kstDate.getUTCFullYear()}-${String(kstDate.getUTCMonth() + 1).padStart(2, '0')}-${String(kstDate.getUTCDate()).padStart(2, '0')}`;
            history = [...existing, { date, by: byName, time: kstTime, completedDate }].sort((a, b) => a.date.localeCompare(b.date));
          }
          const lastEntry = history[history.length - 1];
          return { ...t, lastDone: lastEntry?.date ?? undefined, doneHistory: history };
        });
        set({ scheduledTasks: next });
        dbSet(ref(db, 'shared/scheduledTasks'), { _k: true, items: next });
      },
      moveScheduledTaskDate: (id, fromDate, toDate) => {
        const next = get().scheduledTasks.map(t => {
          if (t.id !== id) return t;
          const overrides = { ...(t.dateOverrides ?? {}), [fromDate]: toDate };
          return { ...t, dateOverrides: overrides };
        });
        set({ scheduledTasks: next });
        dbSet(ref(db, 'shared/scheduledTasks'), { _k: true, items: next });
      },
    };
  },
    {
      name: 'axiom-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        view: state.view,
      }),
    }
  )
);
