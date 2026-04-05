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
const toE164 = (p) => { if (!p) return ''; const d = p.replace(/[^0-9]/g, ''); if (d.startsWith('0')) return '+82' + d.slice(1); return '+' + d; };
const toLocal = (p) => { if (!p) return ''; const d = p.replace(/[^0-9]/g, ''); if (d.startsWith('82')) return '0' + d.slice(2); return d; };
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
  const [customerPopup, setCustomerPopup] = useState(null);
  const [deleteMode, setDeleteMode] = useState(false);
  const [smsPopup, setSmsPopup] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const searchWrapRef = useRef(null);

  /* ── SMS 읽지 않은 문자 카운트 ── */
  useEffect(() => {
    if (!user) return;
    const fetchUnread = async () => { const { count } = await supabase.from('sms_messages').select('*', { count: 'exact', head: true }).eq('direction', 'incoming').eq('read', false); setUnreadCount(count || 0); };
    fetchUnread();
    const iv = setInterval(fetchUnread, 10000);
    return () => clearInterval(iv);
  }, [user]);

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
                <button style={{position:'relative',display:'inline-flex',alignItems:'center',gap:5,padding:'6px 14px',borderRadius:6,border: unreadCount > 0 ? '1px solid #B5D4F4' : '0.5px solid #DDE1EB',background: unreadCount > 0 ? '#E6F1FB' : '#F4F6FA',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:600,color: unreadCount > 0 ? '#0C447C' : '#5A6070'}} onClick={() => setSmsPopup(true)}>
                  <svg width="16" height="16" viewBox="0 0 14 14" fill="none"><path d="M2 2.5C2 1.7 2.7 1 3.5 1h7C11.3 1 12 1.7 12 2.5v5c0 .8-.7 1.5-1.5 1.5H8l-2.5 2.5V9H3.5C2.7 9 2 8.3 2 7.5v-5z" fill={unreadCount > 0 ? '#185FA5' : '#9BA3B2'}/></svg>
                  문자
                  {unreadCount > 0 && <span style={{position:'absolute',top:-6,right:-6,background:'#E24B4A',color:'#fff',fontSize:10,fontWeight:700,minWidth:18,height:18,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 4px'}}>{unreadCount}</span>}
                </button>
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
                  <button style={{background: deleteMode ? 'rgba(204,34,34,0.5)' : 'rgba(204,34,34,0.2)', border: deleteMode ? '1px solid rgba(240,149,149,0.6)' : '1px solid rgba(240,149,149,0.35)', color: deleteMode ? '#fff' : '#F09595', fontSize:11, fontWeight: deleteMode ? 700 : 500, padding:'4px 10px', borderRadius:5, cursor:'pointer', fontFamily:'inherit'}}
                    onClick={() => setDeleteMode(!deleteMode)}>삭제</button>
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
                  deleteMode={deleteMode}
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

        {/* ═══ 설정 ═══ */}
        {tab === 'settings' && (
          <SettingsTab asRecords={asRecords} monthFilter={monthFilter} />
        )}
      </div>

      {/* ═══ 기타 MODALS (부품 모달이 아닐 때만) ═══ */}
      {modal && modal.type !== 'part-new' && modal.type !== 'part-edit' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* ═══ 고객 이력 팝업 ═══ */}
      {smsPopup && <SMSPopup onClose={() => setSmsPopup(false)} onUnreadChange={setUnreadCount} />}
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
function ASTable({ records, onSaveField, onAddNew, onDelete, onReload, showNewRow, onHideNewRow, onOpenCustomer, onAddShip, deleteMode }) {
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
      if (r.payment_status !== '완료') return empty; // 입금 미완료
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
          {deleteMode && <th style={{position:'sticky',top:0,zIndex:21,background:'#FCEBEB',width:30}} />}
          {COL_GROUPS.map((g, i) => (
            <th key={i} colSpan={g.span} style={{ background: g.bg, color: g.color, fontSize: 12, fontWeight: 700, padding: '8px 0', textAlign: 'center', borderBottom: `2px solid ${g.border}`, borderRight: i < COL_GROUPS.length - 1 ? `2px solid ${g.border}` : 'none', position: 'sticky', top: 0, zIndex: 21 }}>
              {g.label}
            </th>
          ))}
        </tr>
        <tr className="as-col-header">
          {deleteMode && <th style={{position:'sticky',top:34,zIndex:20,background:'#FCEBEB',width:30,fontSize:10,color:'#CC2222'}}>삭제</th>}
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
            {deleteMode && <td />}
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
            {deleteMode && (
              <td style={{textAlign:'center',cursor:'pointer',padding:'2px'}} onClick={e => { e.stopPropagation(); if (confirm(`이 AS 건을 삭제하시겠습니까?\n고객: ${r.customer_name||'-'} / 모델: ${r.model||'-'}`)) onDelete(r.id); }}>
                <span style={{color:'#CC2222',fontSize:14,fontWeight:700,display:'inline-flex',width:22,height:22,alignItems:'center',justifyContent:'center',borderRadius:4}} onMouseOver={e => e.currentTarget.style.background='#FCEBEB'} onMouseOut={e => e.currentTarget.style.background='transparent'}>✕</span>
              </td>
            )}
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
          <tr><td colSpan={COLS.length + (deleteMode?1:0)} className="empty">조건에 맞는 AS 건이 없습니다</td></tr>
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
    try {
      const res = await fetch('/api/sms/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to: phone, content: msgInput.trim() }) });
      const result = await res.json();
      if (result.error) { alert('문자 발송 실패: ' + result.error); return; }
    } catch (e) { alert('문자 발송 실패: ' + e.message); return; }
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
  const tableRef = useRef(null);
  const savedWidthsRef = useRef((() => {
    if (typeof window === 'undefined') return {};
    try { const v = JSON.parse(localStorage.getItem('parts_column_widths')); return (v && typeof v === 'object') ? v : {}; } catch { return {}; }
  })());

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
  const DEFAULT_W = { code:90, name:280, category:120, price:100, _edit:60 };
  const getW = (k) => savedWidthsRef.current[k] || DEFAULT_W[k] || 80;

  const startResize = (colIdx, colKey, e) => {
    e.preventDefault(); e.stopPropagation();
    const table = tableRef.current; if (!table) return;
    const col = table.querySelector('colgroup').children[colIdx]; if (!col) return;
    const startX = e.clientX;
    const startW = col.offsetWidth || getW(colKey);
    const startTableW = table.offsetWidth;
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize';
    const onMove = (ev) => { ev.preventDefault(); const newW = Math.max(40, startW + ev.clientX - startX); col.style.width = newW + 'px'; table.style.width = (startTableW + (newW - startW)) + 'px'; };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = ''; document.body.style.cursor = '';
      const finalW = parseInt(col.style.width) || startW;
      savedWidthsRef.current = { ...savedWidthsRef.current, [colKey]: finalW };
      localStorage.setItem('parts_column_widths', JSON.stringify(savedWidthsRef.current));
    };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  };

  return (
    <table className="as-table" ref={tableRef} style={{width: COLS.reduce((s,c) => s + getW(c.key), 0)}}>
      <colgroup>{COLS.map(c => <col key={c.key} style={{width: getW(c.key)}} />)}</colgroup>
      <thead><tr className="as-col-header">
        {COLS.map((c, idx) => (
          <th key={c.key} style={{background:'#F4F6FA',cursor:c.key !== '_edit' ? 'pointer' : 'default'}} onClick={() => c.key !== '_edit' && toggleSort(c.key)}>
            {c.label}{sortKey === c.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
            <span className="col-resize-handle" onMouseDown={e => startResize(idx, c.key, e)} />
          </th>
        ))}
      </tr></thead>
      <tbody>
        {sorted.map((p, i) => (
          <tr key={p.id} className="as-data-row" style={i % 2 === 1 ? {background:'#FAFBFC'} : undefined}>
            <td style={{textAlign:'center'}}><span style={{fontSize:13,color:'#5A6070'}}>{p.code || <span className="empty-dot">●</span>}</span></td>
            <td style={{textAlign:'left',padding:'10px 8px'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                {p.image_url ? <img src={p.image_url} alt="" style={{width:48,height:48,objectFit:'cover',borderRadius:8,flexShrink:0}} />
                  : <div style={{width:48,height:48,borderRadius:8,background:'#E6F1FB',display:'flex',alignItems:'center',justifyContent:'center',color:'#0C447C',fontSize:16,fontWeight:600,flexShrink:0}}>{(p.name||'?')[0]}</div>}
                <div style={{minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:'#1A1D23',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.name || <span className="empty-dot">●</span>}</div>
                  {p.spec && <div style={{fontSize:12,color:'#5A6070',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.spec}</div>}
                </div>
              </div>
            </td>
            <td style={{textAlign:'center'}}>{p.category ? <span style={{display:'inline-flex',padding:'3px 10px',borderRadius:4,fontSize:12,fontWeight:600,background: p.category === '공용' ? '#E6F1FB' : '#F4F6FA',color: p.category === '공용' ? '#0C447C' : '#1A1D23'}}>{p.category}</span> : <span className="empty-dot">●</span>}</td>
            <td style={{textAlign:'right',color:'#185FA5',fontWeight:700,fontSize:15,padding:'10px 12px'}}>{p.price?.toLocaleString('ko-KR') || '0'}</td>
            <td style={{textAlign:'center'}}><button className="btn-text-edit" style={{fontSize:12,fontWeight:500}} onClick={() => onEdit(p)}>수정</button></td>
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


/* ═══ SETTINGS TAB ═══ */
function SettingsTab({ asRecords, monthFilter }) {
  const [subTab, setSubTab] = useState('system');
  const [pwModal, setPwModal] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState('');
  const [authOk, setAuthOk] = useState(false);
  const [settMonth, setSettMonth] = useState(monthFilter);
  const [techs, setTechs] = useState([]);
  const [stg, setStg] = useState({});
  const [smsIntake, setSmsIntake] = useState('');
  const [smsRelease, setSmsRelease] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiPhone, setApiPhone] = useState('');
  const [warrantyNew, setWarrantyNew] = useState('12');
  const [warrantyRepair, setWarrantyRepair] = useState('6');
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPwC, setNewPwC] = useState('');
  const [newTechName, setNewTechName] = useState('');
  const [editTech, setEditTech] = useState(null);
  const intakeRef = useRef(null);
  const releaseRef = useRef(null);
  const [lastFocusedTpl, setLastFocusedTpl] = useState('intake');

  useEffect(() => {
    supabase.from('technicians').select('*').order('created_at').then(({data}) => { if(data) setTechs(data); });
    supabase.from('settings').select('*').then(({data}) => {
      const m = {}; (data||[]).forEach(s => { m[s.key] = s.value; }); setStg(m);
      setSmsIntake(m.sms_template_intake || '{고객명}님, {모델명} 제품이 {입고날짜}에 입고되었습니다.');
      setSmsRelease(m.sms_template_release || '{고객명}님, {모델명} 제품이 {택배사} {운송장번호}로 발송되었습니다.');
      setApiKey(m.httpsms_api_key || ''); setApiPhone(m.httpsms_phone || '');
      setWarrantyNew(String(m.warranty_new_months || 12)); setWarrantyRepair(String(m.warranty_repair_months || 6));
    });
  }, []);

  const save = async (key, value) => { await supabase.from('settings').upsert({ key, value, updated_at: new Date().toISOString() }); };

  const getAdminPw = () => { const v = stg.admin_password; if (!v) return '1234'; return String(v).replace(/"/g, ''); };
  const handlePwCheck = () => {
    if (pwInput === getAdminPw()) { setAuthOk(true); setPwModal(false); setPwInput(''); setPwError(''); }
    else setPwError('비밀번호가 일치하지 않습니다');
  };

  const handleSubTab = (t) => { if (t === 'billing') { setAuthOk(false); setPwModal(true); setPwInput(''); setPwError(''); } setSubTab(t); };

  const insertVar = (v) => {
    const ref = lastFocusedTpl === 'release' ? releaseRef : intakeRef;
    const el = ref.current; if (!el) return;
    const pos = el.selectionStart || 0;
    const val = el.value;
    const nv = val.slice(0, pos) + v + val.slice(pos);
    if (lastFocusedTpl === 'release') setSmsRelease(nv); else setSmsIntake(nv);
    setTimeout(() => { el.focus(); el.setSelectionRange(pos + v.length, pos + v.length); }, 0);
  };

  const [sy, sm] = settMonth.split('-').map(Number);
  const sRecs = asRecords.filter(r => r.receipt_date?.startsWith(settMonth));
  const totalRev = sRecs.reduce((s,r) => s + (r.repair_cost||0), 0);
  const paidAmt = sRecs.filter(r => r.payment_status === '완료').reduce((s,r) => s + (r.repair_cost||0), 0);
  const unpaidAmt = sRecs.filter(r => r.payment_status === '대기' || r.payment_status === '명세서').reduce((s,r) => s + (r.repair_cost||0), 0);
  const freeN = sRecs.filter(r => r.payment_status === '무상').length;
  const B = (bg,c,t) => <span style={{display:'inline-flex',padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:600,whiteSpace:'nowrap',background:bg,color:c}}>{t}</span>;
  const VARS = ['{입고날짜}','{출고날짜}','{모델명}','{택배사}','{운송장번호}','{고객명}','{거래처명}','{브랜드}','{AS비용}'];
  const prevMo = () => { setSettMonth(sm===1?`${sy-1}-12`:`${sy}-${String(sm-1).padStart(2,'0')}`); };
  const nextMo = () => { setSettMonth(sm===12?`${sy+1}-01`:`${sy}-${String(sm+1).padStart(2,'0')}`); };

  return (
    <div style={{padding:'0 4px'}}>
      <div style={{display:'flex',gap:4,marginBottom:20}}>
        {[['billing','🔒 정산 관리'],['system','시스템 설정']].map(([k,v]) => (
          <button key={k} onClick={() => handleSubTab(k)} style={{padding:'8px 18px',borderRadius:6,fontSize:13,fontWeight:600,cursor:'pointer',border:'none',fontFamily:'inherit',background:subTab===k?'#185FA5':'transparent',color:subTab===k?'#fff':'#5A6070'}}>{v}</button>
        ))}
      </div>

      {pwModal && (
        <div className="modal-overlay" onClick={() => { setPwModal(false); setSubTab('system'); }}>
          <div className="modal-content" style={{maxWidth:360,padding:0}} onClick={e => e.stopPropagation()}>
            <div style={{padding:'24px',textAlign:'center'}}>
              <div style={{fontSize:16,fontWeight:700,marginBottom:16}}>🔒 정산 관리 접근</div>
              <input type="password" maxLength={4} value={pwInput} onChange={e => setPwInput(e.target.value.replace(/\D/g,''))} onKeyDown={e => e.key==='Enter' && handlePwCheck()} placeholder="4자리 비밀번호" className="input" style={{textAlign:'center',fontSize:20,letterSpacing:8,marginBottom:8}} autoFocus />
              {pwError && <div style={{color:'#CC2222',fontSize:12,marginBottom:8}}>{pwError}</div>}
              <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:12}}>
                <button className="btn-secondary" onClick={() => { setPwModal(false); setSubTab('system'); }}>취소</button>
                <button className="btn-primary" onClick={handlePwCheck}>확인</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {subTab === 'billing' && authOk && (
        <>
          <div style={{display:'flex',gap:12,marginBottom:16,flexWrap:'wrap'}}>
            <div style={{flex:'1.5 1 200px',background:'#185FA5',borderRadius:8,padding:'16px 20px',color:'#fff'}}>
              <div style={{fontSize:11,opacity:0.8}}>이번달 총 매출</div>
              <div style={{fontSize:26,fontWeight:700}}>{totalRev.toLocaleString('ko-KR')}</div>
            </div>
            <div style={{flex:'1 1 140px',background:'#E1F5EE',borderRadius:8,padding:'16px 20px'}}>
              <div style={{fontSize:11,color:'#5A6070'}}>입금 완료</div>
              <div style={{fontSize:22,fontWeight:700,color:'#1D9E75'}}>{paidAmt.toLocaleString('ko-KR')}</div>
            </div>
            <div style={{flex:'1 1 140px',background:'#FAEEDA',borderRadius:8,padding:'16px 20px'}}>
              <div style={{fontSize:11,color:'#5A6070'}}>미수금</div>
              <div style={{fontSize:22,fontWeight:700,color:'#EF9F27'}}>{unpaidAmt.toLocaleString('ko-KR')}</div>
            </div>
            <div style={{flex:'1 1 140px',background:'#F4F6FA',borderRadius:8,padding:'16px 20px'}}>
              <div style={{fontSize:11,color:'#5A6070'}}>무상 처리</div>
              <div style={{fontSize:22,fontWeight:700,color:'#5A6070'}}>{freeN}건</div>
            </div>
          </div>
          <div className="section">
            <div className="section-header">
              <span style={{fontSize:12,fontWeight:600}}>정산 내역</span>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <button style={{background:'none',border:'none',color:'#fff',cursor:'pointer',fontSize:14}} onClick={prevMo}>◀</button>
                <span style={{fontSize:12}}>{sy}년 {sm}월</span>
                <button style={{background:'none',border:'none',color:'#fff',cursor:'pointer',fontSize:14}} onClick={nextMo}>▶</button>
              </div>
            </div>
            <div style={{overflowX:'auto',maxHeight:'calc(100vh - 340px)'}}>
              <table className="data-table"><thead><tr>
                {['날짜','거래처/고객','구분','모델','처리내용','AS비용','입금상태','계산서'].map(h => <th key={h}>{h}</th>)}
              </tr></thead><tbody>
                {sRecs.map((r,i) => (
                  <tr key={r.id} style={i%2===1?{background:'#FAFBFC'}:undefined}>
                    <td>{fmtDate(r.receipt_date)}</td>
                    <td>{[r.company_name,r.customer_name].filter(Boolean).join(' / ') || <span className="empty-dot">●</span>}</td>
                    <td>{r.record_type ? B(r.record_type==='as_repair'?'#E6F1FB':'#E1F5EE',r.record_type==='as_repair'?'#0C447C':'#085041',dbToRecordType(r.record_type)) : <span className="empty-dot">●</span>}</td>
                    <td>{r.model ? B('#E6F1FB','#0C447C',r.model) : <span className="empty-dot">●</span>}</td>
                    <td style={{maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.repair_result || <span className="empty-dot">●</span>}</td>
                    <td style={{textAlign:'right',color:'#185FA5',fontWeight:700}}>{r.repair_cost ? r.repair_cost.toLocaleString('ko-KR') : <span className="empty-dot">●</span>}</td>
                    <td>{r.payment_status ? B(r.payment_status==='완료'?'#E1F5EE':r.payment_status==='무상'?'#F4F6FA':'#FAEEDA',r.payment_status==='완료'?'#085041':r.payment_status==='무상'?'#5A6070':'#412402',r.payment_status) : <span className="empty-dot">●</span>}</td>
                    <td>{r.invoice_type ? B(r.invoice_type.includes('계산서')?'#E6F1FB':'#F4F6FA',r.invoice_type.includes('계산서')?'#0C447C':'#5A6070',r.invoice_type==='없음(일반소매)'?'일반':r.invoice_type.includes('계산서')?'계산서':r.invoice_type) : <span className="empty-dot">●</span>}</td>
                  </tr>
                ))}
                {sRecs.length === 0 && <tr><td colSpan={8} className="empty">정산 내역이 없습니다</td></tr>}
                {sRecs.length > 0 && <tr style={{background:'#F4F6FA',fontWeight:700}}><td colSpan={5} style={{textAlign:'right',fontSize:13}}>합계</td><td style={{textAlign:'right',color:'#185FA5',fontSize:16,fontWeight:700}}>{totalRev.toLocaleString('ko-KR')}</td><td colSpan={2}/></tr>}
              </tbody></table>
            </div>
          </div>
        </>
      )}

      {subTab === 'system' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,alignItems:'start'}}>
          <div style={{background:'#fff',border:'1px solid #DDE1EB',borderRadius:8,padding:20,marginBottom:16}}>
            <div style={{fontSize:15,fontWeight:600,marginBottom:12}}>📱 문자 알림 템플릿</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:12}}>
              {VARS.map(v => <button key={v} style={{background:'#E6F1FB',color:'#0C447C',border:'none',borderRadius:4,padding:'3px 8px',fontSize:10,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}} onClick={() => insertVar(v)}>{v}</button>)}
            </div>
            <div style={{marginBottom:12}}>
              <label className="label">입고 알림</label>
              <textarea ref={intakeRef} className="input" style={{height:'auto',minHeight:60,resize:'vertical',padding:10}} value={smsIntake} onChange={e => setSmsIntake(e.target.value)} onFocus={() => setLastFocusedTpl('intake')} />
            </div>
            <div style={{marginBottom:12}}>
              <label className="label">출고 알림</label>
              <textarea ref={releaseRef} className="input" style={{height:'auto',minHeight:60,resize:'vertical',padding:10}} value={smsRelease} onChange={e => setSmsRelease(e.target.value)} onFocus={() => setLastFocusedTpl('release')} />
            </div>
            <button className="btn-primary" style={{fontSize:12}} onClick={() => { save('sms_template_intake',smsIntake); save('sms_template_release',smsRelease); alert('저장 완료'); }}>템플릿 저장</button>
          </div>

          <div style={{background:'#fff',border:'1px solid #DDE1EB',borderRadius:8,padding:20,marginBottom:16}}>
            <div style={{fontSize:15,fontWeight:600,marginBottom:12}}>📡 SMS 연동 (httpSMS)</div>
            <div style={{marginBottom:12}}><span style={{fontSize:12,color:apiKey?'#1D9E75':'#9BA3B2'}}>● {apiKey?'연결됨':'미설정'}</span></div>
            <div className="form-grid">
              <div className="form-field"><label className="label">API 키</label><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} className="input" placeholder="httpSMS API Key" /></div>
              <div className="form-field"><label className="label">발신 번호</label><input value={apiPhone} onChange={e => setApiPhone(e.target.value)} className="input" placeholder="010-0000-0000" /></div>
            </div>
            <div style={{display:'flex',gap:8,marginTop:8}}>
              <button className="btn-primary" style={{fontSize:12}} onClick={async () => { await save('httpsms_api_key',apiKey); await save('httpsms_phone',apiPhone); alert('저장 완료'); }}>SMS 설정 저장</button>
              <button className="btn-outline-secondary" style={{fontSize:12}} onClick={async () => {
                if (!apiKey || !apiPhone) { alert('API 키와 발신번호를 먼저 저장하세요'); return; }
                try {
                  const res = await fetch('/api/sms/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to: apiPhone, content: 'AS Manager 테스트 문자입니다' }) });
                  const result = await res.json();
                  if (result.error) alert('❌ 발송 실패: ' + result.error); else alert('✅ 테스트 문자 발송 성공!');
                } catch(e) { alert('❌ 발송 실패: '+e.message); }
              }}>테스트 문자 발송</button>
            </div>
          </div>

          <div style={{background:'#fff',border:'1px solid #DDE1EB',borderRadius:8,padding:20,marginBottom:16}}>
            <div style={{fontSize:15,fontWeight:600,marginBottom:12}}>👤 처리자 관리</div>
            {techs.map(t => (
              <div key={t.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:'1px solid #F0F2F7'}}>
                {editTech === t.id ? (
                  <><input className="input" style={{flex:1,height:32}} defaultValue={t.name} id={`tech-${t.id}`} />
                  <button className="btn-primary" style={{fontSize:11,padding:'4px 10px'}} onClick={async () => { const v=document.getElementById(`tech-${t.id}`).value; await supabase.from('technicians').update({name:v}).eq('id',t.id); setTechs(p=>p.map(x=>x.id===t.id?{...x,name:v}:x)); setEditTech(null); }}>저장</button>
                  <button className="btn-secondary" style={{fontSize:11,padding:'4px 10px'}} onClick={() => setEditTech(null)}>취소</button></>
                ) : (
                  <><span style={{flex:1,fontSize:13}}>{t.name}</span>
                  <button className="btn-text-edit" style={{fontSize:11}} onClick={() => setEditTech(t.id)}>수정</button>
                  <button className="btn-text-danger" style={{fontSize:11}} onClick={async () => { if(!confirm(`${t.name}을(를) 삭제?`)) return; await supabase.from('technicians').delete().eq('id',t.id); setTechs(p=>p.filter(x=>x.id!==t.id)); }}>삭제</button></>
                )}
              </div>
            ))}
            <div style={{display:'flex',gap:8,marginTop:8}}>
              <input className="input" style={{flex:1,height:32}} value={newTechName} onChange={e => setNewTechName(e.target.value)} placeholder="새 처리자 이름" onKeyDown={e => {if(e.key==='Enter') e.preventDefault();}} />
              <button className="btn-primary" style={{fontSize:11,padding:'4px 12px'}} onClick={async () => { if(!newTechName.trim()) return; const {data}=await supabase.from('technicians').insert({name:newTechName.trim()}).select(); if(data) setTechs(p=>[...p,...data]); setNewTechName(''); }}>추가</button>
            </div>
          </div>

          <div style={{background:'#fff',border:'1px solid #DDE1EB',borderRadius:8,padding:20,marginBottom:16}}>
            <div style={{fontSize:15,fontWeight:600,marginBottom:12}}>🛡️ 보증 기간 설정</div>
            <div className="form-grid">
              <div className="form-field"><label className="label">새 제품 구매 시</label><div style={{display:'flex',alignItems:'center',gap:6}}><input value={warrantyNew} onChange={e => setWarrantyNew(e.target.value.replace(/\D/g,''))} className="input" style={{width:80,textAlign:'center'}} /><span style={{fontSize:13,color:'#5A6070'}}>개월</span></div></div>
              <div className="form-field"><label className="label">AS 후 동일 부속</label><div style={{display:'flex',alignItems:'center',gap:6}}><input value={warrantyRepair} onChange={e => setWarrantyRepair(e.target.value.replace(/\D/g,''))} className="input" style={{width:80,textAlign:'center'}} /><span style={{fontSize:13,color:'#5A6070'}}>개월</span></div></div>
            </div>
            <button className="btn-primary" style={{fontSize:12,marginTop:8}} onClick={() => { save('warranty_new_months',parseInt(warrantyNew)||12); save('warranty_repair_months',parseInt(warrantyRepair)||6); alert('저장 완료'); }}>보증 설정 저장</button>
          </div>

          <div style={{background:'#fff',border:'1px solid #DDE1EB',borderRadius:8,padding:20,marginBottom:16}}>
            <div style={{fontSize:15,fontWeight:600,marginBottom:12}}>🔐 관리자 비밀번호 변경</div>
            <div style={{maxWidth:300}}>
              <div className="form-field"><label className="label">현재 비밀번호</label><input type="password" maxLength={4} value={curPw} onChange={e => setCurPw(e.target.value.replace(/\D/g,''))} className="input" placeholder="4자리" /></div>
              <div className="form-field"><label className="label">새 비밀번호</label><input type="password" maxLength={4} value={newPw} onChange={e => setNewPw(e.target.value.replace(/\D/g,''))} className="input" placeholder="4자리" /></div>
              <div className="form-field"><label className="label">새 비밀번호 확인</label><input type="password" maxLength={4} value={newPwC} onChange={e => setNewPwC(e.target.value.replace(/\D/g,''))} className="input" placeholder="4자리" /></div>
            </div>
            <button className="btn-primary" style={{fontSize:12,marginTop:8}} onClick={() => {
              if(curPw!==getAdminPw()){alert('현재 비밀번호가 틀립니다');return;}
              if(newPw.length!==4){alert('4자리 필요');return;} if(newPw!==newPwC){alert('불일치');return;}
              save('admin_password',newPw); setStg(p=>({...p,admin_password:newPw}));
              setCurPw('');setNewPw('');setNewPwC(''); alert('변경 완료');
            }}>비밀번호 변경</button>
          </div>
        </div>
      )}
    </div>
  );
}


/* ═══ SMS POPUP ═══ */
function SMSPopup({ onClose, onUnreadChange }) {
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState(null); // phone
  const [messages, setMessages] = useState([]);
  const [msgInput, setMsgInput] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const chatRef = useRef(null);

  // 고객 목록 로드
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('sms_messages').select('*').order('sent_at', { ascending: false });
      if (!data) return;
      const grouped = {};
      data.forEach(m => {
        if (!m.phone) return;
        if (!grouped[m.phone]) grouped[m.phone] = { phone: m.phone, name: '', messages: [], unread: 0, latest: null, latestText: '' };
        grouped[m.phone].messages.push(m);
        if (!grouped[m.phone].latest || m.sent_at > grouped[m.phone].latest) { grouped[m.phone].latest = m.sent_at; grouped[m.phone].latestText = m.content; }
        if (m.direction === 'incoming' && !m.read) grouped[m.phone].unread++;
      });
      // 고객명 매칭 (as_records에서)
      const { data: asData } = await supabase.from('as_records').select('customer_name,customer_phone').not('customer_phone', 'is', null);
      const nameMap = {};
      (asData||[]).forEach(r => { if (r.customer_phone && r.customer_name) nameMap[r.customer_phone] = r.customer_name; });
      Object.values(grouped).forEach(c => { c.name = nameMap[c.phone] || c.phone; });
      const list = Object.values(grouped).sort((a,b) => (b.latest||'') > (a.latest||'') ? 1 : -1);
      setCustomers(list);
    };
    load();
  }, []);

  // 메시지 로드 + 읽음 처리
  useEffect(() => {
    if (!selected) return;
    const load = async () => {
      const { data } = await supabase.from('sms_messages').select('*').eq('phone', selected).order('sent_at', { ascending: true });
      if (data) setMessages(data);
      // 읽음 처리
      await supabase.from('sms_messages').update({ read: true }).eq('phone', selected).eq('direction', 'incoming').eq('read', false);
      setCustomers(prev => prev.map(c => c.phone === selected ? { ...c, unread: 0 } : c));
      // 전체 카운트 업데이트
      const { count } = await supabase.from('sms_messages').select('*', { count: 'exact', head: true }).eq('direction', 'incoming').eq('read', false);
      onUnreadChange(count || 0);
    };
    load();
  }, [selected, onUnreadChange]);

  useEffect(() => { setTimeout(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, 50); }, [messages]);

  useEffect(() => { const esc = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, [onClose]);

  const handleSend = async () => {
    if (!msgInput.trim() || !selected) return;
    try {
      const res = await fetch('/api/sms/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to: selected, content: msgInput.trim() }) });
      const result = await res.json();
      if (result.error) { alert('발송 실패: ' + result.error); return; }
    } catch (e) { alert('발송 실패: ' + e.message); return; }
    const msg = { phone: selected, content: msgInput.trim(), direction: 'outgoing', sent_at: new Date().toISOString(), read: true };
    const { data } = await supabase.from('sms_messages').insert(msg).select();
    if (data) setMessages(prev => [...prev, ...data]);
    setMsgInput('');
    setCustomers(prev => prev.map(c => c.phone === selected ? { ...c, latest: new Date().toISOString(), latestText: msgInput.trim() } : c));
  };

  const timeAgo = (t) => {
    if (!t) return '';
    const diff = (Date.now() - new Date(t).getTime()) / 1000;
    if (diff < 60) return '방금';
    if (diff < 3600) return Math.floor(diff/60) + '분 전';
    if (diff < 86400) return Math.floor(diff/3600) + '시간 전';
    if (diff < 172800) return '어제';
    return new Date(t).toLocaleDateString('ko-KR', { month:'numeric', day:'numeric' });
  };

  const filtered = searchQ ? customers.filter(c => c.name?.includes(searchQ) || c.phone?.includes(searchQ)) : customers;
  const selCustomer = customers.find(c => c.phone === selected);

  // 날짜 그룹핑
  const groupedMsgs = [];
  let lastDate = '';
  messages.forEach(m => {
    const d = new Date(m.sent_at).toLocaleDateString('ko-KR');
    if (d !== lastDate) { groupedMsgs.push({ type: 'date', label: d }); lastDate = d; }
    groupedMsgs.push({ type: 'msg', data: m });
  });

  const COLORS = ['#185FA5','#1D9E75','#EF9F27','#534AB7','#CC2222','#5A6070'];

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}} onClick={onClose}>
      <div style={{width:700,height:'80vh',background:'#fff',borderRadius:12,overflow:'hidden',display:'flex',boxShadow:'0 8px 32px rgba(0,0,0,0.18)'}} onClick={e => e.stopPropagation()}>
        {/* 좌측: 고객 목록 */}
        <div style={{width:280,flexShrink:0,display:'flex',flexDirection:'column',borderRight:'1px solid #EAECF2'}}>
          <div style={{background:'#185FA5',padding:'14px 16px'}}>
            <div style={{fontSize:16,fontWeight:500,color:'#fff'}}>문자함</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,0.6)'}}>{customers.reduce((s,c) => s + c.unread, 0)}건 새 문자</div>
          </div>
          <div style={{padding:8}}><input className="input" style={{height:34,fontSize:13,borderRadius:8}} placeholder="고객명, 연락처 검색..." value={searchQ} onChange={e => setSearchQ(e.target.value)} /></div>
          <div style={{flex:1,overflowY:'auto'}}>
            {filtered.map((c, i) => (
              <div key={c.phone} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',borderBottom:'0.5px solid #F0F2F7',cursor:'pointer',background: selected === c.phone ? '#E6F1FB' : (c.unread > 0 ? '#F4F8FD' : 'transparent')}} onClick={() => setSelected(c.phone)}>
                <div style={{width:40,height:40,borderRadius:'50%',background:COLORS[i % COLORS.length],display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:15,fontWeight:600,flexShrink:0}}>{(c.name||'?')[0]}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:c.unread > 0 ? 600 : 400,color:c.unread > 0 ? '#1A1D23' : '#5A6070'}}>{c.name}</div>
                  <div style={{fontSize:12,color:'#5A6070',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.latestText}</div>
                </div>
                <div style={{flexShrink:0,textAlign:'right'}}>
                  <div style={{fontSize:11,color:'#9BA3B2'}}>{timeAgo(c.latest)}</div>
                  {c.unread > 0 && <div style={{background:'#E24B4A',color:'#fff',fontSize:10,fontWeight:700,minWidth:18,height:18,borderRadius:9,display:'inline-flex',alignItems:'center',justifyContent:'center',marginTop:2}}>{c.unread}</div>}
                </div>
              </div>
            ))}
            {filtered.length === 0 && <div style={{padding:20,textAlign:'center',color:'#9BA3B2',fontSize:13}}>문자 내역이 없습니다</div>}
          </div>
        </div>
        {/* 우측: 채팅 */}
        <div style={{flex:1,display:'flex',flexDirection:'column'}}>
          {!selected ? (
            <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'#9BA3B2',fontSize:15}}>고객을 선택해주세요</div>
          ) : (
            <>
              <div style={{background:'#185FA5',padding:'12px 16px',display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:36,height:36,borderRadius:'50%',background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:14,fontWeight:600}}>{(selCustomer?.name||'?')[0]}</div>
                <div><div style={{fontSize:15,fontWeight:500,color:'#fff'}}>{selCustomer?.name}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.65)'}}>{selected}</div></div>
                <button style={{marginLeft:'auto',background:'none',border:'none',color:'rgba(255,255,255,0.4)',fontSize:18,cursor:'pointer'}} onClick={onClose}>✕</button>
              </div>
              <div ref={chatRef} style={{flex:1,overflowY:'auto',background:'#F4F6FA',padding:'12px 14px'}}>
                {groupedMsgs.map((item, i) => {
                  if (item.type === 'date') return <div key={`d-${i}`} style={{textAlign:'center',margin:'12px 0 8px'}}><span style={{background:'#E6F1FB',color:'#5A6070',fontSize:11,padding:'3px 12px',borderRadius:10}}>{item.label}</span></div>;
                  const m = item.data; const isOut = m.direction === 'outgoing';
                  return (
                    <div key={m.id} style={{display:'flex',justifyContent:isOut?'flex-end':'flex-start',marginBottom:6}}>
                      <div style={{maxWidth:'75%'}}>
                        <div style={{padding:'10px 14px',borderRadius: isOut ? '14px 14px 4px 14px' : '14px 14px 14px 4px', background:isOut?'#185FA5':'#fff',color:isOut?'#fff':'#1A1D23',fontSize:14,lineHeight:1.5,border:isOut?'none':'0.5px solid #DDE1EB'}}>{m.content}</div>
                        <div style={{fontSize:11,color:'#9BA3B2',marginTop:2,textAlign:isOut?'right':'left'}}>{new Date(m.sent_at).toLocaleString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</div>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && <div style={{textAlign:'center',color:'#9BA3B2',fontSize:13,padding:'40px 0'}}>문자 내역이 없습니다</div>}
              </div>
              <div style={{borderTop:'0.5px solid #DDE1EB',padding:'10px 12px',background:'#fff',display:'flex',gap:8,alignItems:'center'}}>
                <input value={msgInput} onChange={e => setMsgInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} placeholder="메시지 입력..." style={{flex:1,padding:'10px 14px',borderRadius:20,border:'1px solid #DDE1EB',fontSize:14,fontFamily:'inherit',outline:'none'}} />
                <button onClick={handleSend} style={{width:38,height:38,borderRadius:'50%',background:'#185FA5',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M14 2L7 9M14 2L9.5 14L7 9M14 2L2 6.5L7 9" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
