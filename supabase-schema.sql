-- ═══════════════════════════════════════════════════════
-- AS Manager - Supabase 테이블 생성 SQL
-- Supabase 대시보드 > SQL Editor 에서 실행하세요
-- ═══════════════════════════════════════════════════════

-- 1) AS 일지 테이블
CREATE TABLE as_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  model TEXT NOT NULL,
  error_code TEXT DEFAULT '없음',
  status TEXT DEFAULT '접수',
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  symptom TEXT,
  diagnosis TEXT,
  parts_used TEXT,
  parts_used_codes TEXT[] DEFAULT '{}',
  run_hours INTEGER,
  memo TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2) 택배 발송 테이블
CREATE TABLE ship_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  ship_date DATE NOT NULL DEFAULT CURRENT_DATE,
  carrier TEXT DEFAULT 'CJ대한통운',
  tracking_no TEXT,
  sender_name TEXT,
  receiver_name TEXT,
  receiver_phone TEXT,
  receiver_address TEXT,
  contents TEXT,
  memo TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3) 부속 가격 테이블 (관리자가 가격 수정할 수 있도록)
CREATE TABLE parts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  category TEXT,
  name TEXT NOT NULL,
  spec TEXT,
  price INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4) updated_at 자동 갱신 함수
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_as_updated
  BEFORE UPDATE ON as_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_ship_updated
  BEFORE UPDATE ON ship_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5) RLS (Row Level Security) - 로그인한 사용자만 접근
ALTER TABLE as_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ship_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;

-- 로그인한 모든 사용자에게 전체 CRUD 허용 (2~3명 내부 사용)
CREATE POLICY "Authenticated users full access" ON as_records
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON ship_records
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON parts
  FOR ALL USING (auth.role() = 'authenticated');

-- 6) 부속 가격 초기 데이터 입력
INSERT INTO parts (code, category, name, spec, price) VALUES
('23516', '995/998', '모터 SET', '모터SET+하우징+크랭크축+헤드SET', 200000),
('23517', '4HP', '모터 SET', '모터SET+하우징+크랭크축+헤드SET', 150000),
('23518', '2HP/충전', '모터 SET', '모터SET+하우징+크랭크축+헤드SET', 110000),
('23519', '4HP', '모터+스테이터', '모터+스테이터+하우징', 90000),
('23520', '2HP/충전', '모터+스테이터', '모터+스테이터+하우징', 80000),
('23521', '4HP', '하우징 SET', '', 80000),
('23522', '2HP/충전', '하우징 SET', '', 70000),
('23523', '4HP', '메인보드', '', 50000),
('23524', '2HP', '메인보드', '', 40000),
('23525', '충전/유무선', '메인보드', '', 40000),
('23526', '4HP', '크랭크', '', 30000),
('23527', '2HP/충전', '크랭크', '', 25000),
('23528', '4HP', '피스톤', '', 10000),
('23529', '2HP/충전', '피스톤', '', 10000),
('23530', '4HP', '헤드 SET', '', 30000),
('23531', '2HP/충전', '헤드 SET', '', 30000),
('23532', '공용', '가스켓 SET(기본)', '가스켓+가스켓 실린더+O링', 15000),
('23533', '공용', '가스켓 SET(추가)', '가스켓+실린더+O링+컵플레이트+밸브플레이트', 25000),
('23534', '4HP', '밸브 플레이트', '', 10000),
('23535', '2HP/충전', '밸브 플레이트', '', 10000),
('23536', '4HP', '컵 플레이트', '', 8000),
('23537', '2HP/충전', '컵 플레이트', '', 8000),
('23538', '4HP', '액정+커버', '220V/110V MPA-1.0', 35000),
('23539', 'DC990K', '액정+커버', '220V/110V MPA-1.0', 35000),
('23540', '2HP', '액정+커버', '220V/110V MPA-0.9', 35000),
('23541', '충전/유무선', '액정+커버', '18V-MPA-0.9-1700', 35000),
('23615', '공용', 'LCD', '', 30000),
('23542', 'DC660', '솔레노이드 센서 SET', 'Solenoid Valve 220V 3VA', 25000),
('23543', 'A20', '솔레노이드 센서 SET', 'Solenoid Valve 12V DC', 30000),
('23544', '2/4HP', '솔레노이드 센서 SET', 'Solenoid Valve 220V 5.5VA', 30000),
('23545', '충전', '솔레노이드 센서 SET', 'Solenoid Valve DC12V 4.8W', 25000),
('23546', '유무선', '유무선 컨버터', '', 55000),
('23547', '유무선', '더블 스위치', 'Double open switch 30A', 15000),
('23548', '충전', '스위치', 'Power supply switch 30A', 15000),
('23549', '공용', '압력센서 SET', '압력센서+케이블', 25000),
('23550', 'DC660/A20', '체크밸브', 'Check Valve', 15000),
('23551', '2/4HP/충전', '체크밸브', 'Check Valve', 10000),
('23552', '공용', '안전밸브', '', 8000),
('23553', '공용', '체크밸브 SET', '체크밸브+솔레노이드 센서', 30000),
('23554', '공용', '체크밸브 SET', '체크밸브+솔레노이드+ㅗ니쁠', 35000),
('23555', '공용', '가스 실린더', 'φ69×φ63.7×24.5', 8000),
('23556', 'DC990S', '탱크', 'C 60×288', 60000),
('23557', 'DC661', '탱크', '', 60000),
('23558', 'DC662', '탱크', '', 60000),
('23559', 'DC990X1', '탱크', '', 60000),
('23560', 'DC886', '탱크', 'Aluminum tank', 90000),
('23561', 'DC991', '탱크', 'Steel tank', 130000),
('23562', '충전/유무선', '알루미늄 탱크', '881 Aluminum tank', 50000),
('23563', '2HP/4HP', '가스켓', 'φ68×0.8', 2000),
('23564', '충전/유무선', '가스켓', 'φ68×0.6', 2000),
('23565', '충전', '패킹', 'KOL-25 Square cushion', 1000),
('23566', '공용', '패킹(주황)', 'O-ring φ63×φ3', 1000),
('23567', '공용', '패킹(흰색)', 'O-ring φ63×φ3', 1000),
('23568', '공용', '패킹', 'Square pad', 1000),
('23569', '2HP', '패킹', 'Square washer(left)', 1000),
('23570', '2HP', '패킹', 'Square washer(right)', 1000),
('23571', '2/4HP', '드레인 밸브', 'Butterfly Drain Valve', 10000),
('23572', '충전', '드레인 밸브', 'Drainage ball valve G1/4', 10000),
('23573', '공용', '팬커버', '', 3000),
('23574', '공용', '날개(우)', '', 3000),
('23575', '공용', '날개(좌)', '', 3000),
('23576', 'DC991', '에어 밸브 세트', 'Regulating valve', 35000),
('23577', 'DC992/993', '에어 밸브 세트', 'Copper Four-way', 35000),
('23578', 'DC998', '에어 밸브 세트', 'three-way connector', 35000),
('23579', '충전/유무선', '에어 밸브 세트', 'three-way connector', 25000),
('23580', 'DC990K', '에어 밸브 세트', 'Pressure regulator (Aluminum)', 40000),
('23581', '공용', '볼 밸브', '', 10000),
('23582', '공용', '에어 카플러(속 나사산)', '', 5000),
('23614', '공용', '에어 카플러(겉 나사산)', '', 5000),
('23584', '4HP', '에어 원터치 피팅(ㄱ)', '', 5000),
('23585', '공용', '에어 원터치 피팅(Y)', '', 10000),
('23586', '공용', '니쁠 - 4WAY', '', 5000),
('23587', '공용', '니쁠 - 연결(겉)', '', 5000),
('23588', '공용', '니블 - L', '', 5000),
('23589', '공용', '니쁠 - Y', '', 5000),
('23590', '공용', '니쁠 - ㅗ', '', 5000),
('23591', '공용', '니쁠 - ㅗ(2)', '', 5000),
('23592', '공용', '니쁠 - 연결(속)', '', 5000),
('23593', 'DC990S', '배기파이프 140', 'Flexible pipe', 10000),
('23594', 'DC990S', '배기파이프 170', 'Flexible pipe', 10000),
('23595', 'DC998', '배기파이프 230', 'Flexible pipe', 10000),
('23596', '886/990K/991~993', '배기파이프 275', 'Flexible pipe', 10000),
('23597', '886/990X1/990K~998', '배기파이프 350', 'Flexible pipe', 10000),
('23600', '충전/유무선', '커버 - 배터리 케이스', '', 20000),
('23601', '유무선', '커버 - 탱크 홀더(좌)', '', 30000),
('23602', '유무선', '커버 - 탱크 홀더(우)', '', 30000),
('23605', 'DC990S', '바디 커버', '', 20000),
('23606', '유무선', '손잡이', '', 10000),
('23607', 'DC886/990X1', '손잡이', '', 10000),
('23608', '4HP', '패드', '', 10000),
('23609', '2HP/충전/유무선', '패드', 'Rubber Damping Foot', 3000),
('23610', '662/990X1~995', '바퀴 - 5인치', '', 5000),
('23611', 'DC991/998', '바퀴 - 6인치', '', 5000);
