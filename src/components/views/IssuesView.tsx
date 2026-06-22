import React, { useState, useMemo, useEffect } from 'react';
import { AlertTriangle, Plus, User, Camera, BarChart3, List, Layers, Image as ImageIcon, X, RotateCcw, ExternalLink } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAppStore } from '@/lib/store';
import { EQUIPMENT_TYPES, PLATE_PROCESS_TYPES, CHIP_EQUIPMENT_TYPES, CHIP_IMAGE_ISSUE_TYPES, CHIP_TYPES, SCHEDULE_SPREADSHEET_ID } from '@/lib/types';
import { uploadChipImageToDrive, uploadIssueToDrive, getAccessToken, createThumbnailBase64 } from '@/lib/driveUpload';
import { sheetsGetValues } from '@/lib/sheetsApi';

type IssueSubTab = 'equipment' | 'plate' | 'chipImage';

export function IssuesView() {
  const { issues, addIssue, plateIssues, addPlateIssue, chipImageIssues, addChipImageIssue, user,
    updateIssueStatus, updatePlateIssueStatus, updateChipImageCHQStatus,
    selectedIssue, setSelectedIssue, selectedPlateIssue, setSelectedPlateIssue, selectedChipImageId, setSelectedChipImageId, chipInfoRows
  } = useAppStore();
  const [subTab, setSubTab] = useState<IssueSubTab>('equipment');
  const [equipmentTab, setEquipmentTab] = useState<'new' | 'gallery' | 'stats'>('gallery');
  const [plateTab, setPlateTab] = useState<'new' | 'gallery' | 'stats'>('gallery');
  const [chipImageTab, setChipImageTab] = useState<'new' | 'gallery' | 'stats'>('gallery');
  const [chipStatsDateFrom, setChipStatsDateFrom] = useState('');
  const [chipStatsDateTo, setChipStatsDateTo] = useState('');

  // Reset tabs to list view on mount
  useEffect(() => {
    setEquipmentTab('gallery');
    setPlateTab('gallery');
    setChipImageTab('gallery');
  }, []);
  const [statsDateFrom, setStatsDateFrom] = useState('');
  const [statsDateTo, setStatsDateTo] = useState('');
  const [activeEquipStat, setActiveEquipStat] = useState<string>('장비별 이슈');
  const [activePlateStat, setActivePlateStat] = useState<string>('과정별 이슈');
  const [activeChipStat, setActiveChipStat] = useState<string>('실험 결과 (CHQ)');

  const todayStr = new Date().toISOString().split('T')[0];
  // Equipment issue form
  const [newIssue, setNewIssue] = useState({
    type: EQUIPMENT_TYPES[0],
    plateId: '',
    barcode: '',
    description: '',
    summary: '',
    estimatedCause: '',
    followUpAction: '',
    experimentResult: '',
    status: 'Open' as 'Open' | 'Resolved',
    date: todayStr,
  });
  const [pendingIssueFiles, setPendingIssueFiles] = useState<{ file: File; previewUrl: string }[]>([]);
  const [uploadingIssue, setUploadingIssue] = useState(false);
  // Plate issue form
  const [newPlateIssue, setNewPlateIssue] = useState({
    step: PLATE_PROCESS_TYPES[0],
    plateId: '',
    barcode: '',
    description: '',
    summary: '',
    estimatedCause: '',
    followUpAction: '',
    experimentResult: '',
    status: 'Open' as 'Open' | 'Resolved',
    date: todayStr,
  });
  const [pendingPlateIssueFiles, setPendingPlateIssueFiles] = useState<{ file: File; previewUrl: string }[]>([]);
  const [uploadingPlateIssue, setUploadingPlateIssue] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Chip image tab state
  const [pendingChipImageFiles, setPendingChipImageFiles] = useState<{ file: File; previewUrl: string }[]>([]);
  const [uploadingChipImage, setUploadingChipImage] = useState(false);
  const [imageTypeIsCustom, setImageTypeIsCustom] = useState(false);
  const [imageTypeCustom, setImageTypeCustom] = useState('');
  const [equipBarcodeStatus, setEquipBarcodeStatus] = useState<'idle' | 'success' | 'fail'>('idle');
  const [plateBarcodeStatus, setPlateBarcodeStatus] = useState<'idle' | 'success' | 'fail'>('idle');
  const [chipBarcodeStatus, setChipBarcodeStatus] = useState<'idle' | 'success' | 'fail'>('idle');

  const selectedChipImage = useMemo(() =>
    selectedChipImageId ? chipImageIssues.find(i => i.id === selectedChipImageId) : null,
    [selectedChipImageId, chipImageIssues]
  );

  const emptyChipImageForm = {
    date: new Date().toISOString().split('T')[0],
    equipment: '',
    imageType: '',
    chipType: '',
    plateId: '',
    barcode: '',
    chipPosition: '',
    description: '',
    callRate: '',
    dqc: '',
    qcCallRate: '',
    chqResult: '',
  };
  const [chipImageForm, setChipImageForm] = useState(emptyChipImageForm);

  // Barcode auto-lookup from global store
  useEffect(() => {
    if (!newIssue.plateId.trim() || !newIssue.date) { setEquipBarcodeStatus('idle'); return; }
    const plateId = newIssue.plateId.trim().toUpperCase();
    const match = chipInfoRows.find(r => r.plateId.toUpperCase() === plateId && r.steps.some(s => s.date === newIssue.date));
    if (match && match.barcode) {
      setNewIssue(f => ({ ...f, barcode: match.barcode }));
      setEquipBarcodeStatus('success');
    } else {
      setEquipBarcodeStatus('fail');
    }
  }, [newIssue.plateId, newIssue.date, chipInfoRows]);

  useEffect(() => {
    if (!newPlateIssue.plateId.trim() || !newPlateIssue.date) { setPlateBarcodeStatus('idle'); return; }
    const plateId = newPlateIssue.plateId.trim().toUpperCase();
    const match = chipInfoRows.find(r => r.plateId.toUpperCase() === plateId && r.steps.some(s => s.date === newPlateIssue.date));
    if (match && match.barcode) {
      setNewPlateIssue(f => ({ ...f, barcode: match.barcode }));
      setPlateBarcodeStatus('success');
    } else {
      setPlateBarcodeStatus('fail');
    }
  }, [newPlateIssue.plateId, newPlateIssue.date, chipInfoRows]);

  useEffect(() => {
    if (!chipImageForm.plateId.trim() || !chipImageForm.date) { setChipBarcodeStatus('idle'); return; }
    const plateId = chipImageForm.plateId.trim().toUpperCase();
    const match = chipInfoRows.find(r => r.plateId.toUpperCase() === plateId && r.steps.some(s => s.date === chipImageForm.date));
    if (match && match.barcode) {
      setChipImageForm(f => ({
        ...f,
        barcode: match.barcode,
        equipment: match.equipment || f.equipment,
        chipType: match.chipType || f.chipType
      }));
      setChipBarcodeStatus('success');
    } else {
      setChipBarcodeStatus('fail');
    }
  }, [chipImageForm.plateId, chipImageForm.date, chipInfoRows]);


  const chartData = useMemo(() => {
    return EQUIPMENT_TYPES.map(t => ({ name: t, count: issues.filter(i => i.type === t).length })).filter(d => d.count > 0);
  }, [issues]);

  const statsFilteredIssues = useMemo(() => issues.filter(i =>
    (!statsDateFrom || i.date >= statsDateFrom) && (!statsDateTo || i.date <= statsDateTo)
  ), [issues, statsDateFrom, statsDateTo]);

  const statsFilteredPlateIssues = useMemo(() => plateIssues.filter(i =>
    (!statsDateFrom || i.date >= statsDateFrom) && (!statsDateTo || i.date <= statsDateTo)
  ), [plateIssues, statsDateFrom, statsDateTo]);

  const handleAddIssue = async () => {
    if (!newIssue.description) return;
    setUploadingIssue(true);
    try {
      const token = await getAccessToken();
      let photos: { fileId: string; viewUrl: string; thumbnailBase64?: string }[] = [];
      if (pendingIssueFiles.length > 0) {
        photos = await Promise.all(
          pendingIssueFiles.map(async ({ file }) => {
            const [r, thumb] = await Promise.all([uploadIssueToDrive(file, newIssue.date, token, 'equipment'), createThumbnailBase64(file).catch(() => undefined)]);
            return { fileId: r.fileId, viewUrl: r.viewUrl, thumbnailBase64: thumb };
          })
        );
      }
      await addIssue({ id: Date.now().toString(), reporter: user?.name || 'Unknown', ...newIssue, photos }, token);
      setNewIssue({ type: newIssue.type, plateId: '', barcode: '', description: '', summary: '', estimatedCause: '', followUpAction: '', experimentResult: '', status: 'Open', date: new Date().toISOString().split('T')[0] });
      pendingIssueFiles.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
      setPendingIssueFiles([]);
      setEquipmentTab('gallery');
    } catch (e: any) {
      alert('저장 오류: ' + (e?.message || String(e)));
    } finally {
      setUploadingIssue(false);
    }
  };

  const handleAddPlateIssue = async () => {
    if (!newPlateIssue.description) return;
    setUploadingPlateIssue(true);
    try {
      const token = await getAccessToken();
      let photos: { fileId: string; viewUrl: string; thumbnailBase64?: string }[] = [];
      if (pendingPlateIssueFiles.length > 0) {
        photos = await Promise.all(
          pendingPlateIssueFiles.map(async ({ file }) => {
            const [r, thumb] = await Promise.all([uploadIssueToDrive(file, newPlateIssue.date, token, 'plate'), createThumbnailBase64(file).catch(() => undefined)]);
            return { fileId: r.fileId, viewUrl: r.viewUrl, thumbnailBase64: thumb };
          })
        );
      }
      await addPlateIssue({ id: Date.now().toString(), reporter: user?.name || 'Unknown', ...newPlateIssue, photos }, token);
      setNewPlateIssue({ step: newPlateIssue.step, plateId: '', barcode: '', description: '', summary: '', estimatedCause: '', followUpAction: '', experimentResult: '', status: 'Open', date: new Date().toISOString().split('T')[0] });
      pendingPlateIssueFiles.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
      setPendingPlateIssueFiles([]);
      setPlateTab('gallery');
    } catch (e: any) {
      alert('저장 오류: ' + (e?.message || String(e)));
    } finally {
      setUploadingPlateIssue(false);
    }
  };

  const handleAddChipImage = async () => {
    if (pendingChipImageFiles.length === 0) return;
    setUploadingChipImage(true);
    try {
      const token = await getAccessToken();
      const date = chipImageForm.date || new Date().toISOString().split('T')[0];
      const photos = await Promise.all(
        pendingChipImageFiles.map(async ({ file }) => {
          const [r, thumb] = await Promise.all([uploadChipImageToDrive(file, date, token), createThumbnailBase64(file).catch(() => undefined)]);
          return { fileId: r.fileId, viewUrl: r.viewUrl, thumbnailBase64: thumb };
        })
      );
      await addChipImageIssue({
        id: Date.now().toString(),
        ...chipImageForm,
        photos,
        reporter: user?.name || '',
      });
      setChipImageForm({ ...emptyChipImageForm, date: new Date().toISOString().split('T')[0] });
      pendingChipImageFiles.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
      setPendingChipImageFiles([]);
      setShowForm(false);
    } catch (e: any) {
      alert('업로드 오류: ' + e.message);
    } finally {
      setUploadingChipImage(false);
    }
  };

  const subTabs = [
    { id: 'equipment' as const, label: '장비 이슈', icon: AlertTriangle },
    { id: 'plate' as const, label: '실험 이슈', icon: Layers },
    { id: 'chipImage' as const, label: 'Chip 이미지', icon: ImageIcon },
  ];

  return (
    <div className="space-y-4 md:space-y-6 max-w-5xl">
      {/* Sub-tab navigation */}
      <div className="flex flex-wrap items-center gap-2">
        {subTabs.map(st => (
          <button key={st.id} onClick={() => { setSubTab(st.id); }} className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all ${subTab === st.id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
            <st.icon className="w-3.5 h-3.5" />
            {st.label}
          </button>
        ))}
      </div>

      {/* =================== EQUIPMENT ISSUES =================== */}
      {subTab === 'equipment' && (
        <div className="space-y-4">
          <div className="flex bg-secondary rounded-lg p-0.5 self-start w-fit">
            {([
              { id: 'new', label: '새 기록', icon: Plus },
              { id: 'gallery', label: '목록', icon: List },
              { id: 'stats', label: '통계', icon: BarChart3 },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setEquipmentTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${equipmentTab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>

          {/* ── 새 기록 ── */}
          {equipmentTab === 'new' && (
            <div className="card-base p-4 md:p-5 space-y-4">
              {/* Row 1: 발생일자 + GTMC 장비 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label-overline mb-1.5 block">발생 날짜</label>
                  <input type="date" value={newIssue.date} onChange={e => setNewIssue({ ...newIssue, date: e.target.value })} className="input-clean h-9" />
                </div>
                <div>
                  <label className="label-overline mb-1.5 block">GTMC 장비</label>
                  <select value={newIssue.type} onChange={e => setNewIssue({ ...newIssue, type: e.target.value })} className="input-clean h-9">
                    {EQUIPMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {/* Row 2: #p + Barcode */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-overline mb-1.5 block">#p</label>
                  <input value={newIssue.plateId} onChange={e => setNewIssue({ ...newIssue, plateId: e.target.value })} className="input-clean font-mono" placeholder="" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <label className="label-overline block">Barcode</label>
                    {equipBarcodeStatus === 'success' && <span className="text-[10px] text-emerald-500 font-bold">✅ 자동 입력됨</span>}
                    {equipBarcodeStatus === 'fail' && <span className="text-[10px] text-rose-500 font-bold">❌ 조회 실패</span>}
                  </div>
                  <input value={newIssue.barcode} onChange={e => setNewIssue({ ...newIssue, barcode: e.target.value })} className="input-clean font-mono" placeholder="직접 입력 가능" />
                </div>
              </div>
              {/* Row 3: 사건 개요 */}
              <div>
                <label className="label-overline mb-1.5 block">사건 개요</label>
                <input value={newIssue.summary} onChange={e => setNewIssue({ ...newIssue, summary: e.target.value })} className="input-clean" placeholder="" />
              </div>
              {/* Row 4: 상세 내용 */}
              <div>
                <label className="label-overline mb-1.5 block">상세 내용</label>
                <textarea value={newIssue.description} onChange={e => setNewIssue({ ...newIssue, description: e.target.value })} className="input-clean min-h-[72px] resize-none" placeholder="" />
              </div>
              {/* Row 4: 추정 원인 + 후속 조치 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label-overline mb-1.5 block">추정 원인</label>
                  <input value={newIssue.estimatedCause} onChange={e => setNewIssue({ ...newIssue, estimatedCause: e.target.value })} className="input-clean" placeholder="" />
                </div>
                <div>
                  <label className="label-overline mb-1.5 block">후속 조치</label>
                  <input value={newIssue.followUpAction} onChange={e => setNewIssue({ ...newIssue, followUpAction: e.target.value })} className="input-clean" placeholder="" />
                </div>
              </div>
              {/* Row 5: 해결 여부 + 실험결과 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label-overline mb-1.5 block">해결 여부</label>
                  <div className="flex gap-2">
                    {(['Open', 'Resolved'] as const).map(s => (
                      <button key={s} onClick={() => setNewIssue({ ...newIssue, status: s })}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${newIssue.status === s ? (s === 'Open' ? 'bg-warning/20 text-warning border-warning/30' : 'bg-accent/20 text-accent border-accent/30') : 'bg-secondary text-muted-foreground border-transparent'}`}>
                        {s === 'Open' ? '미해결' : '해결됨'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label-overline mb-1.5 block">실험결과</label>
                  <div className="flex gap-2">
                    {(['Pass', 'Fail'] as const).map(res => (
                      <button key={res} onClick={() => setNewIssue({ ...newIssue, experimentResult: newIssue.experimentResult === res ? '' : res })}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${newIssue.experimentResult === res ? (res === 'Pass' ? 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30' : 'bg-rose-500/20 text-rose-600 border-rose-500/30') : 'bg-secondary text-muted-foreground border-transparent'}`}>
                        {res}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {/* Row 6: 이미지 */}
              <div>
                <label className="label-overline mb-1.5 block">참고 사진</label>
                <label htmlFor="equip-photo-upload" className="flex items-center justify-center gap-2 p-3 bg-secondary rounded-lg cursor-pointer hover:bg-muted transition-all border border-dashed border-muted-foreground/20">
                  <Camera className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                  <span className="text-xs text-muted-foreground font-medium">촬영 또는 업로드 (다중 선택 가능)</span>
                </label>
                <input id="equip-photo-upload" type="file" accept="image/*" multiple className="hidden"
                  onChange={e => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      const newEntries = Array.from(files).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) }));
                      setPendingIssueFiles(prev => [...prev, ...newEntries]);
                    }
                    e.target.value = '';
                  }} />
                {pendingIssueFiles.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 p-2 bg-secondary/20 rounded-lg">
                    {pendingIssueFiles.map(({ file, previewUrl }, i) => (
                      <div key={`${file.name}-${i}`} className="relative group">
                        <img src={previewUrl} alt="" className="w-20 h-20 object-cover rounded shadow-sm border border-white" />
                        <button type="button" onClick={() => { URL.revokeObjectURL(previewUrl); setPendingIssueFiles(prev => prev.filter((_, j) => j !== i)); }}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-black/70 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border border-white">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <User className="w-3.5 h-3.5" />
                  <span>보고자: <span className="font-semibold text-foreground">{user?.name || '—'}</span></span>
                </div>
                <button onClick={() => handleAddIssue()} disabled={uploadingIssue} className="btn-primary btn-sm">{uploadingIssue ? '업로드 중...' : '이슈 등록'}</button>
              </div>
            </div>
          )}

          {/* ── 목록 ── */}
          {equipmentTab === 'gallery' && (
            <div className="grid gap-2">
              {statsFilteredIssues.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground bg-secondary/20 rounded-xl border border-dashed border-muted-foreground/20">
                  등록된 이슈가 없습니다.
                </div>
              ) : (
                statsFilteredIssues.map((issue) => (
                  <div key={issue.id} onClick={() => setSelectedIssue(issue)}
                    className="group flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-card rounded-lg border border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 flex-1 min-w-0">
                      <span className="text-xs font-mono text-muted-foreground w-20 shrink-0">{issue.date}</span>
                      <span className="shrink-0 px-2 py-0.5 rounded bg-secondary text-xs font-semibold text-secondary-foreground">{issue.type}</span>
                      <span className="text-sm font-medium text-foreground truncate">{issue.summary || issue.description}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2 sm:mt-0 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${issue.status === 'Resolved' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'}`}>
                        {issue.status === 'Resolved' ? '해결됨' : '미해결'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── 통계 ── */}
          {equipmentTab === 'stats' && (
            <div className="space-y-4">
              {/* 기간 필터 */}
              <div className="card-base p-3 flex flex-wrap items-center gap-3">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest shrink-0">기간</span>
                <input type="date" value={statsDateFrom} onChange={e => setStatsDateFrom(e.target.value)} className="input-clean h-8 text-xs min-w-0 flex-1 sm:flex-none sm:w-36" />
                <span className="text-xs text-muted-foreground">~</span>
                <input type="date" value={statsDateTo} onChange={e => setStatsDateTo(e.target.value)} className="input-clean h-8 text-xs min-w-0 flex-1 sm:flex-none sm:w-36" />
                {(statsDateFrom || statsDateTo) && (
                  <button onClick={() => { setStatsDateFrom(''); setStatsDateTo(''); }} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">초기화</button>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">총 {statsFilteredIssues.length}건</span>
              </div>
              {/* 통계 기준 선택 */}
              <div className="flex flex-wrap gap-2">
                {['장비별 이슈', '해결 현황', '결과별 현황'].map(s => (
                  <button key={s} onClick={() => setActiveEquipStat(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${activeEquipStat === s ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-secondary text-muted-foreground border-transparent hover:text-foreground'}`}>
                    {s}
                  </button>
                ))}
              </div>

              {(() => {
                const item = [
                  { title: '장비별 이슈', data: EQUIPMENT_TYPES.map(t => ({ name: t, count: statsFilteredIssues.filter(i => i.type === t).length })).filter(d => d.count > 0) },
                  { title: '해결 현황', data: [{ name: '미해결', count: statsFilteredIssues.filter(i => i.status === 'Open').length }, { name: '해결됨', count: statsFilteredIssues.filter(i => i.status === 'Resolved').length }].filter(d => d.count > 0) },
                  { title: '결과별 현황', data: [{ name: 'Pass', count: statsFilteredIssues.filter(i => i.experimentResult === 'Pass').length }, { name: 'Fail', count: statsFilteredIssues.filter(i => i.experimentResult === 'Fail').length }].filter(d => d.count > 0) },
                ].find(x => x.title === activeEquipStat);

                if (!item) return null;

                return (
                  <div key={item.title} className="card-base p-4 md:p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <p className="label-overline mb-4">{item.title}</p>
                    {item.data.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-12">데이터 없음</p>
                    ) : (
                      <div className="h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={item.data}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(220 13% 91%)" />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: 'hsl(220 10% 46%)' }} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: 'hsl(220 10% 46%)' }} allowDecimals={false} />
                            <Tooltip contentStyle={{ backgroundColor: 'hsl(0 0% 100%)', borderRadius: '8px', border: '1px solid hsl(220 13% 91%)' }} cursor={{ fill: 'hsl(215 16% 94%)' }} />
                            <Bar dataKey="count" fill="hsl(220 70% 50%)" radius={[4, 4, 0, 0]} barSize={32} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* =================== PLATE ISSUES =================== */}
      {subTab === 'plate' && (
        <div className="space-y-4">
          <div className="flex bg-secondary rounded-lg p-0.5 self-start w-fit">
            {([
              { id: 'new', label: '새 기록', icon: Plus },
              { id: 'gallery', label: '목록', icon: List },
              { id: 'stats', label: '통계', icon: BarChart3 },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setPlateTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${plateTab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>

          {/* ── 새 기록 ── */}
          {plateTab === 'new' && (
            <div className="card-base p-4 md:p-5 space-y-4">
              {/* Row 1: 발생일자 + 실험과정 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label-overline mb-1.5 block">발생 날짜</label>
                  <input type="date" value={newPlateIssue.date} onChange={e => setNewPlateIssue({ ...newPlateIssue, date: e.target.value })} className="input-clean h-9" />
                </div>
                <div>
                  <label className="label-overline mb-1.5 block">실험과정</label>
                  <select value={newPlateIssue.step} onChange={e => setNewPlateIssue({ ...newPlateIssue, step: e.target.value })} className="input-clean h-9">
                    {PLATE_PROCESS_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              {/* Row 2: #p + Barcode */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-overline mb-1.5 block">#p</label>
                  <input value={newPlateIssue.plateId} onChange={e => setNewPlateIssue({ ...newPlateIssue, plateId: e.target.value })} className="input-clean font-mono" placeholder="" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <label className="label-overline block">Barcode</label>
                    {plateBarcodeStatus === 'success' && <span className="text-[10px] text-emerald-500 font-bold">✅ 자동 입력됨</span>}
                    {plateBarcodeStatus === 'fail' && <span className="text-[10px] text-rose-500 font-bold">❌ 조회 실패</span>}
                  </div>
                  <input value={newPlateIssue.barcode} onChange={e => setNewPlateIssue({ ...newPlateIssue, barcode: e.target.value })} className="input-clean font-mono" placeholder="직접 입력 가능" />
                </div>
              </div>
              {/* Row 3: 사건 개요 */}
              <div>
                <label className="label-overline mb-1.5 block">사건 개요</label>
                <input value={newPlateIssue.summary} onChange={e => setNewPlateIssue({ ...newPlateIssue, summary: e.target.value })} className="input-clean" placeholder="" />
              </div>
              {/* Row 4: 상세 내용 */}
              <div>
                <label className="label-overline mb-1.5 block">상세 내용</label>
                <textarea value={newPlateIssue.description} onChange={e => setNewPlateIssue({ ...newPlateIssue, description: e.target.value })} className="input-clean min-h-[72px] resize-none" placeholder="" />
              </div>
              {/* Row 4: 추정 원인 + 후속 조치 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label-overline mb-1.5 block">추정 원인</label>
                  <input value={newPlateIssue.estimatedCause} onChange={e => setNewPlateIssue({ ...newPlateIssue, estimatedCause: e.target.value })} className="input-clean" placeholder="" />
                </div>
                <div>
                  <label className="label-overline mb-1.5 block">후속 조치</label>
                  <input value={newPlateIssue.followUpAction} onChange={e => setNewPlateIssue({ ...newPlateIssue, followUpAction: e.target.value })} className="input-clean" placeholder="" />
                </div>
              </div>
              {/* Row 5: 해결 여부 + 실험결과 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label-overline mb-1.5 block">해결 여부</label>
                  <div className="flex gap-2">
                    {(['Open', 'Resolved'] as const).map(s => (
                      <button key={s} onClick={() => setNewPlateIssue({ ...newPlateIssue, status: s })}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${newPlateIssue.status === s ? (s === 'Open' ? 'bg-warning/20 text-warning border-warning/30' : 'bg-accent/20 text-accent border-accent/30') : 'bg-secondary text-muted-foreground border-transparent'}`}>
                        {s === 'Open' ? '미해결' : '해결됨'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label-overline mb-1.5 block">실험결과</label>
                  <div className="flex gap-2">
                    {(['Pass', 'Fail'] as const).map(res => (
                      <button key={res} onClick={() => setNewPlateIssue({ ...newPlateIssue, experimentResult: newPlateIssue.experimentResult === res ? '' : res })}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${newPlateIssue.experimentResult === res ? (res === 'Pass' ? 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30' : 'bg-rose-500/20 text-rose-600 border-rose-500/30') : 'bg-secondary text-muted-foreground border-transparent'}`}>
                        {res}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {/* Row 6: 참고 사진 */}
              <div>
                <label className="label-overline mb-1.5 block">참고 사진</label>
                <label htmlFor="plate-photo-upload" className="flex items-center justify-center gap-2 p-3 bg-secondary rounded-lg cursor-pointer hover:bg-muted transition-all border border-dashed border-muted-foreground/20">
                  <Camera className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                  <span className="text-xs text-muted-foreground font-medium">촬영 또는 업로드 (다중 선택 가능)</span>
                </label>
                <input id="plate-photo-upload" type="file" accept="image/*" multiple className="hidden"
                  onChange={e => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      const newEntries = Array.from(files).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) }));
                      setPendingPlateIssueFiles(prev => [...prev, ...newEntries]);
                    }
                    e.target.value = '';
                  }} />
                {pendingPlateIssueFiles.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 p-2 bg-secondary/20 rounded-lg">
                    {pendingPlateIssueFiles.map(({ file, previewUrl }, i) => (
                      <div key={`${file.name}-${i}`} className="relative group">
                        <img src={previewUrl} alt="" className="w-20 h-20 object-cover rounded shadow-sm border border-white" />
                        <button type="button" onClick={() => { URL.revokeObjectURL(previewUrl); setPendingPlateIssueFiles(prev => prev.filter((_, j) => j !== i)); }}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-black/70 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border border-white">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <User className="w-3.5 h-3.5" />
                  <span>보고자: <span className="font-semibold text-foreground">{user?.name || '—'}</span></span>
                </div>
                <button onClick={() => handleAddPlateIssue()} disabled={uploadingPlateIssue} className="btn-primary btn-sm flex items-center gap-2">
                  {uploadingPlateIssue ? (<><RotateCcw className="w-3 h-3 animate-spin" /> 업로드 중...</>) : '등록'}
                </button>
              </div>
            </div>
          )}

          {/* ── 목록 ── */}
          {plateTab === 'gallery' && (
            <div className="grid gap-2">
              {statsFilteredPlateIssues.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground bg-secondary/20 rounded-xl border border-dashed border-muted-foreground/20">
                  등록된 이슈가 없습니다.
                </div>
              ) : (
                statsFilteredPlateIssues.map((issue) => (
                  <div key={issue.id} onClick={() => setSelectedPlateIssue(issue)}
                    className="group flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-card rounded-lg border border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 flex-1 min-w-0">
                      <span className="text-xs font-mono text-muted-foreground w-20 shrink-0">{issue.date}</span>
                      <span className="shrink-0 px-2 py-0.5 rounded bg-secondary text-xs font-semibold text-secondary-foreground">{issue.step}</span>
                      <span className="text-sm font-medium text-foreground truncate">{issue.summary || issue.description}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2 sm:mt-0 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${issue.status === 'Resolved' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'}`}>
                        {issue.status === 'Resolved' ? '해결됨' : '미해결'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── 통계 ── */}
          {plateTab === 'stats' && (
            <div className="space-y-4">
              <div className="card-base p-3 flex flex-wrap items-center gap-3">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest shrink-0">기간</span>
                <input type="date" value={statsDateFrom} onChange={e => setStatsDateFrom(e.target.value)} className="input-clean h-8 text-xs min-w-0 flex-1 sm:flex-none sm:w-36" />
                <span className="text-xs text-muted-foreground">~</span>
                <input type="date" value={statsDateTo} onChange={e => setStatsDateTo(e.target.value)} className="input-clean h-8 text-xs min-w-0 flex-1 sm:flex-none sm:w-36" />
                {(statsDateFrom || statsDateTo) && (
                  <button onClick={() => { setStatsDateFrom(''); setStatsDateTo(''); }} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">초기화</button>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">총 {statsFilteredPlateIssues.length}건</span>
              </div>

              {/* 통계 기준 선택 */}
              <div className="flex flex-wrap gap-2">
                {['과정별 이슈', '해결 현황', '결과별 현황'].map(s => (
                  <button key={s} onClick={() => setActivePlateStat(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${activePlateStat === s ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-secondary text-muted-foreground border-transparent hover:text-foreground'}`}>
                    {s}
                  </button>
                ))}
              </div>

              {(() => {
                const item = [
                  { title: '과정별 이슈', data: Object.entries(statsFilteredPlateIssues.reduce((acc, i) => { const k = i.step || '미분류'; acc[k] = (acc[k] || 0) + 1; return acc; }, {} as Record<string, number>)).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) },
                  { title: '해결 현황', data: [{ name: '미해결', count: statsFilteredPlateIssues.filter(i => i.status === 'Open').length }, { name: '해결됨', count: statsFilteredPlateIssues.filter(i => i.status === 'Resolved').length }].filter(d => d.count > 0) },
                  { title: '결과별 현황', data: [{ name: 'Pass', count: statsFilteredPlateIssues.filter(i => i.experimentResult === 'Pass').length }, { name: 'Fail', count: statsFilteredPlateIssues.filter(i => i.experimentResult === 'Fail').length }].filter(d => d.count > 0) },
                ].find(x => x.title === activePlateStat);

                if (!item) return null;

                return (
                  <div key={item.title} className="card-base p-4 md:p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <p className="label-overline mb-4">{item.title}</p>
                    {item.data.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-12">데이터 없음</p>
                    ) : (
                      <div className="h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={item.data}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(220 13% 91%)" />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: 'hsl(220 10% 46%)' }} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: 'hsl(220 10% 46%)' }} allowDecimals={false} />
                            <Tooltip contentStyle={{ backgroundColor: 'hsl(0 0% 100%)', borderRadius: '8px', border: '1px solid hsl(220 13% 91%)' }} cursor={{ fill: 'hsl(215 16% 94%)' }} />
                            <Bar dataKey="count" fill="hsl(220 70% 50%)" radius={[4, 4, 0, 0]} barSize={32} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* =================== CHIP IMAGE ISSUES =================== */}
      {subTab === 'chipImage' && (
        <div className="space-y-4">
          {/* 3 independent tabs */}
          <div className="flex bg-secondary rounded-lg p-0.5 self-start w-fit">
            {([
              { id: 'new', label: '새 기록', icon: Plus },
              { id: 'gallery', label: '목록', icon: List },
              { id: 'stats', label: '통계', icon: BarChart3 },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setChipImageTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${chipImageTab === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>

          {/* ── 새 기록 ── */}
          {chipImageTab === 'new' && (
            <div className="card-base p-4 md:p-6 space-y-5">
              {/* Image upload */}
              <div>
                <label className="label-overline mb-1.5 block">Chip 이미지</label>
                <div className="space-y-4">
                  <label htmlFor="chip-photo-upload" className="flex flex-col items-center justify-center gap-2 p-6 bg-secondary rounded-xl cursor-pointer hover:bg-muted transition-all border border-dashed border-muted-foreground/20">
                    <ImageIcon className="w-8 h-8 text-muted-foreground/40" strokeWidth={1.5} />
                    <span className="text-xs text-muted-foreground font-medium">
                      {pendingChipImageFiles.length > 0 ? `${pendingChipImageFiles.length}개 선택됨` : '촬영 또는 이미지 파일 선택 (다중 가능)'}
                    </span>
                  </label>
                  <input id="chip-photo-upload" type="file" accept="image/*" multiple className="hidden"
                    onChange={e => {
                      const files = e.target.files;
                      if (files && files.length > 0) {
                        const newEntries = Array.from(files).map(f => ({ file: f, previewUrl: URL.createObjectURL(f) }));
                        setPendingChipImageFiles(prev => [...prev, ...newEntries]);
                      }
                      e.target.value = '';
                    }} />
                </div>
                {pendingChipImageFiles.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 p-2 bg-secondary/20 rounded-lg">
                    {pendingChipImageFiles.map(({ file, previewUrl }, i) => (
                      <div key={`${file.name}-${i}`} className="relative group">
                        <img src={previewUrl} alt="" className="w-20 h-20 object-cover rounded shadow-sm border border-white" />
                        <button type="button" onClick={() => { URL.revokeObjectURL(previewUrl); setPendingChipImageFiles(prev => prev.filter((_, j) => j !== i)); }}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-black/70 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity border border-white">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Date / #p / Barcode / Position */}
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-1">
                  <label className="label-overline mb-1 block">Wash 날짜</label>
                  <input type="date" value={chipImageForm.date}
                    onChange={e => setChipImageForm(f => ({ ...f, date: e.target.value }))}
                    className="input-clean" />
                </div>
                <div className="col-span-1">
                  <label className="label-overline mb-1 block">#p</label>
                  <input value={chipImageForm.plateId}
                    onChange={e => setChipImageForm(f => ({ ...f, plateId: e.target.value }))}
                    className="input-clean font-mono" />
                </div>
                <div className="col-span-1">
                  <div className="flex items-center gap-1 mb-1">
                    <label className="label-overline block">Barcode</label>
                    {chipBarcodeStatus === 'success' && <span className="text-[10px] text-emerald-500 font-bold">✅</span>}
                    {chipBarcodeStatus === 'fail' && <span className="text-[10px] text-rose-500 font-bold">❌</span>}
                  </div>
                  <input value={chipImageForm.barcode} onChange={e => setChipImageForm(f => ({ ...f, barcode: e.target.value }))}
                    className="input-clean font-mono" placeholder="입력" />
                </div>
                <div className="col-span-1">
                  <label className="label-overline mb-1 block">Position</label>
                  <input value={chipImageForm.chipPosition}
                    onChange={e => setChipImageForm(f => ({ ...f, chipPosition: e.target.value.toUpperCase() }))}
                    maxLength={3}
                    placeholder=""
                    className="input-clean font-mono text-center uppercase" />
                </div>
              </div>

              {/* GTMC 장비 */}
              <div>
                <label className="label-overline mb-2 block">GTMC 장비</label>
                <div className="flex flex-wrap gap-2">
                  {CHIP_EQUIPMENT_TYPES.map(eq => (
                    <button key={eq}
                      onClick={() => setChipImageForm(f => ({ ...f, equipment: f.equipment === eq ? '' : eq }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${chipImageForm.equipment === eq ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
                      {eq}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chip 종류 */}
              <div>
                <label className="label-overline mb-2 block">Chip 종류</label>
                <div className="flex flex-wrap gap-2">
                  {CHIP_TYPES.map(ct => (
                    <button key={ct}
                      onClick={() => setChipImageForm(f => ({ ...f, chipType: f.chipType === ct ? '' : ct }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${chipImageForm.chipType === ct ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
                      {ct}
                    </button>
                  ))}
                </div>
              </div>

              {/* Image 유형 */}
              <div>
                <label className="label-overline mb-2 block">Image 유형</label>
                <div className="flex flex-wrap gap-2">
                  {CHIP_IMAGE_ISSUE_TYPES.map(it => (
                    <button key={it}
                      onClick={() => { setImageTypeIsCustom(false); setImageTypeCustom(''); setChipImageForm(f => ({ ...f, imageType: f.imageType === it ? '' : it })); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${chipImageForm.imageType === it && !imageTypeIsCustom ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
                      {it}
                    </button>
                  ))}
                  <button
                    onClick={() => { setImageTypeIsCustom(true); setChipImageForm(f => ({ ...f, imageType: imageTypeCustom })); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${imageTypeIsCustom ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
                    기타
                  </button>
                </div>
                {imageTypeIsCustom && (
                  <input autoFocus value={imageTypeCustom}
                    onChange={e => { setImageTypeCustom(e.target.value); setChipImageForm(f => ({ ...f, imageType: e.target.value })); }}
                    className="input-clean mt-2 max-w-xs" />
                )}
              </div>

              {/* CHQ result */}
              <div>
                <label className="label-overline mb-2 block">실험 결과 (CHQ result)</label>
                <div className="flex gap-2">
                  {(['Pass', 'Fail'] as const).map(r => (
                    <button key={r}
                      onClick={() => setChipImageForm(f => ({ ...f, chqResult: f.chqResult === r ? '' : r }))}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${chipImageForm.chqResult === r
                        ? (r === 'Pass' ? 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30' : 'bg-rose-500/20 text-rose-600 border-rose-500/30')
                        : 'bg-secondary text-muted-foreground border-transparent'
                        }`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* QC metrics */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Call rate', key: 'callRate' as const },
                  { label: 'DQC', key: 'dqc' as const },
                  { label: 'QC call rate', key: 'qcCallRate' as const },
                ].map(({ label, key }) => (
                  <div key={key}>
                    <label className="label-overline mb-1 block">{label}</label>
                    <input value={chipImageForm[key]}
                      onChange={e => setChipImageForm(f => ({ ...f, [key]: e.target.value }))}
                      className="input-clean font-mono" />
                  </div>
                ))}
              </div>

              {/* Description */}
              <div>
                <label className="label-overline mb-1 block">Description</label>
                <textarea value={chipImageForm.description}
                  onChange={e => setChipImageForm(f => ({ ...f, description: e.target.value }))}
                  className="input-clean resize-none min-h-[80px]" />
              </div>

              <div className="flex justify-end">
                <button onClick={handleAddChipImage}
                  disabled={uploadingChipImage || pendingChipImageFiles.length === 0}
                  className="btn-primary">
                  {uploadingChipImage ? '업로드 중...' : '등록'}
                </button>
              </div>
            </div>
          )}

          {/* ── 목록 ── */}
          {chipImageTab === 'gallery' && (
            <div className="grid gap-2">
              {chipImageIssues.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground bg-secondary/20 rounded-xl border border-dashed border-muted-foreground/20">
                  등록된 Chip 이미지 이슈가 없습니다.
                </div>
              ) : (
                chipImageIssues.map((chip) => (
                  <div key={chip.id} onClick={() => setSelectedChipImageId(chip.id)}
                    className="group flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-card rounded-lg border border-border/50 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 flex-1 min-w-0">
                      <span className="text-xs font-mono text-muted-foreground w-20 shrink-0">{chip.date || '-'}</span>
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {chip.chipType && <span className="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-xs font-semibold text-amber-700 dark:text-amber-400">{chip.chipType}</span>}
                        {chip.equipment && <span className="px-2 py-0.5 rounded bg-secondary text-xs font-semibold text-secondary-foreground">{chip.equipment}</span>}
                      </div>
                      <span className="text-sm font-medium text-foreground truncate">{chip.imageType || 'Custom'}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-0 shrink-0">
                      {chip.chqResult && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${chip.chqResult === 'Pass' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'}`}>
                          {chip.chqResult}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── 통계 ── */}
          {chipImageTab === 'stats' && (() => {
            const statsFilteredChipIssues = chipImageIssues.filter(i =>
              (!chipStatsDateFrom || i.date >= chipStatsDateFrom) && (!chipStatsDateTo || i.date <= chipStatsDateTo)
            );
            return (
              <div className="space-y-4">
                {/* 기간 필터 */}
                <div className="card-base p-3 flex flex-wrap items-center gap-3">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest shrink-0">기간</span>
                  <input type="date" value={chipStatsDateFrom} onChange={e => setChipStatsDateFrom(e.target.value)} className="input-clean h-8 text-xs min-w-0 flex-1 sm:flex-none sm:w-36" />
                  <span className="text-xs text-muted-foreground">~</span>
                  <input type="date" value={chipStatsDateTo} onChange={e => setChipStatsDateTo(e.target.value)} className="input-clean h-8 text-xs min-w-0 flex-1 sm:flex-none sm:w-36" />
                  {(chipStatsDateFrom || chipStatsDateTo) && (
                    <button onClick={() => { setChipStatsDateFrom(''); setChipStatsDateTo(''); }} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">초기화</button>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto">총 {statsFilteredChipIssues.length}건</span>
                </div>

                {/* 통계 기준 선택 */}
                <div className="flex flex-wrap gap-2">
                  {['실험 결과 (CHQ)', 'Image 유형별', 'GTMC 장비별', 'Chip 종류별'].map(s => (
                    <button key={s} onClick={() => setActiveChipStat(s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${activeChipStat === s ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-secondary text-muted-foreground border-transparent hover:text-foreground'}`}>
                      {s}
                    </button>
                  ))}
                </div>

                {(() => {
                  const items = [
                    { title: '실험 결과 (CHQ)', data: [{ name: 'Pass', count: statsFilteredChipIssues.filter(i => i.chqResult === 'Pass').length }, { name: 'Fail', count: statsFilteredChipIssues.filter(i => i.chqResult === 'Fail').length }].filter(d => d.count > 0) },
                    { title: 'Image 유형별', key: 'imageType' },
                    { title: 'GTMC 장비별', key: 'equipment' },
                    { title: 'Chip 종류별', key: 'chipType' },
                  ];

                  const item = items.find(x => x.title === activeChipStat);
                  if (!item) return null;

                  let chartData = item.data;
                  if (item.key) {
                    chartData = Object.entries(
                      statsFilteredChipIssues.reduce((acc, c) => {
                        const k = (c as any)[item.key!] || '미분류';
                        acc[k] = (acc[k] || 0) + 1;
                        return acc;
                      }, {} as Record<string, number>)
                    ).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
                  }

                  return (
                    <div key={item.title} className="card-base p-4 md:p-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <p className="label-overline mb-4">{item.title}</p>
                      {!chartData || chartData.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-12">데이터 없음</p>
                      ) : (
                        <div className="h-[200px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(220 13% 91%)" />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: 'hsl(220 10% 46%)' }} />
                              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: 'hsl(220 10% 46%)' }} allowDecimals={false} />
                              <Tooltip contentStyle={{ backgroundColor: 'hsl(0 0% 100%)', borderRadius: '8px', border: '1px solid hsl(220 13% 91%)' }} cursor={{ fill: 'hsl(215 16% 94%)' }} />
                              <Bar dataKey="count" fill="hsl(220 70% 50%)" radius={[4, 4, 0, 0]} barSize={32} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })()}


        </div>
      )}
    </div>
  );
}
