export type ViewType = 'dashboard' | 'schedule' | 'reagent' | 'issues' | 'timeline';

export interface UserSession {
  name: string;
  emoji: string;
  photoUrl?: string;
}

export interface Announcement {
  id: string;
  content: string;
  date: string;
  author: string;
  remindDate?: string;
}

export interface RecurringTask {
  id: string;
  category: string;
  task: string;
  completed: boolean;
  assignee?: string;       // kept for backwards compat
  assignees?: string[];    // up to 2 assignees
  completedAt?: string;
}

export interface TeamMember {
  name: string;
  emoji: string;
}

export interface IssuePhoto {
  fileId: string;
  viewUrl: string;
  thumbnailBase64?: string;
}

export interface Issue {
  id: string;
  date: string;
  type: string;           // GTMC 장비
  plateId?: string;       // #p
  barcode?: string;       // Barcode
  summary?: string;       // 사건 개요
  description: string;    // 상세 내용
  estimatedCause?: string;
  followUpAction?: string;
  experimentResult?: string; // 실험결과
  status: 'Open' | 'Resolved';
  reporter: string;
  photoUrl?: string;         // legacy
  thumbnailBase64?: string;  // legacy
  photos?: IssuePhoto[];
}

export interface PlateIssue {
  id: string;
  date: string;
  step: string;              // 실험과정
  plateId?: string;          // #p
  barcode?: string;          // Barcode
  summary?: string;          // 사건 개요
  description: string;       // 상세 내용
  estimatedCause?: string;
  followUpAction?: string;
  experimentResult?: string; // 실험결과
  status: 'Open' | 'Resolved';
  reporter: string;
  photoUrl?: string;         // legacy
  thumbnailBase64?: string;  // legacy
  photos?: IssuePhoto[];
}

export interface ChipImageIssue {
  id: string;
  date: string;           // Scan 날짜
  equipment: string;      // GTMC 장비
  imageType: string;      // Image 유형
  chipType: string;       // Chip 종류
  plateId: string;        // #p
  barcode: string;        // barcode
  chipPosition?: string;  // Chip position (e.g., A01)
  description: string;
  callRate: string;
  dqc: string;
  qcCallRate: string;
  chqResult: string;
  imageUrl?: string;      // legacy single Drive URL
  thumbnailBase64?: string; // legacy
  photos?: IssuePhoto[];
  reporter: string;
}

export interface ChipQCEntry {
  id: string;
  washDate: string;
  chipBarcode: string;
  batchNo: string; // #b
  plateNo: string; // #p
  issue: string;
  deadline: string;
  isCompleted: boolean;
}

export interface MonthlyStat {
  month: string;
  samples: number;
}

export interface ReagentComponent {
  name: string;
  amount: number;
  checked: boolean;
}

export interface ReagentGroup {
  reagentName: string;
  components: ReagentComponent[];
  timestamp: string;
  isFullyChecked: boolean;
}

export interface ScheduleDay {
  date: string;
  day1_96: string;
  day1_384: string;
  day2: string;
  wash: string[];
  utilization: number[];
}

export interface ScheduleData {
  sheetName: string;
  currentName: string;
  upcomingName: string;
  currentSheetId: number;
  upcomingSheetId: number;
  schedule: ScheduleDay[];
  stats: {
    weeklySamples: number;
    monthlySamples: number;
    weeklyUtilization: number[];
  };
  announcements: string[];
}

export interface PlateTimelineEntry {
  id: string;
  plateId: string;
  batchId: string;
  step: string;
  timestamp: string;
  operator: string;
  notes?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD (inclusive)
  color: string;     // tailwind color key: 'blue' | 'green' | 'red' | 'purple' | 'orange'
}

export interface ChipInfoRow {
  plateId: string;   // #p
  batchId: string;   // #b
  barcode: string;   // Chip barcode
  chipType?: string; // Chip Type (Axiom, PM 등)
  equipment?: string; // GTMC 장비 등
  steps: { label: string; date: string }[];
}

export type MonthlyType = 'date' | 'nth-weekday' | 'last-weekday';

export interface ScheduledTaskDoneEntry {
  date: string;          // YYYY-MM-DD (업무 마감일)
  by?: string;           // 완료자 이름
  time?: string;         // HH:MM (KST, 체크 시각)
  completedDate?: string; // YYYY-MM-DD (KST, 실제 체크한 날짜)
}

export interface ScheduledTaskDef {
  id: string;
  name: string;
  period: 'weekly' | 'monthly';
  weekday?: number;           // 0=Sun…6=Sat (weekly, or nth-weekday 요일)
  monthlyType?: MonthlyType;
  monthDay?: number | 'last'; // 'date' 기준: 1-28 or 'last'
  monthWeek?: number;         // 'nth-weekday' 기준: 1-4 or -1(마지막)
  assignee?: string;
  lastDone?: string;
  doneHistory?: ScheduledTaskDoneEntry[];
  // drag & drop override: specific dates remapped from calculated due date
  dateOverrides?: Record<string, string>; // calDueDate -> actualDueDate
}

export interface ReagentDefinition {
  format: string;
  process: string;
  reagentName: string;
  componentName: string;
  amount: number;
}


export const TEAM_MEMBERS = ['박근모', '원미나'];
export const EQUIPMENT_TYPES = ['GT1', 'GT2', 'GT3', 'GT4', 'GTS'];
export const PLATE_PROCESS_TYPES = ['Day 1', 'Day 2_AM', 'Day 2_PM', 'Hyb', 'Wash RGT'];

export const RECURRING_TASKS: Record<string, string[]> = {
  "Reagent Prep": ["Day 1_96", "Day 1_384", "Day 2_AM", "Day 2_PM", "S1, S2", "Stbl, Lig"],
  "Experiment Prep": ["M1_96 at RT", "M1_384 at RT", "M4 at RT", "M1_96 at 4°C", "M2 at 4°C"],
  "Wash": ["Wash #1", "Wash #2", "Wash #3"],
  "Hyb": ["Transfer", "Hyb #1", "Hyb #2", "Hyb #3", "주간 hyb 일정 수립"],
  "기타": ["DNA input 사진 업로드", "DNA pellet 사진 업로드",
    "Chip 바코드 등록", "Sample sheet 업로드", "Rescan/chip 보관", "Chip QC", "QC_OD", "성별 validation"]
};

export const REAGENT_DEFINITIONS: ReagentDefinition[] = [
  { format: '384', process: 'Day 1', reagentName: 'Denaturation Master Mix', componentName: 'Axiom Propel Water', amount: 12.5 },
  { format: '384', process: 'Day 1', reagentName: 'Denaturation Master Mix', componentName: 'Axiom Propel 10X Denat Soln', amount: 1.4 },
  { format: '96', process: 'Day 1', reagentName: 'Denaturation Master Mix', componentName: 'Axiom Propel Water', amount: 6.25 },
  { format: '96', process: 'Day 1', reagentName: 'Denaturation Master Mix', componentName: 'Axiom Propel 10X Denat Soln', amount: 0.7 },
  { format: '384', process: 'Day 1', reagentName: 'Amplification Master Mix', componentName: 'Axiom Propel Amp Soln', amount: 57 },
  { format: '384', process: 'Day 1', reagentName: 'Amplification Master Mix', componentName: 'Axiom (XPRES) Amp Enzyme', amount: 1.27 },
  { format: '96', process: 'Day 1', reagentName: 'Amplification Master Mix', componentName: 'Axiom Propel Amp Soln', amount: 28.5 },
  { format: '96', process: 'Day 1', reagentName: 'Amplification Master Mix', componentName: 'Axiom (XPRES) Amp Enzyme', amount: 0.63 },
  { format: '384', process: 'Day 2_AM', reagentName: 'Fragmentation Master Mix', componentName: 'Axiom Propel 10X Frag Buffer', amount: 18.0 },
  { format: '384', process: 'Day 2_AM', reagentName: 'Fragmentation Master Mix', componentName: 'Axiom Propel Frag Diluent', amount: 4.05 },
  { format: '384', process: 'Day 2_AM', reagentName: 'Fragmentation Master Mix', componentName: 'Axiom Propel Frag Enzyme', amount: 0.4 },
  { format: '96', process: 'Day 2_AM', reagentName: 'Fragmentation Master Mix', componentName: 'Axiom Propel 10X Frag Buffer', amount: 9.0 },
  { format: '96', process: 'Day 2_AM', reagentName: 'Fragmentation Master Mix', componentName: 'Axiom Propel Frag Diluent', amount: 2.03 },
  { format: '96', process: 'Day 2_AM', reagentName: 'Fragmentation Master Mix', componentName: 'Axiom Propel Frag Enzyme', amount: 0.2 },
  { format: '384', process: 'Day 2_AM', reagentName: 'Precipitation Master Mix', componentName: 'Axiom Propel Precip Soln1', amount: 60 },
  { format: '384', process: 'Day 2_AM', reagentName: 'Precipitation Master Mix', componentName: 'Axiom Propel Precip Soln2', amount: 0.55 },
  { format: '384', process: 'Day 2_AM', reagentName: 'Precipitation Master Mix', componentName: 'Isopropanol', amount: 165 },
  { format: '96', process: 'Day 2_AM', reagentName: 'Precipitation Master Mix', componentName: 'Axiom Propel Precip Soln1', amount: 30 },
  { format: '96', process: 'Day 2_AM', reagentName: 'Precipitation Master Mix', componentName: 'Axiom Propel Precip Soln2', amount: 0.275 },
  { format: '96', process: 'Day 2_AM', reagentName: 'Isopropanol', componentName: 'Isopropanol', amount: 85 },
  { format: '384', process: 'Day 2_PM', reagentName: 'Hybridization Cocktail', componentName: 'Axiom Propel Resuspension Buffer', amount: 9.15 },
  { format: '384', process: 'Day 2_PM', reagentName: 'Hybridization Cocktail', componentName: 'Axiom Propel Hyb Buffer', amount: 18.5 },
  { format: '384', process: 'Day 2_PM', reagentName: 'Hybridization Cocktail', componentName: 'Axiom Propel Hyb Soln 1', amount: 0.133 },
  { format: '384', process: 'Day 2_PM', reagentName: 'Hybridization Cocktail', componentName: 'Axiom Propel Hyb Soln 2', amount: 2.35 },
  { format: '96', process: 'Day 2_PM', reagentName: 'Hybridization Cocktail', componentName: 'Axiom Propel Hyb Buffer', amount: 11.75 },
  { format: '96', process: 'Day 2_PM', reagentName: 'Hybridization Cocktail', componentName: 'Axiom Propel Hyb Soln 1', amount: 0.083 },
  { format: '96', process: 'Day 2_PM', reagentName: 'Hybridization Cocktail', componentName: 'Axiom Propel Hyb Soln 2', amount: 1.5 },
  { format: '384', process: 'Wash RGT', reagentName: 'Stain 1', componentName: 'Axiom Propel Wash A', amount: 54.0 },
  { format: '384', process: 'Wash RGT', reagentName: 'Stain 1', componentName: 'Axiom Propel Stain Buffer', amount: 1.15 },
  { format: '384', process: 'Wash RGT', reagentName: 'Stain 1', componentName: 'Axiom Propel Stain 1-A', amount: 0.565 },
  { format: '384', process: 'Wash RGT', reagentName: 'Stain 1', componentName: 'Axiom Propel Stain 1-B', amount: 0.565 },
  { format: '96', process: 'Wash RGT', reagentName: 'Stain 1', componentName: 'Axiom Propel Wash A', amount: 27.0 },
  { format: '96', process: 'Wash RGT', reagentName: 'Stain 1', componentName: 'Axiom Propel Stain Buffer', amount: 0.575 },
  { format: '96', process: 'Wash RGT', reagentName: 'Stain 1', componentName: 'Axiom Propel Stain 1-A', amount: 0.283 },
  { format: '96', process: 'Wash RGT', reagentName: 'Stain 1', componentName: 'Axiom Propel Stain 1-B', amount: 0.283 },
  { format: '384', process: 'Wash RGT', reagentName: 'Stain 2', componentName: 'Axiom Propel Wash A', amount: 31.5 },
  { format: '384', process: 'Wash RGT', reagentName: 'Stain 2', componentName: 'Axiom Propel Stain Buffer', amount: 0.655 },
  { format: '384', process: 'Wash RGT', reagentName: 'Stain 2', componentName: 'Axiom Propel Stain 2-A', amount: 0.33 },
  { format: '384', process: 'Wash RGT', reagentName: 'Stain 2', componentName: 'Axiom Propel Stain 2-B', amount: 0.33 },
  { format: '96', process: 'Wash RGT', reagentName: 'Stain 2', componentName: 'Axiom Propel Wash A', amount: 15.75 },
  { format: '96', process: 'Wash RGT', reagentName: 'Stain 2', componentName: 'Axiom Propel Stain Buffer', amount: 0.328 },
  { format: '96', process: 'Wash RGT', reagentName: 'Stain 2', componentName: 'Axiom Propel Stain 2-A', amount: 0.165 },
  { format: '96', process: 'Wash RGT', reagentName: 'Stain 2', componentName: 'Axiom Propel Stain 2-B', amount: 0.165 },
  { format: '384', process: 'Wash RGT', reagentName: 'Stabilization Master Mix', componentName: 'Axiom Water', amount: 29.0 },
  { format: '384', process: 'Wash RGT', reagentName: 'Stabilization Master Mix', componentName: 'Axiom Stabilize Diluent', amount: 3.25 },
  { format: '384', process: 'Wash RGT', reagentName: 'Stabilization Master Mix', componentName: 'Axiom Stabilize Soln', amount: 0.41 },
  { format: '96', process: 'Wash RGT', reagentName: 'Stabilization Master Mix', componentName: 'Axiom Water', amount: 14.5 },
  { format: '96', process: 'Wash RGT', reagentName: 'Stabilization Master Mix', componentName: 'Axiom Stabilize Diluent', amount: 1.63 },
  { format: '96', process: 'Wash RGT', reagentName: 'Stabilization Master Mix', componentName: 'Axiom Stabilize Soln', amount: 0.2 },
  { format: '384', process: 'Wash RGT', reagentName: 'Ligation Master Mix', componentName: 'Axiom Ligate Buffer', amount: 20.5 },
  { format: '384', process: 'Wash RGT', reagentName: 'Ligation Master Mix', componentName: 'Axiom Ligate Soln1', amount: 4.05 },
  { format: '384', process: 'Wash RGT', reagentName: 'Ligation Master Mix', componentName: 'Axiom Probe Mix 1', amount: 3.25 },
  { format: '384', process: 'Wash RGT', reagentName: 'Ligation Master Mix', componentName: 'Axiom Probe Mix 2', amount: 3.25 },
  { format: '384', process: 'Wash RGT', reagentName: 'Ligation Master Mix', componentName: 'Axiom Ligate Soln2', amount: 0.98 },
  { format: '96', process: 'Wash RGT', reagentName: 'Ligation Master Mix', componentName: 'Axiom Ligate Buffer', amount: 10.25 },
  { format: '96', process: 'Wash RGT', reagentName: 'Ligation Master Mix', componentName: 'Axiom Ligate Soln1', amount: 2.03 },
  { format: '96', process: 'Wash RGT', reagentName: 'Ligation Master Mix', componentName: 'Axiom Probe Mix 1', amount: 1.63 },
  { format: '96', process: 'Wash RGT', reagentName: 'Ligation Master Mix', componentName: 'Axiom Probe Mix 2', amount: 1.63 },
  { format: '96', process: 'Wash RGT', reagentName: 'Ligation Master Mix', componentName: 'Axiom Ligate Soln2', amount: 0.49 },
  { format: '384', process: 'Ligation Enzyme', reagentName: 'Ligation Enzyme', componentName: 'Axiom Fast Ligation Enzyme', amount: 1.23 },
  { format: '96', process: 'Ligation Enzyme', reagentName: 'Ligation Enzyme', componentName: 'Axiom Fast Ligation Enzyme', amount: 0.613 }
];

export const SCHEDULE_SPREADSHEET_ID = '1eS0I2tvQt0GFPEzHQ3r2wWhYxYLBphvFslN8Q79wfmA';
export const REAGENT_LOG_SPREADSHEET_ID = '1I4JFKw0t3H9b5DPOxhMtjt0N9WKmF5PoJ-oS0Ne9Sbw';
export const REAGENT_BARCODE_SPREADSHEET_ID = '1feUys_TK5NlyZYCFThky8jsULEhuqW0WVldyicORJTA';
export const EQUIP_ISSUE_FOLDER_ID = '10HeJRW4yZFOVtQb76-kmOT6PMo404cK6';
export const PLATE_ISSUE_FOLDER_ID = '1m7sVC7u7l1wZGjCYdKGm-jRexKBu2G1a';
export const CHIP_IMAGE_FOLDER_ID = '1lU3QEtVtCjOBsxlY4p0B3Wsx0Xnfdb9w';
export const CHIP_IMAGE_SPREADSHEET_ID = '1QVVqbMwp8RIDN-68dg3ahi-TLCCRlM73mNd4uwnXHow';
export const CHIP_EQUIPMENT_TYPES = ['GT1', 'GT2', 'GT3', 'GT4', 'GTS'];
export const CHIP_IMAGE_ISSUE_TYPES = ['Hyb bubble', '이물질', 'Scratch', 'Bright edge', '밝기 불균일'];
export const CHIP_TYPES = ['PMDA1', 'PangenomiX', 'AX3', 'AX2_96'];

export type PhotoEntry = { fileId: string; fileName: string; viewUrl: string; thumbnailBase64: string };
export type DailyPhotos = { dna: PhotoEntry[]; pellet: PhotoEntry[] };
