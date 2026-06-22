import React from 'react';
import { X, AlertTriangle, ImageIcon, ExternalLink } from 'lucide-react';
import { useAppStore } from '@/lib/store';

export function IssueDetailModal() {
  const { 
    selectedIssue, setSelectedIssue, 
    selectedPlateIssue, setSelectedPlateIssue, 
    selectedChipImageId, setSelectedChipImageId,
    chipImageIssues,
    updateIssueStatus, updatePlateIssueStatus, updateChipImageCHQStatus
  } = useAppStore();

  const selectedChipImage = selectedChipImageId ? chipImageIssues.find(c => c.id === selectedChipImageId) : null;
  const active = selectedIssue || selectedPlateIssue || selectedChipImage;

  if (!active) return null;

  const handleClose = () => {
    setSelectedIssue(null);
    setSelectedPlateIssue(null);
    setSelectedChipImageId(null);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm shadow-2xl">
      <div className="bg-card w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden border border-border/50 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between p-4 border-b border-border/50 bg-secondary/30">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            <h3 className="text-sm font-semibold text-foreground">이슈 상세 정보</h3>
          </div>
          <button onClick={handleClose} className="p-1 hover:bg-secondary rounded-lg transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
        
        <div className="p-6 max-h-[80vh] overflow-y-auto space-y-6">
          {selectedChipImage ? (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Header Info: Unified 4-column layout */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-6 border-b border-border/20">
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">발생일자</p>
                  <p className="text-xs font-semibold text-foreground">{selectedChipImage.date}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">장비/과정</p>
                  <p className="text-xs font-semibold text-foreground">
                    {selectedChipImage.equipment || (selectedChipImage.chipType ? `Chip: ${selectedChipImage.chipType}` : '-')}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">보고자</p>
                  <p className="text-xs font-semibold text-foreground">{selectedChipImage.reporter || '-'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">실험결과</p>
                  <div className="flex gap-2">
                    {['Pass', 'Fail'].map(r => (
                      <button key={r} onClick={() => updateChipImageCHQStatus(selectedChipImage.id, r)}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${selectedChipImage.chqResult === r ? (r === 'Pass' ? 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30' : 'bg-rose-500/20 text-rose-600 border-rose-500/30') : 'bg-secondary text-muted-foreground border-transparent'}`}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Summary Section unified */}
              <div className="space-y-1.5 p-3 bg-secondary/20 rounded-lg">
                <p className="text-[10px] text-muted-foreground font-bold italic">Image 유형</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground">
                    {selectedChipImage.imageType || 'Chip Image Issue'}
                  </p>
                </div>
              </div>

              {/* QC Details Grid */}
              <div className="space-y-3">
                <p className="text-[10px] text-muted-foreground font-bold italic tracking-widest uppercase">QC 상세 정보</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {([
                    ['Chip 종류', selectedChipImage.chipType],
                    ['#p', selectedChipImage.plateId],
                    ['Position', selectedChipImage.chipPosition],
                    ['Barcode', selectedChipImage.barcode],
                    ['Call rate', selectedChipImage.callRate],
                    ['DQC', selectedChipImage.dqc],
                    ['QC call rate', selectedChipImage.qcCallRate],
                  ] as [string, string][]).filter(([, v]) => v).map(([label, value]) => (
                    <div key={label} className="p-2.5 bg-secondary/30 rounded-lg border border-border/10">
                      <p className="text-[9px] text-muted-foreground font-bold uppercase mb-0.5">{label}</p>
                      <p className="text-xs font-mono font-bold text-foreground truncate">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {selectedChipImage.description && (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-muted-foreground font-bold italic">상세 내용</p>
                  <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{selectedChipImage.description}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Header Info */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-4 border-b border-border/20">
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">발생일자</p>
                  <p className="text-xs font-semibold text-foreground">{(active as any).date}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">장비/과정</p>
                  <p className="text-xs font-semibold text-foreground">
                    {(active as any).type || (active as any).step}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">보고자</p>
                  <p className="text-xs font-semibold text-foreground">{(active as any).reporter}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">해결 여부</p>
                  <div className="flex gap-2">
                    {['Open', 'Resolved'].map(s => {
                      const target = selectedIssue || selectedPlateIssue;
                      if (!target) return null;
                      return (
                        <button key={s} onClick={() => {
                          if (selectedIssue) updateIssueStatus(selectedIssue.id, s as any, selectedIssue.experimentResult || '');
                          else if (selectedPlateIssue) updatePlateIssueStatus(selectedPlateIssue.id, s as any, selectedPlateIssue.experimentResult || '');
                        }} className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${target.status === s ? (s === 'Open' ? 'bg-warning/20 text-warning border-warning/30' : 'bg-accent/20 text-accent border-accent/30') : 'bg-secondary text-muted-foreground border-transparent'}`}>
                          {s === 'Resolved' ? '해결됨' : '미해결'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* #p / Barcode */}
              {((active as any).plateId || (active as any).barcode) && (
                <div className="flex items-center gap-3">
                  {(active as any).plateId && (
                    <div className="p-2.5 bg-secondary/30 rounded-lg border border-border/10">
                      <p className="text-[9px] text-muted-foreground font-bold uppercase mb-0.5">#p</p>
                      <p className="text-xs font-mono font-bold text-foreground">{(active as any).plateId}</p>
                    </div>
                  )}
                  {(active as any).barcode && (
                    <div className="p-2.5 bg-secondary/30 rounded-lg border border-border/10">
                      <p className="text-[9px] text-muted-foreground font-bold uppercase mb-0.5">Barcode</p>
                      <p className="text-xs font-mono font-bold text-foreground">{(active as any).barcode}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Summary & Description */}
              <div className="space-y-4">
                {(active as any).summary && (
                  <div className="space-y-1.5 p-3 bg-secondary/20 rounded-lg">
                    <p className="text-[10px] text-muted-foreground font-bold italic">사건 개요</p>
                    <p className="text-sm font-medium text-foreground">{(active as any).summary}</p>
                  </div>
                )}
                {(active as any).description && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-muted-foreground font-bold italic">상세 내용</p>
                    <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{(active as any).description}</p>
                  </div>
                )}
                {((active as any).estimatedCause || (active as any).followUpAction) && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {(active as any).estimatedCause && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-muted-foreground font-bold italic">추정 원인/정보</p>
                        <p className="text-xs text-foreground whitespace-pre-wrap">{(active as any).estimatedCause}</p>
                      </div>
                    )}
                    {(active as any).followUpAction && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] text-muted-foreground font-bold italic">후속 조치</p>
                        <p className="text-xs text-foreground whitespace-pre-wrap">{(active as any).followUpAction}</p>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-1.5">
                  <p className="text-[10px] text-muted-foreground font-bold italic">실험 결과 (Pass/Fail)</p>
                  <div className="flex gap-2">
                    {['Pass', 'Fail'].map(r => {
                      const target = selectedIssue || selectedPlateIssue;
                      if (!target) return null;
                      return (
                        <button key={r} onClick={() => {
                          if (selectedIssue) updateIssueStatus(selectedIssue.id, selectedIssue.status, selectedIssue.experimentResult === r ? '' : r);
                          else if (selectedPlateIssue) updatePlateIssueStatus(selectedPlateIssue.id, selectedPlateIssue.status, selectedPlateIssue.experimentResult === r ? '' : r);
                        }} className={`px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${target.experimentResult === r ? (r === 'Pass' ? 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30' : 'bg-rose-500/20 text-rose-600 border-rose-500/30') : 'bg-secondary text-muted-foreground border-transparent'}`}>
                          {r}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Photos */}
          {((active as any).photos && (active as any).photos.length > 0) || (selectedChipImage && (selectedChipImage.thumbnailBase64 || selectedChipImage.imageUrl)) ? (
            <div className="space-y-3 pt-4 border-t border-border/20">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground font-bold italic tracking-widest uppercase">
                  참고 사진 {((active as any).photos?.length > 0) ? `(${(active as any).photos.length})` : 1}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {((active as any).photos?.length > 0) ? (
                  (active as any).photos.map((p: any, i: number) => (
                    <a 
                      key={i} href={p.viewUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 group p-2 bg-secondary/40 rounded-lg hover:bg-secondary/60 transition-all border border-transparent hover:border-primary/20"
                    >
                      <div className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center shrink-0">
                        <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-medium text-foreground truncate">참고 사진 #{i + 1}</p>
                        <p className="text-[9px] text-muted-foreground">구글 드라이브에서 보기</p>
                      </div>
                    </a>
                  ))
                ) : selectedChipImage ? (
                  <a 
                    href={selectedChipImage.imageUrl || '#'} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 group p-2 bg-secondary/40 rounded-lg hover:bg-secondary/60 transition-all border border-transparent hover:border-primary/20"
                  >
                    <div className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center shrink-0">
                      <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-medium text-foreground truncate">참고 사진 #1</p>
                      <p className="text-[9px] text-muted-foreground">구글 드라이브에서 보기</p>
                    </div>
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
