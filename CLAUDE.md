# AS Manager — Claude 작업 규칙

> **이 파일의 역할**: Claude Code (또는 Claude.ai)가 AS Manager 프로젝트 작업 시 항상 먼저 읽어야 할 헌법.
> 모든 patch 프롬프트는 이 파일을 참조한다.

---

## 1. 프로젝트 식별

| 항목 | 값 |
|---|---|
| **프로젝트명** | AS Manager (콜라보 AS센터 통합 관리 시스템) |
| **운영자** | toollab.studio (공구연구소 \| TOOL-LAB) |
| **로컬 경로** | `/Users/choi/1.클로드/앱,웹개발/웹)AS센터 관리/as-manager` |
| **배포 URL** | https://as-manager-murex.vercel.app |
| **로그인** | admin@asmanager.com |
| **배포 방식** | GitHub push → Vercel 자동 배포 |
| **기술 스택** | Next.js + React + Supabase (Seoul) + pdfmake + httpSMS |
| **Supabase 프로젝트 ID** | `dlzasdhhwgxshkyuzfyp` |
| **메인 코드 파일** | `src/app/page.js` (단일 파일, 6292줄) |

### 5탭 구조
```
[AS 일지] [택배발송] [거래처] [제품/부속가격] [설정]
```

### "제품/부속가격" 탭 내부 (patch35 적용 후)
```
mode === 'home':              [부품리스트] [제품리스트]
mode === 'detail' + parts:    [←] [부품가격] [부품발주]
mode === 'detail' + products: [←] 제품리스트
```

---

## 2. 절대 규칙 (5대 non-negotiable)

1. **이해 안 되면 무조건 질문** — 추측 금지
2. **요청한 것만 수정** — 다른 로직 변경 절대 금지
3. **하나씩 완료 후 체크** — 일괄 진행 금지
4. **Supabase DB 기존 데이터 절대 삭제 금지** — DDL/DML 신중
5. **수정 후 완료 루틴 필수**:
   - `npm run build` (또는 `node -c`) 문법/타입 검사
   - `git add -A`
   - `git commit -m "patch{{번호}}: {{요약}}"`
   - `git push origin main`
   - 체크리스트 출력
   - push 성공 여부 명시 보고

---

## 3. Claude Code 작업 흐름

### 3.1 작업 규모 분류
| 규모 | 기준 | 진행 방식 |
|---|---|---|
| 🟢 **단순** | UI 변경, state 1~2개 | 단일 patch (즉시 진행) |
| 🟡 **복잡** | 다중 영역, DB 변경 | Phase 분리 (a/b/c) |
| 🔴 **대규모** | 리팩터링, 회귀 위험 큼 | 풀 Phase (a/b/c/d) |

### 3.2 표준 작업 단계
```
사전 진단 → 결과 보고 → 사용자 승인 → 적용 → 빌드 → 푸시 → 검증 보고
```

### 3.3 사전 진단 명령 (작업 시작 전 필수)
```bash
# 작업 영역 line 번호 파악
grep -n "{{찾을 패턴}}" src/app/page.js

# state 선언 위치
grep -n "useState" src/app/page.js | head -30

# 함수 본체
sed -n '{{시작}},{{끝}}p' src/app/page.js
```

### 3.4 결정사항 사전 보고
Phase 9 패턴 — 작업 시작 전 모호한 결정사항을 사용자에게 명확히 질문:
- "DB 마이그레이션 필요한가?"
- "컴포넌트 재생성 vs 부분 업데이트?"
- "기존 인덱스/state 재사용 가능?"

각 단계 PASS 받기 전 다음 진행 금지.

---

## 4. Claude Code 프롬프트 작성 규칙

### 4.1 형식
- **항상 `.md` 파일로 작성** (채팅 직접 X)
- **`present_files`로 공유**
- **호칭은 "프롬프트"** (.md/지시서/패치 파일 X)

### 4.2 모든 프롬프트의 시작 부분
```markdown
## 작업 전 반드시 아래 파일 먼저 읽고 시작할 것
- ~/.claude/CLAUDE.md
- ~/1.클로드/웹개발/AS서비스 센터 관리/as-manager/CLAUDE.md
- ~/.claude/skills/web-ui-patterns/SKILL.md
- ~/.claude/skills/toollab-design-system/SKILL.md
```

### 4.3 프롬프트 작성 7원칙
1. **JSX 코드 골격 직접 제공** — 글로만 명세하면 매번 다르게 해석됨
2. **"손대도 되는 것" + "절대 손대지 말 것" 양쪽 명시**
3. **정확한 픽셀 단위 명세** (padding/border-radius/font-size/color 모두)
4. **체크리스트 11개 이상** — 사용자가 검증 가능한 형태
5. **이전 작업 피드백 섹션** — 반복 실수 차단
6. **사전 진단 명령** (grep/sed) — 추측 제거
7. **결정사항 사전 보고** — 모호한 부분은 작업 전 사용자 결정

### 4.4 프롬프트 작성 전 순서
1. 에러/요청 원인 분석
2. 사용자에게 설명
3. 모호한 부분 질문 → 결정 받음
4. 그 다음에야 프롬프트 작성

### 4.5 SQL 작성 규칙
Supabase SQL은 **inline plain text**로 (중첩 코드 블록 X) — 복붙 시 포매팅 손상 방지.

---

## 5. 디자인 시스템 (필수 준수)

### 5.1 색상 팔레트
| 용도 | 값 |
|---|---|
| Primary Blue | `#185FA5` |
| Dark Text | `#1A1D23` |
| Border (light) | `#D5D7DB` |
| Even rows | `#FAFBFC` |
| Hover blue | `#185FA5` |

### 5.2 폰트
- 본문: Pretendard (`public/fonts/Pretendard-Regular.ttf`)
- PDF 한자: NotoSansSC (`public/fonts/NotoSansSC-Regular.ttf`)

### 5.3 빈 셀 처리
- ✅ 파란 점 ●(`#185FA5`, 8px, opacity 0.4)
- ❌ "—" **절대 금지**

### 5.4 날짜 형식
`2026년 4월 4일` 스타일 (전체 통일)

### 5.5 테이블 표준
- 컬럼 리사이즈: 핸들 6px (transparent → `#185FA5` hover), `position:absolute`, `zIndex:10`
- `table-layout:fixed`, min-width 40px
- 컬럼 너비 → localStorage 저장
- 텍스트 가운데 정렬 (주소만 좌측)

### 5.6 상세 규칙
- `~/.claude/skills/toollab-design-system/SKILL.md` (시각 속성)
- `~/.claude/skills/web-ui-patterns/SKILL.md` (행위 패턴)

---

## 6. Supabase 핵심 컬럼명 (자주 헷갈리는 것)

### `as_records`
- ✅ `customer_phone` (❌ `phone` 아님)
- ✅ `company_name` + `customer_name` (별도 컬럼)
- 컬럼: 입고날짜, 입고택배사, 운임, 계산서여부, 거래처명, 고객명, 연락처, 모델명, 증상, 처리결과, 처리자, AS상태, AS비용, 입금상태, 입금자, 출고날짜, 출고택배사, 운송장번호, 비고

### `ship_records`
- ✅ `receiver_name`, `receiver_phone`, `receiver_address` (❌ `recipient_*` 아님)

### 기타
- `parts` (93개 레코드) — **절대 삭제 금지**
- `parts_orders`, `parts_order_items`
- `companies` (57개: 10 월말 + 47 계산서)
- `products`, `part_categories`
- `as_records` (3,042건, 2024-10~2026-04 마이그레이션 완료)

### Supabase 작업 규칙
- `execute_sql` (MCP): DDL/DML에 안정적
- `apply_migration` (MCP): 테이블 생성 + RLS 추가용
- **Auth user 생성**: dashboard에서만 (MCP SQL로 불가)

---

## 7. 알려진 함정 (반복 방지)

### 7.1 인라인 편집 후 로컬 state 갱신 필수
Supabase update 직후 `setRecords`/`setProducts` 즉시 호출 안 하면 새로고침 전까지 안 보임.

### 7.2 Badge dropdown clipping
테이블의 `overflow:hidden` 때문에 absolute 드롭다운 잘림.
→ `position:fixed` + `getBoundingClientRect()` 좌표 계산.

### 7.3 Modal close-on-click
`mousedown`과 `click` 둘 다 `stopPropagation` 필요.

### 7.4 Column resize React 재렌더 버그
drag 중 DOM 직접 조작, `setState`는 `mouseup`에서만 호출.

### 7.5 localStorage 컬럼 너비 리셋
`useEffect`로 읽으면 초기 렌더 시 default → 사용자 값 깜빡임.
→ `useState` 초기화 함수에서 직접 읽기.

### 7.6 Search 무한 re-render
debounce + `debouncedSearch` 별도 state 분리.

### 7.7 pdfmake 0.2.x 함정 (3가지)
1. `createPdf(docDef)` — 1 argument only (0.3.x 4-arg 형식이면 "Parameter options has an invalid type" 에러)
2. `getBlob(callback)` — 1 argument only (reject 함수를 두 번째 인자로 넣으면 같은 에러)
3. 큰 docDef 객체에서 `pageOrientation` 등 키 중복 선언 금지

### 7.8 한글 경로 빌드 함정
```
경로: /Users/choi/1.클로드/앱,웹개발/웹)AS센터 관리/as-manager
빌드 실패 시:
  1. /tmp/as-build로 rsync mirror
  2. cp -cR (APFS clone) 사용
  3. node_modules 부분 누락 시 통째 재클론
```

### 7.9 JSX SVG 속성 카멜케이스
`stroke-width` ❌ → `strokeWidth` ✅
`stroke-linecap` ❌ → `strokeLinecap` ✅

### 7.10 mode/mainTab/partsSubTab 분기 혼동
- `mode` state는 **헤더 UI 분기에만** 사용
- 컨텐츠 분기는 **`mainTab`/`partsSubTab`만** 사용
- 둘을 섞으면 home에서 컨텐츠 사라지는 사고

---

## 8. 회귀 테스트 표준 (모든 patch 끝에 검증)

```
[ ] AS 일지: 인라인 편집·KPI·필터·검색·SMS·고객 이력 팝업
[ ] 택배발송: 입력·송장번호·carrier·날짜 필터
[ ] 거래처: 검색·편집·KPI 뱃지
[ ] 제품/부속가격: mode 전환(home/detail)·부품가격↔부품발주
[ ] 부속가격: 인라인 편집·이미지 업로드·드래그 정렬
[ ] 부속발주: 장바구니·이력·PDF (Pretendard + NotoSansSC)
[ ] 설정: 비밀번호 잠금
[ ] 콘솔 에러 0건
[ ] localStorage 유지 (컬럼 너비, 활성 탭 등)
[ ] 다른 탭 영향 없음
[ ] 빌드 통과 (npm run build)
```

---

## 9. 보조 문서 시스템

| 문서 | 역할 | 갱신 빈도 |
|---|---|---|
| `CLAUDE.md` (이 파일) | 프로젝트 헌법 | 거의 변경 없음 |
| `AS-MANAGER-진행상태.md` | 현재 state·patch 이력 | 🔥 매 patch마다 |
| `AS-MANAGER-CODE-MAP.md` | page.js 6292줄 인덱스 | 가끔 (line 크게 변하면) |
| `PROMPT-TEMPLATE.md` | 프롬프트 작성 템플릿 | 거의 변경 없음 |
| `AS-MANAGER-NEXT-STEPS.md` | 작업 큐 | 자주 |
| `supabase-schema.sql` | DB 스키마 | DB 변경 시 |
| `AS-MANAGER-SPEC.md` | 프로젝트 사양 | 거의 변경 없음 |

### 갱신 자동 트리거
새 patch 완료 시:
1. `AS-MANAGER-진행상태.md` patch 이력에 한 줄 추가
2. state 추가/변경 시 `AS-MANAGER-진행상태.md` state 구조 갱신
3. line 번호 크게 변하면 `AS-MANAGER-CODE-MAP.md` 갱신
4. 새 함정 발견 시 이 `CLAUDE.md` 7장에 추가

---

## 10. 보고 형식 표준

작업 완료 시 다음 형식으로 보고:

```
✅ patch{{번호}} {{한 줄 제목}} 완료

📁 변경 파일:
- {{파일 경로}}
  - {{변경 내용 1}}
  - {{변경 내용 2}}

📁 변경 안 한 파일/영역:
- {{보호 영역 1}} — 무수정
- {{보호 영역 2}} — 무수정
- DB·Supabase — 무변경

✅ 11개 체크리스트 모두 통과
✅ 빌드 통과 (npm run build)
✅ origin/main 푸시 완료, Vercel 배포 트리거됨
✅ 회귀 테스트 11개 모두 통과

배포 확인 URL: https://as-manager-murex.vercel.app
```
