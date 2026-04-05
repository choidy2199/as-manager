'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

/* ── 상수 ── */
const MODELS = ["DC660","DC661","DC662","DC886","DC990X1","DC990K","DC990S","DC991","DC992","DC993","DC995","DC998","KOL-30AD","KOL-A20","DA25","DAC990X1","DW30AD","FVC-20C","기타"];
const BRANDS = ["콜라보","마끼다","디월트","프레레","기타"];
const STATUS_LIST = ["접수","진단중","부품대기","수리중","완료","수리X","폐기"];
const RECORD_TYPES = ["AS 수리","제품 판매","부품 판매"];
const CARRIERS_IN = ["롯데택배","CJ대한통운","한진택배","경동택배","로젠택배","우체국","대신화물","대신택배","방문","용차","퀵"];
const CARRIERS_OUT = [...CARRIERS_IN, "매장"];
const INVOICE_TYPES = ["없음(일반소매)","계산서(거래처)","월말"];
const PAYMENT_STATUS = ["완료","대기","명세서","무상","카드","방문결제"];

const fmt = (n) => n?.toLocaleString('ko-KR') ?? '0';
const today = () => new Date().toISOString().split('T')[0];
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getMonth()+1}월 ${dt.getDate()}일`;
};
const recordTypeToDb = (t) => ({ 'AS 수리':'as_repair','제품 판매':'product_sale','부품 판매':'parts_sale' }[t] || 'as_repair');
const dbToRecordType = (t) => ({ 'as_repair':'AS 수리','product_sale':'제품 판매','parts_sale':'부품 판매' }[t] || 'AS 수리');

export default function Home() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState(() => { if (typeof window !== 'undefined') { return localStorage.getItem('as_active_tab') || 'as'; } return 'as'; });
  const [asRecords, setAsRecords] = useState([]);
  const [shipRecords, setShipRecords] = useState([]);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);

  /* ── AS 필터 ── */
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('전체');
  const [statusFilter, setStatusFilter] = useState('전체');
  const [brandFilter, setBrandFilter] = useState('전체');
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0,7));

  /* ── 새 접수 입력 행 표시 ── */
  const [showNewRow, setShowNewRow] = useState(false);
  const [kpiFilter, setKpiFilter] = useState(null);
  const [customerPopup, setCustomerPopup] = useState(null); // { name, phone, company }
  const searchWrapRef = useRef(null);

  /* ── 검색 debounce ── */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  /* ── 검색 드롭다운 바깥 클릭 닫기 ── */
  useEffect(() => {
    const handler = (e) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target) && search.length >= 2) {
        // 바깥 클릭 시 검색어 유지하되 드롭다운만 닫기 위해 blur 처리
        if (document.activeElement?.closest('.as-filter-search-wrap')) document.activeElement.blur();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [search]);

  /* ── 택배 필터 ── */
  const [shipSearch, setShipSearch] = useState('');
  const [shipCarrierFilter, setShipCarrierFilter] = useState('전체');
  const [shipTrackingFilter, setShipTrackingFilter] = useState('전체');
  const [shipMonthFilter, setShipMonthFilter] = useState(new Date().toISOString().slice(0,7));
  const [showNewShipRow, setShowNewShipRow] = useState(false);

  /* ── 부속 기존 state ── */
  const [partsSearch, setPartsSearch] = useState('');
  const [partsCatFilter, setPartsCatFilter] = useState('전체');
  const [modal, setModal] = useState(null);

  /* ── Auth ── */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  /* ── Data Load (월별 최적화, 검색어 있으면 전체) ── */
  const loadData = useCallback(async (month, fullSearch) => {
    const m = month || monthFilter;
    let asQuery = supabase.from('as_records').select('*').order('receipt_date', { ascending: false });
    if (!fullSearch) {
      const [y, mo] = m.split('-').map(Number);
      const lastDay = new Date(y, mo, 0).getDate();
      asQuery = asQuery.gte('receipt_date', m + '-01').lte('receipt_date', m + '-' + String(lastDay).padStart(2, '0'));
    }
    const [asRes, shipRes, partsRes] = await Promise.all([
      asQuery,
      supabase.from('ship_records').select('*').order('ship_date', { ascending: false }).limit(100),
      supabase.from('parts').select('*').order('code'),
    ]);
    if (asRes.data) setAsRecords(asRes.data);
    if (shipRes.data) setShipRecords(shipRes.data);
    if (partsRes.data) setParts(partsRes.data);
    if (loading) setLoading(false);
  }, [monthFilter]);

  useEffect(() => { if (user) loadData(monthFilter, debouncedSearch.length >= 2); }, [user, monthFilter, loadData, debouncedSearch]);

  /* ── Realtime ── */
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'as_records' }, () => loadData(monthFilter))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ship_records' }, () => loadData(monthFilter))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, loadData, monthFilter]);

  /* ── AS inline save ── */
  const saveASField = async (id, field, value) => {
    const { error } = await supabase.from('as_records').update({ [field]: value }).eq('id', id);
    if (error) { console.error('AS save error:', error); alert('저장 실패: ' + error.message); }
  };

  const addNewAS = async (row) => {
    const { error } = await supabase.from('as_records').insert(row);
    if (!error) loadData();
  };

  const deleteAS = async (id) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await supabase.from('as_records').delete().eq('id', id);
    loadData();
  };

  /* ── Ship CRUD (기존 유지) ── */
  const addShip = async (d) => {
    const row = {
      ship_date: d.shipDate, carrier: d.carrier, tracking_no: d.trackingNo,
      sender_name: d.senderName || '선불',
      receiver_name: d.receiverName, receiver_phone: d.receiverPhone,
      receiver_address: d.receiverAddress, contents: d.contents, memo: d.memo,
    };
    if (d.asRecordId) row.as_record_id = d.asRecordId;
    const { error } = await supabase.from('ship_records').insert(row);
    if (error) { console.error('Ship insert error:', error); alert('택배 등록 실패: ' + error.message); }
    loadData();
  };
  const updateShip = async (id, d) => {
    await supabase.from('ship_records').update({
      ship_date: d.shipDate, carrier: d.carrier, tracking_no: d.trackingNo,
      sender_name: d.senderName, receiver_name: d.receiverName, receiver_phone: d.receiverPhone,
      receiver_address: d.receiverAddress, contents: d.contents, memo: d.memo,
    }).eq('id', id);
    loadData();
  };
  const deleteShip = async (id) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await supabase.from('ship_records').delete().eq('id', id);
    loadData();
  };

  const logout = async () => { await supabase.auth.signOut(); setUser(null); };

  /* ── 택배 엑셀 출력 ── */
  const exportShipExcel = (data, label) => {
    const headers = ['수령자명','수령자HP','수령자주소','품목명','수량','배송메시지','선불/착불','택배사'];
    const rows = data.map(r => [r.receiver_name||'',r.receiver_phone||'',r.receiver_address||'',r.contents||'','1',r.memo||'',r.sender_name||'선불',r.carrier||'']);
    let csv = '\uFEFF' + headers.join(',') + '\n' + rows.map(r => r.map(c => `"${(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `택배발송_${label}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  /* ── AS 필터링 ── */
  const KPI_STATUS_MAP = { reception: ['접수','진단중'], repairing: ['수리중','부품대기'], done: ['완료'], norepair: ['수리X','폐기'] };
  const filteredAS = asRecords.filter(r => {
    const ms = !search || [r.customer_name, r.customer_phone, r.model, r.symptom, r.company_name, r.memo, r.repair_result].some(f => f?.toLowerCase().includes(search.toLowerCase()));
    const mt = typeFilter === '전체' || dbToRecordType(r.record_type) === typeFilter;
    const mst = statusFilter === '전체' || r.status === statusFilter;
    const mb = brandFilter === '전체' || r.brand === brandFilter;
    const mm = search.length >= 2 || !monthFilter || r.receipt_date?.startsWith(monthFilter);
    const mk = !kpiFilter || (KPI_STATUS_MAP[kpiFilter] || []).includes(r.status);
    return ms && mt && mst && mb && mm && mk;
  });

  /* ── KPI ── */
  const monthAS = asRecords.filter(r => r.receipt_date?.startsWith(monthFilter));
  const kpiTotal = monthAS.length;
  const kpiReception = monthAS.filter(r => ['접수','진단중'].includes(r.status)).length;
  const kpiRepairing = monthAS.filter(r => ['수리중','부품대기'].includes(r.status)).length;
  const kpiDone = monthAS.filter(r => r.status === '완료').length;
  const kpiNoRepair = monthAS.filter(r => ['수리X','폐기'].includes(r.status)).length;

  /* ── 부속 필터 (기존) ── */
  const filteredParts = parts.filter(p => {
    const ms = !partsSearch || [p.code,p.name,p.spec,p.category].some(f => f?.toLowerCase().includes(partsSearch.toLowerCase()));
    const mc = partsCatFilter === '전체' || (p.category && p.category.includes(partsCatFilter));
    return ms && mc;
  });
  const partCats = ['전체', ...new Set(parts.map(p => p.category).filter(Boolean))];

  /* ── Auth gate ── */
  if (authLoading) return <div className="loading"><span>로딩 중...</span></div>;
  if (!user) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    return <div className="loading"><span>로그인 페이지로 이동 중...</span></div>;
  }
  if (loading) return <div className="loading"><div style={{ textAlign:'center' }}><div style={{ fontSize:20, fontWeight:700, color:'var(--tl-primary)', marginBottom:8 }}>AS Manager</div><div>데이터 로딩 중...</div></div></div>;

  const monthLabel = (() => {
    const [y,m] = monthFilter.split('-');
    return `${y}년 ${parseInt(m)}월`;
  })();

  return (
    <>
      {/* ── NAV ── */}
      <nav className="top-nav">
        <div className="nav-logo">
          <span className="nav-logo-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h8" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </span>
          AS Manager
        </div>
        <div className="nav-tabs">
          {[['as','AS 일지'],['ship','택배발송'],['parts','부속가격'],['settings','설정']].map(([k,v]) => (
            <button key={k} onClick={() => { setTab(k); localStorage.setItem('as_active_tab', k); }} className={`nav-tab ${tab===k?'active':''}`}>{v}</button>
          ))}
        </div>
        <div className="nav-actions">
          <span className="nav-user-avatar">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="4" r="2.5" stroke="white" strokeWidth="1.2"/><path d="M1.5 11c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="white" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </span>
          <span className="nav-user">{user.email?.split('@')[0]}</span>
          <button onClick={logout} className="btn-ghost nav-logout-btn">로그아웃</button>
        </div>
      </nav>

      <div className="container">

        {/* ═══ AS 일지 ═══ */}
        {tab === 'as' && (
          <>
            {/* 필터 행 (라벨 포함) */}
            <div className="as-filter-row">
              <div className="as-filter-search-wrap" ref={searchWrapRef}>
                <svg className="as-filter-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="#9BA3B2" strokeWidth="1.2"/><path d="M9.5 9.5L13 13" stroke="#9BA3B2" strokeWidth="1.2" strokeLinecap="round"/></svg>
                <input className="input as-filter-search" placeholder="이름, 연락처, 모델, 증상 검색..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Escape' && setSearch('')} autoComplete="off" />
                {/* 고객 검색 드롭다운 */}
                {search.length >= 2 && (() => {
                  const q = search.toLowerCase();
                  const matched = asRecords.filter(r => [r.customer_name, r.company_name, r.customer_phone].some(f => f?.toLowerCase().includes(q)));
                  const grouped = {};
                  matched.forEach(r => {
                    const k = `${r.customer_name||''}__${r.customer_phone||''}`;
                    if (!grouped[k]) grouped[k] = { name: r.customer_name, phone: r.customer_phone, company: r.company_name, count: 0, latest: null };
                    grouped[k].count++;
                    if (!grouped[k].latest || r.receipt_date > grouped[k].latest) grouped[k].latest = r.receipt_date;
                  });
                  const customers = Object.values(grouped).filter(c => c.name || c.phone);
                  if (customers.length === 0) return null;
                  return (
                    <div className="search-dropdown">
                      <div className="search-dropdown-header">
                        <span style={{fontSize:12,fontWeight:600,color:'#5A6070'}}>고객 검색 결과 {customers.length}건</span>
                        <span style={{fontSize:11,color:'#9BA3B2'}}>클릭 → 수리내역</span>
                      </div>
                      {customers.slice(0, 8).map((c, i) => (
                        <div key={i} className="search-dropdown-item" style={{padding:'12px 16px'}} onClick={() => { setCustomerPopup({ name: c.name, phone: c.phone, company: c.company }); setSearch(''); }}>
                          <div className="search-dropdown-avatar" style={{background: i === 0 ? '#185FA5' : '#5A6070',width:38,height:38,fontSize:14}}>{(c.name || '?')[0]}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:15,fontWeight:600,color:'#1A1D23'}}>{c.name || '-'}{c.company ? <span style={{fontSize:13,color:'#9BA3B2',marginLeft:6}}>{c.company}</span> : null}</div>
                            <div style={{fontSize:13,color:'#5A6070'}}>{c.phone || '-'}</div>
                          </div>
                          <div style={{textAlign:'right',flexShrink:0}}>
                            <div style={{fontSize:14,fontWeight:700,color:'#185FA5'}}>AS {c.count}건</div>
                            {c.latest && <div style={{fontSize:12,color:'#9BA3B2'}}>최근 {fmtDate(c.latest)}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div className="as-filter-pair"><span className="as-filter-label">구분</span>
                <select className="input as-filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                  <option>전체</option>{RECORD_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="as-filter-pair"><span className="as-filter-label">브랜드</span>
                <select className="input as-filter-select" value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
                  <option>전체</option>{BRANDS.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div className="as-filter-pair"><span className="as-filter-label">상태</span>
                <select className="input as-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option>전체</option>{STATUS_LIST.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="as-filter-pair"><span className="as-filter-label">기간</span>
                <input className="input as-filter-month" type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} />
              </div>
            </div>

            {/* 페이지 요약 + 버튼 */}
            <div className="page-header">
              <div className="page-header-summary">
                <span style={{fontSize:12,color:'var(--tl-text-hint)'}}>{monthLabel}</span>
                <span style={{fontSize:13,fontWeight:700,color:'var(--tl-text)',marginLeft:4}}>— {filteredAS.length}건</span>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn-outline-secondary">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{marginRight:4,verticalAlign:-1}}><path d="M2 1.5h8M3 4.5h6M4 7.5h4M5 10.5h2" stroke="#5A6070" strokeWidth="1" strokeLinecap="round"/></svg>
                  엑셀 다운로드
                </button>
                <button className="btn-primary" onClick={() => setShowNewRow(true)}>+ 새 접수</button>
              </div>
            </div>

            {/* 섹션 헤더 (다크바 + KPI 버튼) + 테이블 */}
            <div className="section">
              <div className="section-header">
                <span style={{fontSize:12,fontWeight:600}}>AS 일지</span>
                <div className="kpi-bar">
                  {[
                    { key: null, label: '전체', value: kpiTotal, bg: 'rgba(255,255,255,0.15)', border: 'rgba(255,255,255,0.25)', color: '#fff' },
                    { key: 'reception', label: '접수', value: kpiReception, bg: 'rgba(36,99,173,0.4)', border: 'rgba(133,183,235,0.4)', color: '#B5D4F4' },
                    { key: 'repairing', label: '수리중', value: kpiRepairing, bg: 'rgba(186,117,23,0.3)', border: 'rgba(239,159,39,0.4)', color: '#FAC775' },
                    { key: 'done', label: '완료', value: kpiDone, bg: 'rgba(29,158,117,0.25)', border: 'rgba(93,202,165,0.4)', color: '#5DCAA5' },
                    { key: 'norepair', label: '불가', value: kpiNoRepair, bg: 'rgba(204,34,34,0.2)', border: 'rgba(240,149,149,0.35)', color: '#F09595' },
                  ].map(k => (
                    <button key={k.label} className={`kpi-btn${kpiFilter === k.key ? ' active' : ''}`} style={{ background: k.bg, border: `1px solid ${k.border}`, color: k.color }} onClick={() => setKpiFilter(kpiFilter === k.key ? null : k.key)}>
                      <span className="kpi-btn-label">{k.label}</span>
                      <span className="kpi-btn-value">{k.value}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="as-table-wrapper">
                <ASTable
                  records={filteredAS}
                  onSaveField={saveASField}
                  onAddNew={addNewAS}
                  onDelete={deleteAS}
                  onReload={() => loadData(monthFilter)}
                  showNewRow={showNewRow}
                  onHideNewRow={() => setShowNewRow(false)}
                  onOpenCustomer={(name, phone, company) => setCustomerPopup({ name, phone, company })}
                  onAddShip={async (r) => {
                    await addShip({ shipDate: today(), carrier: null, trackingNo: null, senderName: '선불', receiverName: r.customer_name || r.company_name || '', receiverPhone: r.customer_phone, receiverAddress: null, contents: r.model || null, memo: null, asRecordId: r.id });
                    alert('택배발송에 입력되었습니다');
                  }}
                />
              </div>
            </div>
          </>
        )}

        {/* ═══ 택배발송 ═══ */}
        {tab === 'ship' && (() => {
          const SHIP_CARRIERS = ['롯데택배','CJ대한통운','한진택배','경동택배','로젠택배','우체국','대신택배'];
          const filtered = shipRecords.filter(r => {
            const ms = !shipSearch || [r.receiver_name, r.receiver_phone, r.contents].some(f => f?.toLowerCase().includes(shipSearch.toLowerCase()));
            const mc = shipCarrierFilter === '전체' || r.carrier === shipCarrierFilter;
            const mt = shipTrackingFilter === '전체' || (shipTrackingFilter === '미입력' ? !r.tracking_no : !!r.tracking_no);
            const mm = !shipMonthFilter || r.ship_date?.startsWith(shipMonthFilter);
            return ms && mc && mt && mm;
          });
          const shipMonthLabel = (() => { const [y,m] = shipMonthFilter.split('-'); return `${y}년 ${parseInt(m)}월`; })();
          return (
          <>
            <div className="as-filter-row">
              <div className="as-filter-search-wrap">
                <svg className="as-filter-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="#9BA3B2" strokeWidth="1.2"/><path d="M9.5 9.5L13 13" stroke="#9BA3B2" strokeWidth="1.2" strokeLinecap="round"/></svg>
                <input className="input as-filter-search" placeholder="수령자명, 연락처, 품목 검색..." value={shipSearch} onChange={e => setShipSearch(e.target.value)} autoComplete="off" />
              </div>
              <div className="as-filter-pair"><span className="as-filter-label">택배사</span>
                <select className="input as-filter-select" value={shipCarrierFilter} onChange={e => setShipCarrierFilter(e.target.value)}>
                  <option>전체</option>{SHIP_CARRIERS.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="as-filter-pair"><span className="as-filter-label">송장</span>
                <select className="input as-filter-select" value={shipTrackingFilter} onChange={e => setShipTrackingFilter(e.target.value)}>
                  <option>전체</option><option>미입력</option><option>입력완료</option>
                </select>
              </div>
              <div className="as-filter-pair"><span className="as-filter-label">기간</span>
                <input className="input as-filter-month" type="month" value={shipMonthFilter} onChange={e => setShipMonthFilter(e.target.value)} />
              </div>
            </div>
            <div className="page-header">
              <div />
              <div style={{display:'flex',gap:8}}>
                <button className="btn-outline-secondary" onClick={() => exportShipExcel(filtered, shipMonthLabel)}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{marginRight:4,verticalAlign:-1}}><path d="M2 1.5h8M3 4.5h6M4 7.5h4M5 10.5h2" stroke="#5A6070" strokeWidth="1" strokeLinecap="round"/></svg>
                  송장 엑셀 출력
                </button>
                <button className="btn-primary" onClick={() => setShowNewShipRow(true)}>+ 새 발송</button>
              </div>
            </div>
            <div className="section">
              <div className="section-header">
                <span style={{fontSize:12,fontWeight:600}}>택배 발송</span>
                <span style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>{shipMonthLabel} — {filtered.length}건</span>
              </div>
              <div className="as-table-wrapper" style={{maxHeight:'calc(100vh - 220px)'}}>
                <ShipTable
                  records={filtered}
                  asRecords={asRecords}
                  onSave={async (id, field, value) => { const {error} = await supabase.from('ship_records').update({[field]:value}).eq('id',id); if(error) { console.error('Ship save error:', error); alert('저장 실패: '+error.message); } loadData(monthFilter); }}
                  onAdd={addShip}
                  onDelete={deleteShip}
                  showNewRow={showNewShipRow}
                  onHideNewRow={() => setShowNewShipRow(false)}
                  saveASField={saveASField}
                />
              </div>
            </div>
          </>
          );
        })()}

        {/* ═══ 수리내역조회 (신규 빈 페이지) ═══ */}
        {tab === 'history' && (
          <div style={{textAlign:'center',padding:'80px 0',color:'var(--tl-text-hint)'}}>
            <div style={{fontSize:48,marginBottom:16}}>🔍</div>
            <div style={{fontSize:18,fontWeight:600,marginBottom:8}}>수리내역 조회</div>
            <div>다음 단계에서 구현 예정입니다</div>
          </div>
        )}

        {/* ═══ 부속가격 ═══ */}
        {tab === 'parts' && (
          <>
            {/* 검색 + 필터 */}
            <div className="as-filter-row">
              <div className="as-filter-search-wrap">
                <svg className="as-filter-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="#9BA3B2" strokeWidth="1.2"/><path d="M9.5 9.5L13 13" stroke="#9BA3B2" strokeWidth="1.2" strokeLinecap="round"/></svg>
                <input className="input as-filter-search" placeholder="부품코드, 품명, 스펙 검색..." value={partsSearch} onChange={e => setPartsSearch(e.target.value)} autoComplete="off" />
              </div>
              <div className="as-filter-pair"><span className="as-filter-label">구분</span>
                <select className="input as-filter-select" value={partsCatFilter} onChange={e => setPartsCatFilter(e.target.value)}>
                  {partCats.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            {/* 다크바 */}
            <div className="section">
              <div className="section-header">
                <span style={{fontSize:12,fontWeight:600}}>부속 가격</span>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>총 {filteredParts.length}건</span>
                  <button className="btn-primary" style={{fontSize:11,padding:'4px 12px'}} onClick={() => setModal({type:'part-new'})}>+ 새 부품</button>
                </div>
              </div>
              <div className="as-table-wrapper" style={{maxHeight:'calc(100vh - 200px)'}}>
                <PartsTable parts={filteredParts} onEdit={p => setModal({type:'part-edit',data:p})} />
              </div>
            </div>
          </>
        )}

        {/* 부품 모달 */}
        {modal && (modal.type === 'part-new' || modal.type === 'part-edit') && (
          <PartModal
            initial={modal.data}
            onSave={async (d) => {
              if (modal.type === 'part-new') {
                const { error } = await supabase.from('parts').insert(d);
                if (error) alert('저장 실패: ' + error.message);
              } else {
                const { error } = await supabase.from('parts').update(d).eq('id', modal.data.id);
                if (error) alert('수정 실패: ' + error.message);
              }
              setModal(null); loadData(monthFilter);
            }}
            onDelete={modal.type === 'part-edit' ? async () => {
              if (!confirm('이 부품을 삭제하시겠습니까?')) return;
              await supabase.from('parts').delete().eq('id', modal.data.id);
              setModal(null); loadData(monthFilter);
            } : null}
            onClose={() => setModal(null)}
          />
        )}

        {/* ═══ 설정 (신규 빈 페이지) ═══ */}
        {tab === 'settings' && (
          <div style={{textAlign:'center',padding:'80px 0',color:'var(--tl-text-hint)'}}>
            <div style={{fontSize:48,marginBottom:16}}>⚙️</div>
            <div style={{fontSize:18,fontWeight:600,marginBottom:8}}>설정</div>
            <div>다음 단계에서 구현 예정입니다</div>
          </div>
        )}
      </div>

      {/* ═══ 기타 MODALS ═══ */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* ═══ 고객 이력 팝업 ═══ */}
      {customerPopup && (
        <CustomerPopup
          customer={customerPopup}
          onClose={() => setCustomerPopup(null)}
        />
      )}
    </>
  );
}


/* ═══════════════════════════════════════════════
   AS 테이블 — 인라인 편집
   ═══════════════════════════════════════════════ */
function ASTable({ records, onSaveField, onAddNew, onDelete, onReload, showNewRow, onHideNewRow, onOpenCustomer, onAddShip }) {
  const [editCell, setEditCell] = useState(null); // {id, field} — 텍스트/숫자/날짜용
  const [editValue, setEditValue] = useState('');
  const [badgeOpen, setBadgeOpen] = useState(null); // {id, field} — 뱃지 펼침용
  const [newRow, setNewRow] = useState(emptyRow());
  const savedWidthsRef = useRef((() => {
    if (typeof window === 'undefined') return {};
    try { const v = JSON.parse(localStorage.getItem('as_column_widths')); return (v && typeof v === 'object') ? v : {}; } catch { return {}; }
  })());
  const tableRef = useRef(null);

  const getColWidth = (key) => savedWidthsRef.current[key] || DEFAULT_WIDTHS[key] || 80;

  /* ── 컬럼 리사이즈 — DOM 직접 조작 ── */
  /* ── 컬럼 리사이즈 — colgroup > col DOM 직접 조작 ── */
  const startResize = (colIdx, colKey, e) => {
    e.preventDefault();
    e.stopPropagation();
    const table = tableRef.current;
    if (!table) return;
    const col = table.querySelector('colgroup').children[colIdx];
    if (!col) return;
    const startX = e.clientX;
    const startW = col.offsetWidth || getColWidth(colKey);
    const startTableW = table.offsetWidth;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMove = (ev) => {
      ev.preventDefault();
      const diff = ev.clientX - startX;
      const newW = Math.max(30, startW + diff);
      col.style.width = newW + 'px';
      table.style.width = (startTableW + (newW - startW)) + 'px';
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      const finalW = parseInt(col.style.width) || startW;
      savedWidthsRef.current = { ...savedWidthsRef.current, [colKey]: finalW };
      localStorage.setItem('as_column_widths', JSON.stringify(savedWidthsRef.current));
      supabase.from('settings').upsert({ key: 'as_column_widths', value: savedWidthsRef.current, updated_at: new Date().toISOString() });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  function emptyRow() {
    return {
      record_type: 'as_repair', receipt_date: today(), brand: '', intake_carrier: '',
      shipping_fee: '', invoice_type: '없음(일반소매)', company_name: '', customer_name: '',
      customer_phone: '', model: '', symptom: '', memo: '',
      repair_result: '', technician: '', status: '접수', repair_cost: '',
      payment_status: '', payer: '',
      release_date: '', release_carrier: '', tracking_number: '', release_memo: '',
    };
  }

  // 뱃지 펼침 바깥 클릭 닫기
  useEffect(() => {
    if (!badgeOpen) return;
    const handler = (e) => { if (!e.target.closest('.badge-expand-panel')) setBadgeOpen(null); };
    const escHandler = (e) => { if (e.key === 'Escape') setBadgeOpen(null); };
    const timer = setTimeout(() => { document.addEventListener('click', handler); document.addEventListener('keydown', escHandler); }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', handler); document.removeEventListener('keydown', escHandler); };
  }, [badgeOpen]);

  // 뱃지 선택 → 즉시 저장
  const saveBadge = async (id, field, value) => {
    setBadgeOpen(null);
    await onSaveField(id, field, value);
    onReload();
  };

  const startEdit = (id, field, value) => {
    setEditCell({ id, field });
    setEditValue(value ?? '');
  };

  const commitEdit = async () => {
    if (!editCell) return;
    const { id, field } = editCell;
    let val = editValue;
    if (field === 'repair_cost') val = parseInt(String(val).replace(/,/g, '')) || 0;
    const finalVal = val || null;

    // 이전값과 비교 — 변경 없으면 Supabase 호출 안 함
    const row = records.find(r => r.id === id);
    const prevVal = row ? row[field] : undefined;
    const prev = (prevVal === undefined || prevVal === null) ? null : prevVal;
    const next = (finalVal === undefined || finalVal === null || finalVal === '') ? null : finalVal;
    setEditCell(null);

    if (String(prev ?? '') !== String(next ?? '')) {
      await onSaveField(id, field, next);
      onReload(); // Realtime 지연 시 대비하여 수동 갱신
    }
  };

  const handleNewRowSave = async () => {
    if (!newRow.receipt_date) return;
    const row = { ...newRow };
    row.repair_cost = parseInt(String(row.repair_cost).replace(/,/g,'')) || 0;
    Object.keys(row).forEach(k => { if (row[k] === '') row[k] = null; });
    row.receipt_date = row.receipt_date || today();
    row.record_type = row.record_type || 'as_repair';
    row.status = row.status || '접수';
    await onAddNew(row);
    setNewRow(emptyRow());
    if (onHideNewRow) onHideNewRow();
  };

  const DEFAULT_WIDTHS = {
    record_type:70, receipt_date:120, brand:70, intake_carrier:70, shipping_fee:80,
    invoice_type:70, company_name:160, _msg:30, customer_phone:120, model:100, symptom:180, memo:100,
    repair_result:160, technician:80, status:80, repair_cost:90,
    payment_status:70, payer:80,
    release_date:120, release_carrier:70, tracking_number:130, _ship_btn:55,
  };
  const COL_GROUPS = [
    { label: '입고', bg: '#E6F1FB', color: '#0C447C', border: '#85B7EB', span: 12 },
    { label: 'AS 처리', bg: '#E1F5EE', color: '#085041', border: '#5DCAA5', span: 4 },
    { label: '입금', bg: '#FAEEDA', color: '#412402', border: '#EF9F27', span: 2 },
    { label: '출고', bg: '#EEEDFE', color: '#26215C', border: '#AFA9EC', span: 4 },
  ];

  const COLS = [
    // 파란 그룹
    { key:'record_type', label:'구분', w:70, type:'select', opts: RECORD_TYPES, toDb: recordTypeToDb, fromDb: dbToRecordType },
    { key:'receipt_date', label:'입고일', w:115, type:'date' },
    { key:'brand', label:'브랜드', w:80, type:'select', opts: BRANDS },
    { key:'intake_carrier', label:'택배', w:80, type:'select', opts: CARRIERS_IN },
    { key:'shipping_fee', label:'운임', w:80, type:'text' },
    { key:'invoice_type', label:'계산서', w:75, type:'select', opts: INVOICE_TYPES },
    { key:'company_name', label:'거래처/성함', w:150, type:'text', combined: true, isLink: true },
    { key:'_msg', label:'msg', w:30, type:'action', isMsgCol: true },
    { key:'customer_phone', label:'연락처', w:115, type:'text' },
    { key:'model', label:'모델명', w:100, type:'select', opts: MODELS },
    { key:'symptom', label:'증상', w:180, type:'text' },
    { key:'memo', label:'비고', w:100, type:'text', groupEnd: true, groupBorderColor: '#B5D4F4', groupBorderColorBody: '#E6F1FB' },
    // 초록 그룹
    { key:'repair_result', label:'처리결과', w:160, type:'text' },
    { key:'technician', label:'처리자', w:80, type:'text' },
    { key:'status', label:'AS상태', w:80, type:'select', opts: STATUS_LIST },
    { key:'repair_cost', label:'AS비용', w:90, type:'number', groupEnd: true, groupBorderColor: '#9FE1CB', groupBorderColorBody: '#E1F5EE' },
    // 노란 그룹
    { key:'payment_status', label:'입금', w:80, type:'select', opts: PAYMENT_STATUS },
    { key:'payer', label:'입금자', w:80, type:'text', groupEnd: true, groupBorderColor: '#FAC775', groupBorderColorBody: '#FAEEDA' },
    // 보라 그룹 — 읽기전용 (택배발송에서 자동 입력)
    { key:'release_date', label:'출고일', w:115, type:'readonly' },
    { key:'release_carrier', label:'택배', w:70, type:'readonly' },
    { key:'tracking_number', label:'운송장번호', w:130, type:'readonly' },
    { key:'_ship_btn', label:'택배', w:55, type:'action' },
  ];

  // 뱃지 색상 매핑
  const BADGE_COLORS = {
    record_type: { as_repair:['#E6F1FB','#0C447C'], product_sale:['#E1F5EE','#085041'], parts_sale:['#FAEEDA','#412402'] },
    brand: { '콜라보':['#E6F1FB','#0C447C'],'마끼다':['#E1F5EE','#085041'],'디월트':['#FAEEDA','#412402'],'프레레':['#EEEDFE','#26215C'],'기타':['#F1EFE8','#2C2C2A'] },
    status: { '접수':['#E6F1FB','#0C447C'],'진단중':['#E6F1FB','#0C447C'],'부품대기':['#FAEEDA','#412402'],'수리중':['#FAEEDA','#412402'],'완료':['#E1F5EE','#085041'],'수리X':['#FCEBEB','#791F1F'],'폐기':['#FCEBEB','#791F1F'] },
    payment_status: { '완료':['#E1F5EE','#085041'],'대기':['#FAEEDA','#412402'],'명세서':['#FAEEDA','#412402'],'무상':['#F1EFE8','#2C2C2A'],'카드':['#E6F1FB','#0C447C'],'방문결제':['#EEEDFE','#26215C'] },
    invoice_type: { '없음(일반소매)':['#F1EFE8','#2C2C2A'],'계산서(거래처)':['#E6F1FB','#0C447C'],'월말':['#FAEEDA','#412402'] },
  };
  const getBadgeColor = (field, v) => (BADGE_COLORS[field] && BADGE_COLORS[field][v]) || ['#F4F6FA','#1A1D23'];
  const getBadgeLabel = (col, v) => col.fromDb ? col.fromDb(v) : (col.key === 'invoice_type' ? (v === '없음(일반소매)' ? '일반' : v === '계산서(거래처)' ? '계산서' : v) : v);

  const renderBadgeExpand = (r, col) => {
    const dbVal = r[col.key];
    const displayVal = col.fromDb ? col.fromDb(dbVal) : dbVal;
    const isOpen = badgeOpen?.id === r.id && badgeOpen?.field === col.key;
    const [bg, c] = getBadgeColor(col.key, dbVal || displayVal);
    const empty = <span className="empty-dot">●</span>;
    return (
      <div style={{position:'relative'}} className="badge-expand-panel" onClick={e => e.stopPropagation()}>
        <span style={{display:'inline-flex',padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:600,whiteSpace:'nowrap',background: displayVal ? bg : '#F4F6FA',color: displayVal ? c : '#9BA3B2',cursor:'pointer',border: isOpen ? `2px solid ${c}` : '2px solid transparent'}}
          onClick={() => setBadgeOpen(isOpen ? null : {id:r.id, field:col.key})}>
          {displayVal ? getBadgeLabel(col, dbVal) : '—'}
        </span>
        {isOpen && (
          <div style={{position:'absolute',top:'100%',left:0,zIndex:20,background:'#fff',border:'1px solid #DDE1EB',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',padding:4,marginTop:2,minWidth:80,maxHeight:200,overflowY:'auto'}}>
            {col.opts.map(o => {
              const ov = col.toDb ? col.toDb(o) : o;
              const [obg,oc] = getBadgeColor(col.key, ov);
              const selected = (dbVal === ov) || (displayVal === o);
              return <div key={o} style={{display:'flex',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600,cursor:'pointer',background:obg,color:oc,marginBottom:2,border: selected ? `2px solid ${oc}` : '2px solid transparent',whiteSpace:'nowrap'}}
                onClick={() => saveBadge(r.id, col.key, ov)}>{getBadgeLabel(col, ov)}</div>;
            })}
          </div>
        )}
      </div>
    );
  };

  const renderCell = (r, col) => {
    const val = col.fromDb ? col.fromDb(r[col.key]) : r[col.key];
    const isEditing = editCell?.id === r.id && editCell?.field === col.key;

    // 드롭다운 셀 → 뱃지 펼침
    if (col.type === 'select') return renderBadgeExpand(r, col);

    if (isEditing) {
      if (col.type === 'date') {
        return <input type="date" className="as-cell-input" value={editValue} autoFocus onChange={e => setEditValue(e.target.value)} onBlur={commitEdit} />;
      }
      return (
        <input className="as-cell-input" value={editValue} autoFocus
          onChange={e => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => e.key === 'Enter' && commitEdit()}
        />
      );
    }

    // Display
    const B = (bg, color, text, extra) => <span style={{display:'inline-flex',padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:600,whiteSpace:'nowrap',background:bg,color,...(extra||{})}}>{text}</span>;
    const empty = <span className="empty-dot">●</span>;

    // 읽기전용 셀 (출고 그룹 — 택배발송에서 자동 입력)
    if (col.type === 'readonly') {
      if (!val) return <span className="empty-dot">●</span>;
      if (col.key === 'release_date') return B('#E8EBF0','#3A3F4B',fmtDate(val));
      if (col.key === 'tracking_number') return B('#E8EBF0','#3A3F4B',val,{fontFamily:'monospace',fontSize:10});
      return B('#E8EBF0','#3A3F4B',val);
    }
    // 문자 아이콘 컬럼
    if (col.key === '_msg') {
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{cursor:'pointer',opacity:0.7,display:'block',margin:'0 auto'}} onClick={e => { e.stopPropagation(); onOpenCustomer && onOpenCustomer(r.customer_name, r.customer_phone, r.company_name); }} onMouseOver={e => e.currentTarget.style.opacity='1'} onMouseOut={e => e.currentTarget.style.opacity='0.7'}><path d="M2 2.5C2 1.7 2.7 1 3.5 1h7C11.3 1 12 1.7 12 2.5v5c0 .8-.7 1.5-1.5 1.5H8l-2.5 2.5V9H3.5C2.7 9 2 8.3 2 7.5v-5z" fill="#185FA5"/></svg>;
    }
    // 입고일
    if (col.type === 'date') return val ? B('#E8EBF0','#3A3F4B',fmtDate(val)) : empty;
    // 택배 버튼
    if (col.key === '_ship_btn') {
      if (r.release_date || r.tracking_number) return empty; // 이미 출고 완료
      if (r.status !== '완료') return empty; // 수리 미완료
      return <button style={{background:'#EEEDFE',color:'#534AB7',border:'1px solid #AFA9EC',borderRadius:4,padding:'2px 8px',fontSize:10,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',fontFamily:'inherit'}} onClick={e => { e.stopPropagation(); onAddShip && onAddShip(r); }}>발송</button>;
    }
    // AS비용
    if (col.key === 'repair_cost') return val ? <span style={{color:'#185FA5',fontWeight:700}}>{fmt(val)}</span> : empty;
    // 거래처/성함 — 파란 링크 스타일
    if (col.key === 'company_name') {
      const p = [r.company_name, r.customer_name].filter(Boolean);
      if (p.length === 0) return empty;
      return <span className="customer-link" onClick={e => { e.stopPropagation(); onOpenCustomer && onOpenCustomer(r.customer_name, r.customer_phone, r.company_name); }}>{p.join(' / ')}</span>;
    }
    // 연락처
    if (col.key === 'customer_phone') return val ? <span style={{fontSize:12,color:'#5A6070'}}>{val}</span> : empty;
    return val || empty;
  };

  const [newBadgeOpen, setNewBadgeOpen] = useState(null); // field name

  useEffect(() => {
    if (!newBadgeOpen) return;
    const h = (e) => { if (!e.target.closest('.badge-expand-panel')) setNewBadgeOpen(null); };
    const esc = (e) => { if (e.key === 'Escape') setNewBadgeOpen(null); };
    const timer = setTimeout(() => { document.addEventListener('click', h); document.addEventListener('keydown', esc); }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', h); document.removeEventListener('keydown', esc); };
  }, [newBadgeOpen]);

  const renderNewCell = (col) => {
    const val = col.key === 'company_name' ? newRow.company_name : newRow[col.key] ?? '';
    if (col.type === 'select') {
      const dbVal = col.toDb ? col.toDb(val) : val;
      const displayVal = col.fromDb ? col.fromDb(dbVal) : dbVal;
      const isOpen = newBadgeOpen === col.key;
      const [bg, c] = getBadgeColor(col.key, dbVal || displayVal);
      return (
        <div style={{position:'relative'}} className="badge-expand-panel" onClick={e => e.stopPropagation()}>
          <span style={{display:'inline-flex',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600,whiteSpace:'nowrap',background:displayVal?bg:'#F4F6FA',color:displayVal?c:'#9BA3B2',cursor:'pointer',border:isOpen?`2px solid ${c}`:'2px solid transparent'}}
            onClick={() => setNewBadgeOpen(isOpen ? null : col.key)}>
            {displayVal ? getBadgeLabel(col, dbVal) : '선택'}
          </span>
          {isOpen && (
            <div style={{position:'absolute',top:'100%',left:0,zIndex:30,background:'#fff',border:'1px solid #DDE1EB',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',padding:4,marginTop:2,minWidth:80,maxHeight:200,overflowY:'auto'}}>
              {col.opts.map(o => {
                const ov = col.toDb ? col.toDb(o) : o;
                const [obg,oc] = getBadgeColor(col.key, ov);
                return <div key={o} style={{padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600,cursor:'pointer',background:obg,color:oc,marginBottom:2,whiteSpace:'nowrap',border:dbVal===ov?`2px solid ${oc}`:'2px solid transparent'}}
                  onClick={() => { setNewRow(p => ({...p, [col.key]: ov})); setNewBadgeOpen(null); }}>{getBadgeLabel(col, ov)}</div>;
              })}
            </div>
          )}
        </div>
      );
    }
    if (col.type === 'date') {
      return <input type="date" className="as-cell-input" value={val} onChange={e => setNewRow(p => ({...p,[col.key]:e.target.value}))} />;
    }
    return (
      <input className="as-cell-input" value={val} placeholder={col.label}
        onChange={e => setNewRow(p => ({...p,[col.key]:e.target.value}))}
        onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
      />
    );
  };

  return (
    <table className="as-table" ref={tableRef} style={{width: COLS.reduce((s, c) => s + getColWidth(c.key), 0)}}>
      <colgroup>
        {COLS.map(c => <col key={c.key} style={{width: getColWidth(c.key)}} />)}
      </colgroup>
      <thead>
        <tr className="as-group-header">
          {COL_GROUPS.map((g, i) => (
            <th key={i} colSpan={g.span} style={{ background: g.bg, color: g.color, fontSize: 12, fontWeight: 700, padding: '8px 0', textAlign: 'center', borderBottom: `2px solid ${g.border}`, borderRight: i < COL_GROUPS.length - 1 ? `2px solid ${g.border}` : 'none', position: 'sticky', top: 0, zIndex: 21 }}>
              {g.label}
            </th>
          ))}
        </tr>
        <tr className="as-col-header">
          {COLS.map((c, idx) => (
            <th key={c.key} style={{ position: 'sticky', top: 34, zIndex: 20, background: '#EAECF2', borderRight: c.groupEnd && c.groupBorderColor ? `2px solid ${c.groupBorderColor}` : '1px solid #DDE1EB', color: c.isLink ? '#185FA5' : undefined }}>
              {c.isMsgCol ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{verticalAlign:'middle'}}><path d="M2 2.5C2 1.7 2.7 1 3.5 1h7C11.3 1 12 1.7 12 2.5v5c0 .8-.7 1.5-1.5 1.5H8l-2.5 2.5V9H3.5C2.7 9 2 8.3 2 7.5v-5z" fill="#185FA5"/></svg> : c.label}
              <span className="col-resize-handle" onMouseDown={e => startResize(idx, c.key, e)} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {/* NEW 행 */}
        {showNewRow && (
          <tr className="as-new-row">
            {COLS.map(c => (
              <td key={c.key} style={{...(c.groupEnd && c.groupBorderColorBody ? {borderRight:`2px solid ${c.groupBorderColorBody}`} : {}), ...(c.type === 'select' ? {overflow:'visible',position:'relative'} : {})}}>
                {c.key === '_ship_btn' ? (
                  <div style={{display:'flex',gap:4}}>
                    <button className="btn-primary" style={{fontSize:11,padding:'4px 8px',whiteSpace:'nowrap'}} onClick={handleNewRowSave}>저장</button>
                    <button className="btn-secondary" style={{fontSize:11,padding:'4px 8px',whiteSpace:'nowrap'}} onClick={onHideNewRow}>취소</button>
                  </div>
                ) : c.type === 'action' ? null : renderNewCell(c)}
              </td>
            ))}
          </tr>
        )}
        {/* 데이터 행 */}
        {records.map((r, rowIdx) => (
          <tr key={r.id} className="as-data-row" style={rowIdx % 2 === 1 ? {background:'#FAFBFC'} : undefined}>
            {COLS.map(c => {
                const tdStyle = { ...(c.groupEnd && c.groupBorderColorBody ? {borderRight:`2px solid ${c.groupBorderColorBody}`} : {}), ...(c.type === 'select' ? {overflow:'visible',position:'relative'} : {}), ...(c.type === 'readonly' ? {cursor:'default'} : {}) };
                return (
                <td key={c.key} style={Object.keys(tdStyle).length ? tdStyle : undefined}
                  onClick={() => {
                    if (c.isLink || c.type === 'action' || c.type === 'select' || c.type === 'readonly') return;
                    const val = c.key === 'company_name' ? (r.company_name || '') :
                      c.fromDb ? (c.fromDb(r[c.key]) || '') :
                      (c.key === 'repair_cost' ? (r[c.key]?.toString() || '') : (r[c.key] || ''));
                    startEdit(r.id, c.key, c.toDb ? c.toDb(val) : val);
                  }}
                >
                  {renderCell(r, c)}
                </td>);
            })}
          </tr>
        ))}
        {records.length === 0 && (
          <tr><td colSpan={COLS.length} className="empty">조건에 맞는 AS 건이 없습니다</td></tr>
        )}
      </tbody>
    </table>
  );
}


/* ═══ SHIP TABLE — 인라인 편집 ═══ */
function ShipTable({ records, asRecords, onSave, onAdd, onDelete, showNewRow, onHideNewRow, saveASField }) {
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [newRow, setNewRow] = useState({ ship_date: today(), carrier: 'CJ대한통운', tracking_no: '', sender_name: '선불', receiver_name: '', receiver_phone: '', receiver_address: '', contents: '', memo: '', as_record_id: null });
  const [sortKey, setSortKey] = useState('ship_date');
  const [sortAsc, setSortAsc] = useState(false);
  const [recipientQuery, setRecipientQuery] = useState('');
  const SHIP_CARRIERS = ['롯데택배','CJ대한통운','한진택배','경동택배','로젠택배','우체국','대신택배'];
  const tableRef = useRef(null);
  const savedWidthsRef = useRef((() => {
    if (typeof window === 'undefined') return {};
    try { const v = JSON.parse(localStorage.getItem('ship_column_widths')); return (v && typeof v === 'object') ? v : {}; } catch { return {}; }
  })());

  const COLS = [
    { key:'ship_date', label:'날짜', w:90, type:'readonly' },
    { key:'receiver_name', label:'수령자명', w:90, type:'readonly-badge' },
    { key:'receiver_phone', label:'수령자HP', w:110, type:'readonly' },
    { key:'receiver_address', label:'수령자주소', w:180, type:'text' },
    { key:'contents', label:'품목명', w:90, type:'readonly-badge' },
    { key:'_qty', label:'수량', w:45, type:'static', value:'1' },
    { key:'memo', label:'배송메시지', w:120, type:'text' },
    { key:'sender_name', label:'선불/착불', w:80, type:'select', opts: ['선불','착불'] },
    { key:'_origin', label:'출고처', w:50, type:'static', value:'AS' },
    { key:'carrier', label:'택배사', w:100, type:'select', opts: SHIP_CARRIERS },
    { key:'tracking_no', label:'운송장번호', w:140, type:'text' },
    { key:'_delete', label:'', w:45, type:'action' },
  ];

  const DEFAULT_SHIP_WIDTHS = { ship_date:90, receiver_name:90, receiver_phone:110, receiver_address:180, contents:90, _qty:45, memo:120, sender_name:80, _origin:50, carrier:100, tracking_no:140, _delete:45 };
  const getColWidth = (key) => savedWidthsRef.current[key] || DEFAULT_SHIP_WIDTHS[key] || 80;

  const startResize = (colIdx, colKey, e) => {
    e.preventDefault(); e.stopPropagation();
    const table = tableRef.current; if (!table) return;
    const col = table.querySelector('colgroup').children[colIdx]; if (!col) return;
    const startX = e.clientX;
    const startW = col.offsetWidth || getColWidth(colKey);
    const startTableW = table.offsetWidth;
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize';
    const onMove = (ev) => { ev.preventDefault(); const newW = Math.max(40, startW + ev.clientX - startX); col.style.width = newW + 'px'; table.style.width = (startTableW + (newW - startW)) + 'px'; };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = ''; document.body.style.cursor = '';
      const finalW = parseInt(col.style.width) || startW;
      savedWidthsRef.current = { ...savedWidthsRef.current, [colKey]: finalW };
      localStorage.setItem('ship_column_widths', JSON.stringify(savedWidthsRef.current));
    };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  };

  const sorted = [...records].sort((a, b) => {
    const va = a[sortKey] || '', vb = b[sortKey] || '';
    return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });

  const toggleSort = (key) => { if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(true); } };

  const [shipBadgeOpen, setShipBadgeOpen] = useState(null);
  const [shipBadgePos, setShipBadgePos] = useState(null); // {top, left}
  const [newShipBadgeOpen, setNewShipBadgeOpen] = useState(null);
  const [newShipBadgePos, setNewShipBadgePos] = useState(null);

  useEffect(() => {
    const open = shipBadgeOpen || newShipBadgeOpen;
    if (!open) return;
    const h = (e) => { if (!e.target.closest('.badge-expand-panel')) { setShipBadgeOpen(null); setNewShipBadgeOpen(null); } };
    const esc = (e) => { if (e.key === 'Escape') { setShipBadgeOpen(null); setNewShipBadgeOpen(null); } };
    // setTimeout으로 다음 틱에 리스너 등록 — 현재 클릭 이벤트와 충돌 방지
    const timer = setTimeout(() => { document.addEventListener('click', h); document.addEventListener('keydown', esc); }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', h); document.removeEventListener('keydown', esc); };
  }, [shipBadgeOpen, newShipBadgeOpen]);

  const saveShipBadge = async (id, field, value) => {
    setShipBadgeOpen(null);
    const row = records.find(r => r.id === id);
    await onSave(id, field, value);
    // 택배사 변경 시 이미 운송장번호가 있으면 AS건 택배사도 동기화
    if (field === 'carrier' && row?.as_record_id && row.tracking_no) {
      await supabase.from('as_records').update({ release_carrier: value || null }).eq('id', row.as_record_id);
    }
  };

  const startEdit = (id, field, value) => { setEditCell({ id, field }); setEditValue(value ?? ''); };
  const commitEdit = async () => {
    if (!editCell) return;
    const { id, field } = editCell;
    const row = records.find(r => r.id === id);
    const prev = row ? (row[field] ?? '') : '';
    setEditCell(null);
    if (String(prev) !== String(editValue || '')) {
      await onSave(id, field, editValue || null);
      // 송장번호 변경 시 연동된 AS건 출고 정보 자동 업데이트
      if (field === 'tracking_no' && row?.as_record_id && editValue) {
        await supabase.from('as_records').update({
          tracking_number: editValue,
          release_date: today(),
          release_carrier: row.carrier || null,
        }).eq('id', row.as_record_id);
      }
    }
  };

  const handleNewSave = async () => {
    if (!newRow.ship_date) return;
    const row = { ...newRow };
    Object.keys(row).forEach(k => { if (row[k] === '') row[k] = null; });
    row.ship_date = row.ship_date || today();
    await onAdd({ shipDate: row.ship_date, carrier: row.carrier, trackingNo: row.tracking_no, senderName: row.sender_name, receiverName: row.receiver_name, receiverPhone: row.receiver_phone, receiverAddress: row.receiver_address, contents: row.contents, memo: row.memo, asRecordId: row.as_record_id });
    setNewRow({ ship_date: today(), carrier: 'CJ대한통운', tracking_no: '', sender_name: '선불', receiver_name: '', receiver_phone: '', receiver_address: '', contents: '', memo: '', as_record_id: null });
    setRecipientQuery('');
    onHideNewRow();
  };

  const SHIP_BADGE_COLORS = { '선불':['#E6F1FB','#0C447C'], '착불':['#FAEEDA','#412402'] };
  const getShipBadgeColor = (key, v) => (key === 'sender_name' && SHIP_BADGE_COLORS[v]) || ['#E8EBF0','#3A3F4B'];

  const renderShipBadge = (r, col) => {
    const dbVal = r[col.key];
    const isOpen = shipBadgeOpen?.id === r.id && shipBadgeOpen?.field === col.key;
    const [bg, c] = dbVal ? getShipBadgeColor(col.key, dbVal) : ['#F4F6FA','#9BA3B2'];
    return (
      <div className="badge-expand-panel" onClick={e => e.stopPropagation()}>
        <span style={{display:'inline-flex',padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:600,whiteSpace:'nowrap',background:bg,color:c,cursor:'pointer',border:isOpen?`2px solid ${c}`:'2px solid transparent'}}
          onClick={e => { if (isOpen) { setShipBadgeOpen(null); } else { const rect = e.currentTarget.getBoundingClientRect(); setShipBadgePos({top:rect.bottom+2,left:rect.left}); setShipBadgeOpen({id:r.id,field:col.key}); } }}>
          {dbVal || '●'}
        </span>
        {isOpen && shipBadgePos && (
          <div style={{position:'fixed',top:shipBadgePos.top,left:shipBadgePos.left,zIndex:9999,background:'#fff',border:'1px solid #DDE1EB',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',padding:4,minWidth:80,maxHeight:200,overflowY:'auto'}}>
            {col.opts.map(o => {
              const [obg,oc] = getShipBadgeColor(col.key, o);
              return <div key={o} style={{padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600,cursor:'pointer',background:obg,color:oc,marginBottom:2,border:dbVal===o?`2px solid ${oc}`:'2px solid transparent',whiteSpace:'nowrap'}}
                onClick={() => saveShipBadge(r.id, col.key, o)}>{o}</div>;
            })}
          </div>
        )}
      </div>
    );
  };

  const renderCell = (r, col) => {
    const val = r[col.key];
    const isEditing = editCell?.id === r.id && editCell?.field === col.key;
    const empty = <span className="empty-dot">●</span>;
    const B = (bg,c,t,ex) => <span style={{display:'inline-flex',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600,whiteSpace:'nowrap',background:bg,color:c,...(ex||{})}}>{t}</span>;

    // 고정값 셀
    if (col.type === 'static') return B('#F4F6FA','#5A6070', col.value);
    // 읽기전용 뱃지
    if (col.type === 'readonly-badge') return val ? B('#E6F1FB','#0C447C',val) : <span className="empty-dot">●</span>;
    // 읽기전용
    if (col.type === 'readonly') {
      if (!val) return <span className="empty-dot">●</span>;
      if (col.key === 'ship_date') return <span style={{fontSize:12,color:'#3A3F4B'}}>{fmtDate(val)}</span>;
      return <span style={{fontSize:12,color:'#3A3F4B'}}>{val}</span>;
    }
    // 뱃지 선택
    if (col.type === 'select') return renderShipBadge(r, col);
    // 삭제 버튼
    if (col.key === '_delete') {
      return <button className="btn-text-danger" style={{fontSize:11}} onClick={async (e) => {
        e.stopPropagation();
        if (!confirm('이 발송 건을 삭제하시겠습니까?')) return;
        if (r.as_record_id) {
          await supabase.from('as_records').update({ tracking_number: null, release_date: null, release_carrier: null }).eq('id', r.as_record_id);
        }
        await onDelete(r.id);
      }}>삭제</button>;
    }
    // 편집 모드
    if (isEditing) {
      return <input className="as-cell-input" value={editValue} autoFocus onChange={e => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={e => e.key === 'Enter' && commitEdit()} />;
    }
    // 운송장번호
    if (col.key === 'tracking_no') return val ? <span style={{fontFamily:'monospace',fontSize:11,fontWeight:600,color:'#1A1D23'}}>{val}</span> : <span style={{fontSize:10,color:'#9BA3B2'}}>미입력</span>;
    return val || empty;
  };

  const noTracking = (r) => !r.tracking_no;

  return (
    <table className="as-table" ref={tableRef} style={{width: COLS.reduce((s,c) => s + getColWidth(c.key), 0)}}>
      <colgroup>{COLS.map(c => <col key={c.key} style={{width: getColWidth(c.key)}} />)}</colgroup>
      <thead>
        <tr className="as-col-header">
          {COLS.map((c, idx) => (
            <th key={c.key} style={{background:'#EAECF2',cursor:'pointer'}} onClick={() => toggleSort(c.key)}>
              {c.label}{sortKey === c.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
              <span className="col-resize-handle" onMouseDown={e => startResize(idx, c.key, e)} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {showNewRow && (() => {
          // 미출고 고객 검색 (status=완료, tracking_number 비어있음)
          const allPending = asRecords.filter(r => r.status === '완료' && !r.tracking_number);
          const pendingShip = recipientQuery.length >= 1
            ? allPending.filter(r => r.customer_name?.toLowerCase().includes(recipientQuery.toLowerCase()))
            : allPending;
          return (
          <tr className="as-new-row">
            {COLS.map(c => (
              <td key={c.key} style={{...(c.key === 'receiver_name' || c.type === 'select' ? {position:'relative',overflow:'visible'} : {}), ...((c.type === 'readonly' || c.type === 'readonly-badge' || c.type === 'static') ? {cursor:'default'} : {})}}>
                {c.type === 'static' ? (
                  <span style={{display:'inline-flex',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600,background:'#F4F6FA',color:'#5A6070'}}>{c.value}</span>
                ) : (c.type === 'readonly' || c.type === 'readonly-badge') ? (
                  <span style={{fontSize:11,color: newRow[c.key] ? (c.type === 'readonly-badge' ? '#0C447C' : '#3A3F4B') : '#9BA3B2', ...(c.type === 'readonly-badge' && newRow[c.key] ? {background:'#E6F1FB',padding:'3px 8px',borderRadius:4,fontWeight:600,display:'inline-flex'} : {})}}>{c.key === 'ship_date' ? fmtDate(newRow.ship_date) : (newRow[c.key] || '●')}</span>
                ) : c.key === '_delete' ? (
                  <div style={{display:'flex',gap:4}}>
                    <button className="btn-primary" style={{fontSize:11,padding:'4px 8px',whiteSpace:'nowrap'}} onClick={handleNewSave}>저장</button>
                    <button className="btn-secondary" style={{fontSize:11,padding:'4px 8px',whiteSpace:'nowrap'}} onClick={onHideNewRow}>취소</button>
                  </div>
                ) : c.key === 'receiver_name' ? (
                  <>
                    <input className="as-cell-input" value={newRow.receiver_name||''} placeholder="수령자명"
                      onChange={e => { setNewRow(p=>({...p, receiver_name: e.target.value, as_record_id: null})); setRecipientQuery(e.target.value); }}
                      onKeyDown={e => { if (e.key==='Enter') e.preventDefault(); }} />
                    {showNewRow && pendingShip.length > 0 && (
                      <div className="search-dropdown" style={{minWidth:350,top:'100%',left:0}}>
                        <div className="search-dropdown-header">
                          <span style={{fontSize:10,fontWeight:600,color:'#5A6070'}}>발송 대기 {pendingShip.length}건</span>
                        </div>
                        {pendingShip.slice(0,8).map((ar,i) => (
                          <div key={ar.id} className="search-dropdown-item" onClick={() => {
                            setNewRow(p => ({...p, receiver_name: ar.customer_name || '', receiver_phone: ar.customer_phone || '', contents: ar.model || '', as_record_id: ar.id }));
                            setRecipientQuery('');
                          }}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:'flex',alignItems:'center',gap:6}}>
                                <span style={{fontSize:12,fontWeight:600,color:'#1A1D23'}}>{ar.customer_name || '-'}</span>
                                {ar.model && <span style={{display:'inline-flex',padding:'1px 6px',borderRadius:4,fontSize:10,fontWeight:600,background:'#E6F1FB',color:'#0C447C'}}>{ar.model}</span>}
                              </div>
                              <div style={{fontSize:11,color:'#5A6070'}}>{ar.customer_phone || '-'}</div>
                            </div>
                            <div style={{textAlign:'right',flexShrink:0}}>
                              <div style={{fontSize:10,color:'#5A6070',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ar.repair_result || ar.symptom || '-'}</div>
                              <div style={{fontSize:10,color:'#9BA3B2'}}>{fmtDate(ar.receipt_date)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : c.type === 'select' ? (
                  <div className="badge-expand-panel" onClick={e => e.stopPropagation()}>
                    {(() => { const [nbg,nc] = newRow[c.key] ? getShipBadgeColor(c.key, newRow[c.key]) : ['#F4F6FA','#9BA3B2']; return (
                    <span style={{display:'inline-flex',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600,whiteSpace:'nowrap',background:nbg,color:nc,cursor:'pointer',border:newShipBadgeOpen===c.key?`2px solid ${nc}`:'2px solid transparent'}}
                      onClick={e => { if (newShipBadgeOpen===c.key) { setNewShipBadgeOpen(null); } else { const rect=e.currentTarget.getBoundingClientRect(); setNewShipBadgePos({top:rect.bottom+2,left:rect.left}); setNewShipBadgeOpen(c.key); } }}>
                      {newRow[c.key] || '선택'}
                    </span>); })()}
                    {newShipBadgeOpen===c.key && newShipBadgePos && (
                      <div style={{position:'fixed',top:newShipBadgePos.top,left:newShipBadgePos.left,zIndex:9999,background:'#fff',border:'1px solid #DDE1EB',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',padding:4,minWidth:80,maxHeight:200,overflowY:'auto'}}>
                        {c.opts.map(o => { const [obg,oc] = getShipBadgeColor(c.key, o); return (
                          <div key={o} style={{padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600,cursor:'pointer',background:obg,color:oc,marginBottom:2,border:newRow[c.key]===o?`2px solid ${oc}`:'2px solid transparent',whiteSpace:'nowrap'}}
                            onClick={() => { setNewRow(p=>({...p,[c.key]:o})); setNewShipBadgeOpen(null); }}>{o}</div>); })}
                      </div>
                    )}
                  </div>
                ) : c.type === 'date' ? (
                  <input type="date" className="as-cell-input" value={newRow[c.key]||''} onChange={e => setNewRow(p=>({...p,[c.key]:e.target.value}))} />
                ) : (
                  <input className="as-cell-input" value={newRow[c.key]||''} placeholder={c.label} onChange={e => setNewRow(p=>({...p,[c.key]:e.target.value}))} onKeyDown={e => { if (e.key==='Enter') e.preventDefault(); }} />
                )}
              </td>
            ))}
          </tr>
          );
        })()}
        {sorted.map((r, i) => (
          <tr key={r.id} className="as-data-row" style={{background: noTracking(r) ? '#FAEEDA' : (i % 2 === 1 ? '#FAFBFC' : undefined)}}>
            {COLS.map(c => (
              <td key={c.key} style={{...(c.key === 'tracking_no' && noTracking(r) ? {border:'2px solid #1D9E75'} : {}), ...(c.type === 'select' ? {overflow:'visible',position:'relative'} : {}), ...((c.type === 'readonly' || c.type === 'readonly-badge' || c.type === 'static') ? {cursor:'default'} : {})}}
                onClick={() => { if (c.type === 'action' || c.type === 'select' || c.type === 'readonly' || c.type === 'readonly-badge' || c.type === 'static') return; startEdit(r.id, c.key, r[c.key] || ''); }}>
                {renderCell(r, c)}
              </td>
            ))}
          </tr>
        ))}
        {sorted.length === 0 && <tr><td colSpan={COLS.length} className="empty">택배 발송 내역이 없습니다</td></tr>}
      </tbody>
    </table>
  );
}


/* ═══ CUSTOMER POPUP ═══ */
function CustomerPopup({ customer, onClose }) {
  const { name, phone, company } = customer;
  const [records, setRecords] = useState([]);
  const [smsMessages, setSmsMessages] = useState([]);
  const [msgInput, setMsgInput] = useState('');
  const [loading, setLoading] = useState(true);
  const chatRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    const loadAll = async () => {
      // 전체 기간 해당 고객 레코드 조회
      let q = supabase.from('as_records').select('*').order('receipt_date', { ascending: false });
      if (name && phone) q = q.eq('customer_name', name).eq('customer_phone', phone);
      else if (name) q = q.eq('customer_name', name);
      else if (phone) q = q.eq('customer_phone', phone);
      const { data: asData } = await q;
      if (asData) setRecords(asData);

      // 문자 내역
      if (phone) {
        const { data: smsData } = await supabase.from('sms_messages').select('*').eq('phone', phone).order('sent_at', { ascending: true });
        if (smsData) setSmsMessages(smsData);
      }
      setLoading(false);
    };
    loadAll();
  }, [name, phone]);

  useEffect(() => {
    setTimeout(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, 50);
  }, [smsMessages]);

  const totalCost = records.reduce((s, r) => s + (r.repair_cost || 0), 0);
  const now = new Date();
  const warrantyCount = records.filter(r => {
    if (!r.release_date) return false;
    const months = r.record_type === 'product_sale' ? 12 : 6;
    const releaseDate = new Date(r.release_date + 'T00:00:00');
    const diff = (now - releaseDate) / (1000 * 60 * 60 * 24 * 30);
    return diff <= months;
  }).length;

  const isWarranty = (r) => {
    if (!r.release_date) return false;
    const months = r.record_type === 'product_sale' ? 12 : 6;
    const releaseDate = new Date(r.release_date + 'T00:00:00');
    return (now - releaseDate) / (1000 * 60 * 60 * 24 * 30) <= months;
  };

  const handleSend = async () => {
    if (!msgInput.trim() || !phone) return;
    const msg = { phone, content: msgInput.trim(), direction: 'outgoing', sent_at: new Date().toISOString() };
    const { data } = await supabase.from('sms_messages').insert(msg).select();
    if (data) setSmsMessages(prev => [...prev, ...data]);
    setMsgInput('');
  };

  const fmtDateFull = (d) => {
    if (!d) return '—';
    const dt = new Date(d + 'T00:00:00');
    return `${dt.getFullYear()}년 ${dt.getMonth()+1}월 ${dt.getDate()}일`;
  };

  // 날짜별 문자 그룹핑
  const groupedSms = [];
  let lastDate = '';
  smsMessages.forEach(msg => {
    const d = new Date(msg.sent_at).toLocaleDateString('ko-KR');
    if (d !== lastDate) { groupedSms.push({ type: 'date', label: d }); lastDate = d; }
    groupedSms.push({ type: 'msg', data: msg });
  });

  return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp-modal" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="cp-header">
          <div style={{display:'flex',alignItems:'center',gap:12,flex:1}}>
            <div className="cp-avatar">{(name || '?')[0]}</div>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:'#fff'}}>{name || '-'}</div>
              <div style={{fontSize:12,color:'rgba(255,255,255,0.75)'}}>{phone || '연락처 없음'}{company ? ` · ${company}` : ''}</div>
            </div>
          </div>
          <div style={{display:'flex',gap:20,alignItems:'center'}}>
            <div className="cp-stat"><span className="cp-stat-label">총 AS</span><span className="cp-stat-value">{records.length}<span className="cp-stat-unit">건</span></span></div>
            <div className="cp-stat"><span className="cp-stat-label">총 비용</span><span className="cp-stat-value">{fmt(totalCost)}</span></div>
            <div className="cp-stat"><span className="cp-stat-label">보증중</span><span className="cp-stat-value" style={{color:'#7BE8B8'}}>{warrantyCount}<span className="cp-stat-unit">건</span></span></div>
          </div>
          <button className="cp-close" onClick={onClose}>✕</button>
        </div>

        {/* 바디: 좌측 수리이력 + 우측 문자 */}
        <div className="cp-body">
          {/* 좌측: 수리 이력 */}
          <div className="cp-left">
            <div className="cp-sub-header"><span style={{fontSize:13,fontWeight:600,color:'#1A1D23'}}>수리 이력</span><span style={{fontSize:11,color:'#9BA3B2'}}>총 {records.length}건</span></div>
            <div className="cp-history-list">
              {loading ? <div className="empty">로딩 중...</div> : records.length === 0 ? <div className="empty">수리 이력이 없습니다</div> : records.map((r, i) => (
                <div key={r.id} className="cp-history-row" style={i % 2 === 1 ? {background:'#FAFBFC'} : undefined}>
                  <div style={{flexShrink:0}}>
                    {isWarranty(r) ? <span className="cp-warranty-badge warranty">보증중</span> : <span className="cp-warranty-badge expired">만료</span>}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                      {r.model && <span style={{display:'inline-flex',padding:'2px 6px',borderRadius:4,fontSize:10,fontWeight:600,background:'#E6F1FB',color:'#0C447C'}}>{r.model}</span>}
                      <span style={{fontSize:13,fontWeight:500,color:'#1A1D23',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.repair_result || r.symptom || '-'}</span>
                    </div>
                    <div style={{fontSize:11,color:'#5A6070'}}>
                      {fmtDateFull(r.receipt_date)}{r.technician ? ` · 처리자: ${r.technician}` : ''} · 상태: <span style={{color: r.status === '완료' ? '#1D9E75' : '#5A6070'}}>{r.status || '-'}</span>
                    </div>
                  </div>
                  <div style={{flexShrink:0,textAlign:'right'}}>
                    <div style={{fontSize:15,fontWeight:700,color:'#185FA5'}}>{r.repair_cost ? fmt(r.repair_cost) : '-'}</div>
                    <div style={{fontSize:10,color: r.payment_status === '완료' ? '#1D9E75' : (r.payment_status === '대기' || r.payment_status === '명세서') ? '#CC2222' : r.payment_status === '무상' ? '#9BA3B2' : '#5A6070'}}>{r.payment_status || '-'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 우측: 문자 내역 */}
          <div className="cp-right">
            <div className="cp-sub-header"><span style={{fontSize:13,fontWeight:600,color:'#1A1D23'}}>문자 내역</span><span style={{fontSize:11,color:'#9BA3B2'}}>{smsMessages.length}건</span></div>
            <div className="cp-chat-area" ref={chatRef}>
              {smsMessages.length === 0 ? <div className="empty" style={{padding:'40px 0'}}>문자 내역이 없습니다</div> : groupedSms.map((item, i) => {
                if (item.type === 'date') return <div key={`d-${i}`} className="cp-chat-date">{item.label}</div>;
                const msg = item.data;
                const isOut = msg.direction === 'outgoing';
                return (
                  <div key={msg.id} className={`cp-bubble ${isOut ? 'cp-bubble-out' : 'cp-bubble-in'}`}>
                    <div className="cp-bubble-text">{msg.content}</div>
                    <div className="cp-bubble-time">{new Date(msg.sent_at).toLocaleString('ko-KR', {hour:'2-digit',minute:'2-digit'})}</div>
                  </div>
                );
              })}
            </div>
            <div className="cp-chat-input">
              <input className="input" value={msgInput} onChange={e => setMsgInput(e.target.value)} placeholder="문자 입력..." onKeyDown={e => e.key === 'Enter' && handleSend()} style={{flex:1,height:34,fontSize:12}} />
              <button className="btn-primary" onClick={handleSend} style={{padding:'0 14px',fontSize:12,fontWeight:600,whiteSpace:'nowrap'}}>전송</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ═══ PARTS TABLE ═══ */
function PartsTable({ parts, onEdit }) {
  const [sortKey, setSortKey] = useState('code');
  const [sortAsc, setSortAsc] = useState(true);
  const toggleSort = (k) => { if (sortKey === k) setSortAsc(!sortAsc); else { setSortKey(k); setSortAsc(true); } };
  const sorted = [...parts].sort((a, b) => {
    let va = a[sortKey] ?? '', vb = b[sortKey] ?? '';
    if (sortKey === 'price') { va = va || 0; vb = vb || 0; }
    return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });
  const COLS = [
    { key:'code', label:'내부코드', w:90 },
    { key:'name', label:'부품', w:280 },
    { key:'category', label:'구분(모델)', w:120 },
    { key:'price', label:'공임비', w:100 },
    { key:'_edit', label:'관리', w:60 },
  ];
  return (
    <table className="as-table" style={{width: COLS.reduce((s,c) => s + c.w, 0)}}>
      <colgroup>{COLS.map(c => <col key={c.key} style={{width:c.w}} />)}</colgroup>
      <thead><tr className="as-col-header">
        {COLS.map(c => (
          <th key={c.key} style={{background:'#EAECF2',cursor:c.key !== '_edit' ? 'pointer' : 'default'}} onClick={() => c.key !== '_edit' && toggleSort(c.key)}>
            {c.label}{sortKey === c.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
          </th>
        ))}
      </tr></thead>
      <tbody>
        {sorted.map((p, i) => (
          <tr key={p.id} className="as-data-row" style={i % 2 === 1 ? {background:'#FAFBFC'} : undefined}>
            <td style={{textAlign:'center'}}><span style={{fontFamily:'monospace',fontSize:12,color:'#5A6070'}}>{p.code || <span className="empty-dot">●</span>}</span></td>
            <td style={{textAlign:'left'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                {p.image_url ? <img src={p.image_url} alt="" style={{width:48,height:48,objectFit:'cover',borderRadius:6,flexShrink:0}} />
                  : <div style={{width:48,height:48,borderRadius:6,background:'#F4F6FA',display:'flex',alignItems:'center',justifyContent:'center',color:'#5A6070',fontSize:16,fontWeight:600,flexShrink:0}}>{(p.name||'?')[0]}</div>}
                <div style={{minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:'#1A1D23',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.name || <span className="empty-dot">●</span>}</div>
                  {p.spec && <div style={{fontSize:11,color:'#5A6070',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.spec}</div>}
                </div>
              </div>
            </td>
            <td style={{textAlign:'center'}}>{p.category ? <span style={{display:'inline-flex',padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:600,background: p.category === '공용' ? '#E6F1FB' : '#F4F6FA',color: p.category === '공용' ? '#0C447C' : '#1A1D23'}}>{p.category}</span> : <span className="empty-dot">●</span>}</td>
            <td style={{textAlign:'right',color:'#185FA5',fontWeight:700,fontSize:14}}>₩{p.price?.toLocaleString('ko-KR') || '0'}</td>
            <td style={{textAlign:'center'}}><button className="btn-text-edit" style={{fontSize:11}} onClick={() => onEdit(p)}>수정</button></td>
          </tr>
        ))}
        {sorted.length === 0 && <tr><td colSpan={5} className="empty">부품이 없습니다</td></tr>}
      </tbody>
    </table>
  );
}


/* ═══ PART MODAL ═══ */
function PartModal({ initial, onSave, onDelete, onClose }) {
  const isEdit = !!initial;
  const [f, setF] = useState({
    code: initial?.code || '', category: initial?.category || '', name: initial?.name || '',
    spec: initial?.spec || '', price: initial?.price?.toString() || '', image_url: initial?.image_url || '',
  });
  const [imgFile, setImgFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const handleImgChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 200x200 리사이즈
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 200; canvas.height = 200;
        const ctx = canvas.getContext('2d');
        const size = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, 200, 200);
        canvas.toBlob(blob => { setImgFile(blob); set('image_url', URL.createObjectURL(blob)); }, 'image/jpeg', 0.85);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    let imgUrl = f.image_url;
    // 이미지 업로드
    if (imgFile) {
      const fileName = `part_${Date.now()}.jpg`;
      const { data, error } = await supabase.storage.from('parts-images').upload(fileName, imgFile, { contentType: 'image/jpeg', upsert: true });
      if (!error && data) {
        const { data: urlData } = supabase.storage.from('parts-images').getPublicUrl(fileName);
        imgUrl = urlData?.publicUrl || imgUrl;
      }
    }
    await onSave({ code: f.code || null, category: f.category || null, name: f.name || null, spec: f.spec || null, price: parseInt(String(f.price).replace(/,/g, '')) || 0, image_url: imgUrl || null });
    setSaving(false);
  };

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{maxWidth:480}} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h2>{isEdit ? '부품 수정' : '새 부품 추가'}</h2><button onClick={onClose} className="modal-close">✕</button></div>
        <div className="modal-body">
          {/* 이미지 */}
          <div style={{display:'flex',justifyContent:'center',marginBottom:16}}>
            <label style={{cursor:'pointer',position:'relative'}}>
              {f.image_url ? <img src={f.image_url} alt="" style={{width:120,height:120,objectFit:'cover',borderRadius:8,border:'1px solid #DDE1EB'}} />
                : <div style={{width:120,height:120,borderRadius:8,border:'2px dashed #DDE1EB',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#9BA3B2',fontSize:13}}>
                  <span style={{fontSize:28}}>+</span><span>사진 추가</span>
                </div>}
              <input type="file" accept="image/*" onChange={handleImgChange} style={{display:'none'}} />
              {f.image_url && <div style={{textAlign:'center',fontSize:10,color:'#9BA3B2',marginTop:4}}>클릭하여 변경</div>}
            </label>
          </div>
          <div className="form-grid">
            <div className="form-field"><label className="label">내부코드</label><input value={f.code} onChange={e => set('code', e.target.value)} className="input" placeholder="00000" /></div>
            <div className="form-field"><label className="label">구분(모델)</label><input value={f.category} onChange={e => set('category', e.target.value)} className="input" placeholder="DC990, 공용 등" /></div>
          </div>
          <div className="form-field"><label className="label">규격 및 품명</label><input value={f.name} onChange={e => set('name', e.target.value)} className="input" placeholder="품명 입력" /></div>
          <div className="form-field"><label className="label">스펙</label><input value={f.spec} onChange={e => set('spec', e.target.value)} className="input" placeholder="사양/규격" /></div>
          <div className="form-field"><label className="label">공임비 (원)</label><input value={f.price} onChange={e => set('price', e.target.value.replace(/[^0-9]/g,''))} className="input" placeholder="0" /></div>
        </div>
        <div className="modal-footer">
          {isEdit && onDelete && <button onClick={onDelete} className="btn-danger" style={{marginRight:'auto',fontSize:12}}>삭제</button>}
          <button onClick={onClose} className="btn-secondary">취소</button>
          <button onClick={handleSave} className="btn-primary" disabled={saving}>{saving ? '저장 중...' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}
