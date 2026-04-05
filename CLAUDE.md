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

## 최근 변경사항 (2026-04-05)

### 이번 세션 작업 내역
1. **디자인 개선**: 탑네비(로고아이콘+active인디케이터+유저아바타) + KPI시맨틱컬러 + 필터돋보기 + 섹션헤더뱃지
2. **4색 컬럼그룹행**: 입고/AS처리/입금/출고 색상 배경 + 그룹간 컬러구분선 + 짝수행배경
3. **레이아웃 개편 1차**: KPI 우측 세로바 + 검색 드롭다운 + 거래처 링크
4. **레이아웃 개편 2차**: KPI 다크바 버튼 통합 + 필터 라벨(구분/브랜드/상태/기간)
5. **고객 이력 팝업**: 헤더(아바타+통계) + 수리이력(보증뱃지) + 문자채팅 (CustomerPopup)
6. **말풍선 컬럼 제거**: _sms 컬럼 삭제, SMSPanel → CustomerPopup 통합
7. **수리내역조회 탭 삭제**: 4개 탭(AS일지/택배발송/부속가격/설정)
8. **택배발송 탭 전면 구현**: 인라인 편집 테이블, 필터, 정렬, 엑셀 출력
9. **택배발송 컬럼 재구성**: 11개+삭제 (readonly/badge/select/text 셀 타입)
10. **인라인 편집 저장 수정**: select → 뱃지 펼침으로 전면 교체 (blur 타이밍 이슈 해결)
11. **택배 버튼**: AS일지 출고영역 "발송" 버튼 + ship_records 자동등록
12. **운송장 연동**: 송장번호 입력 → AS일지 출고일/택배사/운송장 자동 업데이트
13. **삭제 기능**: 택배발송 삭제 → AS출고 초기화 / AS일지 삭제 모드(토글)
14. **수령자 자동완성**: 미발송 고객 드롭다운 (status=완료+미출고)
15. **검색 개선**: debounce 300ms + 2글자 이상 전체기간 검색
16. **문자 아이콘 컬럼**: 거래처/성함↔연락처 사이 별도 컬럼
17. **부속가격 탭**: PartsTable(썸네일+정렬+리사이즈) + PartModal(이미지업로드)
18. **설정 탭**: 정산관리(🔒비밀번호+KPI+테이블) + 시스템설정(문자템플릿/SMS/처리자/보증/비밀번호)
19. **httpSMS 연동**: /api/sms/send(서버발송) + /api/sms/webhook(수신) + 테스트 발송
20. **문자 알림 버튼**: 상단 버튼(읽지않은 빨간뱃지) + SMSPopup(고객목록+채팅)
21. **탑 네비 B타입**: 배경 하이라이트 스타일 (15px/600, rgba배경)
22. **택배발송 텍스트 확대**: 뱃지 12px, readonly 13px, 헤더 13px

### Supabase 마이그레이션
- ship_records.as_record_id (uuid FK → as_records)
- parts.image_url (text)
- sms_messages.read (boolean DEFAULT false)
- technicians 테이블 생성 (5명)
- settings 테이블 RLS: anon SELECT 허용
- sms_messages RLS: anon INSERT 허용

### 다음 할 일
- 엑셀 다운로드 실제 구현 (AS일지)
- 자동 문자 발송 (입고/출고 시 템플릿 기반)
- 처리자 드롭다운 → technicians 테이블 연동
- 모바일 반응형 최적화
