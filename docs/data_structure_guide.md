# Axiom LabFlow 데이터 구조 및 스키마 가이드

본 문서는 Axiom LabFlow 프로젝트의 데이터 모델과 시트 구조를 명확히 정의합니다.

---

## 1. Google Sheets 스케줄러 & 로그 구조

### 1.1 `Chip info` (마스터 시트)
각 칩의 상태를 추적하는 기준 시트입니다.
*   `Start date`: 실험 시작 날짜
*   `Chip barcode`: chip 바코드
*   `#p` (Plate ID): 플레이트 번호 (실험공정팀 사용)
*   `ISO week`: 해당 주차 (통계 및 중복되는 #p 구분용)
*   `#b`: chip 바코드의 끝 3자리
*   **관계:** `#p`, `ISO week`를 기준으로 실시간 실험 결과와 연결됩니다.

### 1.2 `Reagent log` (시약 로그 시트)
사용된 시약의 롯트 번호와 사용 이력을 관리합니다.
*   `Date`, `Finish time`: 공정 완료 일자와 시각
*   `barcode`: 칩 바코드
*   `Reagent`, `Lot #1`, `Lot #2`: 시약 정보
*   `User`: 작업자 이름 (Zustand 스토어의 `user`)

### 1.3 `Weekly schedule` (주간 일정 시트)
*   요일별(`B`, `F`, `J`, `N`, `R`, `V` 컬럼 등 4칸 단위)로 실험 일정을 기록합니다.
*   `Day 1`, `Day 2`, `Hyb`, `Wash` 단계별로 #p, 시각 정보를 표시하며, `colIdx` 계산 로직에 의해 당일 열을 판별합니다.

---

## 2. Firebase 실시간 데이터 모델 (Shared Data)

Firebase의 `shared/` 경로 하위에 저장되는 실시간 데이터 모델입니다.

*   **`presence/`**: `{ sessionId: { name, photoUrl, connectedAt } }`
*   **`timer/`**: `{ startedAt, totalMs, elapsedMs, isRunning, label }`
*   **`tasks/`**: `{ items: RecurringTask[], lastReset: YYYY-MM-DD }`
    - 당일 한정 업무 목록입니다.
*   **`day1/` / `scheduleState/`**:
    - 당일 실험 진행 상황 및 입력 중간 상태(Firebase-first 전략)

---

## 3. 핵심 데이터 타입 (Typescripts)

주요 데이터 인터페이스 (`types.ts` 발췌):

```typescript
export interface Issue {
  id: string;
  date: string;
  type: string;
  description: string;
  status: 'Open' | 'Resolved';
  reporter: string;
  photos?: { fileId: string; viewUrl: string }[];
}

export interface ChipQCEntry {
  id: string;
  washDate: string;  // QC 대상 기준일
  chipBarcode: string;
  isCompleted: boolean;
}
```

---

## 4. 데이터 관계 요약 (Entity Relationship)

1.  **#p (Plate ID):** 모든 이슈, 일정, 칩 정보의 상호 연결 고리입니다.
2.  **Date (YYYY-MM-DD):** 시약 로그, 주간 일정, 공지사항의 시점 기준입니다.
3.  **User Name:** 팀 멤버 관리, 업무 배정, 시약 로그 작업자로 활용됩니다.
