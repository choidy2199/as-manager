# AS Manager 배포 가이드

콜라보 콤프레샤 AS 관리 시스템을 웹사이트로 배포하는 방법입니다.
코딩 없이 클릭만으로 진행됩니다.

---

## 전체 흐름 (4단계)

```
1. Supabase 가입 → 데이터베이스 생성 → 사용자 계정 생성
2. GitHub 가입 → 이 코드 업로드
3. Vercel 가입 → GitHub 연결 → 배포
4. 접속해서 사용!
```

---

## STEP 1. Supabase 설정 (데이터베이스)

### 1-1. 가입 및 프로젝트 생성

1. https://supabase.com 접속
2. "Start your project" 클릭 → GitHub 계정으로 가입
3. "New Project" 클릭
4. 설정값 입력:
   - **Name**: `as-manager`
   - **Database Password**: 안전한 비밀번호 입력 (메모해두세요)
   - **Region**: `Northeast Asia (Seoul)` 선택
5. "Create new project" 클릭 → 2~3분 대기

### 1-2. 테이블 생성 (SQL 실행)

1. 왼쪽 메뉴에서 **"SQL Editor"** 클릭
2. "New query" 클릭
3. 이 프로젝트 폴더의 **`supabase-schema.sql`** 파일 내용을 전체 복사
4. SQL Editor에 붙여넣기
5. **"Run"** 버튼 클릭
6. "Success" 메시지 확인

### 1-3. 사용자 계정 생성 (2~3명)

1. 왼쪽 메뉴에서 **"Authentication"** 클릭
2. **"Users"** 탭 클릭
3. **"Add user"** → **"Create new user"** 클릭
4. 각 사용자의 이메일/비밀번호 입력 (예: user1@company.com)
5. **"Auto Confirm User"** 체크 ✅
6. "Create user" 클릭
7. 2~3명 모두 반복

### 1-4. Realtime 활성화 (실시간 동기화)

1. 왼쪽 메뉴 **"Database"** → **"Replication"** 클릭
2. `as_records` 테이블 토글 **ON**
3. `ship_records` 테이블 토글 **ON**

### 1-5. API 키 메모

1. 왼쪽 메뉴 **"Settings"** → **"API"** 클릭
2. 아래 두 값을 메모장에 복사해두세요:
   - **Project URL** (예: `https://xxxx.supabase.co`)
   - **anon public** 키 (긴 문자열)

---

## STEP 2. GitHub에 코드 올리기

### 2-1. GitHub 가입

1. https://github.com 접속
2. 계정이 없으면 "Sign up" → 가입
3. 이미 있으면 로그인

### 2-2. 새 저장소 만들기

1. 오른쪽 상단 **"+"** → **"New repository"** 클릭
2. **Repository name**: `as-manager`
3. **Private** 선택 (비공개)
4. "Create repository" 클릭

### 2-3. 코드 업로드

**방법 A - 웹에서 직접 업로드 (가장 쉬움)**

1. 생성된 저장소 페이지에서 "uploading an existing file" 링크 클릭
2. 이 프로젝트 폴더의 파일들을 드래그 앤 드롭
   (주의: `.gitignore`, `package.json`, `jsconfig.json`, `next.config.js` 등 
    모든 파일과 `src/` 폴더 전체를 올려야 합니다)
3. "Commit changes" 클릭

**방법 B - 터미널 사용 (맥에서)**

```bash
cd as-manager
git init
git add .
git commit -m "AS Manager 초기 코드"
git branch -M main
git remote add origin https://github.com/본인계정/as-manager.git
git push -u origin main
```

---

## STEP 3. Vercel에서 배포

### 3-1. Vercel 가입

1. https://vercel.com 접속
2. **"Continue with GitHub"** 클릭 → GitHub 계정 연결

### 3-2. 프로젝트 배포

1. 대시보드에서 **"Add New..."** → **"Project"** 클릭
2. **"Import Git Repository"** 에서 `as-manager` 저장소 선택 → "Import"
3. **Environment Variables** 섹션에서 아래 2개 추가:

   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | Step 1-5에서 메모한 Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Step 1-5에서 메모한 anon public 키 |

4. **"Deploy"** 클릭
5. 1~2분 후 배포 완료! 🎉

### 3-3. 접속

- Vercel이 자동으로 URL을 생성합니다 (예: `as-manager-xxxx.vercel.app`)
- 이 URL로 접속 → Step 1-3에서 만든 계정으로 로그인
- 커스텀 도메인도 연결 가능 (Vercel 대시보드 → Settings → Domains)

---

## STEP 4. 사용 시작!

### 로그인
- Step 1-3에서 만든 이메일/비밀번호로 로그인
- 2~3명이 동시에 접속 가능
- 한 명이 데이터를 수정하면 다른 사람 화면에 실시간 반영

### 기능 요약
- **대시보드**: 이번달 현황, 최근 AS/택배, 모델별 통계
- **AS 일지**: AS 접수, 모델/에러코드/상태 관리, 증상/진단 기록, 교체부품 비용 자동 계산
- **택배발송**: 택배사/송장번호/수령인 관리
- **부속가격**: 80여개 부품 가격표 (검색/필터)
- **백업**: JSON 파일로 전체 데이터 백업 다운로드

---

## 비용

| 서비스 | 요금 |
|--------|------|
| Supabase | 무료 (Free tier - 500MB DB, 2~3명 충분) |
| Vercel | 무료 (Hobby plan - 개인/소규모 팀) |
| GitHub | 무료 (Private repo) |
| **합계** | **월 ₩0** |

---

## 문제 해결

### "로그인이 안 돼요"
→ Supabase > Authentication > Users에서 해당 계정이 있는지 확인
→ "Auto Confirm User"가 체크되어 있었는지 확인

### "데이터가 안 보여요"
→ Supabase > Table Editor에서 테이블이 생성되었는지 확인
→ Vercel 환경변수가 정확히 입력되었는지 확인

### "배포가 실패해요"
→ Vercel > Deployments에서 에러 로그 확인
→ 환경변수 2개가 모두 입력되었는지 확인

### "실시간 동기화가 안 돼요"
→ Supabase > Database > Replication에서 테이블 토글이 ON인지 확인
