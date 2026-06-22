import React from 'react';
import {
  BarChart2, TrendingUp, ClipboardList,
  ChevronRight, X, Plus, Trash2, GripVertical, Pencil,
  CheckCircle2, Megaphone, ArrowRight, CalendarDays, List,
  Activity, RotateCcw, ChevronLeft, RefreshCw, UserPlus, Repeat2, CalendarPlus
} from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { syncMemberCalendarEvents } from '@/lib/calendarSync';
import { useAppStore } from '@/lib/store';
import { type ChipQCEntry, type CalendarEvent, RECURRING_TASKS } from '@/lib/types';
import { isReExpChip } from '@/lib/utils';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const ANIMAL_EMOJIS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵'];

function SortableTaskItem({ task, memberName, stayActive, onToggle, onRemove }: {
  task: import('@/lib/types').RecurringTask;
  memberName: string;
  stayActive: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all ${!stayActive ? 'opacity-50' : 'bg-card border border-border shadow-sm'} ${isDragging ? 'z-50 shadow-lg' : ''}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="p-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-grab active:cursor-grabbing shrink-0 touch-none"
      >
        <GripVertical className="w-3 h-3" />
      </button>
      <button
        onClick={onToggle}
        className={`w-[15px] h-[15px] rounded-[3px] border-[1.5px] shrink-0 flex items-center justify-center transition-all ${task.completed ? 'bg-accent border-accent' : 'bg-transparent border-muted-foreground/35 hover:border-primary/60'}`}
      >
        {task.completed && (
          <svg viewBox="0 0 10 8" className="w-[9px] h-[7px] text-accent-foreground" fill="none" stroke="currentColor" strokeWidth="2.2">
            <polyline points="1,4 3.8,7 9,1" />
          </svg>
        )}
      </button>
      <span className={`text-[11px] font-medium flex-1 min-w-0 truncate ${task.completed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{task.task}</span>
      {task.completedAt && <span className="text-[9px] font-mono text-muted-foreground hidden sm:block shrink-0">{task.completedAt}</span>}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-all shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}


export function DashboardView() {
  const {
    krHolidays,
    announcements, addAnnouncement, removeAnnouncement, updateAnnouncement,
    tasks, toggleTask, addTask, removeTask, resetTasks, removeTasksByAssignee, addTaskAssignee, removeTaskAssignee, reorderMemberTasks,
    teamMembers, addTeamMember, removeTeamMember, updateTeamMemberEmoji,
    issues, plateIssues, weeklySamples, monthlySamples, monthlyChartData,
    chipQCPending, chqList, setView, user, weeklyStatsByDay,
    syncWithSheets, isLoading,
    todayProgressTargets,
    chipInfoRows,
    reExperimentTracking,
    scheduledTasks, addScheduledTask, removeScheduledTask, updateScheduledTask, completeScheduledTask, toggleScheduledTaskDate, moveScheduledTaskDate,
    calendarEvents, addCalendarEvent, removeCalendarEvent, updateCalendarEvent,
    setSelectedIssue, setSelectedPlateIssue
  } = useAppStore();

  // popover state for task assignment
  const [taskPopoverFor, setTaskPopoverFor] = React.useState<string | null>(null);
  const [taskPopoverCategory, setTaskPopoverCategory] = React.useState<string>(() => Object.keys(RECURRING_TASKS)[0]);
  // new member form
  const [selectedMember, setSelectedMember] = React.useState<string | null>(user?.name ?? null);
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [showAddMember, setShowAddMember] = React.useState(false);
  const [newMemberName, setNewMemberName] = React.useState('');
  const [newMemberEmoji, setNewMemberEmoji] = React.useState('🧪');
  // emoji picker
  const [showEmojiPickerFor, setShowEmojiPickerFor] = React.useState<string | null>(null);
  const [noticeTab, setNoticeTab] = React.useState<'notice' | 'repetitive' | 'schedule'>('notice');
  const [noticeListOpen, setNoticeListOpen] = React.useState(false);
  // edit state per tab
  const [editingAnnId, setEditingAnnId] = React.useState<string | null>(null);
  const [editAnnContent, setEditAnnContent] = React.useState('');
  const [editAnnRemind, setEditAnnRemind] = React.useState('');
  const [editingEventId, setEditingEventId] = React.useState<string | null>(null);
  const [editEventTitle, setEditEventTitle] = React.useState('');
  const [editEventStart, setEditEventStart] = React.useState('');
  const [editEventEnd, setEditEventEnd] = React.useState('');
  const [editingSchedId, setEditingSchedId] = React.useState<string | null>(null);
  const [editSchedName, setEditSchedName] = React.useState('');
  const [calDragOverDate, setCalDragOverDate] = React.useState<string | null>(null);
  const [annView, setAnnView] = React.useState<'list' | 'calendar'>('calendar');
  const [showAnnForm, setShowAnnForm] = React.useState(false);
  const [newAnnContent, setNewAnnContent] = React.useState('');
  const [newAnnRemindDate, setNewAnnRemindDate] = React.useState('');

  // Calendar States
  const [currentMonth, setCurrentMonth] = React.useState(new Date());
  const [selectedDate, setSelectedDate] = React.useState<string>(() => {
    // To local YYYY-MM-DD
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  });


  // Schedule tab event form
  const [showSchedEventForm, setShowSchedEventForm] = React.useState(false);
  const [newEventTitle, setNewEventTitle] = React.useState('');
  const [newEventStart, setNewEventStart] = React.useState('');
  const [newEventEnd, setNewEventEnd] = React.useState('');

  // Scheduled tasks form
  const [showScheduledForm, setShowScheduledForm] = React.useState(false);
  const [newSchedName, setNewSchedName] = React.useState('');
  const [newSchedPeriod, setNewSchedPeriod] = React.useState<'monthly' | 'weekly'>('monthly');
  const [newSchedWeekday, setNewSchedWeekday] = React.useState(3);
  const [newSchedMonthlyType, setNewSchedMonthlyType] = React.useState<'date' | 'nth-weekday' | 'last-weekday'>('date');
  const [newSchedMonthDay, setNewSchedMonthDay] = React.useState<number | 'last'>(1);
  const [newSchedMonthWeek, setNewSchedMonthWeek] = React.useState(1);
  const [newSchedAssignee, setNewSchedAssignee] = React.useState('');
  // Calendar navigation for recurring tasks
  const [schedCalMonth, setSchedCalMonth] = React.useState(() => new Date());

  // Modals
  const [showQCModal, setShowQCModal] = React.useState(false);
  const [showChartModal, setShowChartModal] = React.useState(false);
  const [showDetailsModal, setShowDetailsModal] = React.useState(false);

  // Calendar sync state per member
  const [calSyncState, setCalSyncState] = React.useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});

  const holidays = krHolidays;
  const isBusinessDay = (d: Date) => {
    if (d.getDay() === 0 || d.getDay() === 6) return false;
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return !holidays.has(s);
  };
  const addBusinessDays = (dateStr: string, n: number): string => {
    const d = new Date(dateStr + 'T00:00:00');
    let added = 0;
    while (added < n) { d.setDate(d.getDate() + 1); if (isBusinessDay(d)) added++; }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const openIssues = issues.filter(i => i.status === 'Open').length;

  const todayStr3 = new Date().toISOString().split('T')[0];
  const nextBizDayForUrgent = addBusinessDays(todayStr3, 1);
  const hasUrgent = chqList.some(i => !i.isCompleted && i.deadline && i.deadline <= nextBizDayForUrgent);

  const stats = [
    { label: 'Weekly Samples', value: weeklySamples.toLocaleString(), icon: BarChart2, accent: 'primary' as const, onClick: () => setShowDetailsModal(true) },
    { label: 'Chip QC 미완료', value: chipQCPending, icon: ClipboardList, accent: 'warning' as const, onClick: () => setShowQCModal(true), urgent: chipQCPending > 0 && hasUrgent }
  ];

  // Monthly trend
  const monthlyTrend = React.useMemo(() => {
    if (monthlyChartData.length < 2) return null;
    const cur = monthlyChartData[monthlyChartData.length - 1].samples;
    const prev = monthlyChartData[monthlyChartData.length - 2].samples;
    return cur - prev;
  }, [monthlyChartData]);

  const accentStyles = {
    primary: 'bg-primary/8 text-primary',
    accent: 'bg-accent/8 text-accent',
    warning: 'bg-warning/8 text-warning',
    destructive: 'bg-destructive/8 text-destructive',
  };

  const handleAddAnn = () => {
    if (!newAnnContent.trim()) return;
    addAnnouncement({
      id: Date.now().toString(),
      content: newAnnContent,
      date: new Date().toISOString().slice(0, 10),
      author: user?.name || 'Unknown',
      remindDate: newAnnRemindDate || undefined,
    });
    setNewAnnContent('');
    setNewAnnRemindDate('');
    setShowAnnForm(false);
  };

  const sortedAnnouncements = React.useMemo(
    () => [...announcements].sort((a, b) => b.date.localeCompare(a.date)),
    [announcements]
  );

  const displayAnnouncements = React.useMemo(
    () => annView === 'list' ? sortedAnnouncements.slice(0, 3) : sortedAnnouncements,
    [sortedAnnouncements, annView]
  );

  // Lab Progress Helpers
  const isCompleted = React.useCallback((keyword: string) => {
    const related = tasks.filter(t => t.task.includes(keyword) || t.category.includes(keyword));
    return related.length > 0 && related.every(t => t.completed);
  }, [tasks]);

  const progressItems = React.useMemo(() => [
    { id: 'day1_96', label: 'Day 1_96', targeted: todayProgressTargets.day1_96, done: isCompleted('Day 1_96') },
    { id: 'day1_384', label: 'Day 1_384', targeted: todayProgressTargets.day1_384, done: isCompleted('Day 1_384') },
    { id: 'day2', label: 'Day 2', targeted: todayProgressTargets.day2, done: isCompleted('Day 2') },
    { id: 'hyb', label: 'Hyb', targeted: todayProgressTargets.hyb, done: isCompleted('Hyb') },
    { id: 'wash', label: 'Wash', targeted: todayProgressTargets.wash, done: isCompleted('Wash') }
  ].filter(i => i.targeted), [todayProgressTargets, isCompleted]);

  const totalTargets = progressItems.length;
  const completedTargets = progressItems.filter(i => i.done).length;
  const progressPercent = totalTargets === 0 ? 0 : Math.round((completedTargets / totalTargets) * 100);

  // Calendar view - group by date
  const annByDate = React.useMemo(() => {
    const map: Record<string, typeof announcements> = {};
    announcements.forEach(a => {
      if (!map[a.date]) map[a.date] = [];
      map[a.date].push(a);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [announcements]);

  // Calendar render helpers
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: firstDayOfMonth }, (_, i) => i);


  return (
    <div className="space-y-6 md:space-y-8 max-w-5xl" style={{ fontFamily: '"Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif' }}>
      {/* Stats Header with Refresh */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
          <Activity className="w-4 h-4" /> Overview
        </h2>
        <button
          onClick={() => syncWithSheets()}
          disabled={isLoading}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${isLoading ? 'bg-secondary text-muted-foreground scale-95' : 'bg-primary/10 text-primary hover:bg-primary/20'}`}
        >
          <RotateCcw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          {isLoading ? 'Syncing...' : 'Refresh'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Weekly Samples */}
        {(() => {
          const s = stats[0]; return (
            <div
              className={`stat-card ${s.onClick ? 'cursor-pointer hover:border-primary/30' : ''}`}
              onClick={s.onClick}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accentStyles[s.accent]}`}>
                <s.icon className="w-4.5 h-4.5" strokeWidth={1.5} />
              </div>
              <div className="stat-value text-xl md:text-2xl">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          );
        })()}

        {/* Monthly Samples — 주식 스타일 등락 */}
        <div
          className="stat-card cursor-pointer hover:border-primary/30 transition-all"
          onClick={() => setShowChartModal(true)}
        >
          <div className="flex items-center justify-between">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accentStyles.accent}`}>
              <BarChart2 className="w-4.5 h-4.5" strokeWidth={1.5} />
            </div>
            {monthlyTrend !== null && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${monthlyTrend >= 0
                  ? 'bg-red-500/10 text-red-500'
                  : 'bg-primary/10 text-primary'
                }`}>
                {monthlyTrend >= 0 ? '▲' : '▼'} {Math.abs(monthlyTrend).toLocaleString()}
              </span>
            )}
          </div>
          <div className="stat-value text-xl md:text-2xl">{monthlySamples.toLocaleString()}</div>
          <div className="stat-label">Monthly Samples</div>
        </div>

        {/* Chip QC 미완료 */}
        {(() => {
          const s = stats[1]; return (
            <div
              className={`${(s as any).urgent ? 'stat-card-urgent' : 'stat-card'} ${s.onClick ? 'cursor-pointer hover:border-primary/30' : ''}`}
              onClick={s.onClick}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accentStyles[s.accent]}`}>
                <s.icon className="w-4.5 h-4.5" strokeWidth={1.5} />
              </div>
              <div className="stat-value text-xl md:text-2xl">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          );
        })()}

        {/* Re-experiment Timeline Card */}
        {(() => {
          const RE_STEPS = ['Day 1', 'Day 2', 'Hyb', 'Wash'];

          // 1) Firebase에 등록된 재실험 칩 (수동 등록 via "재실험 포함" 버튼)
          const firebaseEntries = Object.values(reExperimentTracking).filter(e => !e.steps['Wash']);

          // 2) _R/_RE suffix 칩: chipInfoRows에서 감지 (Firebase에 없는 것만)
          const firebaseIds = new Set(firebaseEntries.map(e => e.chipId));
          const suffixRows = chipInfoRows.filter(r => isReExpChip(r.plateId) && !firebaseIds.has(r.plateId));
          // Wash step이 완료된 건 제외
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const activeSuffixRows = suffixRows.filter(r => {
            const washStep = r.steps.find(s => s.label === 'Wash');
            if (!washStep) return true;
            const washD = new Date(washStep.date); washD.setHours(0, 0, 0, 0);
            return washD >= today;
          });

          const totalCount = firebaseEntries.length + activeSuffixRows.length;

          return (
            <div className="stat-card col-span-1">
              <div className="w-9 h-9 flex items-center justify-center text-destructive shrink-0">
                <RefreshCw className="w-5 h-5" strokeWidth={1.5} />
              </div>
              <div className="stat-value text-xl md:text-2xl">{totalCount}</div>
              <div className="stat-label">재실험 진행 중</div>
              {totalCount > 0 && (
                <div className="mt-1 space-y-1.5 overflow-y-auto max-h-[140px] border-t border-border/50 pt-2">
                  <div className="flex items-center gap-1 pl-9">
                    {RE_STEPS.map(s => (
                      <span key={s} className="text-[8px] font-bold text-muted-foreground w-10 text-center truncate">{s}</span>
                    ))}
                  </div>
                  {/* Firebase 등록 칩 */}
                  {firebaseEntries.map(({ chipId, steps, stepTimes }) => (
                    <div key={chipId} className="flex items-center gap-1">
                      <span className="text-[10px] font-bold text-destructive w-8 shrink-0 truncate">{chipId}</span>
                      {RE_STEPS.map(step => {
                        const done = steps[step] ?? false;
                        const time = stepTimes?.[step];
                        return (
                          <div
                            key={step}
                            title={time ? `${step}: ${time}` : step}
                            className={`w-10 h-5 rounded flex items-center justify-center ${done ? 'bg-accent/80 text-accent-foreground' : 'bg-secondary text-muted-foreground/30'}`}
                          >
                            {done ? <CheckCircle2 className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20" />}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {/* _R/_RE suffix 칩 (chipInfoRows 기반) */}
                  {activeSuffixRows.map(row => (
                    <div key={row.plateId} className="flex items-center gap-1">
                      <span className="text-[10px] font-bold text-destructive w-8 shrink-0 truncate">{row.plateId}</span>
                      {RE_STEPS.map(step => {
                        const stepLabel = step === 'Wash' ? ['Wash', 'Scan / CHQ'] : [step];
                        const found = row.steps.find(s => stepLabel.includes(s.label));
                        const done = !!found;
                        return (
                          <div
                            key={step}
                            title={found ? `${step}: ${found.date}` : step}
                            className={`w-10 h-5 rounded flex items-center justify-center ${done ? 'bg-accent/80 text-accent-foreground' : 'bg-secondary text-muted-foreground/30'}`}
                          >
                            {done ? <CheckCircle2 className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20" />}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>


      {/* Notice + Repetitive Tasks */}
      <div className="grid grid-cols-1 gap-4">
        {/* Announcements + Repetitive Tasks — unified card */}
        {(() => {
          const KR_HOLIDAYS = new Set([
            '2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30', '2025-03-01',
            '2025-05-05', '2025-05-06', '2025-06-06', '2025-08-15',
            '2025-10-03', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-09', '2025-12-25',
            '2026-01-01', '2026-01-28', '2026-01-29', '2026-01-30', '2026-03-01',
            '2026-05-05', '2026-06-06', '2026-08-15',
            '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', '2026-10-09', '2026-12-25',
          ]);
          const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
          const WEEK_KO = ['', '첫째', '둘째', '셋째', '넷째', '마지막'];
          const today = new Date();
          // KST 기준 오늘 날짜 (UTC+9)
          const todayStr = (() => {
            const kst = new Date(today.getTime() + 9 * 60 * 60 * 1000);
            return kst.toISOString().split('T')[0];
          })();

          // 로컬 날짜 → YYYY-MM-DD (timezone 버그 방지)
          const localDateStr = (d: Date) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

          const getDueDateInMonth = (t: (typeof scheduledTasks)[0], year: number, month: number): string | null => {
            if (t.period === 'weekly') return null;
            const mType = t.monthlyType ?? 'date';
            if (mType === 'date') {
              const day = t.monthDay === 'last' || t.monthDay === undefined
                ? new Date(year, month + 1, 0).getDate()
                : Math.min(t.monthDay as number, new Date(year, month + 1, 0).getDate());
              return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            } else if (mType === 'last-weekday') {
              const d = new Date(year, month + 1, 0); // 말일 (로컬)
              while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
              return localDateStr(d);
            } else {
              const targetWeek = t.monthWeek ?? 1;
              const targetWd = t.weekday ?? 3;
              if (targetWeek === -1) {
                const last = new Date(year, month + 1, 0);
                while (last.getDay() !== targetWd) last.setDate(last.getDate() - 1);
                return localDateStr(last);
              } else {
                const first = new Date(year, month, 1);
                let off = targetWd - first.getDay();
                if (off < 0) off += 7;
                const nthDay = 1 + off + (targetWeek - 1) * 7;
                if (nthDay > new Date(year, month + 1, 0).getDate()) return null;
                return `${year}-${String(month + 1).padStart(2, '0')}-${String(nthDay).padStart(2, '0')}`;
              }
            }
          };

          const isBusinessDay = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6 && !KR_HOLIDAYS.has(localDateStr(d));
          const toNextBusinessDay = (dateStr: string): string => {
            const d = new Date(dateStr + 'T00:00:00');
            while (!isBusinessDay(d)) d.setDate(d.getDate() + 1);
            return localDateStr(d);
          };

          // 오늘 날짜에 정확히 마감인 업무만 (날짜 지나도 표시 안 함)
          const isDueToday = (t: (typeof scheduledTasks)[0]) => {
            if (t.period === 'weekly') {
              const targetDay = t.weekday ?? 3;
              const diff = targetDay - today.getDay();
              const d = new Date(today);
              d.setDate(today.getDate() + (diff > 0 ? diff - 7 : diff));
              const dueStr = toNextBusinessDay(localDateStr(d));
              return dueStr === todayStr && (!t.lastDone || t.lastDone < dueStr);
            } else {
              const rawStr = getDueDateInMonth(t, today.getFullYear(), today.getMonth());
              if (!rawStr) return false;
              const dueStr = toNextBusinessDay(rawStr);
              return dueStr === todayStr && (!t.lastDone || t.lastDone < dueStr);
            }
          };

          const periodLabel = (t: (typeof scheduledTasks)[0]) => {
            if (t.period === 'weekly') return `매주 ${WEEKDAY_KO[t.weekday ?? 3]}요일`;
            const mType = t.monthlyType ?? 'date';
            if (mType === 'date') return `매달 ${t.monthDay === 'last' ? '말일' : `${t.monthDay}일`}`;
            if (mType === 'last-weekday') return '매달 마지막 영업일';
            return `매달 ${t.monthWeek === -1 ? '마지막' : WEEK_KO[t.monthWeek ?? 1]} ${WEEKDAY_KO[t.weekday ?? 3]}요일`;
          };

          const getNextDueDateStr = (t: (typeof scheduledTasks)[0]): string | null => {
            if (t.period === 'weekly') {
              const wd = t.weekday ?? 3;
              const diff = wd - today.getDay();
              const daysUntil = diff <= 0 ? diff + 7 : diff;
              const next = new Date(today);
              next.setDate(today.getDate() + daysUntil);
              return toNextBusinessDay(next.toISOString().split('T')[0]);
            } else {
              const rawStr = getDueDateInMonth(t, today.getFullYear(), today.getMonth());
              if (rawStr) {
                const bd = toNextBusinessDay(rawStr);
                if (bd > todayStr) return bd;
              }
              const nm = today.getMonth() === 11 ? 0 : today.getMonth() + 1;
              const ny = today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear();
              const nextMonthRaw = getDueDateInMonth(t, ny, nm);
              return nextMonthRaw ? toNextBusinessDay(nextMonthRaw) : null;
            }
          };

          // Due dates for repetitive tasks in the shared calendar month
          const calYear = currentMonth.getFullYear();
          const calMonth = currentMonth.getMonth();
          const calMonthStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
          const reptDoneSet = new Set(scheduledTasks.flatMap(t =>
            (t.doneHistory ?? []).map((e: any) => typeof e === 'string' ? e : e.date)
          ));
          const reptDueDates = new Set<string>(
            scheduledTasks
              .filter(t => t.period === 'monthly')
              .map(t => getDueDateInMonth(t, calYear, calMonth))
              .filter(Boolean) as string[]
          );
          scheduledTasks.filter(t => t.period === 'weekly').forEach(t => {
            const wd = t.weekday ?? 3;
            const daysInM = new Date(calYear, calMonth + 1, 0).getDate();
            for (let d = 1; d <= daysInM; d++) {
              if (new Date(calYear, calMonth, d).getDay() === wd) {
                reptDueDates.add(`${calMonthStr}-${String(d).padStart(2, '0')}`);
              }
            }
          });

          const dueTasks = scheduledTasks.filter(t => isDueToday(t));
          const nDue = dueTasks.length;

          // Calendar range events visible in this month
          const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
          const monthStart = `${calMonthStr}-01`;
          const monthEnd = `${calMonthStr}-${String(daysInMonth).padStart(2, '0')}`;
          const visibleEvents = calendarEvents.filter(e => e.startDate <= monthEnd && e.endDate >= monthStart);

          // Color palette for range event bars
          const eventColorMap: Record<string, { bg: string; dot: string }> = {
            blue:   { bg: 'bg-blue-200',   dot: 'bg-blue-400' },
            green:  { bg: 'bg-emerald-200', dot: 'bg-emerald-400' },
            red:    { bg: 'bg-rose-200',   dot: 'bg-rose-400' },
            purple: { bg: 'bg-violet-200', dot: 'bg-violet-400' },
            orange: { bg: 'bg-orange-200', dot: 'bg-orange-400' },
          };

          // Build week rows for event bar rendering
          const firstDow = new Date(calYear, calMonth, 1).getDay();
          const weekRows: (string | null)[][] = [];
          let week: (string | null)[] = Array(firstDow).fill(null);
          for (let d = 1; d <= daysInMonth; d++) {
            week.push(`${calMonthStr}-${String(d).padStart(2, '0')}`);
            if (week.length === 7) { weekRows.push(week); week = []; }
          }
          if (week.length > 0) {
            while (week.length < 7) week.push(null);
            weekRows.push(week);
          }

          type EventBar = { event: CalendarEvent; colStart: number; colSpan: number; isFirst: boolean };
          const weekEventBars: EventBar[][] = weekRows.map(weekDates => {
            const bars: EventBar[] = [];
            visibleEvents.forEach(event => {
              const firstIdx = weekDates.findIndex(d => d !== null && d! >= event.startDate && d! <= event.endDate);
              if (firstIdx === -1) return;
              let lastIdx = firstIdx;
              for (let i = firstIdx + 1; i < 7; i++) {
                if (weekDates[i] !== null && weekDates[i]! <= event.endDate) lastIdx = i;
                else break;
              }
              bars.push({ event, colStart: firstIdx, colSpan: lastIdx - firstIdx + 1, isFirst: weekDates[firstIdx] === event.startDate });
            });
            return bars;
          });

          return (
            <div className="card-base p-4 md:p-5 space-y-4">
              <div className="section-title">
                <CalendarDays className="w-4 h-4 text-primary" strokeWidth={1.5} />
                Calendar
              </div>
              {/* Shared calendar */}
              <div>
                <div className="flex items-center justify-between mb-3 px-1 text-foreground">
                  <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))} className="p-1 hover:bg-secondary rounded-md transition-colors">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="text-xs font-bold select-none">{currentMonth.getFullYear()}년 {currentMonth.getMonth() + 1}월</div>
                  <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))} className="p-1 hover:bg-secondary rounded-md transition-colors">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Day headers */}
                <div className="grid grid-cols-7 gap-1 text-center mb-1">
                  {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                    <div key={d} className={`text-[10px] font-bold ${d === '일' ? 'text-destructive/80' : d === '토' ? 'text-primary' : 'text-muted-foreground'}`}>{d}</div>
                  ))}
                </div>

                {/* Week rows with event bars */}
                {weekRows.map((weekDates, wi) => {
                  const todayObj = new Date();
                  todayObj.setMinutes(todayObj.getMinutes() - todayObj.getTimezoneOffset());
                  const todayStr = todayObj.toISOString().slice(0, 10);
                  const bars = weekEventBars[wi];
                  return (
                    <div key={wi}>
                      {/* Date cells row */}
                      <div className="grid grid-cols-7 gap-1 text-center">
                        {weekDates.map((dateStr, ci) => {
                          if (!dateStr) return <div key={`blank-${wi}-${ci}`} className="h-7" />;
                          const d = parseInt(dateStr.slice(8));
                          const hasAnn = announcements.some(a => a.remindDate === dateStr);
                          const hasRept = reptDueDates.has(dateStr);
                          const reptDone = reptDoneSet.has(dateStr);
                          const isSelected = selectedDate === dateStr;
                          const isToday = dateStr === todayStr;
                          const dow = new Date(dateStr + 'T00:00:00').getDay();
                          const isSun = dow === 0;
                          const isSat = dow === 6;
                          const isHoliday = !isSun && !isSat && krHolidays.has(dateStr);
                          const isDragOver = calDragOverDate === dateStr;
                          return (
                            <div
                              key={dateStr}
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedDate(prev => prev === dateStr ? '' : dateStr)}
                              onKeyDown={e => e.key === 'Enter' && setSelectedDate(prev => prev === dateStr ? '' : dateStr)}
                              onDragOver={e => { e.preventDefault(); setCalDragOverDate(dateStr); }}
                              onDragLeave={() => setCalDragOverDate(null)}
                              onDrop={e => {
                                e.preventDefault();
                                setCalDragOverDate(null);
                                const taskId = e.dataTransfer.getData('taskId');
                                const fromDate = e.dataTransfer.getData('fromDate');
                                if (taskId && fromDate && fromDate !== dateStr) {
                                  moveScheduledTaskDate(taskId, fromDate, dateStr);
                                  setSelectedDate(dateStr);
                                }
                              }}
                              className={`relative h-9 rounded-md flex items-center justify-center text-xs transition-colors cursor-pointer select-none
                                ${isDragOver ? 'ring-2 ring-primary bg-primary/10' :
                                  isSelected ? 'bg-primary text-primary-foreground font-bold shadow-md' :
                                  isToday ? 'text-violet-500 font-black hover:bg-secondary/50' :
                                  isSun || isHoliday ? 'text-destructive/80 font-medium hover:bg-secondary/50' :
                                  isSat ? 'text-primary font-medium hover:bg-secondary/50' :
                                  'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                                }`}
                            >
                              {d}
                              {(hasAnn || hasRept) && (
                                <div className="absolute bottom-0.5 flex items-center gap-0.5 justify-center">
                                  {hasAnn && <div className={`w-1 h-1 rounded-full ${isSelected ? 'bg-primary-foreground' : 'bg-warning'}`} />}
                                  {hasRept && (reptDone
                                    ? <div className={`w-1 h-1 rounded-full ${isSelected ? 'bg-primary-foreground' : 'bg-primary'}`} />
                                    : <div className={`w-1 h-1 rounded-full border ${isSelected ? 'border-primary-foreground' : 'border-primary'}`} />
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Event bars for this week */}
                      {bars.length > 0 && (
                        <div className="relative mt-0.5 mb-1 space-y-0.5">
                          {bars.map(({ event, colStart, colSpan, isFirst }) => {
                            const colors = eventColorMap[event.color] ?? eventColorMap.blue;
                            const leftPct = (colStart / 7) * 100;
                            const widthPct = (colSpan / 7) * 100;
                            const isLast = event.endDate <= (weekRows[wi].filter(Boolean).at(-1) ?? '');
                            const roundL = isFirst ? 'rounded-l-full' : 'rounded-l-none';
                            const roundR = isLast ? 'rounded-r-full' : 'rounded-r-none';
                            return (
                              <div key={event.id + '-' + wi} className="relative h-[18px]">
                                <div
                                  style={{ left: `calc(${leftPct}% + ${isFirst ? 2 : 0}px)`, width: `calc(${widthPct}% - ${isFirst ? 2 : 0}px - ${isLast ? 2 : 0}px)` }}
                                  className={`absolute inset-y-0 flex items-center px-2 text-[10px] font-semibold text-gray-800 truncate ${colors.bg} ${roundL} ${roundR} group opacity-90 hover:opacity-100 transition-opacity`}
                                >
                                  {isFirst && <span className="truncate leading-none">{event.title}</span>}
                                  {isFirst && (
                                    <button
                                      onClick={e => { e.stopPropagation(); removeCalendarEvent(event.id); }}
                                      className="ml-auto opacity-0 group-hover:opacity-100 shrink-0 text-gray-500 hover:text-gray-900 transition-all"
                                    >
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Selected date detail — shown between calendar and divider */}
              {selectedDate && (() => {
                const selAnns = announcements.filter(a => a.remindDate === selectedDate);
                const selReptTasks = scheduledTasks.filter(t => {
                  // If this date was moved away (it's a key in dateOverrides), exclude
                  if (t.dateOverrides?.[selectedDate]) return false;
                  // If this date is a move target (it's a value in dateOverrides), include
                  if (Object.values(t.dateOverrides ?? {}).includes(selectedDate)) return true;
                  // Normal schedule check
                  const dow = new Date(selectedDate + 'T00:00:00').getDay();
                  if (t.period === 'weekly') return (t.weekday ?? 3) === dow;
                  return getDueDateInMonth(t, calYear, calMonth) === selectedDate;
                });
                if (selAnns.length === 0 && selReptTasks.length === 0) return null;
                return (
                  <div className="mt-3 p-3 bg-secondary/40 rounded-xl space-y-2"
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      const draggedId = e.dataTransfer.getData('taskId');
                      const fromDate = e.dataTransfer.getData('fromDate');
                      if (draggedId && fromDate && fromDate !== selectedDate) {
                        moveScheduledTaskDate(draggedId, fromDate, selectedDate);
                      }
                    }}
                  >
                    <p className="text-[10px] font-bold text-primary font-mono">{selectedDate}</p>
                    {selAnns.length > 0 && (
                      <div className="space-y-1.5">
                        {selAnns.map(ann => (
                          <div key={ann.id} className="group flex items-start justify-between gap-2">
                            <div className="flex items-start gap-1.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-warning mt-1 shrink-0" />
                              <div>
                                <p className="text-xs text-foreground font-medium leading-snug">{ann.content}</p>
                                <p className="text-[10px] text-muted-foreground">{ann.author}</p>
                              </div>
                            </div>
                            <button onClick={() => removeAnnouncement(ann.id)} className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-all shrink-0">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {selReptTasks.length > 0 && (
                      <div className="space-y-1.5">
                        {selReptTasks.map(task => {
                          const doneEntry = (task.doneHistory ?? []).map((e: any) =>
                            typeof e === 'string' ? { date: e } : e
                          ).find((e: any) => e.date === selectedDate);
                          const done = !!doneEntry;
                          return (
                            <div key={task.id} className="flex items-center gap-2 cursor-grab active:cursor-grabbing"
                              draggable
                              onDragStart={e => {
                                e.dataTransfer.setData('taskId', task.id);
                                e.dataTransfer.setData('fromDate', selectedDate);
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                            >
                              <div
                                onClick={() => toggleScheduledTaskDate(task.id, selectedDate, user?.name)}
                                className={`w-[15px] h-[15px] rounded-[3px] border-[1.5px] shrink-0 flex items-center justify-center cursor-pointer transition-all ${done ? 'bg-accent border-accent' : 'border-muted-foreground/35 hover:border-accent/60'}`}
                              >
                                {done && <svg viewBox="0 0 10 8" className="w-[9px] h-[7px] text-accent-foreground" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="1,4 3.8,7 9,1" /></svg>}
                              </div>
                              <span className={`text-xs font-medium select-none ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{task.name}</span>
                              {done && (
                                <span className="ml-auto text-[10px] text-muted-foreground/70 font-mono shrink-0">
                                  {[(doneEntry.completedDate ?? doneEntry.date), doneEntry.time, doneEntry.by].filter(Boolean).join(' · ')}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="border-t border-border pt-4 space-y-3">
                {/* Tab row + add button */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 bg-secondary/60 rounded-lg p-0.5">
                    <button
                      onClick={() => {
                        if (noticeTab === 'notice') { setNoticeListOpen(v => !v); }
                        else { setNoticeTab('notice'); setNoticeListOpen(true); }
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${noticeTab === 'notice' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      <Megaphone className="w-3 h-3" strokeWidth={1.5} />
                      Notice
                      {noticeTab === 'notice' && <ChevronRight className={`w-3 h-3 transition-transform ${noticeListOpen ? 'rotate-90' : ''}`} />}
                    </button>
                    <button
                      onClick={() => {
                        if (noticeTab === 'repetitive') { setNoticeListOpen(v => !v); }
                        else { setNoticeTab('repetitive'); setNoticeListOpen(true); }
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${noticeTab === 'repetitive' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      <Repeat2 className="w-3 h-3" strokeWidth={1.5} />
                      Repetitive
                      {nDue > 0 && <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-warning text-[9px] font-black text-warning-foreground animate-pulse">{nDue}</span>}
                      {noticeTab === 'repetitive' && <ChevronRight className={`w-3 h-3 transition-transform ${noticeListOpen ? 'rotate-90' : ''}`} />}
                    </button>
                    <button
                      onClick={() => {
                        if (noticeTab === 'schedule') { setNoticeListOpen(v => !v); }
                        else { setNoticeTab('schedule'); setNoticeListOpen(true); }
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${noticeTab === 'schedule' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      <CalendarDays className="w-3 h-3" strokeWidth={1.5} />
                      Schedule
                      {noticeTab === 'schedule' && <ChevronRight className={`w-3 h-3 transition-transform ${noticeListOpen ? 'rotate-90' : ''}`} />}
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    {noticeTab === 'notice' && noticeListOpen && (
                      <button onClick={() => { setShowAnnForm(v => !v); setShowScheduledForm(false); setShowSchedEventForm(false); }} className="p-1.5 rounded-md text-primary hover:bg-primary/10 transition-all">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {noticeTab === 'repetitive' && noticeListOpen && (
                      <button onClick={() => { setShowScheduledForm(v => !v); setShowAnnForm(false); setShowSchedEventForm(false); }} className="p-1.5 rounded-md text-primary hover:bg-primary/10 transition-all">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {noticeTab === 'schedule' && noticeListOpen && (
                      <button onClick={() => { setShowSchedEventForm(v => !v); setShowAnnForm(false); setShowScheduledForm(false); }} className="p-1.5 rounded-md text-primary hover:bg-primary/10 transition-all">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {noticeListOpen && (<>
                {/* Notice add form */}
                {noticeTab === 'notice' && showAnnForm && (
                  <div className="space-y-2 p-3 bg-secondary/50 rounded-xl">
                    <input value={newAnnContent} onChange={e => setNewAnnContent(e.target.value)} placeholder="공지사항 입력..." className="input-clean text-xs w-full" onKeyDown={e => e.key === 'Enter' && handleAddAnn()} />
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-muted-foreground font-medium shrink-0">리마인드 날짜</label>
                      <input type="date" value={newAnnRemindDate} onChange={e => setNewAnnRemindDate(e.target.value)} className="input-clean text-xs flex-1" />
                      <button onClick={handleAddAnn} className="btn-primary btn-sm text-[10px] shrink-0">추가</button>
                    </div>
                  </div>
                )}

                {/* Repetitive add form */}
                {noticeTab === 'repetitive' && showScheduledForm && (
                  <div className="p-3 bg-secondary/50 rounded-xl space-y-2">
                    <input value={newSchedName} onChange={e => setNewSchedName(e.target.value)} placeholder="업무명" className="input-clean text-xs w-full" />
                    <div className="flex flex-wrap gap-2">
                      <select value={newSchedPeriod} onChange={e => setNewSchedPeriod(e.target.value as 'weekly' | 'monthly')} className="input-clean text-xs">
                        <option value="weekly">매주</option>
                        <option value="monthly">매달</option>
                      </select>
                      {newSchedPeriod === 'weekly' && (
                        <select value={newSchedWeekday} onChange={e => setNewSchedWeekday(Number(e.target.value))} className="input-clean text-xs">
                          {[1, 2, 3, 4, 5].map(i => <option key={i} value={i}>{WEEKDAY_KO[i]}요일</option>)}
                        </select>
                      )}
                      {newSchedPeriod === 'monthly' && (<>
                        <select value={newSchedMonthlyType} onChange={e => setNewSchedMonthlyType(e.target.value as any)} className="input-clean text-xs">
                          <option value="date">날짜 기준</option>
                          <option value="nth-weekday">요일 기준</option>
                          <option value="last-weekday">말일 평일</option>
                        </select>
                        {newSchedMonthlyType === 'date' && (
                          <select value={String(newSchedMonthDay)} onChange={e => setNewSchedMonthDay(e.target.value === 'last' ? 'last' : Number(e.target.value))} className="input-clean text-xs">
                            {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}일</option>)}
                            <option value="last">말일</option>
                          </select>
                        )}
                        {newSchedMonthlyType === 'nth-weekday' && (<>
                          <select value={newSchedMonthWeek} onChange={e => setNewSchedMonthWeek(Number(e.target.value))} className="input-clean text-xs">
                            <option value={1}>첫째</option><option value={2}>둘째</option><option value={3}>셋째</option><option value={4}>넷째</option><option value={-1}>마지막</option>
                          </select>
                          <select value={newSchedWeekday} onChange={e => setNewSchedWeekday(Number(e.target.value))} className="input-clean text-xs">
                            {WEEKDAY_KO.map((d, i) => <option key={i} value={i}>{d}요일</option>)}
                          </select>
                        </>)}
                      </>)}
                      <select value={newSchedAssignee} onChange={e => setNewSchedAssignee(e.target.value)} className="input-clean text-xs">
                        <option value="">담당자 없음</option>
                        {teamMembers.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                      </select>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowScheduledForm(false)} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-secondary transition-all">취소</button>
                      <button onClick={() => {
                        if (!newSchedName.trim()) return;
                        addScheduledTask({
                          name: newSchedName.trim(), period: newSchedPeriod,
                          weekday: (newSchedPeriod === 'weekly' || newSchedMonthlyType === 'nth-weekday') ? newSchedWeekday : undefined,
                          monthlyType: newSchedPeriod === 'monthly' ? newSchedMonthlyType : undefined,
                          monthDay: (newSchedPeriod === 'monthly' && newSchedMonthlyType === 'date') ? newSchedMonthDay : undefined,
                          monthWeek: (newSchedPeriod === 'monthly' && newSchedMonthlyType === 'nth-weekday') ? newSchedMonthWeek : undefined,
                          assignee: newSchedAssignee || undefined,
                        });
                        setNewSchedName(''); setShowScheduledForm(false);
                      }} className="btn-primary btn-sm text-[11px]">저장</button>
                    </div>
                  </div>
                )}

                {/* Notice list */}
                {noticeTab === 'notice' && (
                  <div className="space-y-1">
                    {sortedAnnouncements.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-6 italic">공지사항이 없습니다.</p>
                    ) : sortedAnnouncements.slice(0, 3).map(ann => (
                      editingAnnId === ann.id ? (
                        <div key={ann.id} className="space-y-1.5 p-3 bg-secondary/50 rounded-xl border border-border">
                          <textarea value={editAnnContent} onChange={e => setEditAnnContent(e.target.value)} rows={2} className="input-clean text-xs w-full resize-none" />
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] text-muted-foreground shrink-0">리마인드</label>
                            <input type="date" value={editAnnRemind} onChange={e => setEditAnnRemind(e.target.value)} className="input-clean text-xs flex-1" />
                            <button onClick={() => { updateAnnouncement(ann.id, { content: editAnnContent, remindDate: editAnnRemind || undefined }); setEditingAnnId(null); }} className="btn-primary btn-sm text-[10px]">저장</button>
                            <button onClick={() => setEditingAnnId(null)} className="text-xs text-muted-foreground hover:text-foreground">취소</button>
                          </div>
                        </div>
                      ) : (
                        <div key={ann.id} className="group flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border/50 bg-secondary/20 hover:bg-secondary/40 transition-all">
                          <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-warning/70" />
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] font-semibold text-foreground leading-snug truncate block">{ann.content}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {ann.author} · {ann.date}
                              {ann.remindDate && <span className="ml-1.5 font-bold text-warning">{ann.remindDate}</span>}
                            </span>
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-all shrink-0">
                            <button onClick={() => { setEditingAnnId(ann.id); setEditAnnContent(ann.content); setEditAnnRemind(ann.remindDate || ''); }} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Pencil className="w-3 h-3" /></button>
                            <button onClick={() => removeAnnouncement(ann.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
                          </div>
                        </div>
                      )
                    ))}
                  </div>
                )}

                {/* Repetitive list */}
                {noticeTab === 'repetitive' && (
                  <div className="space-y-1">
                    {scheduledTasks.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-6">반복 업무가 없습니다.</p>
                    ) : scheduledTasks.map(task => {
                      const member = teamMembers.find(m => m.name === task.assignee);
                      const nextDate = getNextDueDateStr(task);
                      const isToday = isDueToday(task);
                      const doneToday = !!(task.doneHistory ?? []).find((e: any) => (typeof e === 'string' ? e : e.date) === todayStr);
                      if (editingSchedId === task.id) return (
                        <div key={task.id} className="space-y-1.5 p-3 bg-secondary/50 rounded-xl border border-border">
                          <input value={editSchedName} onChange={e => setEditSchedName(e.target.value)} className="input-clean text-xs w-full" placeholder="업무명" />
                          <div className="flex items-center gap-2">
                            <select defaultValue={task.assignee || ''} id={`edit-assignee-${task.id}`} className="input-clean text-xs flex-1">
                              <option value="">담당자 없음</option>
                              {teamMembers.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                            </select>
                            <button onClick={() => {
                              const sel = document.getElementById(`edit-assignee-${task.id}`) as HTMLSelectElement;
                              updateScheduledTask(task.id, { name: editSchedName, assignee: sel.value || undefined });
                              setEditingSchedId(null);
                            }} className="btn-primary btn-sm text-[10px]">저장</button>
                            <button onClick={() => setEditingSchedId(null)} className="text-xs text-muted-foreground hover:text-foreground">취소</button>
                          </div>
                        </div>
                      );
                      return (
                        <div key={task.id} className="group flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border/50 bg-secondary/20 hover:bg-secondary/40 transition-all">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isToday ? (doneToday ? 'bg-muted-foreground/30' : 'bg-warning') : 'bg-muted-foreground/25'}`} />
                          <div className="flex-1 min-w-0">
                            <span className={`text-[11px] font-semibold ${doneToday ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{task.name}</span>
                            <span className="text-[10px] text-muted-foreground ml-1.5">{periodLabel(task)}{member ? ` · ${member.name}` : ''}</span>
                          </div>
                          {nextDate && !isToday && <span className="text-[9px] font-mono text-muted-foreground/60 shrink-0">{nextDate}</span>}
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-all shrink-0">
                            <button onClick={() => { setEditingSchedId(task.id); setEditSchedName(task.name); }} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Pencil className="w-3 h-3" /></button>
                            <button onClick={() => removeScheduledTask(task.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Schedule add form */}
                {noticeTab === 'schedule' && showSchedEventForm && (
                  <div className="space-y-2 p-3 bg-secondary/50 rounded-xl">
                    <input value={newEventTitle} onChange={e => setNewEventTitle(e.target.value)} placeholder="일정 제목" className="input-clean text-xs w-full" onKeyDown={e => e.key === 'Enter' && (() => { if (!newEventTitle.trim() || !newEventStart || !newEventEnd) return; addCalendarEvent({ title: newEventTitle.trim(), startDate: newEventStart, endDate: newEventEnd, color: 'blue' }); setNewEventTitle(''); setNewEventStart(''); setNewEventEnd(''); setShowSchedEventForm(false); })()} />
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground font-medium">시작일</label>
                        <input type="date" value={newEventStart} onChange={e => setNewEventStart(e.target.value)} className="input-clean text-xs w-full mt-0.5" />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground font-medium">종료일</label>
                        <input type="date" value={newEventEnd} onChange={e => setNewEventEnd(e.target.value)} className="input-clean text-xs w-full mt-0.5" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={() => {
                        if (!newEventTitle.trim() || !newEventStart || !newEventEnd) return;
                        addCalendarEvent({ title: newEventTitle.trim(), startDate: newEventStart, endDate: newEventEnd, color: 'blue' });
                        setNewEventTitle(''); setNewEventStart(''); setNewEventEnd('');
                        setShowSchedEventForm(false);
                      }} className="btn-primary btn-sm text-[10px] shrink-0">추가</button>
                      <button onClick={() => setShowSchedEventForm(false)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">취소</button>
                    </div>
                  </div>
                )}

                {/* Schedule list — 최근 3개 */}
                {noticeTab === 'schedule' && (
                  <div className="space-y-1">
                    {calendarEvents.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-6">등록된 일정이 없습니다.</p>
                    ) : [...calendarEvents].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 3).map(event => {
                      const isOngoing = event.startDate <= todayStr && event.endDate >= todayStr;
                      const dotColor = (eventColorMap[event.color] ?? eventColorMap.blue).dot;
                      if (editingEventId === event.id) return (
                        <div key={event.id} className="space-y-1.5 p-3 bg-secondary/50 rounded-xl border border-border">
                          <input value={editEventTitle} onChange={e => setEditEventTitle(e.target.value)} className="input-clean text-xs w-full" />
                          <div className="flex gap-2">
                            <div className="flex-1"><label className="text-[10px] text-muted-foreground">시작일</label><input type="date" value={editEventStart} onChange={e => setEditEventStart(e.target.value)} className="input-clean text-xs w-full mt-0.5" /></div>
                            <div className="flex-1"><label className="text-[10px] text-muted-foreground">종료일</label><input type="date" value={editEventEnd} onChange={e => setEditEventEnd(e.target.value)} className="input-clean text-xs w-full mt-0.5" /></div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => { updateCalendarEvent(event.id, { title: editEventTitle, startDate: editEventStart, endDate: editEventEnd }); setEditingEventId(null); }} className="btn-primary btn-sm text-[10px]">저장</button>
                            <button onClick={() => setEditingEventId(null)} className="text-xs text-muted-foreground hover:text-foreground">취소</button>
                          </div>
                        </div>
                      );
                      return (
                        <div key={event.id} className="group flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border/50 bg-secondary/20 hover:bg-secondary/40 transition-all">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOngoing ? dotColor : 'bg-muted-foreground/25'}`} />
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] font-semibold text-foreground">{event.title}</span>
                            <span className="text-[10px] text-muted-foreground ml-1.5 font-mono">{event.startDate === event.endDate ? event.startDate : `${event.startDate} ~ ${event.endDate}`}</span>
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-all shrink-0">
                            <button onClick={() => { setEditingEventId(event.id); setEditEventTitle(event.title); setEditEventStart(event.startDate); setEditEventEnd(event.endDate); }} className="p-1 text-muted-foreground hover:text-primary transition-colors"><Pencil className="w-3 h-3" /></button>
                            <button onClick={() => removeCalendarEvent(event.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                </>)}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Daily Checklist */}
      <div className="card-base p-4 md:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="section-title">
            <CheckCircle2 className="w-4 h-4 text-accent" strokeWidth={1.5} />
            Daily Task List
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { if (confirm('모든 업무를 초기화할까요?')) resetTasks(); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
            <button
              onClick={() => setShowAddMember(v => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-primary hover:bg-primary/10 transition-all"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Add member
            </button>
          </div>
        </div>

        {/* Member filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {teamMembers.map(m => (
            <button
              key={m.name}
              onClick={() => setSelectedMember(m.name)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
                selectedMember === m.name
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80'
              }`}
            >
              <span>{m.emoji}</span>
              <span>{m.name}</span>
            </button>
          ))}
          <button
            onClick={() => setSelectedMember(null)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all ${
              selectedMember === null
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80'
            }`}
          >
            전체
          </button>
        </div>

        {showAddMember && (
          <div className="flex items-center gap-2 p-3 bg-secondary/50 rounded-xl">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowEmojiPickerFor(showEmojiPickerFor === '__new__' ? null : '__new__')}
                className="w-10 h-10 text-xl flex items-center justify-center bg-card border border-border rounded-lg hover:border-primary/50 transition-all"
              >{newMemberEmoji}</button>
              {showEmojiPickerFor === '__new__' && (
                <div className="absolute top-12 left-0 z-50 grid grid-cols-5 gap-1 p-2 bg-card border border-border rounded-xl shadow-lg w-[172px]">
                  {ANIMAL_EMOJIS.map(e => (
                    <button key={e} type="button" onClick={() => { setNewMemberEmoji(e); setShowEmojiPickerFor(null); }}
                      className={`w-8 h-8 text-lg flex items-center justify-center rounded-lg hover:bg-secondary transition-all ${newMemberEmoji === e ? 'bg-primary/15 ring-1 ring-primary' : ''}`}>{e}</button>
                  ))}
                </div>
              )}
            </div>
            <input
              value={newMemberName}
              onChange={e => setNewMemberName(e.target.value)}
              placeholder="이름 입력"
              className="input-clean text-xs flex-1"
              onKeyDown={e => {
                if (e.key === 'Enter' && newMemberName.trim()) {
                  addTeamMember({ name: newMemberName.trim(), emoji: newMemberEmoji });
                  setNewMemberName(''); setNewMemberEmoji('🧪'); setShowAddMember(false);
                }
              }}
            />
            <button
              onClick={() => {
                if (!newMemberName.trim()) return;
                addTeamMember({ name: newMemberName.trim(), emoji: newMemberEmoji });
                setNewMemberName(''); setNewMemberEmoji('🧪'); setShowAddMember(false);
              }}
              className="btn-primary btn-sm text-[11px]"
            >추가</button>
          </div>
        )}

        <div className={`grid gap-3 ${selectedMember === null ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3' : 'grid-cols-1'}`}>
          {(selectedMember === null ? teamMembers : teamMembers.filter(m => m.name === selectedMember)).map((member) => {
            const personTasks = tasks
              .filter(t => {
                const assignees = t.assignees ?? (t.assignee ? [t.assignee] : []);
                return assignees.includes(member.name);
              })
              .sort((a, b) => Number(a.completed) - Number(b.completed));

            return (
              <div
                key={member.name}
                className="relative rounded-xl border bg-secondary/30 p-3 flex flex-col min-h-[180px] border-border"
              >
                {/* Header */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="relative">
                    <button
                      onClick={() => setShowEmojiPickerFor(showEmojiPickerFor === member.name ? null : member.name)}
                      className="w-8 h-8 rounded-xl flex items-center justify-center text-lg bg-secondary border border-border/50 hover:border-primary/50 transition-all"
                      title="이모지 변경"
                    >
                      {member.emoji}
                    </button>
                    {showEmojiPickerFor === member.name && (
                      <div className="absolute top-10 left-0 z-50 grid grid-cols-5 gap-1 p-2 bg-card border border-border rounded-xl shadow-lg w-[172px]">
                        {ANIMAL_EMOJIS.map(e => (
                          <button key={e} type="button" onClick={() => { updateTeamMemberEmoji(member.name, e); setShowEmojiPickerFor(null); }}
                            className={`w-8 h-8 text-lg flex items-center justify-center rounded-lg hover:bg-secondary transition-all ${member.emoji === e ? 'bg-primary/15 ring-1 ring-primary' : ''}`}>{e}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-bold text-foreground">{member.name}</span>
                      {personTasks.length === 0 && <span className="text-xs">💤</span>}
                      {personTasks.length >= 7 && <span className="text-xs animate-pulse">🔥</span>}
                    </div>
                    <span className="text-[9px] text-muted-foreground">{personTasks.length} tasks</span>
                  </div>
                  {/* 업무 추가 버튼 */}
                  <button
                    title="업무 추가"
                    onClick={() => {
                      if (taskPopoverFor === member.name) {
                        setTaskPopoverFor(null);
                      } else {
                        setTaskPopoverFor(member.name);
                        setTaskPopoverCategory(Object.keys(RECURRING_TASKS)[0]);
                      }
                    }}
                    className="p-1 text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    title="캘린더에 추가"
                    disabled={calSyncState[member.name] === 'loading'}
                    onClick={async () => {
                      const taskNames = personTasks.map(t => t.task);
                      setCalSyncState(s => ({ ...s, [member.name]: 'loading' }));
                      try {
                        const added = await syncMemberCalendarEvents(taskNames);
                        setCalSyncState(s => ({ ...s, [member.name]: 'done' }));
                        setTimeout(() => setCalSyncState(s => ({ ...s, [member.name]: 'idle' })), 2500);
                        if (added === 0) alert('이미 캘린더에 모두 등록되어 있습니다.');
                        else alert(`${added}개 일정이 Google Calendar에 추가되었습니다.`);
                      } catch (e: any) {
                        setCalSyncState(s => ({ ...s, [member.name]: 'error' }));
                        alert(e.message || '캘린더 추가 실패');
                        setTimeout(() => setCalSyncState(s => ({ ...s, [member.name]: 'idle' })), 2000);
                      }
                    }}
                    className={`p-1 transition-colors ${calSyncState[member.name] === 'done' ? 'text-accent' :
                        calSyncState[member.name] === 'error' ? 'text-destructive' :
                          'text-muted-foreground hover:text-primary'
                      }`}
                  >
                    {calSyncState[member.name] === 'loading'
                      ? <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                      : <CalendarPlus className="w-3.5 h-3.5" />
                    }
                  </button>
                  <button
                    onClick={() => { if (window.confirm(`${member.name}의 모든 업무를 삭제할까요?`)) removeTasksByAssignee(member.name); }}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                    title="전체 삭제"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => { if (window.confirm(`${member.name}를 삭제할까요?`)) removeTeamMember(member.name); }}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                    title="멤버 삭제"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Tasks */}
                <div className="flex-1 space-y-1">
                  {personTasks.length === 0 && (
                    <div className="flex items-center justify-center border border-dashed border-border rounded-lg py-5">
                      <p className="text-[10px] text-muted-foreground">+ 버튼으로 업무 추가</p>
                    </div>
                  )}
                  <DndContext
                    sensors={dndSensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(event: DragEndEvent) => {
                      const { active, over } = event;
                      if (!over || active.id === over.id) return;
                      const oldIdx = personTasks.findIndex(t => t.id === active.id);
                      const newIdx = personTasks.findIndex(t => t.id === over.id);
                      reorderMemberTasks(arrayMove(personTasks, oldIdx, newIdx).map(t => t.id));
                    }}
                  >
                    <SortableContext items={personTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                      {personTasks.map((task) => {
                        const isFull = (task.assignees?.length ?? (task.assignee ? 1 : 0)) >= 3;
                        const stayActive = !isFull || !task.completed;
                        return (
                          <SortableTaskItem
                            key={task.id}
                            task={task}
                            memberName={member.name}
                            stayActive={stayActive}
                            onToggle={() => toggleTask(task.id, member.name)}
                            onRemove={() => removeTask(task.id)}
                          />
                        );
                      })}
                    </SortableContext>
                  </DndContext>
                </div>

              </div>
            );
          })}
        </div>
      </div>

      {/* 업무 추가 모달 */}
      {taskPopoverFor !== null && (() => {
        const modalMember = teamMembers.find(m => m.name === taskPopoverFor);
        if (!modalMember) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm" onClick={() => setTaskPopoverFor(null)}>
            <div className="w-full sm:max-w-sm bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-foreground flex items-center gap-2">
                  <span>{modalMember.emoji}</span>
                  <span>{modalMember.name} 업무 추가</span>
                </span>
                <button onClick={() => setTaskPopoverFor(null)} className="p-1 hover:bg-secondary rounded-lg transition-colors">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {Object.keys(RECURRING_TASKS).map(cat => (
                  <button key={cat} onClick={() => setTaskPopoverCategory(cat)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${taskPopoverCategory === cat ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
                    {cat}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-0.5 max-h-60 overflow-y-auto">
                {RECURRING_TASKS[taskPopoverCategory].map(taskText => {
                  const already = tasks.find(t => t.task === taskText);
                  const assignees = already?.assignees ?? (already?.assignee ? [already.assignee] : []);
                  const assigned = assignees.includes(modalMember.name);
                  const isFull = assignees.length >= 3;
                  return (
                    <div key={taskText} className={`flex items-center gap-1 rounded-lg text-[11px] font-medium ${assigned ? 'bg-accent/10' : isFull ? 'opacity-40' : 'hover:bg-secondary'}`}>
                      <button
                        disabled={assigned || isFull}
                        onClick={() => {
                          if (already) { addTaskAssignee(already.id, modalMember.name); }
                          else { addTask({ id: Date.now().toString(), category: taskPopoverCategory, task: taskText, completed: false, assignees: [modalMember.name] }); }
                        }}
                        className="flex-1 text-left px-3 py-2 flex items-center gap-2 min-w-0"
                      >
                        <span className={`truncate ${assigned ? 'text-accent' : isFull ? 'text-muted-foreground' : 'text-foreground'}`}>{taskText}</span>
                        {assigned && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-accent" />}
                      </button>
                      {assigned && already && (
                        <button
                          onClick={() => removeTaskAssignee(already.id, modalMember.name)}
                          className="pr-2.5 py-2 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          title="할당 취소"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Weekly Details Modal */}
      {showDetailsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card-base w-full max-w-2xl p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <BarChart2 className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-base font-bold text-foreground">주간 샘플 상세 내역</h3>
              </div>
              <button
                onClick={() => setShowDetailsModal(false)}
                className="p-1.5 hover:bg-secondary rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs table-fixed">
                <thead>
                  <tr className="border-b border-border">
                    <th className="pb-3 text-left font-bold text-muted-foreground pl-2 w-[25%]">날짜 (요일)</th>
                    <th className="pb-3 text-right font-bold text-primary w-[17%]">PMDA1</th>
                    <th className="pb-3 text-right font-bold text-emerald-500 w-[20%]">PangenomiX</th>
                    <th className="pb-3 text-right font-bold text-amber-500 w-[17%]">AX3</th>
                    <th className="pb-3 text-right font-bold text-foreground pr-2 w-[21%]">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {weeklyStatsByDay.filter(d => !['토', '일'].includes(d.day)).map((day, idx) => (
                    <tr key={idx} className="hover:bg-secondary/30 transition-colors">
                      <td className="py-3 pl-2">
                        <span className="font-bold text-foreground">{day.date.substring(5).replace('-', '/')}</span>
                        <span className="ml-1 text-muted-foreground font-medium">({day.day})</span>
                      </td>
                      <td className="py-3 text-right font-mono font-bold text-primary">{day.PMDA1}</td>
                      <td className="py-3 text-right font-mono font-bold text-emerald-500">{day.PangenomiX}</td>
                      <td className="py-3 text-right font-mono font-bold text-amber-500">{day.AX3}</td>
                      <td className="py-3 text-right font-mono font-black text-foreground pr-2 bg-slate-500/5">{day.total} chips</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 bg-secondary/30 rounded-xl space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter ml-1">Summary</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 bg-card rounded-lg border border-border/50 text-center">
                  <p className="text-[9px] font-bold text-muted-foreground mb-1">PMDA1</p>
                  <p className="text-lg font-black text-primary">{weeklyStatsByDay.reduce((acc, d) => acc + d.PMDA1, 0)}</p>
                </div>
                <div className="p-3 bg-card rounded-lg border border-border/50 text-center">
                  <p className="text-[9px] font-bold text-muted-foreground mb-1">PangenomiX</p>
                  <p className="text-lg font-black text-emerald-500">{weeklyStatsByDay.reduce((acc, d) => acc + d.PangenomiX, 0)}</p>
                </div>
                <div className="p-3 bg-card rounded-lg border border-border/50 text-center">
                  <p className="text-[9px] font-bold text-muted-foreground mb-1">AX3</p>
                  <p className="text-lg font-black text-amber-500">{weeklyStatsByDay.reduce((acc, d) => acc + d.AX3, 0)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QC Modal */}
      {showQCModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card-base w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-border flex items-center justify-between bg-secondary/30">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-warning" />
                <span className="font-bold text-sm">Chip QC 미완료 목록</span>
              </div>
              <button onClick={() => setShowQCModal(false)} className="p-1 hover:bg-secondary rounded-md">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-left text-[11px]">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="py-2 font-medium">#p</th>
                    <th className="py-2 font-medium">#b</th>
                    <th className="py-2 font-medium">칩 바코드</th>
                    <th className="py-2 font-medium">실험 이슈</th>
                    <th className="py-2 font-medium">납기</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {chqList.filter(i => !i.isCompleted).map(item => {
                    const todayStr2 = new Date().toISOString().split('T')[0];
                    const nextBizDay = addBusinessDays(todayStr2, 1);
                    const isUrgent = item.deadline && item.deadline <= nextBizDay;
                    return (
                      <tr key={item.id} className="hover:bg-secondary/20">
                        <td className="py-2.5 font-mono font-bold text-foreground">{item.plateNo}</td>
                        <td className="py-2.5 font-mono text-muted-foreground">{item.batchNo}</td>
                        <td className="py-2.5 font-mono text-primary">{item.chipBarcode}</td>
                        <td className="py-2.5 text-muted-foreground">{item.issue}</td>
                        <td className={`py-2.5 ${isUrgent ? 'text-destructive font-bold' : ''}`}>{item.deadline}</td>
                      </tr>
                    );
                  })}
                  {chqList.filter(i => !i.isCompleted).length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground">미완료된 QC가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Monthly Chart Modal */}
      {showChartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card-base w-full max-w-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-accent/10 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-accent" />
                </div>
                <h3 className="text-base font-bold text-foreground">월별 샘플 수 추이 ({new Date().getFullYear()}년)</h3>
              </div>
              <button onClick={() => setShowChartModal(false)} className="p-1 hover:bg-secondary rounded-md text-muted-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#64748b' }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ fontSize: '11px', fontWeight: 'bold', color: 'hsl(var(--primary))' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="samples"
                    stroke="hsl(var(--primary))"
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#fff', stroke: 'hsl(var(--primary))', strokeWidth: 2 }}
                    activeDot={{ r: 6, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
