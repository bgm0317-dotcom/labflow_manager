import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FlaskConical, CheckCircle2, ChevronDown, Clock, Beaker, Camera, Scan, X } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { getAccessToken, uploadPhotoToDrive, createThumbnailBase64 } from '@/lib/driveUpload';
import { sheetsGetValues, sheetsBatchUpdate, sheetsGetMetadata, cellRef } from '@/lib/sheetsApi';
import { REAGENT_DEFINITIONS, REAGENT_BARCODE_SPREADSHEET_ID } from '@/lib/types';
import { parseChipString } from '@/lib/utils';
import type { ReagentGroup, ReagentComponent } from '@/lib/types';
import { BarcodeScanner } from '@/components/BarcodeScanner';

// ── 시약 계량 가이드 ───────────────────────────────────────────
function getDispensingGuide(volMl: number) {
  if (volMl <= 0) return null;
  // Accumulate tube readings (same 50mL tube reused each time)
  const tubeReadings: number[] = [];
  let rem = volMl;
  while (rem >= 10) {
    if (rem >= 50) {
      tubeReadings.push(50);
      rem = parseFloat((rem - 50).toFixed(4));
    } else {
      const reading = Math.floor(rem / 2.5) * 2.5;
      if (reading > 0) { tubeReadings.push(reading); rem = parseFloat((rem - reading).toFixed(4)); }
      break;
    }
  }
  // Remainder: if >200μL divide evenly into N pulls each ≤1000μL
  const remUl = Math.round(parseFloat(rem.toFixed(3)) * 1000);
  let p1000Count = 0;
  let p1000Each = 0;
  let tinyUl = 0;
  if (remUl > 200) {
    p1000Count = Math.ceil(remUl / 1000);
    p1000Each = Math.round(remUl / p1000Count);
  } else if (remUl > 0) {
    tinyUl = remUl; // ≤200μL, show separately
  }
  return { tubeReadings, p1000Count, p1000Each, tinyUl };
}

const CNT = ({ n }: { n: number | string }) => (
  <span className="text-primary font-bold">×{n}</span>
);

function DispensingGuide({ components, batchCount, totalVolumes }: { components: { name: string; amount: number }[]; batchCount: number; totalVolumes?: Record<string, number> }) {
  return (
    <div className="mt-3 pt-3 border-t border-border/40 space-y-2">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">계량 가이드</p>
      {components.map(comp => {
        const vol = totalVolumes?.[comp.name] !== undefined
          ? totalVolumes[comp.name]
          : parseFloat((comp.amount * batchCount * DEAD_VOLUME_FACTOR).toFixed(4));
        const g = getDispensingGuide(vol);
        if (!g) return null;
        const parts: React.ReactNode[] = [];
        g.tubeReadings.forEach((r, i) => {
          parts.push(<span key={`tube${i}`}><span className="text-primary font-bold">{r}</span><span className="text-muted-foreground font-normal"> mL</span></span>);
        });
        if (g.p1000Count > 0) {
          parts.push(
            g.p1000Count === 1
              ? <span key="p1"><span className="text-primary font-bold">{g.p1000Each}</span>μL</span>
              : <span key="p1"><span className="text-primary font-bold">{g.p1000Each}</span>μL <CNT n={g.p1000Count} /></span>
          );
        }
        if (g.tinyUl > 0) parts.push(<span key="tiny"><span className="text-primary font-bold">{g.tinyUl}</span>μL</span>);
        return (
          <div key={comp.name} className="text-[11px]">
            <span className="text-muted-foreground font-medium">{comp.name}</span>
            <span className="text-muted-foreground"> ({vol.toFixed(3)} mL) → </span>
            <span className="text-foreground font-semibold">
              {parts.length > 0
                ? parts.reduce<React.ReactNode[]>((acc, p, i) => i === 0 ? [p] : [...acc, <span key={`sep${i}`} className="text-muted-foreground"> + </span>, p], [])
                : <><span className="text-primary font-bold">{Math.round(vol * 1000)}</span>μL</>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Lot # placeholder 설정 ─────────────────────────────────────
const LOT_PLACEHOLDERS: Record<string, { lot1?: string; lot2?: string }> = {
  'Day 1-96': { lot1: 'M1_96' },
  'Day 1-384': { lot1: 'M1_384' },
  'Day 2_AM': { lot1: 'M2-1', lot2: 'M2-2' },
  'Wash RGT': { lot1: 'M4-1', lot2: 'M4-2' }
};

const PROCESSES = [
  { id: 'Day 1', label: 'Day 1', color: 'primary' },
  { id: 'Day 2_AM', label: 'Day 2_AM', color: 'info' },
  { id: 'Day 2_PM', label: 'Day 2_PM', color: 'accent' },
  { id: 'Wash RGT', label: 'Wash RGT', color: 'warning' },
  { id: 'Ligation Enzyme', label: 'Lig. Enzyme', color: 'destructive' },
];

const DEAD_VOLUME_FACTOR = 1;

// 항상 96+384 합산으로 표시할 시약 (format 전환 시에도 체크 유지)
const ALWAYS_COMBINED = new Set(['Fragmentation Master Mix', 'Fragmentation_96', 'Fragmentation_384']);

export function ReagentView() {
  const { user, todayBatches, todayScheduleSummary, dailyPhotos, addDailyPhoto, removeDailyPhoto, day1Data, saveReagentLog, reagentCheckState, updateReagentCheck, reagentLotSaved, markReagentLotSaved } = useAppStore();
  const [selectedProcess, setSelectedProcess] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('');
  const [batchCount, setBatchCount] = useState('');
  const [lots, setLots] = useState<Record<string, { lot1: string; lot2: string }>>({});
  const lot1 = lots[selectedProcess]?.lot1 ?? '';
  const lot2 = lots[selectedProcess]?.lot2 ?? '';
  const setLot1 = (v: string) => setLots(prev => ({ ...prev, [selectedProcess]: { ...prev[selectedProcess], lot1: v } }));
  const setLot2 = (v: string) => setLots(prev => ({ ...prev, [selectedProcess]: { ...prev[selectedProcess], lot2: v } }));
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [guideGroups, setGuideGroups] = useState<Set<string>>(new Set());
  const toggleGuide = (name: string) => setGuideGroups(prev => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s; });
  const [saving, setSaving] = useState(false);
  const [savingLot, setSavingLot] = useState(false);
  const [showBatchOverrides, setShowBatchOverrides] = useState(false);
  const [scanTarget, setScanTarget] = useState<'lot1' | 'lot2' | null>(null);

  type PhotoType = 'dna' | 'pellet';
  const [pendingFiles, setPendingFiles] = useState<Record<PhotoType, File[]>>({ dna: [], pellet: [] });
  const [uploading, setUploading] = useState<PhotoType | null>(null);

  const handleFileSelect = (files: FileList | null, photoType: PhotoType) => {
    if (!files) return;
    setPendingFiles(prev => ({ ...prev, [photoType]: [...prev[photoType], ...Array.from(files)] }));
  };

  const handlePhotoUpload = async (photoType: PhotoType) => {
    const files = pendingFiles[photoType];
    if (!files.length) return;
    setUploading(photoType);
    try {
      const token = await getAccessToken();
      const today = new Date().toISOString().split('T')[0];
      for (const file of files) {
        const [result, thumbnailBase64] = await Promise.all([
          uploadPhotoToDrive(file, photoType, today, token),
          createThumbnailBase64(file),
        ]);
        addDailyPhoto(photoType, { ...result, thumbnailBase64 });
      }
      setPendingFiles(prev => ({ ...prev, [photoType]: [] }));
    } catch (e: any) {
      alert('업로드 중 오류: ' + e.message);
    } finally {
      setUploading(null);
    }
  };

  const SLOT_EMOJIS = ['🌅', '🌞', '🌙'] as const;
  type SlotEmoji = typeof SLOT_EMOJIS[number];
  const [slotBatches, setSlotBatches] = useState<Record<SlotEmoji, string>>({ '🌅': '', '🌞': '', '🌙': '' });
  // Ligation Enzyme 전용: 96/384 분리
  const [slotBatches96, setSlotBatches96] = useState<Record<SlotEmoji, string>>({ '🌅': '', '🌞': '', '🌙': '' });
  const [slotBatches384, setSlotBatches384] = useState<Record<SlotEmoji, string>>({ '🌅': '', '🌞': '', '🌙': '' });
  const [activeSlot, setActiveSlot] = useState<SlotEmoji | 'total'>('total');
  const [washBatch96Override, setWashBatch96Override] = useState('');
  const [washBatch384Override, setWashBatch384Override] = useState('');
  const [ligBatch96Override, setLigBatch96Override] = useState('');
  const [ligBatch384Override, setLigBatch384Override] = useState('');
  const [batch96Overrides, setBatch96Overrides] = useState<Record<string, string>>({});
  const [batch384Overrides, setBatch384Overrides] = useState<Record<string, string>>({});
  const [showWashOverride, setShowWashOverride] = useState(false);
  const [showLigOverride, setShowLigOverride] = useState(false);
  const [selectedWashGroup, setSelectedWashGroup] = useState<string>('');
  const [batchOverrides, setBatchOverrides] = useState<Record<string, string>>({});

  // Lig enzyme per-component volume override
  const [ligVolumeOverrides, setLigVolumeOverrides] = useState<Record<string, string>>({});
  const [editingLigComp, setEditingLigComp] = useState<string | null>(null);

  const isLigEnzyme = selectedProcess === 'Ligation Enzyme';
  const isWashRGT = selectedProcess === 'Wash RGT';
  const isSlotBased = isWashRGT || isLigEnzyme;

  const reagentGroups = useMemo((): (ReagentGroup & { combined?: boolean })[] => {
    if (!selectedProcess) return [];
    const isFragCombined = ALWAYS_COMBINED.has.bind(ALWAYS_COMBINED);
    const isLigEnzymeProcess = selectedProcess === 'Ligation Enzyme';
    const filtered = REAGENT_DEFINITIONS.filter(r => {
      if (r.process !== selectedProcess) return false;
      // Fragmentation Master Mix: 96/384 모두 포함 (per-format 볼륨 계산)
      if (isFragCombined(r.reagentName)) return true;
      // Wash RGT / Ligation Enzyme: 96/384 모두 포함 (per-format 볼륨 계산)
      if (isWashRGT || isLigEnzymeProcess) return true;
      if (selectedFormat && r.format !== selectedFormat && r.format !== 'all') return false;
      return true;
    });
    const grouped: Record<string, ReagentComponent[]> = {};
    filtered.forEach(r => {
      if (!grouped[r.reagentName]) grouped[r.reagentName] = [];
      // Fragmentation Master Mix / Wash RGT / Ligation Enzyme: 96/384 amount 합산 안 함 (볼륨 계산 시 별도 처리)
      if (isFragCombined(r.reagentName) || isWashRGT || isLigEnzymeProcess) {
        const existing = grouped[r.reagentName].find(c => c.name === r.componentName);
        if (!existing) grouped[r.reagentName].push({ name: r.componentName, amount: r.amount, checked: false });
      } else {
        const existing = grouped[r.reagentName].find(c => c.name === r.componentName);
        if (existing) { existing.amount += r.amount; }
        else { grouped[r.reagentName].push({ name: r.componentName, amount: r.amount, checked: false }); }
      }
    });
    const result: (ReagentGroup & { combined?: boolean })[] = Object.entries(grouped).map(([name, components]) => {
      // Day 2_AM 384 Precipitation Master Mix: Discard 항목을 Isopropanol 앞에 삽입
      if (selectedProcess === 'Day 2_AM' && selectedFormat === '384' && name === 'Precipitation Master Mix') {
        const isoIdx = components.findIndex(c => c.name === 'Isopropanol');
        const at = isoIdx !== -1 ? isoIdx : components.length;
        components = [
          ...components.slice(0, at),
          { name: 'Discard Precip Soln1+Soln2', amount: 5.55, checked: false },
          ...components.slice(at),
        ];
      }
      return {
        reagentName: name, components, timestamp: '', isFullyChecked: false,
        combined: isFragCombined(name),
      };
    });
    return result;
  }, [selectedProcess, selectedFormat, isWashRGT, isLigEnzyme]);

  // Slot 기반 공정 첫 그룹 자동 선택
  React.useEffect(() => {
    if (isSlotBased && reagentGroups.length > 0) {
      setSelectedWashGroup(prev => (prev && reagentGroups.some(g => g.reagentName === prev)) ? prev : reagentGroups[0].reagentName);
    }
    if (!isSlotBased) setSelectedWashGroup('');
  }, [isSlotBased, reagentGroups]);

  // process 변경 시: activeSlot 리셋 및 오버라이드 초기화
  React.useEffect(() => {
    setActiveSlot('total');
    setBatch96Overrides({});
    setBatch384Overrides({});
    setWashBatch96Override(''); setWashBatch384Override('');
    setLigBatch96Override(''); setLigBatch384Override('');
  }, [selectedProcess]);

  // 자동 배치 로딩 (activeSlot은 건드리지 않음)
  React.useEffect(() => {
    if (!selectedProcess) return;
    if (isSlotBased) {
      const batches: Record<SlotEmoji, string> = { '🌅': '', '🌞': '', '🌙': '' };
      const source = isWashRGT ? todayScheduleSummary.hyb : todayScheduleSummary.wash;
      source.forEach(slot => {
        if (slot.emoji === '🌅' || slot.emoji === '🌞' || slot.emoji === '🌙') {
          batches[slot.emoji] = [...(slot.chips96 || []), ...(slot.chips384 || [])].join(', ');
        }
      });
      setSlotBatches(batches);
      // Ligation Enzyme: 96/384 분리 로딩
      if (isLigEnzyme) {
        const b96: Record<SlotEmoji, string> = { '🌅': '', '🌞': '', '🌙': '' };
        const b384: Record<SlotEmoji, string> = { '🌅': '', '🌞': '', '🌙': '' };
        todayScheduleSummary.wash.forEach(slot => {
          if (slot.emoji === '🌅' || slot.emoji === '🌞' || slot.emoji === '🌙') {
            b96[slot.emoji] = (slot.chips96 || []).join(', ');
            b384[slot.emoji] = (slot.chips384 || []).join(', ');
          }
        });
        setSlotBatches96(b96);
        setSlotBatches384(b384);
      }
      return;
    }
    let key = selectedProcess;
    if ((selectedProcess === 'Day 1' || selectedProcess === 'Day 2_AM' || selectedProcess === 'Day 2_PM') && selectedFormat) {
      key = `${selectedProcess} (${selectedFormat})`;
    }
    // 시트에 값이 있으면 시트 우선, 없으면(undefined) Schedule 탭 Firebase 값으로 폴백
    const sheetVal = todayBatches[key];
    if (sheetVal !== undefined) {
      setBatchCount(sheetVal);
    } else if (selectedProcess === 'Day 1' && selectedFormat) {
      setBatchCount(day1Data[selectedFormat as '96' | '384']?.chipInput || '');
    } else {
      setBatchCount('');
    }
  }, [selectedProcess, selectedFormat, todayBatches, todayScheduleSummary, isSlotBased, isWashRGT, day1Data]);

  // 당일 저장된 기록 키 (process-format, Lig Enzyme은 슬롯별 독립)
  const logKey = isLigEnzyme && activeSlot !== 'total'
    ? `Ligation Enzyme-${activeSlot}`
    : `${selectedProcess}-${selectedFormat}`;
  // Fragmentation Master Mix: 96/384 공유 key
  const fragLogKey = 'Day 2_AM-Fragmentation';
  const autoSavedRef = React.useRef(false);

  const [checkState, setCheckState] = useState<Record<string, Record<string, boolean>>>({});
  const [groupFinishTimes, setGroupFinishTimes] = useState<Record<string, string>>({});
  const [groupUsers, setGroupUsers] = useState<Record<string, string>>({});

  // format-specific 및 frag 공유 state를 병합하여 반환
  const mergeFragState = React.useCallback((key: string) => {
    const saved = reagentCheckState[key] || { checkState: {}, groupFinishTimes: {}, groupUsers: {}, savedGroups: {} };
    const fragSaved = reagentCheckState[fragLogKey] || { checkState: {}, groupFinishTimes: {}, groupUsers: {}, savedGroups: {} };
    const merged = { ...(saved.checkState || {}), ...(fragSaved.checkState || {}) };
    const mergedTimes = { ...(saved.groupFinishTimes || {}), ...(fragSaved.groupFinishTimes || {}) };
    const mergedUsers = { ...(saved.groupUsers || {}), ...(fragSaved.groupUsers || {}) };
    const mergedSaved = { ...(saved.savedGroups || {}), ...(fragSaved.savedGroups || {}) };
    return { merged, mergedTimes, mergedUsers, mergedSaved };
  }, [reagentCheckState, fragLogKey]);

  // 공정/포맷 바뀌면 Firebase에서 체크 상태 복원
  React.useEffect(() => {
    const { merged, mergedTimes, mergedUsers } = mergeFragState(logKey);
    setCheckState(merged);
    setGroupFinishTimes(mergedTimes);
    setGroupUsers(mergedUsers);
  }, [logKey, mergeFragState]);

  // 다른 사용자가 체크하면 Firebase → 로컬 상태 실시간 반영
  React.useEffect(() => {
    const { merged, mergedTimes, mergedUsers } = mergeFragState(logKey);
    setCheckState(merged);
    setGroupFinishTimes(mergedTimes);
    setGroupUsers(mergedUsers);
  }, [reagentCheckState, logKey, mergeFragState]);

  const toggleCheck = (reagentName: string, compName: string) => {
    const group = reagentGroups.find(g => g.reagentName === reagentName);
    const prevComp = checkState[reagentName] || {};
    const newComp = { ...prevComp, [compName]: !prevComp[compName] };
    const newCheckState = { ...checkState, [reagentName]: newComp };

    let newFinishTimes = groupFinishTimes;
    let newGroupUsers = groupUsers;
    const wasComplete = group ? group.components.every(c => prevComp[c.name]) : false;
    const isNowComplete = group ? group.components.every(c => newComp[c.name]) : false;

    if (!wasComplete && isNowComplete) {
      newFinishTimes = { ...groupFinishTimes, [reagentName]: nowStr() };
      newGroupUsers = { ...groupUsers, [reagentName]: user?.name || '' };
      setGroupFinishTimes(newFinishTimes);
      setGroupUsers(newGroupUsers);
    } else if (wasComplete && !isNowComplete) {
      newFinishTimes = { ...groupFinishTimes };
      delete newFinishTimes[reagentName];
      newGroupUsers = { ...groupUsers };
      delete newGroupUsers[reagentName];
      setGroupFinishTimes(newFinishTimes);
      setGroupUsers(newGroupUsers);
    }

    setCheckState(newCheckState);

    // Fragmentation Master Mix: 96/384 공유 key에 저장
    const useFragKey = ALWAYS_COMBINED.has(reagentName) && selectedProcess === 'Day 2_AM';
    const activeKey = useFragKey ? fragLogKey : logKey;

    if (useFragKey) {
      // frag key에는 frag 관련 state만
      const fragCheckState = { [reagentName]: newComp };
      const fragTimes = newFinishTimes[reagentName] ? { [reagentName]: newFinishTimes[reagentName] } : {};
      const fragUsers = newGroupUsers[reagentName] ? { [reagentName]: newGroupUsers[reagentName] } : {};
      updateReagentCheck(activeKey, { checkState: fragCheckState, groupFinishTimes: fragTimes, groupUsers: fragUsers });
    } else {
      // format-specific key에는 non-frag state만
      const fmtCheckState: typeof newCheckState = {};
      const fmtTimes: typeof newFinishTimes = {};
      const fmtUsers: typeof newGroupUsers = {};
      Object.keys(newCheckState).forEach(k => {
        if (!ALWAYS_COMBINED.has(k)) { fmtCheckState[k] = newCheckState[k]; }
      });
      Object.keys(newFinishTimes).forEach(k => {
        if (!ALWAYS_COMBINED.has(k)) { fmtTimes[k] = newFinishTimes[k]; }
      });
      Object.keys(newGroupUsers).forEach(k => {
        if (!ALWAYS_COMBINED.has(k)) { fmtUsers[k] = newGroupUsers[k]; }
      });
      updateReagentCheck(logKey, { checkState: fmtCheckState, groupFinishTimes: fmtTimes, groupUsers: fmtUsers });
    }

    // 사용자 요청: 마스터 믹스 하나 완료될 때마다 즉시 저장
    // ⚠️ setState는 비동기이므로 최신 값(newFinishTimes, newGroupUsers)을 직접 전달
    if (!wasComplete && isNowComplete) {
      handleSave(reagentName, newFinishTimes, newGroupUsers);
    }
  };
  const isGroupComplete = (reagentName: string, components: ReagentComponent[]) => {
    const group = checkState[reagentName] || {};
    return components.every(c => group[c.name]);
  };
  const toggleExpand = (name: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  // 배치 수 계산 (range 포함 파싱: "P1-3" → 3개)
  const batch = useMemo(() => {
    return parseChipString(batchCount).length;
  }, [batchCount]);

  const getSlotBatch = (emoji: SlotEmoji) => {
    return parseChipString(slotBatches[emoji] || '').length;
  };
  const getSlotBatch96 = (emoji: SlotEmoji) => parseChipString(slotBatches96[emoji] || '').length;
  const getSlotBatch384 = (emoji: SlotEmoji) => parseChipString(slotBatches384[emoji] || '').length;

  // Ligation Enzyme: 96/384 totals and overrides
  const totalLigBatch96 = SLOT_EMOJIS.reduce((sum, e) => sum + getSlotBatch96(e), 0);
  const totalLigBatch384 = SLOT_EMOJIS.reduce((sum, e) => sum + getSlotBatch384(e), 0);
  const effectiveLigBatch96 = ligBatch96Override !== '' ? (parseFloat(ligBatch96Override) || 0) : totalLigBatch96;
  const effectiveLigBatch384 = ligBatch384Override !== '' ? (parseFloat(ligBatch384Override) || 0) : totalLigBatch384;

  // Ligation Enzyme 슬롯별 96/384
  const slotLig96 = activeSlot !== 'total'
    ? getSlotBatch96(activeSlot as SlotEmoji)
    : effectiveLigBatch96;
  const slotLig384 = activeSlot !== 'total'
    ? getSlotBatch384(activeSlot as SlotEmoji)
    : effectiveLigBatch384;

  // Wash RGT: 96/384 format별 배치 수
  const washBase96 = useMemo(() => {
    if (!isWashRGT) return 0;
    return todayScheduleSummary.hyb.reduce((sum, slot) => sum + (slot.chips96?.length || 0), 0);
  }, [isWashRGT, todayScheduleSummary.hyb]);
  const washBase384 = useMemo(() => {
    if (!isWashRGT) return 0;
    return todayScheduleSummary.hyb.reduce((sum, slot) => sum + (slot.chips384?.length || 0), 0);
  }, [isWashRGT, todayScheduleSummary.hyb]);
  const effectiveWashBatch96 = washBatch96Override !== '' ? (parseFloat(washBatch96Override) || 0) : washBase96;
  const effectiveWashBatch384 = washBatch384Override !== '' ? (parseFloat(washBatch384Override) || 0) : washBase384;

  // 선택된 슬롯 기반 유효 배치 수
  const slotWash96 = activeSlot !== 'total'
    ? (todayScheduleSummary.hyb.find(s => s.emoji === activeSlot)?.chips96?.length || 0)
    : effectiveWashBatch96;
  const slotWash384 = activeSlot !== 'total'
    ? (todayScheduleSummary.hyb.find(s => s.emoji === activeSlot)?.chips384?.length || 0)
    : effectiveWashBatch384;
  // slotLigBatch: 하위 호환용 (총 합산)
  const slotLigBatch = slotLig96 + slotLig384;

  // 그룹별 유효 배치 수 (96/384 분리 반환)
  const getGroupBatches = (groupName: string) => {
    const isFragAlt = ALWAYS_COMBINED.has(groupName) && isDay2AM;
    
    // 1. 수동 입력값 확인
    const o96 = batch96Overrides[groupName];
    const o384 = batch384Overrides[groupName];
    
    if (isLigEnzyme) return { b96: slotLig96, b384: slotLig384 };
    if (isWashRGT) return { b96: slotWash96, b384: slotWash384 };
    
    if (isFragAlt) {
      const b96 = o96 !== undefined && o96 !== '' ? parseFloat(o96) || 0 : effectiveDay2Batch96;
      const b384 = o384 !== undefined && o384 !== '' ? parseFloat(o384) || 0 : effectiveDay2Batch384;
      return { b96, b384 };
    }
    
    // 일반 공정: 현재 선택된 포맷에 따라
    const base = parseChipString(batchCount).length;
    if (selectedFormat === '96') {
      const b = o96 !== undefined && o96 !== '' ? parseFloat(o96) || 0 : base;
      return { b96: b, b384: 0 };
    } else {
      const b = o384 !== undefined && o384 !== '' ? parseFloat(o384) || 0 : base;
      return { b96: 0, b384: b };
    }
  };

  // Day 2_AM: Fragmentation Master Mix용 96/384 배치 수 (오늘 Day 2 스케줄 기반)
  const isDay2AM = selectedProcess === 'Day 2_AM';
  const effectiveDay2Batch96 = todayScheduleSummary.day2Chips96?.length || 0;
  const effectiveDay2Batch384 = todayScheduleSummary.day2Chips384?.length || 0;

  const needsFormat = selectedProcess === 'Day 1' || selectedProcess.startsWith('Day 2');

  const nowStr = () => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
  };

  // 공정별 시약 바코드(Lot#) → 새 시트 컬럼 매핑
  const LOT_COL_MAP: Record<string, { col: string; value: string }[]> = {
    'Day 1':    [{ col: 'M1', value: lot1 }],
    'Day 2_AM': [{ col: 'M2-1', value: lot1 }, { col: 'M2-2', value: lot2 }],
    'Wash RGT': [{ col: 'M4-1', value: lot1 }, { col: 'M4-2', value: lot2 }],
  };

  const handleSaveLotBarcodes = async () => {
    const lotUpdates = LOT_COL_MAP[selectedProcess];
    if (!lotUpdates) { alert('이 공정은 시약 바코드 저장을 지원하지 않습니다.'); return; }
    if (lotUpdates.every(u => !u.value)) { alert('Lot # 바코드를 먼저 입력해주세요.'); return; }

    setSavingLot(true);
    try {
      const token = await getAccessToken();

      // 시트 이름 가져오기
      const meta = await sheetsGetMetadata(REAGENT_BARCODE_SPREADSHEET_ID, token);
      const sheetName: string = meta.sheets[0]?.properties?.title || 'Sheet1';

      // 헤더 읽기
      const headerRes = await sheetsGetValues(REAGENT_BARCODE_SPREADSHEET_ID, `'${sheetName}'!1:1`, token);
      const headers: string[] = (headerRes.values?.[0] || []).map((h: any) => String(h).trim());
      const pCol = headers.findIndex(h => /^#?p$/i.test(h));
      const barcodeCol = headers.findIndex(h => /barcode/i.test(h));

      // 기존 데이터 읽기
      const dataRes = await sheetsGetValues(REAGENT_BARCODE_SPREADSHEET_ID, `'${sheetName}'!A2:Z1000`, token);
      const rows: any[][] = dataRes.values || [];

      // 현재 공정의 칩 목록
      let chips: string[] = [];
      if (isWashRGT) {
        SLOT_EMOJIS.forEach(e => { chips = [...chips, ...parseChipString(slotBatches[e])]; });
      } else if (selectedProcess === 'Day 2_AM') {
        chips = [...(todayScheduleSummary.day2Chips96 || []), ...(todayScheduleSummary.day2Chips384 || [])];
      } else {
        chips = parseChipString(batchCount);
      }
      chips = [...new Set(chips)];

      const chipBarcodeMap: Record<string, string> = {
        ...day1Data['96'].chipBarcodes,
        ...day1Data['384'].chipBarcodes,
      };

      const updates: { range: string; values: any[][] }[] = [];

      const skipped: string[] = [];
      chips.forEach(chip => {
        const chipNorm = chip.toLowerCase();
        const chipBarcode = chipBarcodeMap[chip] || '';

        // #p AND barcode 모두 일치해야 저장
        if (!chipBarcode) { skipped.push(chip); return; }

        let foundIdx = -1;
        for (let i = rows.length - 1; i >= 0; i--) {
          const row = rows[i];
          const rowP = pCol >= 0 ? String(row[pCol] || '').trim().toLowerCase() : '';
          const rowBarcode = barcodeCol >= 0 ? String(row[barcodeCol] || '').trim() : '';
          const pMatch = rowP === chipNorm || rowP.split(/[,\s]+/).map(s => s.trim()).includes(chipNorm);
          const barcodeMatch = rowBarcode === chipBarcode;
          if (pMatch && barcodeMatch) { foundIdx = i; break; }
        }
        if (foundIdx === -1) { skipped.push(chip); return; }

        const sheetRow = foundIdx + 2;
        lotUpdates.forEach(({ col, value }) => {
          if (!value) return;
          const colIdx = headers.indexOf(col);
          if (colIdx < 0) return;
          updates.push({ range: cellRef(sheetName, sheetRow, colIdx + 1), values: [[value]] });
        });
      });

      if (updates.length === 0) {
        const msg = skipped.length > 0
          ? `일치하는 행을 찾지 못했습니다.\n누락된 칩: ${skipped.join(', ')}\n(#p와 바코드가 시트에 모두 등록되어 있어야 합니다.)`
          : '일치하는 행을 찾지 못했습니다.';
        throw new Error(msg);
      }
      await sheetsBatchUpdate(REAGENT_BARCODE_SPREADSHEET_ID, updates, token);
      if (skipped.length > 0) alert(`저장 완료. 단, 바코드 미인식 또는 행 없음으로 건너뜀: ${skipped.join(', ')}`);
      markReagentLotSaved(selectedProcess);
    } catch (e: any) {
      alert('시약 바코드 저장 오류: ' + (e.message || e));
    } finally {
      setSavingLot(false);
    }
  };

  const handleSave = async (
    singleReagent?: string,
    overrideFinishTimes?: Record<string, string>,
    overrideGroupUsers?: Record<string, string>,
    forceResave = false,
  ) => {
    setSaving(true);
    const ftimes = overrideFinishTimes ?? groupFinishTimes;
    const fusers = overrideGroupUsers ?? groupUsers;
    try {
      let chips: string[] = [];
      if (isLigEnzyme && activeSlot !== 'total') {
        // Lig Enzyme 슬롯별 저장: 해당 슬롯의 칩만 사용
        const slot96 = parseChipString(slotBatches96[activeSlot as SlotEmoji] || '');
        const slot384 = parseChipString(slotBatches384[activeSlot as SlotEmoji] || '');
        chips = [...slot96, ...slot384];
      } else if (isSlotBased) {
        SLOT_EMOJIS.forEach(e => {
          chips = [...chips, ...parseChipString(slotBatches[e])];
        });
      } else {
        chips = parseChipString(batchCount);
      }
      if (chips.length === 0) throw new Error('#p를 입력해주세요.');

      // Lig Enzyme: 시약 그룹별 총 볼륨 계산 (Volume 컬럼에 기록)
      let volumesByReagent: Record<string, number> | undefined;
      if (isLigEnzyme) {
        volumesByReagent = {};
        for (const group of reagentGroups) {
          const { b96, b384 } = getGroupBatches(group.reagentName);
          let totalVol = 0;
          for (const comp of group.components) {
            const ov = ligVolumeOverrides[comp.name];
            if (ov !== undefined) {
              totalVol += parseFloat(ov) || 0;
            } else {
              const def96 = REAGENT_DEFINITIONS.find(r => r.process === 'Ligation Enzyme' && r.format === '96' && r.reagentName === group.reagentName && r.componentName === comp.name);
              const def384 = REAGENT_DEFINITIONS.find(r => r.process === 'Ligation Enzyme' && r.format === '384' && r.reagentName === group.reagentName && r.componentName === comp.name);
              totalVol += ((def96?.amount || 0) * b96 + (def384?.amount || 0) * b384) * DEAD_VOLUME_FACTOR;
            }
          }
          volumesByReagent[group.reagentName] = totalVol;
        }
      }

      const chipBarcodes = {
        ...day1Data['96'].chipBarcodes,
        ...day1Data['384'].chipBarcodes,
      };

      // 저장할 reagent 이름 목록 정리
      const savedGroups = reagentCheckState[logKey]?.savedGroups || {};
      const fragSavedGroups = reagentCheckState[fragLogKey]?.savedGroups || {};

      const reagentNamesToSave = reagentGroups
        .map(g => g.reagentName)
        // 1. 단일 시약 저장 모드면 해당 시약만 대상으로
        .filter(name => !singleReagent || name === singleReagent)
        // 2. 이미 시트에 저장된 것은 제외 (강제 재저장 시 스킵)
        .filter(name => {
          if (forceResave) return true;
          const useFragKey = ALWAYS_COMBINED.has(name) && selectedProcess === 'Day 2_AM';
          return useFragKey ? !fragSavedGroups[name] : !savedGroups[name];
        })
        // 3. 96 format의 Isopropanol은 Precipitation Master Mix로 통합 저장
        .filter(name => !(name === 'Isopropanol' && selectedProcess === 'Day 2_AM'));

      if (reagentNamesToSave.length === 0) return;

      // Day 2_AM Fragmentation Master Mix: 96+384 chip 모두 기록 (어떤 format 탭이든)
      if (selectedProcess === 'Day 2_AM') {
        const fragNames  = reagentNamesToSave.filter(n => ALWAYS_COMBINED.has(n));
        const otherNames = reagentNamesToSave.filter(n => !ALWAYS_COMBINED.has(n));
        if (fragNames.length > 0) {
          const fragChips = [
            ...(todayScheduleSummary.day2Chips96  || []),
            ...(todayScheduleSummary.day2Chips384 || []),
          ];
          if (fragChips.length === 0) throw new Error('Day 2 칩 정보가 없습니다.');
          await saveReagentLog({ process: selectedProcess, chips: fragChips, reagentNames: fragNames, lot1, lot2, groupFinishTimes: ftimes, groupUsers: fusers, chipBarcodes });
        }
        if (otherNames.length > 0) {
          if (chips.length === 0) throw new Error('#p를 입력해주세요.');
          await saveReagentLog({ process: selectedProcess, chips, reagentNames: otherNames, lot1, lot2, groupFinishTimes: ftimes, groupUsers: fusers, chipBarcodes });
        }
      } else {
        if (chips.length === 0) throw new Error('#p를 입력해주세요.');
        await saveReagentLog({
          process: selectedProcess,
          chips,
          reagentNames: reagentNamesToSave,
          lot1,
          lot2,
          groupFinishTimes: ftimes,
          groupUsers: fusers,
          chipBarcodes,
          volumesByReagent,
        });
      }

      // Firebase에 개별 시약 저장 완료 플래그 업데이트
      reagentNamesToSave.forEach(name => {
        const useFragKey = ALWAYS_COMBINED.has(name) && selectedProcess === 'Day 2_AM';
        const activeKey = useFragKey ? fragLogKey : logKey;
        const currentSaved = (useFragKey ? fragSavedGroups : savedGroups)[name] || false;
        if (!currentSaved) {
          const nextSaved = { ...(useFragKey ? fragSavedGroups : savedGroups), [name]: true };
          updateReagentCheck(activeKey, { savedGroups: nextSaved });
        }
      });
    } catch (e: any) {
      alert('저장 중 오류: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const completedCount = reagentGroups.filter(g => isGroupComplete(g.reagentName, g.components)).length;
  const totalCount = reagentGroups.length;
  const allChecked = totalCount > 0 && completedCount === totalCount;
  const savedGroups = reagentCheckState[logKey]?.savedGroups || {};
  const fragSavedGroups = reagentCheckState[fragLogKey]?.savedGroups || {};
  const isAnySaved = Object.values(savedGroups).some(v => v) || Object.values(fragSavedGroups).some(v => v);

  const handleScanResult = (result: string) => {
    if (scanTarget === 'lot1') setLot1(lot1 ? `${lot1}, ${result}` : result);
    else if (scanTarget === 'lot2') setLot2(lot2 ? `${lot2}, ${result}` : result);
    setScanTarget(null);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {scanTarget && (
        <BarcodeScanner
          onScan={handleScanResult}
          onClose={() => setScanTarget(null)}
        />
      )}
      {/* Controls */}
      <div className="card-base p-4 md:p-6 space-y-6">
        {/* Step 1: Process */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">1</span>
            <span className="label-sm">공정 선택</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {PROCESSES.map(proc => (
              <button
                key={proc.id}
                onClick={() => { setSelectedProcess(proc.id); setSelectedFormat(''); setCheckState({}); setShowBatchOverrides(false); setShowWashOverride(false); setShowLigOverride(false); }}
                className={`process-pill ${selectedProcess === proc.id ? 'process-pill-active' : 'process-pill-inactive'}`}
              >
                {proc.label}
              </button>
            ))}
          </div>
        </div>

        {/* Step 2+3 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {needsFormat && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">2</span>
                <span className="label-sm">Format</span>
              </div>
              <div className="flex gap-2">
                {['96', '384'].map(fmt => (
                  <button
                    key={fmt}
                    onClick={() => {
                      setSelectedFormat(fmt);
                      // ALWAYS_COMBINED 그룹 체크는 format 전환 시에도 유지
                      setCheckState(prev => {
                        const next: typeof prev = {};
                        ALWAYS_COMBINED.forEach(name => { if (prev[name]) next[name] = prev[name]; });
                        return next;
                      });
                    }}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${selectedFormat === fmt
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-secondary text-muted-foreground hover:text-foreground border border-transparent hover:border-border'
                      }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isSlotBased && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{needsFormat ? '3' : '2'}</span>
                <span className="label-sm">Batch (#p)</span>
              </div>
              <div className="input-clean font-mono bg-secondary/50 text-foreground select-text cursor-default flex items-center">
                {batchCount || <span className="text-muted-foreground text-xs">스케줄에서 자동 로딩</span>}
              </div>
              {/* 그룹별 플레이트 수 수동 조정 */}
              {!isSlotBased && (
                <div className="pt-1 space-y-1.5 border-t border-border/20">
                  <button
                    onClick={() => setShowBatchOverrides(p => !p)}
                    className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors"
                  >
                    plate 수 수동 조정
                    <span className="text-[8px] opacity-60">{showBatchOverrides ? '▲' : '▼'}</span>
                  </button>
                  {showBatchOverrides && (
                    <div className="space-y-3">
                      {reagentGroups
                        .filter(g => {
                          // Fragmentation은 Day 2_AM - 96 포맷에서만 노출
                          if (ALWAYS_COMBINED.has(g.reagentName)) {
                            return selectedProcess === 'Day 2_AM' && selectedFormat === '96';
                          }
                          return true;
                        })
                        .map(g => {
                          const o96 = batch96Overrides[g.reagentName];
                          const o384 = batch384Overrides[g.reagentName];
                          const isFrag = ALWAYS_COMBINED.has(g.reagentName);
                          const currentBase = parseChipString(batchCount).length;
                          
                          const base96 = isFrag ? effectiveDay2Batch96 : (selectedFormat === '96' ? currentBase : 0);
                          const base384 = isFrag ? effectiveDay2Batch384 : (selectedFormat === '384' ? currentBase : 0);
                          
                          return (
                            <div key={g.reagentName} className="p-2.5 rounded-lg bg-secondary/30 space-y-2">
                              <span className="text-[11px] font-bold text-muted-foreground block truncate">{g.reagentName}</span>
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                  <span className="text-[9px] text-muted-foreground/60 block">96 Format</span>
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="number" step="0.5" min="0"
                                      value={o96 !== undefined && o96 !== '' ? o96 : base96}
                                      onChange={e => {
                                        const v = e.target.value;
                                        setBatch96Overrides(prev => ({ ...prev, [g.reagentName]: v === String(base96) ? '' : v }));
                                      }}
                                      className={`w-full text-center font-mono font-bold text-xs rounded-md border px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary transition-colors ${o96 !== undefined && o96 !== '' ? 'bg-warning/10 border-warning/40 text-warning' : 'bg-secondary border-border/50 text-foreground'}`}
                                    />
                                    {o96 !== undefined && o96 !== '' && <button onClick={() => setBatch96Overrides(prev => { const n = { ...prev }; delete n[g.reagentName]; return n; })} className="text-[10px] text-muted-foreground hover:text-foreground">↩</button>}
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <span className="text-[9px] text-muted-foreground/60 block">384 Format</span>
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="number" step="0.5" min="0"
                                      value={o384 !== undefined && o384 !== '' ? o384 : base384}
                                      onChange={e => {
                                        const v = e.target.value;
                                        setBatch384Overrides(prev => ({ ...prev, [g.reagentName]: v === String(base384) ? '' : v }));
                                      }}
                                      className={`w-full text-center font-mono font-bold text-xs rounded-md border px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary transition-colors ${o384 !== undefined && o384 !== '' ? 'bg-warning/10 border-warning/40 text-warning' : 'bg-secondary border-border/50 text-foreground'}`}
                                    />
                                    {o384 !== undefined && o384 !== '' && <button onClick={() => setBatch384Overrides(prev => { const n = { ...prev }; delete n[g.reagentName]; return n; })} className="text-[10px] text-muted-foreground hover:text-foreground">↩</button>}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Kit Lot # - hidden for Ligation Enzyme and Day 2_PM */}
          {!isLigEnzyme && selectedProcess !== 'Day 2_PM' && (
            <div className="space-y-3 sm:col-span-2 md:col-span-1">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{needsFormat ? '4' : '3'}</span>
                <span className="label-sm">Kit Lot #</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input value={lot1} onChange={e => setLot1(e.target.value)} placeholder={LOT_PLACEHOLDERS[selectedProcess === 'Day 1' ? `Day 1-${selectedFormat || '96'}` : selectedProcess]?.lot1 ?? ''} className="input-clean font-mono flex-1" />
                  <button onClick={() => setScanTarget('lot1')} className="p-2 rounded-lg bg-secondary hover:bg-primary/10 hover:text-primary text-muted-foreground transition-all shrink-0">
                    <Scan className="w-4 h-4" />
                  </button>
                </div>
                {selectedProcess !== 'Day 1' && (
                  <div className="flex items-center gap-2">
                    <input value={lot2} onChange={e => setLot2(e.target.value)} placeholder={LOT_PLACEHOLDERS[selectedProcess === 'Day 1' ? `Day 1-${selectedFormat || '96'}` : selectedProcess]?.lot2 ?? ''} className="input-clean font-mono flex-1" />
                    <button onClick={() => setScanTarget('lot2')} className="p-2 rounded-lg bg-secondary hover:bg-primary/10 hover:text-primary text-muted-foreground transition-all shrink-0">
                      <Scan className="w-4 h-4" />
                    </button>
                  </div>
                )}
                {LOT_COL_MAP[selectedProcess] && (
                  <button
                    onClick={handleSaveLotBarcodes}
                    disabled={savingLot || reagentLotSaved[selectedProcess]}
                    className={`w-full py-1.5 rounded-lg text-[11px] font-bold transition-all ${reagentLotSaved[selectedProcess] ? 'bg-accent/15 text-accent cursor-default' : 'bg-secondary text-muted-foreground hover:bg-primary/10 hover:text-primary'} ${savingLot ? 'opacity-50' : ''}`}
                  >
                    {reagentLotSaved[selectedProcess] ? '✓ 시약 바코드 저장됨' : savingLot ? '저장 중...' : '시약 바코드 기록 저장'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>


        {/* Wash RGT: 슬롯별 배치 현황 */}
        {isWashRGT && (() => {
          const view96 = activeSlot !== 'total'
            ? (todayScheduleSummary.hyb.find(s => s.emoji === activeSlot)?.chips96 || [])
            : todayScheduleSummary.hyb.flatMap(s => s.chips96 || []);
          const view384 = activeSlot !== 'total'
            ? (todayScheduleSummary.hyb.find(s => s.emoji === activeSlot)?.chips384 || [])
            : todayScheduleSummary.hyb.flatMap(s => s.chips384 || []);
          return (
            <div className="pt-4 border-t border-border/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">Batch</span>
                {activeSlot === 'total' && (
                  <button onClick={() => setShowWashOverride(p => !p)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                    수동 조정 {showWashOverride ? '▲' : '▼'}
                  </button>
                )}
              </div>
              {/* Batch 4-Column Grid Layout */}
              <div className="grid grid-cols-4 gap-2">
                {/* 1. Buttons Row */}
                {SLOT_EMOJIS.map((emoji, i) => {
                  const slot = todayScheduleSummary.hyb.find(s => s.emoji === emoji);
                  const cnt = (slot?.chips96?.length || 0) + (slot?.chips384?.length || 0);
                  const isActive = activeSlot === emoji;
                  return (
                    <button
                      key={emoji}
                      onClick={() => cnt > 0 && setActiveSlot(emoji)}
                      className={`py-2 rounded-lg text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 border ${
                        isActive 
                          ? 'bg-primary text-primary-foreground border-primary shadow-md' 
                          : cnt > 0 
                            ? 'bg-secondary text-muted-foreground border-transparent hover:border-border' 
                            : 'bg-secondary/30 text-muted-foreground/30 border-transparent cursor-default'
                      }`}
                    >
                      <span>#{i + 1}</span>
                    </button>
                  );
                })}
                <button
                  onClick={() => setActiveSlot('total')}
                  className={`py-2 rounded-lg text-xs font-bold transition-all border ${
                    activeSlot === 'total' 
                      ? 'bg-primary text-primary-foreground border-primary shadow-md' 
                      : 'bg-secondary text-muted-foreground border-transparent hover:border-border'
                  }`}
                >
                  전체
                </button>

                {/* 2. Chip Info & Summary Rows (Vertical alignment under buttons) */}
                {[...SLOT_EMOJIS, 'total'].map((key) => {
                  const isTotal = key === 'total';
                  const slot = isTotal ? null : todayScheduleSummary.hyb.find(s => s.emoji === key);
                  const v96 = isTotal ? todayScheduleSummary.hyb.flatMap(s => s.chips96 || []) : (slot?.chips96 || []);
                  const v384 = isTotal ? todayScheduleSummary.hyb.flatMap(s => s.chips384 || []) : (slot?.chips384 || []);
                  const isActive = activeSlot === key;

                  return (
                    <div key={`info-${key}`} className={`flex flex-col gap-2 pt-1 transition-opacity ${isActive ? 'opacity-100' : 'opacity-40'}`}>
                      {/* Chips list */}
                      <div className="space-y-1 min-h-[50px] px-1">
                        {v96.length > 0 && (
                          <div className="flex flex-col">
                            <span className="text-[8px] font-bold text-primary/70 mb-0.5">96</span>
                            <span className="text-[10px] font-mono text-foreground break-all leading-tight">
                              {v96.join(', ')}
                            </span>
                          </div>
                        )}
                        {v384.length > 0 && (
                          <div className="flex flex-col">
                            <span className="text-[8px] font-bold text-cyan-600/70 mb-0.5">384</span>
                            <span className="text-[10px] font-mono text-foreground break-all leading-tight">
                              {v384.join(', ')}
                            </span>
                          </div>
                        )}
                        {v96.length === 0 && v384.length === 0 && (
                          <div className="h-full flex items-center justify-center">
                            <span className="text-muted-foreground/20 text-[10px]">—</span>
                          </div>
                        )}
                      </div>
                      {/* Summary Count */}
                      <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-mono font-bold border-t border-border/30 pt-1.5">
                        {v96.length > 0 && <span>{v96.length}<span className="text-[8px] text-muted-foreground font-normal ml-0.5">x96</span></span>}
                        {v384.length > 0 && <span>{v384.length}<span className="text-[8px] text-muted-foreground font-normal ml-0.5">x384</span></span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Manual override - only for total */}
              {activeSlot === 'total' && showWashOverride && (
                <div className="space-y-1.5 pt-1">
                  {[{ label: '96 format', val: washBatch96Override, base: washBase96, set: setWashBatch96Override }, { label: '384 format', val: washBatch384Override, base: washBase384, set: setWashBatch384Override }].map(({ label, val, base, set }) => (
                    <div key={label} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input
                          type="number" step="1" min="0"
                          value={val !== '' ? val : base}
                          onChange={e => set(e.target.value === String(base) ? '' : e.target.value)}
                          className={`w-14 text-center font-mono font-bold text-sm rounded-lg border px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary transition-colors ${val !== '' ? 'bg-warning/10 border-warning/40 text-warning' : 'bg-secondary border-border/50 text-foreground'}`}
                        />
                        {val !== '' && <button onClick={() => set('')} className="text-[10px] text-muted-foreground hover:text-foreground">↩</button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Ligation Enzyme: 슬롯별 배치 현황 (Wash RGT와 동일 구조, 96/384 분리) */}
        {isLigEnzyme && (() => {
          const view96 = activeSlot !== 'total'
            ? (slotBatches96[activeSlot as SlotEmoji] || '').split(',').map(s => s.trim()).filter(Boolean)
            : SLOT_EMOJIS.flatMap(e => (slotBatches96[e] || '').split(',').map(s => s.trim()).filter(Boolean));
          const view384 = activeSlot !== 'total'
            ? (slotBatches384[activeSlot as SlotEmoji] || '').split(',').map(s => s.trim()).filter(Boolean)
            : SLOT_EMOJIS.flatMap(e => (slotBatches384[e] || '').split(',').map(s => s.trim()).filter(Boolean));
          return (
            <div className="pt-4 border-t border-border/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">Batch</span>
                {activeSlot === 'total' && (
                  <button onClick={() => setShowLigOverride(p => !p)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                    수동 조정 {showLigOverride ? '▲' : '▼'}
                  </button>
                )}
              </div>
              {/* Batch 4-Column Grid Layout */}
              <div className="grid grid-cols-4 gap-2">
                {/* 1. Buttons Row */}
                {SLOT_EMOJIS.map((emoji, i) => {
                  const cnt96 = getSlotBatch96(emoji);
                  const cnt384 = getSlotBatch384(emoji);
                  const cnt = cnt96 + cnt384;
                  const isActive = activeSlot === emoji;
                  return (
                    <button
                      key={emoji}
                      onClick={() => cnt > 0 && setActiveSlot(emoji)}
                      className={`py-2 rounded-lg text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 border ${
                        isActive 
                          ? 'bg-primary text-primary-foreground border-primary shadow-md' 
                          : cnt > 0 
                            ? 'bg-secondary text-muted-foreground border-transparent hover:border-border' 
                            : 'bg-secondary/30 text-muted-foreground/30 border-transparent cursor-default'
                      }`}
                    >
                      <span>#{i + 1}</span>
                    </button>
                  );
                })}
                <button
                  onClick={() => setActiveSlot('total')}
                  className={`py-2 rounded-lg text-xs font-bold transition-all border ${
                    activeSlot === 'total' 
                      ? 'bg-primary text-primary-foreground border-primary shadow-md' 
                      : 'bg-secondary text-muted-foreground border-transparent hover:border-border'
                  }`}
                >
                  전체
                </button>

                {/* 2. Info Rows */}
                {[...SLOT_EMOJIS, 'total'].map((key) => {
                  const isTotal = key === 'total';
                  const v96 = isTotal 
                    ? SLOT_EMOJIS.flatMap(e => (slotBatches96[e] || '').split(',').map(s => s.trim()).filter(Boolean))
                    : (slotBatches96[key as SlotEmoji] || '').split(',').map(s => s.trim()).filter(Boolean);
                  const v384 = isTotal 
                    ? SLOT_EMOJIS.flatMap(e => (slotBatches384[e] || '').split(',').map(s => s.trim()).filter(Boolean))
                    : (slotBatches384[key as SlotEmoji] || '').split(',').map(s => s.trim()).filter(Boolean);
                  const isActive = activeSlot === key;

                  return (
                    <div key={`lig-info-${key}`} className={`flex flex-col gap-2 pt-1 transition-opacity ${isActive ? 'opacity-100' : 'opacity-40'}`}>
                      <div className="space-y-1 min-h-[50px] px-1">
                        {v96.length > 0 && (
                          <div className="flex flex-col">
                            <span className="text-[8px] font-bold text-primary/70 mb-0.5">96</span>
                            <span className="text-[10px] font-mono text-foreground break-all leading-tight">
                              {v96.join(', ')}
                            </span>
                          </div>
                        )}
                        {v384.length > 0 && (
                          <div className="flex flex-col">
                            <span className="text-[8px] font-bold text-cyan-600/70 mb-0.5">384</span>
                            <span className="text-[10px] font-mono text-foreground break-all leading-tight">
                              {v384.join(', ')}
                            </span>
                          </div>
                        )}
                        {v96.length === 0 && v384.length === 0 && (
                          <div className="h-full flex items-center justify-center">
                            <span className="text-muted-foreground/20 text-[10px]">—</span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-mono font-bold border-t border-border/30 pt-1.5">
                        {v96.length > 0 && <span>{v96.length}<span className="text-[8px] text-muted-foreground font-normal ml-0.5">x96</span></span>}
                        {v384.length > 0 && <span>{v384.length}<span className="text-[8px] text-muted-foreground font-normal ml-0.5">x384</span></span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Summary (Active Only) - redundant due to grid layout, but let's keep it minimal if needed or remove */}
              {/* Manual override */}
              {activeSlot === 'total' && showLigOverride && (
                <div className="space-y-1.5 pt-1">
                  {[{ label: '96 format', val: ligBatch96Override, base: totalLigBatch96, set: setLigBatch96Override }, { label: '384 format', val: ligBatch384Override, base: totalLigBatch384, set: setLigBatch384Override }].map(({ label, val, base, set }) => (
                    <div key={label} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input
                          type="number" step="1" min="0"
                          value={val !== '' ? val : base}
                          onChange={e => set(e.target.value === String(base) ? '' : e.target.value)}
                          className={`w-14 text-center font-mono font-bold text-sm rounded-lg border px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary transition-colors ${val !== '' ? 'bg-warning/10 border-warning/40 text-warning' : 'bg-secondary border-border/50 text-foreground'}`}
                        />
                        {val !== '' && <button onClick={() => set('')} className="text-[10px] text-muted-foreground hover:text-foreground">↩</button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Photo Upload - Day 1: DNA input / Day 2_PM: DNA Pellet */}
      {(selectedProcess === 'Day 1' || selectedProcess === 'Day 2_PM') && (() => {
        const type: PhotoType = selectedProcess === 'Day 1' ? 'dna' : 'pellet';
        const label = type === 'dna' ? 'DNA Input' : 'DNA Pellet';
        return (
          <div className="card-base p-4 md:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">{label}</span>
              <div className="flex items-center gap-2">
                <label className="btn-ghost btn-sm cursor-pointer text-[10px] border border-border">
                  <Camera className="w-3 h-3" /> 촬영
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={e => handleFileSelect(e.target.files, type)}
                  />
                </label>
                <label className="btn-ghost btn-sm cursor-pointer text-[10px] border border-border">
                  + 파일 선택
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => handleFileSelect(e.target.files, type)}
                  />
                </label>
                {pendingFiles[type].length > 0 && (
                  <button
                    onClick={() => handlePhotoUpload(type)}
                    disabled={uploading === type}
                    className="btn-primary btn-sm text-[10px]"
                  >
                    {uploading === type ? '업로드 중...' : `업로드 (${pendingFiles[type].length})`}
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {/* 대기 중인 파일 미리보기 */}
              {pendingFiles[type].map((f, i) => (
                <div key={i} className="relative w-16 h-16 group">
                  <img
                    src={URL.createObjectURL(f)}
                    alt={f.name}
                    className="w-16 h-16 object-cover opacity-60"
                  />
                  <button
                    onClick={() => setPendingFiles(prev => ({ ...prev, [type]: prev[type].filter((_, j) => j !== i) }))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {/* 업로드 완료된 사진 */}
              {dailyPhotos[type].map(p => (
                <div key={p.fileId} className="relative w-16 h-16 group">
                  <a href={p.viewUrl} target="_blank" rel="noopener noreferrer" title={p.fileName}>
                    <img
                      src={`data:image/jpeg;base64,${p.thumbnailBase64}`}
                      alt={p.fileName}
                      className="w-16 h-16 object-cover hover:opacity-80 transition-opacity"
                    />
                  </a>
                  {/* 업로드 완료 뱃지 */}
                  <div className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-accent flex items-center justify-center shadow">
                    <CheckCircle2 className="w-3 h-3 text-accent-foreground" />
                  </div>
                  <button
                    onClick={() => removeDailyPhoto(type, p.fileId)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {dailyPhotos[type].length === 0 && pendingFiles[type].length === 0 && (
                <div className="w-16 h-16 border border-border/50 flex items-center justify-center text-muted-foreground">
                  <Camera className="w-5 h-5 opacity-30" />
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Format 선택 필요한 공정: 선택 전까지 시약 숨김 */}
      {needsFormat && !selectedFormat && (
        <div className="text-center py-10 text-sm text-muted-foreground">Format을 선택하면 시약 목록이 표시됩니다.</div>
      )}

      {(!needsFormat || selectedFormat) && <>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${(completedCount / totalCount) * 100}%` }} />
          </div>
          <span className="text-xs font-mono font-bold text-muted-foreground">{completedCount}/{totalCount}</span>
        </div>
      )}

      {/* Reagent Groups */}
      <AnimatePresence mode="wait">
        {isLigEnzyme && reagentGroups.length > 0 ? (
          /* Lig Enzyme: 단일 카드 레이아웃 */
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            <div className="card-base overflow-hidden">
              {/* 탭 바 (그룹이 여러 개일 때만) */}
              {reagentGroups.length > 1 && (
                <div className="flex border-b border-border/40">
                  {reagentGroups.map(group => {
                    const complete = isGroupComplete(group.reagentName, group.components);
                    const isActive = selectedWashGroup === group.reagentName;
                    return (
                      <button
                        key={group.reagentName}
                        onClick={() => setSelectedWashGroup(group.reagentName)}
                        className={`relative flex-1 py-3 px-1 text-[11px] font-bold transition-all text-center leading-tight ${
                          isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {complete && <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent" />}
                        {group.reagentName}
                        {isActive && <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-full" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 그룹 헤더 + 컨텐츠 */}
              {reagentGroups.map(group => {
                if (reagentGroups.length > 1 && group.reagentName !== selectedWashGroup) return null;
                const complete = isGroupComplete(group.reagentName, group.components);
                const { b96, b384 } = getGroupBatches(group.reagentName);
                const getLigCompVol = (c: { name: string; amount: number }) => {
                  const def96 = REAGENT_DEFINITIONS.find(r => r.process === 'Ligation Enzyme' && r.format === '96' && r.reagentName === group.reagentName && r.componentName === c.name);
                  const def384 = REAGENT_DEFINITIONS.find(r => r.process === 'Ligation Enzyme' && r.format === '384' && r.reagentName === group.reagentName && r.componentName === c.name);
                  return ((def96?.amount || 0) * b96 + (def384?.amount || 0) * b384) * DEAD_VOLUME_FACTOR;
                };
                const guideVols = Object.fromEntries(group.components.map(c => {
                  const ov = ligVolumeOverrides[c.name];
                  return [c.name, ov !== undefined ? parseFloat(ov) || 0 : getLigCompVol(c)];
                }));
                return (
                  <div key={group.reagentName}>
                    {/* 큰 제목 헤더 */}
                    <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border/40">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${complete ? 'bg-accent' : 'bg-secondary'}`}>
                        {complete ? <CheckCircle2 className="w-4 h-4 text-accent-foreground" /> : <FlaskConical className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />}
                      </div>
                      <span className="text-sm font-bold text-foreground">{group.reagentName}</span>
                      {complete && <span className="badge badge-accent ml-1">완료</span>}
                    </div>
                    <div className="p-4 space-y-0.5">
                    {group.components.map(comp => {
                      const checked = checkState[group.reagentName]?.[comp.name] || false;
                      const isEditingThis = editingLigComp === comp.name;
                      const computed = getLigCompVol(comp);
                      const ov = ligVolumeOverrides[comp.name];
                      const vol = ov !== undefined ? parseFloat(ov) || 0 : computed;
                      return (
                        <div
                          key={comp.name}
                          onClick={() => { if (!isEditingThis) toggleCheck(group.reagentName, comp.name); }}
                          className={`flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl cursor-pointer transition-all ${checked ? 'bg-accent/5' : 'hover:bg-secondary/50'}`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-[15px] h-[15px] rounded-[3px] border-[1.5px] shrink-0 flex items-center justify-center transition-all ${checked ? 'bg-accent border-accent' : 'border-muted-foreground/35'}`}>
                              {checked && <svg viewBox="0 0 10 8" className="w-[9px] h-[7px] text-accent-foreground" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="1,4 3.8,7 9,1" /></svg>}
                            </div>
                            <span className={`text-xs font-medium truncate ${checked ? 'text-muted-foreground line-through' : comp.name.toLowerCase().includes('enzyme') ? 'text-amber-500 dark:text-amber-400' : 'text-foreground'}`}>{comp.name}</span>
                          </div>
                          <div className="text-right shrink-0" onClick={e => { e.stopPropagation(); setEditingLigComp(comp.name); }}>
                            {isEditingThis ? (
                              <input
                                type="number" step="0.01" autoFocus
                                value={ov ?? computed.toFixed(3)}
                                onChange={e => setLigVolumeOverrides(prev => ({ ...prev, [comp.name]: e.target.value }))}
                                onBlur={() => setEditingLigComp(null)}
                                onKeyDown={e => e.key === 'Enter' && setEditingLigComp(null)}
                                className="w-20 text-right font-mono font-bold text-sm bg-secondary border border-primary rounded px-1 py-0.5 outline-none"
                                onClick={e => e.stopPropagation()}
                              />
                            ) : (
                              <>
                                <span className={`text-sm font-mono font-bold cursor-pointer hover:text-primary transition-colors ${ov !== undefined ? 'text-primary' : 'text-foreground'}`}>
                                  {vol.toFixed(3)}
                                </span>
                                <span className="text-[10px] text-muted-foreground ml-1">mL</span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    </div>
                    <div className="flex items-center justify-between px-4 pb-3 pt-1">
                      <p className="text-[10px] text-muted-foreground">값을 탭하면 수정 가능</p>
                      <button
                        onClick={() => toggleGuide(group.reagentName)}
                        className={`text-[11px] font-bold transition-colors ${guideGroups.has(group.reagentName) ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        가이드
                      </button>
                    </div>
                    {guideGroups.has(group.reagentName) && (
                      <div className="px-4 pb-4">
                        <DispensingGuide
                          components={group.components}
                          batchCount={b96 + b384}
                          totalVolumes={guideVols}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 전체 진행 상태 */}
            {totalCount > 0 && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${(completedCount / totalCount) * 100}%` }} />
                </div>
                <span className="text-xs font-mono font-bold text-muted-foreground">{completedCount}/{totalCount}</span>
              </div>
            )}
            <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground flex-wrap">
              <Clock className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
              {(() => {
                const uniqueUsers = [...new Set(Object.values(groupUsers).filter(Boolean))];
                const displayUsers = uniqueUsers.length > 0 ? uniqueUsers.join(', ') : (user?.name || '');
                const lastTime = Object.values(groupFinishTimes).sort().at(-1);
                return (
                  <>
                    <span>담당자: <strong className="text-foreground">{displayUsers}</strong></span>
                    {lastTime && <span className="font-mono text-accent">{lastTime} 완료</span>}
                  </>
                );
              })()}
              {saving && <span className="text-muted-foreground">저장 중...</span>}
              {allChecked && !saving && (
                <button onClick={() => handleSave(undefined, undefined, undefined, isAnySaved)} className="btn-sm bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg px-2 py-1 text-[10px] font-bold transition-all">
                  {isAnySaved ? '시트에 다시 저장' : '시약 기록 저장'}
                </button>
              )}
              {allChecked && isAnySaved && <span className="text-[10px] text-accent font-semibold">✓ 저장됨</span>}
            </div>
          </motion.div>
        ) : reagentGroups.length > 0 ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            {reagentGroups.map((group) => {
              const complete = isGroupComplete(group.reagentName, group.components);
              const isExpanded = expandedGroups.has(group.reagentName) || !complete;
              // per-format 볼륨 계산용 helper
              const { b96, b384 } = getGroupBatches(group.reagentName);
              const getCompVol = (comp: { name: string; amount: number }) => {
                // Discard 항목: 그룹 배치 수 × amount
                if (comp.name === 'Discard Precip Soln1+Soln2') {
                  return comp.amount * (b96 + b384);
                }
                // Wash RGT: 96/384 format별 per-plate 계산
                if (isWashRGT) {
                  const def96 = REAGENT_DEFINITIONS.find(r => r.process === 'Wash RGT' && r.format === '96' && r.reagentName === group.reagentName && r.componentName === comp.name);
                  const def384 = REAGENT_DEFINITIONS.find(r => r.process === 'Wash RGT' && r.format === '384' && r.reagentName === group.reagentName && r.componentName === comp.name);
                  return ((def96?.amount || 0) * b96 + (def384?.amount || 0) * b384) * DEAD_VOLUME_FACTOR;
                }
                // Ligation Enzyme: 96/384 format별 per-plate 계산
                if (isLigEnzyme) {
                  const def96 = REAGENT_DEFINITIONS.find(r => r.process === 'Ligation Enzyme' && r.format === '96' && r.reagentName === group.reagentName && r.componentName === comp.name);
                  const def384 = REAGENT_DEFINITIONS.find(r => r.process === 'Ligation Enzyme' && r.format === '384' && r.reagentName === group.reagentName && r.componentName === comp.name);
                  return ((def96?.amount || 0) * b96 + (def384?.amount || 0) * b384) * DEAD_VOLUME_FACTOR;
                }
                // Fragmentation Master Mix / Fragmentation_96 / Fragmentation_384: Day 2_AM 96/384 각각 계산
                if (ALWAYS_COMBINED.has(group.reagentName) && isDay2AM) {
                  if (group.reagentName.includes('_96')) {
                    const def96 = REAGENT_DEFINITIONS.find(r => r.process === 'Day 2_AM' && r.format === '96' && r.reagentName === group.reagentName && r.componentName === comp.name);
                    return ((def96?.amount || 0) * b96) * DEAD_VOLUME_FACTOR;
                  }
                  if (group.reagentName.includes('_384')) {
                    const def384 = REAGENT_DEFINITIONS.find(r => r.process === 'Day 2_AM' && r.format === '384' && r.reagentName === group.reagentName && r.componentName === comp.name);
                    return ((def384?.amount || 0) * b384) * DEAD_VOLUME_FACTOR;
                  }
                  // Fragmentation Master Mix: 96+384 합산
                  const def96 = REAGENT_DEFINITIONS.find(r => r.process === 'Day 2_AM' && r.format === '96' && r.reagentName === group.reagentName && r.componentName === comp.name);
                  const def384 = REAGENT_DEFINITIONS.find(r => r.process === 'Day 2_AM' && r.format === '384' && r.reagentName === group.reagentName && r.componentName === comp.name);
                  return ((def96?.amount || 0) * b96 + (def384?.amount || 0) * b384) * DEAD_VOLUME_FACTOR;
                }
                return comp.amount * (b96 + b384) * DEAD_VOLUME_FACTOR;
              };
              return (
                <div key={group.reagentName} className={`overflow-hidden transition-all rounded-xl border ${
                  group.combined ? 'bg-muted border-border/60' : 'card-base'
                } ${complete ? 'ring-1 ring-accent/30' : ''}`}>
                  <div className="flex items-center">
                    <button onClick={() => toggleExpand(group.reagentName)} className="flex-1 flex items-center justify-between p-4 hover:bg-secondary/30 transition-all">
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${complete ? 'bg-accent' : 'bg-secondary'}`}>
                          {complete ? <CheckCircle2 className="w-4 h-4 text-accent-foreground" /> : <FlaskConical className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />}
                        </div>
                        <span className="text-sm font-bold text-foreground">{group.reagentName}</span>
                        {group.combined && <span className="badge bg-muted-foreground/20 text-muted-foreground text-[9px]">96 + 384</span>}
                        {complete && <span className="badge badge-accent">완료</span>}
                      </div>
                      <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); toggleGuide(group.reagentName); }}
                      className={`px-3 py-4 text-[10px] font-bold transition-colors border-l border-border/40 shrink-0 ${guideGroups.has(group.reagentName) ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                      title="계량 가이드"
                    >
                      가이드
                    </button>
                  </div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                        <div className="px-4 pb-4">
                          <table className="w-full min-w-0">
                            <thead>
                              <tr className="text-left">
                                <th className="label-overline pb-2 pl-8">Component</th>
                                <th className="label-overline pb-2 text-right pr-2">Volume</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.components.map((comp) => {
                                const isDiscardComp = comp.name === 'Discard Precip Soln1+Soln2';
                                const computed = comp.amount * (b96 + b384) * DEAD_VOLUME_FACTOR;
                                const override = isLigEnzyme ? ligVolumeOverrides[comp.name] : undefined;
                                const useGetCompVol = isWashRGT || isLigEnzyme || isDiscardComp || ALWAYS_COMBINED.has(group.reagentName);
                                const vol = useGetCompVol ? getCompVol(comp) : (override !== undefined ? parseFloat(override) || 0 : computed);
                                const isEditingThis = editingLigComp === comp.name;
                                const checked = checkState[group.reagentName]?.[comp.name] || false;
                                const isEnzyme = comp.name.toLowerCase().includes('enzyme');
                                return (
                                  <tr
                                    key={comp.name}
                                    onClick={() => toggleCheck(group.reagentName, comp.name)}
                                    className={`cursor-pointer transition-colors ${checked ? 'bg-accent/5' : 'hover:bg-secondary/50'}`}
                                  >
                                    <td className="py-2 pl-2">
                                      <div className="flex items-center gap-3">
                                        <div className={`w-[15px] h-[15px] rounded-[3px] border-[1.5px] shrink-0 flex items-center justify-center transition-all ${checked ? 'bg-accent border-accent' : 'border-muted-foreground/35'}`}>
                                          {checked && (
                                            <svg viewBox="0 0 10 8" className="w-[9px] h-[7px] text-accent-foreground" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="1,4 3.8,7 9,1" /></svg>
                                          )}
                                        </div>
                                        <span className={`text-xs font-medium ${checked ? 'text-muted-foreground line-through' : isDiscardComp ? 'text-blue-500 dark:text-blue-400' : isEnzyme ? 'text-amber-500 dark:text-amber-400' : 'text-foreground'}`}>{comp.name}</span>
                                      </div>
                                    </td>
                                    <td className="py-2 pr-2 text-right">
                                      {isLigEnzyme && isEditingThis ? (
                                        <input
                                          type="number"
                                          step="0.01"
                                          autoFocus
                                          value={ligVolumeOverrides[comp.name] ?? computed.toFixed(3)}
                                          onChange={e => setLigVolumeOverrides(prev => ({ ...prev, [comp.name]: e.target.value }))}
                                          onBlur={() => setEditingLigComp(null)}
                                          onKeyDown={e => e.key === 'Enter' && setEditingLigComp(null)}
                                          className="w-20 text-right font-mono font-bold text-sm bg-secondary border border-primary rounded px-1 py-0.5 outline-none"
                                          onClick={e => e.stopPropagation()}
                                        />
                                      ) : (
                                        <span
                                          className={`text-sm font-mono font-bold ${isLigEnzyme ? 'cursor-pointer hover:text-primary transition-colors' : ''} ${isDiscardComp ? 'text-blue-500 dark:text-blue-400' : override !== undefined ? 'text-primary' : 'text-foreground'}`}
                                          onClick={isLigEnzyme ? (e) => { e.stopPropagation(); setEditingLigComp(comp.name); } : undefined}
                                        >
                                          {isDiscardComp ? `-${vol.toFixed(3)}` : vol.toFixed(3)}
                                        </span>
                                      )}
                                      {!isEditingThis && <span className="text-[10px] text-muted-foreground font-semibold ml-1">mL</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                              {/* Total row */}
                              {(() => {
                                const totalVol = group.components.reduce((sum, c) => {
                                  const isD = c.name === 'Discard Precip Soln1+Soln2';
                                  const cv = getCompVol(c);
                                  return sum + (isD ? -cv : cv);
                                }, 0);
                                return (
                                  <tr className="border-t border-border/40">
                                    <td className="pt-2 pl-2 text-[10px] font-black text-muted-foreground uppercase tracking-wide">Total</td>
                                    <td className="pt-2 pr-2 text-right">
                                      <span className="text-sm font-mono font-bold text-foreground">{totalVol.toFixed(3)}</span>
                                      <span className="text-[10px] text-muted-foreground ml-1">mL</span>
                                    </td>
                                  </tr>
                                );
                              })()}
                            </tbody>
                          </table>
                          {isLigEnzyme && (
                            <p className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border/40">
                              값을 클릭하면 직접 수정할 수 있습니다.
                            </p>
                          )}
                          {guideGroups.has(group.reagentName) && (
                            <DispensingGuide
                              components={group.components.filter(c => c.name !== 'Discard Precip Soln1+Soln2')}
                              batchCount={b96 + b384}
                              totalVolumes={Object.fromEntries(group.components.filter(c => c.name !== 'Discard Precip Soln1+Soln2').map(c => [c.name, getCompVol(c)]))}
                            />
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            <div className="flex items-center gap-2 pt-3 text-xs text-muted-foreground flex-wrap">
              <Clock className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
              {(() => {
                const uniqueUsers = [...new Set(Object.values(groupUsers).filter(Boolean))];
                const displayUsers = uniqueUsers.length > 0 ? uniqueUsers.join(', ') : (user?.name || '');
                const lastTime = Object.values(groupFinishTimes).sort().at(-1);
                return (
                  <>
                    <span>담당자: <strong className="text-foreground">{displayUsers}</strong></span>
                    {lastTime && <span className="font-mono text-accent">{lastTime} 완료</span>}
                  </>
                );
              })()}
              {saving && <span className="text-muted-foreground">저장 중...</span>}
              {allChecked && !saving && (
                <button onClick={() => handleSave(undefined, undefined, undefined, isAnySaved)} className="btn-sm bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg px-2 py-1 text-[10px] font-bold transition-all">
                  {isAnySaved ? '시트에 다시 저장' : '시약 기록 저장'}
                </button>
              )}
              {allChecked && isAnySaved && (
                <span className="text-[10px] text-accent font-semibold">✓ 저장됨</span>
              )}
            </div>
          </motion.div>
        ) : selectedProcess ? (
          <div className="text-center py-16 md:py-20 card-base">
            <Beaker className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground font-medium">
              {needsFormat && !selectedFormat ? 'Format을 선택하세요' : '해당 시약 정보가 없습니다'}
            </p>
          </div>
        ) : (
          <div className="text-center py-16 md:py-20 card-base">
            <FlaskConical className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground font-medium">공정을 선택하여 시약 제조를 시작하세요</p>
          </div>
        )}
      </AnimatePresence>

      </> /* end needsFormat gate */}
    </div>
  );
}
