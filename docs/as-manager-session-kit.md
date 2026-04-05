# AS Manager 세션 키트
> 마지막 업데이트: 2026-04-05

## 프로젝트 개요
- Next.js 14 + Supabase + Vercel
- 배포: https://as-manager-murex.vercel.app
- Supabase 프로젝트: dlzasdhhwgxshkyuzfyp (ap-northeast-2)

## 파일 구조
```
src/app/page.js          — 메인 페이지 (모든 탭 + 컴포넌트)
src/app/globals.css       — 전역 스타일
src/app/layout.js         — 레이아웃
src/app/login/page.js     — 로그인 페이지
src/lib/supabase.js       — Supabase 클라이언트
src/app/api/sms/send/route.js     — SMS 발송 API Route
src/app/api/sms/webhook/route.js  — SMS 수신 Webhook
```

## Supabase 테이블
| 테이블 | 용도 | 주요 필드 |
|--------|------|-----------|
| as_records | AS 일지 | receipt_date, customer_name, customer_phone, model, status, repair_cost, payment_status, release_date, release_carrier, tracking_number |
| ship_records | 택배 발송 | ship_date, receiver_name, receiver_phone, receiver_address, contents, memo, sender_name(선불/착불), carrier, tracking_no, as_record_id |
| parts | 부속 가격 | code, category, name, spec, price, image_url |
| sms_messages | 문자 내역 | phone, direction(incoming/outgoing), content, sent_at, read |
| settings | 설정 | key(PK), value(jsonb) |
| technicians | 처리자 | name |

## page.js 컴포넌트 구조

### Home (메인)
| 함수/state | 설명 |
|------------|------|
| tab / setTab | 탭 전환 (as/ship/parts/settings), localStorage 유지 |
| search / debouncedSearch | 검색어 + 300ms debounce |
| kpiFilter | KPI 버튼 클릭 필터 (reception/repairing/done/norepair) |
| customerPopup | 고객 이력 팝업 state |
| smsPopup / unreadCount | 문자 팝업 + 읽지 않은 건수 |
| deleteMode | AS일지 삭제 모드 토글 |
| loadData(month, fullSearch) | Supabase 데이터 로드 (월별/전체) |
| saveASField(id, field, value) | AS 레코드 필드 저장 |
| addShip(d) | 택배 발송 추가 (as_record_id 연동) |
| exportShipExcel(data, label) | 택배 CSV 출력 |

### ASTable
| prop | 설명 |
|------|------|
| records, onSaveField, onAddNew, onDelete, onReload | CRUD |
| showNewRow, onHideNewRow | 새 접수 행 |
| onOpenCustomer | 고객 팝업 열기 |
| onAddShip | 택배 발송 등록 |
| deleteMode | 삭제 모드 |
| badgeOpen / newBadgeOpen | 뱃지 펼침 state |

### ShipTable
| prop | 설명 |
|------|------|
| records, asRecords, onSave, onAdd, onDelete | CRUD |
| showNewRow, onHideNewRow | 새 발송 행 |
| saveASField | 송장→AS 출고 자동 연동 |
| shipBadgeOpen / newShipBadgeOpen | 뱃지 펼침 (position:fixed) |
| recipientQuery | 미발송 고객 드롭다운 |

### CustomerPopup
| 기능 | 설명 |
|------|------|
| 헤더 | 아바타 + 통계(총AS/총비용/보증중) |
| 좌측 | 수리 이력 (전체 기간, 보증뱃지) |
| 우측 | 문자 채팅 (발신/수신 말풍선, /api/sms/send 호출) |

### SMSPopup
| 기능 | 설명 |
|------|------|
| 좌측(280px) | 고객 목록 (검색, 아바타, 마지막메시지, 미읽뱃지) |
| 우측 | 채팅 화면 (날짜구분, 발신/수신 말풍선, 전송) |
| 읽음 처리 | 고객 선택 시 read=true 업데이트 |

### PartsTable
| 기능 | 설명 |
|------|------|
| 5컬럼 | 내부코드/부품(썸네일)/구분/공임비/관리 |
| 정렬 | 헤더 클릭 토글 |
| 리사이즈 | col-resize-handle, localStorage |

### PartModal
| 기능 | 설명 |
|------|------|
| 이미지 업로드 | 200x200 리사이즈 → Supabase Storage |
| 필드 | 코드/구분/품명/스펙/공임비 |

### SettingsTab
| 서브탭 | 기능 |
|--------|------|
| 정산관리(🔒) | 비밀번호 인증 + 월별 KPI 4개 + 정산 테이블 |
| 시스템설정 | 문자 템플릿 + SMS 연동 + 처리자 CRUD + 보증기간 + 비밀번호 변경 |

## 핵심 로직

### 택배 발송 연동
1. AS상태=완료 + 입금=완료 + 미출고 → "발송" 버튼 표시
2. 버튼 클릭 → ship_records insert (이름/HP/모델/as_record_id)
3. 택배발송에서 운송장번호 입력 → as_records 출고 자동 업데이트
4. 택배발송 삭제 → as_records 출고 정보 초기화

### 뱃지 펼침 (드롭다운 대체)
- AS일지: badgeOpen state + useEffect(click+setTimeout)
- 택배발송: shipBadgeOpen + position:fixed (overflow 잘림 방지)
- 새 행: newBadgeOpen / newShipBadgeOpen

### httpSMS 연동
- 발송: /api/sms/send (서버→httpSMS, CORS 우회)
- 수신: /api/sms/webhook (httpSMS→서버→sms_messages insert)
- 설정: settings 테이블 httpsms_api_key / httpsms_phone
