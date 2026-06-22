# Axiom LabFlow
본 웹 애플리케이션은 Axiom microarray 실험의 스케줄 관리, 시약 준비, 이슈 추적, 업무 내역 등을 실시간으로 공유할 수 있는 시스템입니다.

---

## 주요 기능

### 🏠 대시보드 (Dashboard)
- 주간/월간 샘플 수, Chip QC 미완료 현황 통계
- 재실험 칩 진행 단계 추적 (Day 1 → CHQ)
- **Daily Checklist**: 팀원별 업무 배정 (드래그 & 드롭 방식)
- **공지사항**: 리마인드 날짜 설정, 캘린더 뷰 지원
- **Recent issue**: 최근 미해결 장비/실험 이슈 리스트
- **반복 업무**: 매주/매달 주기 업무 등록 및 캘린더 기반 완료 추적

### 📅 스케줄 관리 (Schedule)
- 오늘/내일 Day 1 실험 배치 등록 및 시각 기록
- 칩 바코드 및 hybridization 시각 기록
- Google Sheets 실시간 연동

### 🧪 시약 준비 (Reagent)
- Day 1 / Day 2 AM·PM / Wash RGT / Ligation Enzyme 공정별 체크리스트
- 배치 포맷에 따른 시약 volume 자동 계산 
- 시약 로트번호 기록, DNA input/pellet 사진 업로드

### ⚠️ 이슈 트래커 (Issues)
- 장비 이슈, 공정 이슈, 칩 이미지 이슈의 3가지 유형
- 사진 첨부 → Google Drive 자동 업로드 및 썸네일 관리
- 이슈 빈도 통계 및 이미지 갤러리 뷰

### 🔬 Plate Timeline
- `#p`(플레이트 번호) + `#b`(배치 ID) 조합으로 칩 처리 이력 조회
- Chip info 시트 기반 단계별 완료 날짜 추적

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| 프레임워크 | React + TypeScript + Vite |
| 스타일링 | Tailwind CSS + shadcn-ui |
| 상태 관리 | Zustand |
| 실시간 DB | Firebase Realtime Database |
| 데이터 연동 | Google Sheets API |
| 파일 저장 | Google Drive API |

---

## 로컬 실행

```sh
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev
```

> Google OAuth 토큰 및 Firebase 설정이 필요합니다. 환경 변수는 `.env` 파일을 참고하세요.

---

## 📑 상세 가이드 (Project Documentation)
시스템의 설계 및 운영에 관한 구체적인 내용은 아래 문서들을 참고하세요.

*   **[시스템 아키텍처 가이드](docs/architecture_guide.md)**: 기술 스택 및 외부 API 연동 구조
*   **[데이터 구조 및 스키마 가이드](docs/data_structure_guide.md)**: 구글 시트 필드 및 데이터 관계 정의
*   **[사용자 운영 매뉴얼](docs/operation_manual.md)**: 실무자를 위한 단계별 시스템 사용법

