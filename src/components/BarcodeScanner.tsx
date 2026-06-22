import React, { useEffect, useRef, useState } from 'react';
import Quagga from '@ericblade/quagga2';
import { X, CheckCircle2, RotateCcw, ImagePlus, Loader2 } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (result: string) => void;
  onClose: () => void;
}

const QUAGGA_READERS = [
  'code_128_reader', 'ean_reader', 'ean_8_reader',
  'code_39_reader', 'upc_reader', 'i2of5_reader', 'codabar_reader',
];

export function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const scannedRef = useRef(false);
  const consecutiveRef = useRef(0);
  const lastCodeRef = useRef('');
  const lockedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    Quagga.init(
      {
        inputStream: {
          type: 'LiveStream',
          target: containerRef.current,
          constraints: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        locator: { patchSize: 'medium', halfSample: true },
        numOfWorkers: navigator.hardwareConcurrency ?? 2,
        frequency: 10,
        decoder: {
          readers: [
            'code_128_reader', 'ean_reader', 'ean_8_reader',
            'code_39_reader', 'code_39_vin_reader', 'codabar_reader',
            'upc_reader', 'upc_e_reader', 'i2of5_reader',
          ],
        },
        locate: true,
      },
      (err) => {
        if (err) {
          setError('카메라를 열 수 없습니다. 아래 사진 스캔을 이용해주세요.');
          return;
        }
        Quagga.start();
      }
    );

    const onDetected = (data: any) => {
      if (scannedRef.current || lockedRef.current) return;
      const code = data?.codeResult?.code;
      if (!code) return;

      const errors = data.codeResult.decodedCodes
        .filter((c: any) => c.error !== undefined)
        .map((c: any) => c.error);
      const avgError = errors.reduce((a: number, b: number) => a + b, 0) / (errors.length || 1);
      if (avgError > 0.25) return;

      if (code === lastCodeRef.current) {
        consecutiveRef.current++;
      } else {
        consecutiveRef.current = 1;
        lastCodeRef.current = code;
      }

      if (consecutiveRef.current >= 4) {
        lockedRef.current = true;
        setPendingCode(code);
      }
    };

    Quagga.onDetected(onDetected);

    return () => {
      Quagga.offDetected(onDetected);
      Quagga.stop();
    };
  }, []);

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setPhotoError('');
    setPhotoProcessing(true);
    lockedRef.current = true;

    try {
      let code: string | null = null;

      // BarcodeDetector API (Chrome / Samsung Internet 기본 지원)
      if ('BarcodeDetector' in window) {
        const bitmap = await createImageBitmap(file);
        const detector = new (window as any).BarcodeDetector({
          formats: ['code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'upc_e', 'codabar', 'itf'],
        });
        const barcodes = await detector.detect(bitmap);
        if (barcodes.length > 0) code = barcodes[0].rawValue;
      }

      // Quagga2 정지 이미지 폴백
      if (!code) {
        const dataURL = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target!.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        code = await new Promise<string | null>((resolve) => {
          Quagga.decodeSingle(
            { decoder: { readers: QUAGGA_READERS }, locate: true, src: dataURL },
            (result) => resolve(result?.codeResult?.code ?? null)
          );
        });
      }

      if (code) {
        setPendingCode(code.replace(/[^\x20-\x7E]/g, '').trim());
      } else {
        setPhotoError('바코드를 찾을 수 없습니다. 더 선명하게 찍어주세요.');
        lockedRef.current = false;
      }
    } catch {
      setPhotoError('이미지 처리 중 오류가 발생했습니다.');
      lockedRef.current = false;
    } finally {
      setPhotoProcessing(false);
    }
  };

  const handleConfirm = () => {
    if (!pendingCode) return;
    scannedRef.current = true;
    try { Quagga.stop(); } catch { /* 카메라 미시작 시 무시 */ }
    onScan(pendingCode.replace(/[^\x20-\x7E]/g, '').trim());
  };

  const handleRescan = () => {
    lockedRef.current = false;
    consecutiveRef.current = 0;
    lastCodeRef.current = '';
    setPendingCode(null);
    setPhotoError('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-sm mx-4">
        <button onClick={onClose} className="absolute -top-10 right-0 text-white/80 hover:text-white p-1">
          <X className="w-6 h-6" />
        </button>
        <div className="rounded-2xl overflow-hidden border-2 border-primary shadow-2xl relative bg-black">
          <div ref={containerRef} className="w-full aspect-square [&_video]:w-full [&_video]:h-full [&_canvas]:absolute [&_canvas]:inset-0 [&_canvas]:w-full [&_canvas]:h-full" />
          {/* 가이드 박스 */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-72 h-28 border-2 border-primary/80 rounded-xl relative">
              <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-primary rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-primary rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-primary rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-primary rounded-br-lg" />
              {!pendingCode && <div className="absolute inset-x-2 top-1/2 h-0.5 bg-primary/60 animate-scan" />}
            </div>
          </div>
          {/* 인식 결과 오버레이 */}
          {pendingCode && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-center px-6">
                <CheckCircle2 className="w-8 h-8 text-primary mx-auto mb-2" />
                <p className="text-white/60 text-xs mb-1">인식됨</p>
                <p className="text-white font-mono font-bold text-sm break-all">{pendingCode}</p>
              </div>
            </div>
          )}
        </div>

        {pendingCode ? (
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleRescan}
              className="flex-1 py-2.5 rounded-xl bg-white/10 text-white/80 text-sm font-bold hover:bg-white/20 transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> 다시 스캔
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-all flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" /> 확인
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-center text-white/70 text-xs">
              {error || '바코드를 가이드 안에 맞춰주세요'}
            </p>
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={photoProcessing}
              className="w-full py-2.5 rounded-xl bg-white/10 text-white/80 text-sm font-bold hover:bg-white/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {photoProcessing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중...</>
                : <><ImagePlus className="w-4 h-4" /> 사진으로 스캔</>}
            </button>
            {photoError && <p className="text-center text-red-400 text-xs">{photoError}</p>}
          </div>
        )}

        <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
      </div>
    </div>
  );
}
