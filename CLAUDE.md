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

## 최근 변경사항 (2026-04-06)

### 이번 세션 작업 내역
1. **새 접수 구분 드롭다운 버그 수정**: toDb 매핑 버그 → 제품판매/부품판매 선택 가능
2. **새 접수 입고일 뱃지**: date picker 제거 → 오늘 날짜 읽기전용 뱃지 자동 표시
3. **거래처/성함 인라인 편집**: 2-input → 단일 "거래처 / 성함" input, "/" 기준 split 저장
4. **택배사 방문 → 운임 자동 0원**: 입고 택배 "방문" 선택 시 shipping_fee='0' + "방문" 뱃지
5. **비고 팝업**: 아이콘 버튼(파란/회색) + 모달 textarea + 저장/취소
6. **처리결과 인라인 + 뱃지**: 텍스트 인라인 편집 + 쉼표 기준 초록 뱃지 분리 표시
7. **출고 택배 직접 선택**: release_carrier readonly→select + "방문" 시 출고일/운송장 자동
8. **제품/부속가격 탭 2분할**: 좌측 부속가격(기존) + 우측 제품가격(신규 ProductsTable)
9. **제품가격 테이블**: 브랜드 뱃지펼침, 모델/가격/비고 인라인편집, 삭제, 컬럼 리사이즈
10. **처리자 뱃지펼침 드롭다운**: technicians 테이블 연동, 파란 뱃지
11. **문자 버튼 파란 스타일**: 항상 border:1.5px #185FA5 + 파란 아이콘/텍스트
12. **문자함 닫기 버튼**: SMSPopup 헤더 우측 원형 X 버튼
13. **기간 필터 날짜 범위**: 월 선택 → 시작일~종료일 date picker + 오늘/이번달/전체 버튼
14. **기간 필터 기본값**: 이번달(1일~오늘) + 선택 색상(활성/비활성) + localStorage 저장
15. **제품가격 인라인 편집 즉시 반영**: setProducts 낙관적 업데이트
16. **필터 바 크기 통일**: select/date/버튼 전부 height:32px
17. **새 접수 제품판매 팝업**: 구분 "제품판매" → 제품 선택 팝업 → 자동 채움
18. **입고/출고 알림 문자 자동 발송**: 템플릿 변수 치환, 중복 방지
19. **삭제 오버레이 X**: 별도 컬럼 제거 → 구분 셀 position:absolute X 버튼
20. **삭제 버그 수정**: confirm 중복 제거, 이벤트 전파 강화, 로컬 state 선제거
21. **삭제/완료 토글**: 다크바 삭제(#CC2222) ↔ 완료(#1D9E75)
22. **확인 컬럼**: sms_messages.message_type + 클립보드 title 저장 + "발송완료" 뱃지
23. **다크바 입금 섹터**: 완료/대기/명세서/무상/카드/방문결제 6개 뱃지 필터
24. **다크바 색상 통일**: AS파란(#185FA5)+수리중주황, 입금초록(#1D9E75)+대기주황
25. **다크바 전체 버튼 분리**: 전체|AS상태|입금상태|삭제 3구분선
26. **새 접수 정렬**: created_at desc + 로컬 배열 앞 추가 → 최신이 맨 위
27. **제품가격 드래그 앤 드롭**: 드래그 핸들 + HTML5 DnD + sort_order 재설정
28. **AS상태 진단중 제거**: 드롭다운에서 진단중 옵션 삭제
29. **새 접수 기본값**: payment_status='대기' 추가

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
