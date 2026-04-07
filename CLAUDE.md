# AS Manager — 프로젝트 지침

## 프로젝트 정보
- Next.js 14 + Supabase + Vercel
- 배포: https://as-manager-murex.vercel.app
- Supabase: dlzasdhhwgxshkyuzfyp (서울)
- GitHub: choidy2199/as-manager

## 완료 루틴
1. node -c 문법 검사
2. npm run build
3. git add -A && git commit && git push origin main
4. open https://as-manager-murex.vercel.app

## 최근 변경사항 (2026-04-08)

### 이번 세션 작업 내역 (택배발송 달력 필터 + 거래처 자동완성)
1. **today() 전역 함수 KST 처리**: `new Date()` → `toLocaleString('en-US', { timeZone: 'Asia/Seoul' })` 명시
2. **택배발송 달력 필터 AS일지 패턴 통일**: shipMonthFilter(월 단위 type="month") → shipDateFrom/To/All/Mode(일 범위) 교체
3. **택배발송 "오늘/이번달/전체" 버튼 추가**: AS일지와 동일 UI·동작 (active/inactive 스타일)
4. **ship_records Supabase 쿼리 ���짜 필터**: limit(100) → 날짜 범위 gte/lte 필터링
5. **택배발송 localStorage 날짜 저장/복원**: ship_date_filter_mode/from/to 키, 과거 종료일 자동 오늘 갱신
6. **날짜 변경 시 자동 refetch**: useCallback/useEffect 의존성에 shipDateFrom/To/All 추가
7. **AS일지 이번달 버튼 KST 통일**: new Date() → KST 처리
8. **택배발송 수령자명 거래처 자동완성**: 입력 시 통합 드롭다운 (직접입력 + AS발송대기 + 거래처 목록)
9. **거래처 선택 시 자동 채움**: receiver_name/phone/address 자동 입력 + 다음 필드 포커스
10. **드롭다운 position:fixed**: zIndex 9999, 바깥 클릭/ESC 닫힘, 테이블 잘림 방지
11. **companies state 공유**: 거래처 탭 추가/수정 → 택배발송 자동완성에 실��간 반영

### 이전 변경사항 (2026-04-07 — 디자인 스킬 적용 — 스타일 전면 통일)
1. **AS일지 폰트/크기/정렬 통일**: 모든 셀 fontFamily Pretendard, 텍스트13px, 금액 파란볼드, 헤더12px/600
2. **AS일지 날짜 뱃지**: 입고일/출고일 → #5A6070 배경 + 흰색 뱃지
3. **AS일지 뱃지 공통 스타일**: padding 4px 8px, fontSize 11px, fontWeight 700, alignItems center
4. **택배사별 진한 색상 뱃지**: 롯데(파랑)/CJ(초록)/한진(보라)/경동(갈색)/대신(주황)/로젠(빨강)/우체국(노랑)/방문·용차·퀵·매장(회색)
5. **AS일지+택배발송 택배사 색상 통일**: CARRIER_COLORS 공유 (입고/출고/택배발송 동일)
6. **택배발송 테이블 디자인 통일**: 헤더 12px, 날짜 회색 뱃지, 삭제 빨간 뱃지, 운송장 Pretendard
7. **택배발송 renderShipBadge 통일**: 뱃지 스타일 4px 8px / 11px / 700
8. **출고 운송장번호 회색 뱃지**: #5A6070 배경 + 흰색
9. **발송 버튼 크기 통일**: padding 4px 8px, fontSize 11px
10. **새 접수 저장/취소 → 헤더 좌측**: showNewRow일 때 첫 번째 th에 저장(초록)+취소(회색) 표시
11. **뱃지 min-width 전체 제거**: 모든 뱃지에서 minWidth 제거 → 컬럼 리사이즈 시 셀 침범 방지
12. **뱃지 overflow 처리**: overflow:hidden + textOverflow:ellipsis + maxWidth:100%

### 이전 변경사항 (2026-04-06)
1~37번: 새 접수 기능, 뱃지펼침, 인라인 편집, 다크바 필터, 택배발송, 제품가격, 문자 자동발송, 기간 필터, 삭제/완료 토글, 확인 컬럼, 검색 드롭다운, 테이블 폰트/정렬 통일 등

### Supabase 마이그레이션 (2026-04-06)
- products 테이블 생성 (id, brand, model, price, memo, sort_order, RLS)
- products.memo (text), products.sort_order (integer) 컬럼 추가
- sms_messages.message_type (text) 컬럼 추가
- ship_records FK → ON DELETE CASCADE
- sms_messages FK → ON DELETE CASCADE

### 이전 변경사항 (2026-04-05)
1~22번: 디자인 개선, 4색 컬럼그룹, 레이아웃 개편, 고객이력 팝업, 택배발송, 부속가격, 설정, httpSMS 연동, 문자 알림 등

### 다음 할 일
- 엑셀 다운로드 실제 구현 (AS일지)
- 모바일 반응형 최적화
- 정산 기능 고도화
