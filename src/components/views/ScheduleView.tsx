import { useState, useMemo, useEffect } from 'react';
import { Clock, CheckCircle2, RotateCcw, Scan, Check, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { parseChipString } from '@/lib/utils';
import { reauthorize } from '@/lib/driveUpload';

const slotLabel = (emoji: string) =>
  emoji === '🌅' ? '#1' : emoji === '🌞' ? '#2' : '#3';

const nowStr = () => {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
};

// 시각 파싱 / 조합 헬퍼
function toHM(timeStr: string): [number, number] {
  if (!timeStr) { const n = new Date(); return [n.getHours(), n.getMinutes()]; }
  const [h, m] = timeStr.split(':').map(Number);
  return [h || 0, m || 0];
}
function fromHM(h: number, m: number): string {
  const nh = ((h % 24) + 24) % 24;
  const nm = ((m % 60) + 60) % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

/** PC 전용: HH / MM 분리 직접 입력 (모바일에서는 숨김) */
function TimeInputPC({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h, m] = toHM(value);
  return (
    <div className="hidden md:flex items-center gap-1 shrink-0">
      <input
        type="number"
        min={0} max={23}
        value={String(h).padStart(2, '0')}
        onChange={e => onChange(fromHM(parseInt(e.target.value) || 0, m))}
        className="w-10 text-center font-mono font-bold text-xs bg-secondary border border-border rounded-lg px-1 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <span className="text-muted-foreground font-bold text-xs">:</span>
      <input
        type="number"
        min={0} max={59}
        value={String(m).padStart(2, '0')}
        onChange={e => onChange(fromHM(h, parseInt(e.target.value) || 0))}
        className="w-10 text-center font-mono font-bold text-xs bg-secondary border border-border rounded-lg px-1 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}

function addH(t: string, h: number) {
  const [hh, mm] = t.split(':').map(Number);
  const total = hh * 60 + mm + h * 60;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function Day2StartTimes({ summary }: { summary: { day2Chips96: string[]; day2Chips384: string[]; prevFinishTime96: string; prevFinishTime384: string } }) {
  const s96  = summary.prevFinishTime96  ? addH(summary.prevFinishTime96,  22) : '';
  const s384 = summary.prevFinishTime384 ? addH(summary.prevFinishTime384, 16) : '';
  const rows = [
    ...(summary.day2Chips96.length  > 0 ? [{ label: '96',  labelColor: 'text-violet-500',  time: s96,  chips: summary.day2Chips96,  chipColor: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' }] : []),
    ...(summary.day2Chips384.length > 0 ? [{ label: '384', labelColor: 'text-emerald-600', time: s384, chips: summary.day2Chips384, chipColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' }] : []),
  ];
  return (
    <div className="space-y-2">
      {rows.map(row => (
        <div key={row.label} className="flex items-center gap-3">
          <div className="flex items-center gap-2 shrink-0 w-24">
            <span className={`text-[10px] font-bold uppercase ${row.labelColor}`}>{row.label}</span>
            <span className={`text-sm font-mono font-bold ${row.time ? 'text-foreground' : 'text-muted-foreground/40'}`}>{row.time || '--:--'}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {row.chips.map(chip => (
              <span key={chip} className={`px-2 py-0.5 rounded-full text-xs font-mono font-bold ${row.chipColor}`}>{chip}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ScheduleView() {
  const {
    todayScheduleSummary, tomorrowScheduleSummary, syncWithSheets, isLoading,
    recordDay1, deleteDay1,
    day1Data, updateDay1, registerChips,
    scheduleState, updateScheduleState, saveHybTimes, saveSpindownNote, toggleHybDone,
    fetchDay1FinishFromSheet, fetchBarcodesFromChipInfo,
    scheduleData,
  } = useAppStore();

  const { hybTimes, hybDone, washStartTimes } = scheduleState;

  // ── UI-only state ───────────────────────────────────────────
  const [viewDay, setViewDay] = useState<'today' | 'tomorrow'>('today');
  const [batchFormat, setBatchFormat] = useState<'96' | '384'>('96');
  const [scanningFor, setScanningFor] = useState<string | null>(null);
  const [savingBarcode, setSavingBarcode] = useState(false);
  const [savedBarcode, setSavedBarcode] = useState(false);
  const [savingTime, setSavingTime] = useState(false);
  const [savedTime, setSavedTime] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [hybSlotSaving, setHybSlotSaving] = useState<Record<string, boolean>>({});
  const [hybSlotSaved, setHybSlotSaved] = useState<Record<string, boolean>>({});
  const [permError, setPermError] = useState(false);


  const { chipInput, chipBarcodes, finishTime, reExperimentChips } = day1Data[batchFormat];

  // 시각 필드가 비어있으면 현재 시각으로 초기화
  useEffect(() => {
    if (!finishTime) updateDay1(batchFormat, { finishTime: nowStr() });
  }, [batchFormat]);

  const toggleReExperiment = (chip: string) =>
    updateDay1(batchFormat, {
      reExperimentChips: { ...reExperimentChips, [chip]: !reExperimentChips[chip] },
    });
  const parsedChips = useMemo(() => parseChipString(chipInput), [chipInput]);

  // 칩 입력이 바뀌면 캐시(chipInfoRows)에서만 바코드 자동 조회 (API 호출 없음)
  useEffect(() => {
    if (parsedChips.length === 0) return;
    const timer = setTimeout(() => {
      fetchBarcodesFromChipInfo(batchFormat, true).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [chipInput, batchFormat]);

  // scheduleData가 로드/갱신되면 공정 종료 시각 자동 조회
  useEffect(() => {
    if (!scheduleData) return;
    fetchDay1FinishFromSheet().catch(() => {});
  }, [scheduleData]);

  // ── helpers ──────────────────────────────────────────────────-─
  const setHybTime = (slotEmoji: string, chip: string, val: string) =>
    updateScheduleState({
      hybTimes: { ...hybTimes, [slotEmoji]: { ...(hybTimes[slotEmoji] || {}), [chip]: val } },
    });


  // ── Day 1 handlers ────────────────────────────────────────────
  const handleSaveBarcodes = async () => {
    if (!chipInput) { alert('#p를 입력해주세요. (예: P1-2, X3)'); return; }
    const hasBarcodes = Object.values(chipBarcodes).some(b => b);
    if (!hasBarcodes) { alert('바코드를 먼저 입력해주세요.'); return; }
    setSavingBarcode(true);
    setPermError(false);
    try {
      await registerChips(batchFormat);
      setSavedBarcode(true);
      setTimeout(() => setSavedBarcode(false), 3000);
    } catch (e: any) {
      const msg: string = e.message || String(e);
      if (msg.includes('permission') || msg.includes('403')) {
        setPermError(true);
      } else {
        alert('바코드 등록 중 오류: ' + msg);
      }
    } finally {
      setSavingBarcode(false);
    }
  };

  const handleSaveTime = async () => {
    if (!chipInput) { alert('#p를 입력해주세요. (예: P1-2, X3)'); return; }
    setSavingTime(true);
    setPermError(false);
    try {
      await recordDay1(batchFormat, chipInput, finishTime);
      setSavedTime(true);
      setTimeout(() => setSavedTime(false), 3000);
    } catch (e: any) {
      const msg: string = e.message || String(e);
      if (msg.includes('permission') || msg.includes('403')) {
        setPermError(true);
      } else {
        alert('저장 중 오류: ' + msg);
      }
    } finally {
      setSavingTime(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('오늘 날짜의 Day 1 기록을 삭제하시겠습니까?')) return;
    setDeleting(true);
    try {
      await deleteDay1(batchFormat);
      updateDay1(batchFormat, { chipInput: '', chipBarcodes: {}, finishTime: '' });
    } catch (e: any) {
      alert(e.message || '삭제 중 오류가 발생했습니다.');
    } finally {
      setDeleting(false);
    }
  };

  // 내일 뷰용 데이터
  const tmr = tomorrowScheduleSummary;
  const isTomorrow = viewDay === 'tomorrow';

  return (
    <div className="space-y-6 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        {/* 오늘/내일 토글 */}
        <div className="flex items-center gap-1 p-1 bg-secondary rounded-xl">
          <button
            onClick={() => setViewDay('today')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${!isTomorrow ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            오늘
          </button>
          <button
            onClick={() => setViewDay('tomorrow')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isTomorrow ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            내일
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          onClick={() => syncWithSheets()}
          disabled={isLoading}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${isLoading ? 'bg-secondary text-muted-foreground scale-95' : 'bg-primary/10 text-primary hover:bg-primary/20'}`}
        >
          <RotateCcw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          {isLoading ? 'Syncing...' : 'Refresh'}
        </button>
      </div>

      {/* ── 내일 스케줄 (읽기 전용) ──────────────────────────── */}
      {isTomorrow && (
        <div className="space-y-4">
          {tmr.date && (
            <p className="text-xs font-mono text-muted-foreground">{tmr.date}</p>
          )}

          {/* Day 1 */}
          <div className="card-base p-4 space-y-3">
            <div className="section-title text-sm">
              <Clock className="w-4 h-4 text-primary" strokeWidth={1.5} /> Day 1
            </div>
            {tmr.day1Chips96.length === 0 && tmr.day1Chips384.length === 0 ? (
              <p className="text-sm text-muted-foreground">Day 1 없음</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tmr.day1Chips96.map(c => <span key={c} className="px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-mono font-bold">{c}</span>)}
                {tmr.day1Chips384.map(c => <span key={c} className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-mono font-bold">{c}</span>)}
              </div>
            )}
          </div>

          {/* Day 2 */}
          <div className="card-base p-4 space-y-3">
            <div className="section-title text-sm">
              <Clock className="w-4 h-4 text-blue-500" strokeWidth={1.5} /> Day 2
            </div>
            {tmr.day2Chips96.length === 0 && tmr.day2Chips384.length === 0 ? (
              <p className="text-sm text-muted-foreground">Day 2 없음</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tmr.day2Chips96.map(c => <span key={c} className="px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-mono font-bold">{c}</span>)}
                {tmr.day2Chips384.map(c => <span key={c} className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-mono font-bold">{c}</span>)}
              </div>
            )}
          </div>

          {/* Hyb */}
          <div className="card-base p-4 space-y-3">
            <div className="section-title text-sm">
              <Clock className="w-4 h-4 text-violet-500" strokeWidth={1.5} /> Hyb
            </div>
            {tmr.hyb.length === 0 ? (
              <p className="text-sm text-muted-foreground">Hyb 없음</p>
            ) : (
              <div className="space-y-3">
                {tmr.hyb.map(slot => (
                  <div key={slot.emoji} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{slot.emoji}</span>
                      <span className="text-xs font-bold text-muted-foreground uppercase">{slotLabel(slot.emoji)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 pl-7">
                      {slot.chips96.map(c => <span key={c} className="px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-mono font-bold">{c}</span>)}
                      {slot.chips384.map(c => <span key={c} className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-mono font-bold">{c}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Wash */}
          <div className="card-base p-4 space-y-3">
            <div className="section-title text-sm">
              <Clock className="w-4 h-4 text-cyan-500" strokeWidth={1.5} /> Wash
            </div>
            {tmr.wash.length === 0 ? (
              <p className="text-sm text-muted-foreground">Wash 없음</p>
            ) : (
              <div className="space-y-3">
                {tmr.wash.map(slot => (
                  <div key={slot.emoji} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{slot.emoji}</span>
                      <span className="text-xs font-bold text-muted-foreground uppercase">{slotLabel(slot.emoji)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 pl-7">
                      {slot.chips96.map(c => <span key={c} className="px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-mono font-bold">{c}</span>)}
                      {slot.chips384.map(c => <span key={c} className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-mono font-bold">{c}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 오늘 스케줄 (기존 입력 UI) ───────────────────────── */}
      {!isTomorrow && (<>

      {/* ── Day 1 ─────────────────────────────────────────────── */}
      <div className="card-base p-5 space-y-4">
        <div className="section-title text-sm">
          <Clock className="w-4 h-4 text-primary" strokeWidth={1.5} />
          Day 1 기록
        </div>

        {/* Format */}
        <div>
          <label className="label-overline mb-2 block">Format</label>
          <div className="flex gap-2">
            {(['96', '384'] as const).map(fmt => (
              <button
                key={fmt}
                onClick={() => setBatchFormat(fmt)}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                  batchFormat === fmt
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>

        {/* #p input */}
        <div>
          <label className="label-overline mb-2 block">#p</label>
          <input
            type="text"
            placeholder=""
            value={chipInput}
            onChange={e => updateDay1(batchFormat, { chipInput: e.target.value, chipBarcodes: {} })}
            className="input-clean font-mono w-full"
          />
        </div>

        {/* Per-chip barcodes */}
        <div>
          <label className="label-overline mb-2 block">Chip 바코드 등록</label>
          {parsedChips.length === 0 ? (
            <p className="text-xs text-muted-foreground">#p를 입력하면 칩별 바코드 입력란이 생성됩니다.</p>
          ) : (
            <div className="space-y-2">
              {parsedChips.map(chip => (
                <div key={chip} className="flex items-center gap-2">
                  <span className={`text-xs font-mono font-bold w-10 shrink-0 ${reExperimentChips[chip] ? 'text-destructive' : 'text-muted-foreground'}`}>{chip}</span>
                  <input
                    type="text"
                    placeholder=""
                    value={chipBarcodes[chip] || ''}
                    onChange={e => updateDay1(batchFormat, { chipBarcodes: { ...chipBarcodes, [chip]: e.target.value } })}
                    className="input-clean font-mono flex-1 text-sm"
                  />
                  <button
                    onClick={() => setScanningFor(chip)}
                    className="p-2 rounded-lg bg-secondary hover:bg-primary/10 hover:text-primary text-muted-foreground transition-all"
                    title="바코드 스캔"
                  >
                    <Scan className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => toggleReExperiment(chip)}
                    className={`px-2 py-1 rounded text-[10px] font-bold transition-all shrink-0 ${
                      reExperimentChips[chip]
                        ? 'bg-destructive/15 text-destructive border border-destructive/30'
                        : 'bg-secondary text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                    }`}
                    title="재실험 샘플 포함"
                  >
                    재실험 샘플 포함
                  </button>
                  {chipBarcodes[chip] && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Finish Time */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label-overline">공정 종료 시각</label>
            <button
              onClick={() => updateDay1(batchFormat, { finishTime: nowStr() })}
              className="px-2 py-0.5 rounded bg-secondary text-xs font-bold hover:bg-primary/10 hover:text-primary transition-colors"
            >
              지금
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={finishTime}
              onChange={e => updateDay1(batchFormat, { finishTime: e.target.value })}
              className="input-clean font-mono text-xs flex-1 md:hidden"
            />
            <TimeInputPC value={finishTime} onChange={v => updateDay1(batchFormat, { finishTime: v })} />
          </div>
        </div>

        {/* Save Barcodes / Save Time / Delete */}
        <div className="flex gap-2">
          <button
            onClick={handleSaveBarcodes}
            disabled={savingBarcode || savingTime || deleting}
            className={`flex-1 btn-primary ${savingBarcode ? 'opacity-50' : ''}`}
          >
            {savedBarcode ? <><CheckCircle2 className="w-4 h-4" /> 바코드 등록 완료</> : savingBarcode ? '등록 중...' : '바코드 등록'}
          </button>
          <button
            onClick={handleSaveTime}
            disabled={savingBarcode || savingTime || deleting}
            className={`flex-1 btn-primary ${savingTime ? 'opacity-50' : ''}`}
          >
            {savedTime ? <><CheckCircle2 className="w-4 h-4" /> 시간 저장 완료</> : savingTime ? '저장 중...' : '시간 저장'}
          </button>
          <button
            onClick={handleDelete}
            disabled={savingBarcode || savingTime || deleting}
            className="flex-1 btn-ghost border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all"
          >
            {deleting ? '삭제 중...' : '삭제'}
          </button>
        </div>

        {/* 권한 오류 배너 */}
        {permError && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 space-y-2">
            <div className="flex items-center gap-2 text-destructive text-xs font-bold">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              시트 편집 권한이 없거나 OAuth 토큰이 만료됐습니다.
            </div>
            <p className="text-[10px] text-muted-foreground">
              스프레드시트에서 편집자 권한을 확인하거나, 아래 버튼으로 Google 권한을 재동의하세요.
            </p>
            <button
              onClick={async () => {
                try { await reauthorize(); setPermError(false); } catch {}
              }}
              className="btn-sm bg-destructive/15 text-destructive hover:bg-destructive/25 rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
            >
              Google 권한 재동의
            </button>
          </div>
        )}
      </div>

      {/* ── Day 2 ─────────────────────────────────────────────── */}
      <div className="card-base p-5 space-y-3">
        <div className="section-title text-sm">
          <Clock className="w-4 h-4 text-blue-500" strokeWidth={1.5} />
          Day 2
        </div>
        {todayScheduleSummary.day2Chips96.length === 0 && todayScheduleSummary.day2Chips384.length === 0
          ? <p className="text-sm text-muted-foreground">오늘 Day 2 없음</p>
          : <Day2StartTimes summary={todayScheduleSummary} />
        }
      </div>

      {/* ── Hyb ───────────────────────────────────────────────── */}
      <div className="card-base p-5 space-y-4">
        <div className="section-title text-sm">
          <Clock className="w-4 h-4 text-violet-500" strokeWidth={1.5} />
          Hyb
        </div>
        {todayScheduleSummary.hyb.length === 0 ? (
          <p className="text-sm text-muted-foreground">오늘 Hyb 없음</p>
        ) : (
          <div className="space-y-4">
            {todayScheduleSummary.hyb.map(slot => (
              <div key={slot.emoji} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{slot.emoji}</span>
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
                      {slotLabel(slot.emoji)}
                    </span>
                  </div>
                  <button
                    onClick={async () => {
                      setHybSlotSaving(p => ({ ...p, [slot.emoji]: true }));
                      try {
                        await saveHybTimes(slot.emoji);
                        setHybSlotSaved(p => ({ ...p, [slot.emoji]: true }));
                        setTimeout(() => setHybSlotSaved(p => ({ ...p, [slot.emoji]: false })), 3000);
                      } catch (e: any) { alert('저장 오류: ' + e.message); }
                      finally { setHybSlotSaving(p => ({ ...p, [slot.emoji]: false })); }
                    }}
                    disabled={hybSlotSaving[slot.emoji]}
                    className={`flex items-center gap-1.5 btn-sm ${hybSlotSaved[slot.emoji] ? 'btn-accent' : 'btn-primary'} ${hybSlotSaving[slot.emoji] ? 'opacity-50' : ''}`}
                  >
                    {hybSlotSaved[slot.emoji] ? <><CheckCircle2 className="w-3 h-3" /> 저장 완료</> : hybSlotSaving[slot.emoji] ? '저장 중...' : '시트에 저장'}
                  </button>
                </div>
                {slot.chips96.length === 0 && slot.chips384.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-6">칩 없음</p>
                ) : (
                  <div className="space-y-2 pl-6">
                    {([
                      { chips: slot.chips96,  fmt: '96'  as const },
                      { chips: slot.chips384, fmt: '384' as const },
                    ]).flatMap(({ chips, fmt }) =>
                      chips.map((chip: string) => (
                        <div key={`${fmt}-${chip}`} className="flex items-center gap-2">
                          <span className={`text-xs font-mono font-bold w-10 shrink-0 ${
                            fmt === '96' ? 'text-violet-500 dark:text-violet-400' : 'text-emerald-600 dark:text-emerald-400'
                          }`}>{chip}</span>
                          <input
                            type="time"
                            value={hybTimes[slot.emoji]?.[chip] || ''}
                            onChange={e => setHybTime(slot.emoji, chip, e.target.value)}
                            className="input-clean font-mono text-xs flex-1 md:hidden"
                          />
                          <TimeInputPC value={hybTimes[slot.emoji]?.[chip] || ''} onChange={v => setHybTime(slot.emoji, chip, v)} />
                          <button
                            onClick={() => setHybTime(slot.emoji, chip, nowStr())}
                            className="px-2 py-0.5 rounded bg-secondary text-xs font-bold hover:bg-primary/10 hover:text-primary transition-colors"
                          >
                            지금
                          </button>
                          <button
                            onClick={() => {
                              const next = !hybDone[slot.emoji]?.[chip];
                              console.log(`[UI] Spindown click: chip=${chip}, nextState=${next}`);
                              toggleHybDone(slot.emoji, chip);
                              if (next) {
                                console.log(`[UI] Calling saveSpindownNote for ${chip}`);
                                saveSpindownNote(slot.emoji, [chip]).catch((e: any) => {
                                  console.error('[Spindown] 시트 저장 실패:', e);
                                  alert('Spindown 기록 저장 실패: ' + (e?.message || String(e)));
                                });
                              }
                            }}
                            title="Spindown 완료 표시"
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-all border ${
                              hybDone[slot.emoji]?.[chip]
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                : 'bg-secondary text-muted-foreground border-transparent hover:border-border'
                            }`}
                          >
                            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-all ${
                              hybDone[slot.emoji]?.[chip] ? 'bg-emerald-500 border-emerald-500' : 'border-muted-foreground/40'
                            }`}>
                              {hybDone[slot.emoji]?.[chip] && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                            </div>
                            Spindown
                            {scheduleState.spindownSaved?.[chip] && (
                              <span className="ml-1 text-[8px] bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-1 rounded">Sheet</span>
                            )}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Wash ──────────────────────────────────────────────── */}
      <div className="card-base p-4 md:p-5 space-y-3">
        <div className="section-title text-sm">
          <Clock className="w-4 h-4 text-cyan-500" strokeWidth={1.5} />
          Wash
        </div>
        {todayScheduleSummary.wash.length === 0 ? (
          <p className="text-sm text-muted-foreground">오늘 Wash 없음</p>
        ) : (
          <div className="space-y-2">
            {todayScheduleSummary.wash.map(slot => (
              <div key={slot.emoji} className="flex items-center gap-3">
                <div className="flex items-center gap-2 shrink-0 w-24">
                  <span className="text-sm">{slot.emoji}</span>
                  <span className={`text-sm font-mono font-bold ${washStartTimes[slot.emoji] ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                    {washStartTimes[slot.emoji] || '--:--'}
                  </span>
                </div>
                {(slot.chips96.length > 0 || slot.chips384.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {slot.chips96.map((chip: string) => (
                      <span key={`96-${chip}`} className="px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-mono font-bold">{chip}</span>
                    ))}
                    {slot.chips384.map((chip: string) => (
                      <span key={`384-${chip}`} className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-mono font-bold">{chip}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Barcode Scanner modal */}
      {scanningFor !== null && (
        <BarcodeScanner
          onScan={result => {
            updateDay1(batchFormat, { chipBarcodes: { ...chipBarcodes, [scanningFor!]: result } });
            setScanningFor(null);
          }}
          onClose={() => setScanningFor(null)}
        />
      )}
    </>)}

    </div>
  );
}
