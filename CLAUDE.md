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

### 이번 세션 작업 내역 (2차)
1. **AS일지 모델명 '부품판매' 추가**: 모델명 드롭다운 맨 앞에 '부품판매' 하드코딩 추가, 구분=부품판매 시 모델명 자동 고정/편집불가
2. **발송 버튼 필드 매핑**: model→contents(품목명), repair_result→delivery_message(배송메시지) 분리 저장
3. **ship_records delivery_message 컬럼 추가**: Supabase 마이그레이션 + 기존 memo 데이터 이전
4. **택배발송 배송메시지 컬럼 수정**: key:'memo'→'delivery_message'로 변경, CSV 내보내기도 반영
5. **택배발송 정렬 안정화**: 운송장 미입력→최상위, 날짜역순 고정, 인라인 편집 시 순서 유지, 헤더 정렬 토글 제거
6. **택배발송 날짜 달력 팝업**: 날짜 뱃지 클릭→달력 팝업 표시, 월 이동/날짜 선택/저장/취소, position:fixed
7. **이번달 필터 수정**: 종료일을 오늘→월말로 변경 (AS일지+택배발송 모두, 초기값+버튼 클릭 모두)

### 이번 세션 작업 내역 (1차)
1. **종료일 기본값 오늘 날짜 수정**: today() 함수 UTC→로컬 시간 기준 변경, localStorage custom 모드 과거일 자동 갱신
2. **거래처 탭 신규 생성**: CompaniesTab — Supabase companies 연동, 검색, 다크바 KPI(전체/계산서/일반), 인라인 편집, 계산서구분 드롭다운, 새 거래처 추가, 삭제, 컬럼 리사이즈
3. **거래처 수정/저장 모드**: 읽기↔수정 토글, pendingEdits/pendingDeletes 일괄 저장, 삭제 예정 행(line-through+빨간배경), 복원 기능
4. **택배사 드롭다운 텍스트 축약**: 롯데택배→롯데, CJ대한통운→CJ 등 + 대신화물/경동화물 추가, 기존 DB값 호환 색상 매핑
5. **새 접수 거래처 자동완성**: 거래처/성함 입력→companies 실시간 검색, 거래처 선택→invoice_type/phone 자동 채움, 일반 소비자 옵션
6. **택배발송 달력 필터 통일**: shipMonthFilter→shipDateFrom/To/All/Mode(일 범위) 교체, 오늘/이번달/전체 버튼
7. **ship_records Supabase 날짜 필터**: limit(100)→날짜 범위 gte/lte, localStorage 저장/복원
8. **택배발송 수령자명 거래처 자동완성**: 직접입력 + AS발송대기 + 거래처 목록 통합 드롭다운
9. **companies state 공유**: 거래처 탭 추가/수정 → AS일지+택배발송 자동완성에 실시간 반영

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
