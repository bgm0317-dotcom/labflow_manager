import { useState, useMemo } from 'react';
import { Search, Activity, RotateCcw, CalendarDays, List } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { parseSheetDate } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

const PROCESS_LABELS = ['Day 1', 'Day 2', 'Hyb', 'Wash', 'CHQ'];
const STEP_TO_PROCESS: Record<string, string> = {
  'Day 1': 'Day 1',
  'Day 2': 'Day 2',
  'Hyb': 'Hyb',
  'Wash': 'Wash',
  'CHQ': 'CHQ',
  'Scan/CHQ': 'CHQ',
  'Scan / CHQ': 'CHQ',
  'Scan': 'CHQ',
};

export function TimelineView() {
  const { chipInfoRows, issues, plateIssues, chipImageIssues, setSelectedIssue, setSelectedPlateIssue, setSelectedChipImageId } = useAppStore();
  const [mode, setMode] = useState<'search' | 'browse'>('search');

  // ── Search mode ──────────────────────────────────────────────
  const [queryPlate, setQueryPlate] = useState('');
  const [queryBatch, setQueryBatch] = useState('');
  const [loading, setLoading] = useState(false);

  const normalizedPlate = queryPlate.trim().replace(/^#/, '').toUpperCase();
  const normalizedBatch = queryBatch.trim().replace(/^#/, '').toUpperCase();
  const canSearch = normalizedPlate !== '' && normalizedBatch !== '';

  const matchedChipInfo = useMemo(() => {
    if (!canSearch) return null;
    return chipInfoRows.find(r =>
      r.plateId.toUpperCase() === normalizedPlate &&
      r.batchId.toUpperCase() === normalizedBatch
    ) ?? null;
  }, [chipInfoRows, normalizedPlate, normalizedBatch, canSearch]);

  // ── Browse mode ───────────────────────────────────────────────
  const [browseDate, setBrowseDate] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  });
  const [browseProcess, setBrowseProcess] = useState('Day 1');

  const browseResults = useMemo(() => {
    if (!browseDate || !browseProcess) return [];
    return chipInfoRows.filter(r => {
      if (browseProcess === 'Day 2') {
        // Day 2 is not stored; compute as Day 1 + 1
        const day1Step = r.steps.find(s => s.label === 'Day 1');
        if (!day1Step) return false;
        const day1Date = new Date(day1Step.date + 'T00:00:00');
        day1Date.setDate(day1Date.getDate() + 1);
        const day2Date = `${day1Date.getFullYear()}-${String(day1Date.getMonth() + 1).padStart(2, '0')}-${String(day1Date.getDate()).padStart(2, '0')}`;
        return day2Date === browseDate;
      }
      return r.steps.some(s => STEP_TO_PROCESS[s.label] === browseProcess && s.date === browseDate);
    });
  }, [chipInfoRows, browseDate, browseProcess]);


  const hasAnyResult = matchedChipInfo != null;

  // ── Chip info step timeline card ──────────────────────────────
  const StepTimeline = ({ plateId, batchId, barcode, chipType, steps, highlightProcess }: {
    plateId: string; batchId: string; barcode?: string; chipType?: string;
    steps: { label: string; date: string }[];
    highlightProcess?: string;
  }) => {
    const displaySteps = [...steps];
    const day1Idx = displaySteps.findIndex(s => s.label === 'Day 1');
    const day2Idx = displaySteps.findIndex(s => s.label === 'Day 2');

    // Day 2 자동 표기
    if (day1Idx >= 0 && day2Idx < 0) {
      const day1Date = new Date(displaySteps[day1Idx].date);
      day1Date.setDate(day1Date.getDate() + 1);
      displaySteps.splice(day1Idx + 1, 0, {
        label: 'Day 2',
        date: `${day1Date.getFullYear()}-${String(day1Date.getMonth() + 1).padStart(2, '0')}-${String(day1Date.getDate()).padStart(2, '0')}`
      });
    }


    const openIssue = barcode ? (
      issues.find(i => i.barcode === barcode && i.status === 'Open') ||
      plateIssues.find(i => i.barcode === barcode && i.status === 'Open')
    ) : undefined;
    const openChipIssue = barcode ? chipImageIssues.find(i => i.barcode === barcode && !i.chqResult) : undefined;

    const hasIssue = !!openIssue || !!openChipIssue;

    const handleOpenIssue = () => {
      if (openIssue && 'equipment' in openIssue) setSelectedIssue(openIssue as any);
      else if (openIssue) setSelectedPlateIssue(openIssue as any);
      else if (openChipIssue) setSelectedChipImageId(openChipIssue.id);
    };

    const initial = chipType ? chipType.charAt(0).toUpperCase() : (plateId ? plateId.charAt(0).toUpperCase() : '?');

    return (
      <div className="card-base p-4 md:p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-sm font-black text-primary">{initial}</span>
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <div>
              <h3 className="text-sm font-bold text-foreground font-mono">{plateId} {batchId ? `· ${batchId}` : ''}</h3>
            </div>
            {hasIssue && (
              <button onClick={handleOpenIssue} className="p-1 hover:bg-warning/20 rounded-md transition-colors text-warning" title="이슈 보기">
                <AlertTriangle className="w-4 h-4" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        {displaySteps.length > 0 ? (
          <div className="relative ml-4 pl-6">
            {displaySteps.map((step, idx) => {
              const isHighlighted = highlightProcess
                ? STEP_TO_PROCESS[step.label] === highlightProcess || step.label === highlightProcess
                : idx === displaySteps.length - 1;

              const timeStr = '';

              // 색상 매핑: 강조 단계는 인디고/바이올렛, 나머지는 회색
              const dotOutlineColor = isHighlighted ? 'border-teal-500 bg-teal-500/10' : 'border-muted-foreground/40 bg-muted-foreground/5';
              const dotInnerColor = isHighlighted ? 'bg-teal-500' : 'bg-muted-foreground/40';
              const textColor = isHighlighted ? 'text-teal-500 font-semibold' : 'text-muted-foreground font-semibold';

              return (
                <div key={idx} className="relative py-3">
                  <div className={`absolute z-10 -left-[9px] top-[18px] w-4 h-4 rounded-full flex items-center justify-center border-2 ${dotOutlineColor}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${dotInnerColor}`} />
                  </div>
                  <div className="flex items-center justify-between ml-4 gap-2">
                    <p className={`text-sm ${textColor}`}>{STEP_TO_PROCESS[step.label] ?? step.label}</p>
                    <div className="flex flex-col items-end text-right">
                      <span className="text-[11px] font-mono font-medium text-foreground shrink-0">{step.date}</span>
                      {timeStr && <span className="text-[10px] font-mono font-medium text-muted-foreground">{timeStr}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground pl-2">공정 날짜 정보 없음</p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode('search')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${mode === 'search' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
        >
          <Search className="w-3.5 h-3.5" /> #p / #b 검색
        </button>
        <button
          onClick={() => setMode('browse')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${mode === 'browse' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
        >
          <CalendarDays className="w-3.5 h-3.5" /> 날짜/공정별 조회
        </button>
      </div>

      {/* ── Search mode ── */}
      {mode === 'search' && (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
              <input type="text" value={queryPlate} onChange={e => setQueryPlate(e.target.value)} placeholder="#p" className="input-clean pl-10 text-sm font-mono w-full" />
            </div>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
              <input type="text" value={queryBatch} onChange={e => setQueryBatch(e.target.value)} placeholder="#b (Barcode 맨 끝 3자리)" className="input-clean pl-10 text-sm font-mono w-full" />
            </div>
            {loading && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground shrink-0">
                <RotateCcw className="w-3.5 h-3.5 animate-spin" /> 조회 중...
              </div>
            )}
          </div>

          {!canSearch && (
            <div className="text-center py-16 card-base">
              <Search className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground font-medium">#p와 #b를 모두 입력하면 실험 기록을 불러옵니다</p>
            </div>
          )}

          {canSearch && !loading && !hasAnyResult && (
            <div className="text-center py-16 card-base">
              <Search className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground font-medium">
                <span className="font-mono text-foreground">{normalizedPlate}</span> / <span className="font-mono text-foreground">{normalizedBatch}</span>에 대한 실험 기록이 없습니다
              </p>
            </div>
          )}

          {canSearch && matchedChipInfo && (
            <StepTimeline
              plateId={matchedChipInfo.plateId}
              batchId={matchedChipInfo.batchId}
              barcode={matchedChipInfo.barcode}
              chipType={matchedChipInfo.chipType}
              steps={matchedChipInfo.steps}
            />
          )}
        </>
      )}

      {/* ── Browse mode ── */}
      {mode === 'browse' && (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <input
                type="date"
                value={browseDate}
                onChange={e => setBrowseDate(e.target.value)}
                className="input-clean font-mono w-full"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PROCESS_LABELS.map(p => (
                <button
                  key={p}
                  onClick={() => setBrowseProcess(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${browseProcess === p ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {browseResults.length === 0 ? (
            <div className="text-center py-16 card-base">
              <List className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground font-medium">
                <span className="font-mono text-foreground">{browseDate}</span>에 <span className="font-semibold">{browseProcess}</span> 공정을 진행한 플레이트가 없습니다
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                {browseDate} · {browseProcess} — {browseResults.length}개 플레이트
              </p>
              {browseResults.map((row, idx) => (
                <StepTimeline
                  key={idx}
                  plateId={row.plateId}
                  batchId={row.batchId}
                  chipType={row.chipType}
                  steps={row.steps}
                  highlightProcess={browseProcess}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
