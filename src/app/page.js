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
  const [tab, setTab] = useState('as');
  const [asRecords, setAsRecords] = useState([]);
  const [shipRecords, setShipRecords] = useState([]);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);

  /* ── AS 필터 ── */
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('전체');
  const [statusFilter, setStatusFilter] = useState('전체');
  const [brandFilter, setBrandFilter] = useState('전체');
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0,7));

  /* ── 새 접수 입력 행 표시 ── */
  const [showNewRow, setShowNewRow] = useState(false);
  const [kpiFilter, setKpiFilter] = useState(null);
  const [smsPanelId, setSmsPanelId] = useState(null);
  const searchWrapRef = useRef(null);

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

  /* ── 택배/부속 기존 state ── */
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

  /* ── Data Load (월별 최적화) ── */
  const loadData = useCallback(async (month) => {
    const m = month || monthFilter;
    setLoading(true);
    const [y, mo] = m.split('-').map(Number);
    const lastDay = new Date(y, mo, 0).getDate();
    const startDate = m + '-01';
    const endDate = m + '-' + String(lastDay).padStart(2, '0');
    const [asRes, shipRes, partsRes] = await Promise.all([
      supabase.from('as_records').select('*').gte('receipt_date', startDate).lte('receipt_date', endDate).order('created_at', { ascending: false }),
      supabase.from('ship_records').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('parts').select('*').order('code'),
    ]);
    if (asRes.data) setAsRecords(asRes.data);
    if (shipRes.data) setShipRecords(shipRes.data);
    if (partsRes.data) setParts(partsRes.data);
    setLoading(false);
  }, [monthFilter]);

  useEffect(() => { if (user) loadData(monthFilter); }, [user, monthFilter, loadData]);

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
    await supabase.from('as_records').update({ [field]: value }).eq('id', id);
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
    await supabase.from('ship_records').insert({
      ship_date: d.shipDate, carrier: d.carrier, tracking_no: d.trackingNo,
      sender_name: d.senderName, receiver_name: d.receiverName, receiver_phone: d.receiverPhone,
      receiver_address: d.receiverAddress, contents: d.contents, memo: d.memo,
    });
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

  /* ── AS 필터링 ── */
  const KPI_STATUS_MAP = { reception: ['접수','진단중'], repairing: ['수리중','부품대기'], done: ['완료'], norepair: ['수리X','폐기'] };
  const filteredAS = asRecords.filter(r => {
    const ms = !search || [r.customer_name, r.customer_phone, r.model, r.symptom, r.company_name, r.memo, r.repair_result].some(f => f?.toLowerCase().includes(search.toLowerCase()));
    const mt = typeFilter === '전체' || dbToRecordType(r.record_type) === typeFilter;
    const mst = statusFilter === '전체' || r.status === statusFilter;
    const mb = brandFilter === '전체' || r.brand === brandFilter;
    const mm = !monthFilter || r.receipt_date?.startsWith(monthFilter);
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
          {[['as','AS 일지'],['ship','택배발송'],['history','수리내역조회'],['parts','부속가격'],['settings','설정']].map(([k,v]) => (
            <button key={k} onClick={() => setTab(k)} className={`nav-tab ${tab===k?'active':''}`}>{v}</button>
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
            {/* 상단 영역: 좌측(검색+필터+요약) | 우측(KPI 세로바) */}
            <div className="as-top-area">
              <div className="as-top-left">
                {/* 필터 */}
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
                            <span style={{fontSize:10,fontWeight:600,color:'#5A6070'}}>고객 검색 결과 {customers.length}건</span>
                            <span style={{fontSize:9,color:'#9BA3B2'}}>클릭 → 수리내역</span>
                          </div>
                          {customers.slice(0, 8).map((c, i) => (
                            <div key={i} className="search-dropdown-item" onClick={() => { console.log('고객 클릭:', c.name, c.phone); setSearch(''); }}>
                              <div className="search-dropdown-avatar" style={{background: i === 0 ? '#185FA5' : '#5A6070'}}>{(c.name || '?')[0]}</div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:12,fontWeight:600,color:'#1A1D23'}}>{c.name || '-'}{c.company ? <span style={{fontSize:10,color:'#9BA3B2',marginLeft:6}}>{c.company}</span> : null}</div>
                                <div style={{fontSize:10,color:'#5A6070'}}>{c.phone || '-'}</div>
                              </div>
                              <div style={{textAlign:'right',flexShrink:0}}>
                                <div style={{fontSize:11,fontWeight:700,color:'#185FA5'}}>AS {c.count}건</div>
                                {c.latest && <div style={{fontSize:9,color:'#9BA3B2'}}>최근 {fmtDate(c.latest)}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <select className="input as-filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                    <option>전체</option>{RECORD_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <select className="input as-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                    <option>전체</option>{STATUS_LIST.map(s => <option key={s}>{s}</option>)}
                  </select>
                  <select className="input as-filter-select" value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
                    <option>전체</option>{BRANDS.map(b => <option key={b}>{b}</option>)}
                  </select>
                  <input className="input as-filter-month" type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)} />
                </div>
                {/* 페이지 요약 + 버튼 */}
                <div className="page-header" style={{marginBottom:0}}>
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
              </div>
              {/* KPI 세로바 */}
              <div className="as-kpi-sidebar">
                {[
                  { key: null, label: '전체', value: kpiTotal, bg: '#185FA5', labelColor: 'rgba(255,255,255,0.8)', valueColor: '#fff', valueFz: 18, pad: '7px 2px' },
                  { key: 'reception', label: '접수/진단', value: kpiReception, bg: '#E6F1FB', labelColor: '#5A6070', valueColor: '#185FA5', valueFz: 15, pad: '6px 2px' },
                  { key: 'repairing', label: '수리중', value: kpiRepairing, bg: '#FAEEDA', labelColor: '#5A6070', valueColor: '#EF9F27', valueFz: 15, pad: '6px 2px' },
                  { key: 'done', label: '완료', value: kpiDone, bg: '#E1F5EE', labelColor: '#5A6070', valueColor: '#1D9E75', valueFz: 15, pad: '6px 2px' },
                  { key: 'norepair', label: '수리불가', value: kpiNoRepair, bg: '#FCEBEB', labelColor: '#5A6070', valueColor: '#CC2222', valueFz: 15, pad: '6px 2px' },
                ].map(k => (
                  <div key={k.label} className="as-kpi-v-item" style={{ background: k.bg, padding: k.pad, border: kpiFilter === k.key ? `2px solid ${k.valueColor}` : '2px solid transparent' }} onClick={() => setKpiFilter(kpiFilter === k.key ? null : k.key)}>
                    <div style={{fontSize:8,fontWeight:500,color:k.labelColor,lineHeight:1.2}}>{k.label}</div>
                    <div style={{fontSize:k.valueFz,fontWeight:700,color:k.valueColor,lineHeight:1.2}}>{k.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 섹션 헤더 + 테이블 — 풀 너비 */}
            <div className="section">
              <div className="section-header">
                <span style={{fontSize:13,fontWeight:600}}>AS 일지</span>
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
                  smsPanelId={smsPanelId}
                  onOpenSms={setSmsPanelId}
                />
              </div>
            </div>
          </>
        )}

        {/* ═══ 택배발송 (기존 유지) ═══ */}
        {tab === 'ship' && (
          <>
            <div className="page-header">
              <h1 className="page-title" style={{marginBottom:0}}>택배 발송 관리</h1>
              <button onClick={() => setModal({ type:'ship-new' })} className="btn-primary">+ 새 발송</button>
            </div>
            <div className="section">
              <div className="section-header"><span>발송 목록 ({shipRecords.length}건)</span></div>
              <div className="section-body">
                {shipRecords.length === 0 ? <div className="empty">아직 발송 내역이 없습니다</div> : (
                  <div className="scroll-x"><table className="data-table"><thead><tr>
                    {['발송일','택배사','송장번호','보내는분','수령인','연락처','내용물','메모',''].map(h => <th key={h}>{h}</th>)}
                  </tr></thead><tbody>
                    {shipRecords.map(r => (
                      <tr key={r.id}>
                        <td>{r.ship_date}</td><td>{r.carrier}</td>
                        <td className="mono fw600">{r.tracking_no}</td>
                        <td>{r.sender_name || '-'}</td><td>{r.receiver_name}</td><td>{r.receiver_phone || '-'}</td>
                        <td className="ellipsis" style={{maxWidth:160}}>{r.contents}</td>
                        <td className="text-secondary ellipsis" style={{maxWidth:120}}>{r.memo || '-'}</td>
                        <td>
                          <div style={{ display:'flex', gap:8 }}>
                            <button className="btn-text-edit" onClick={() => setModal({ type:'ship-edit', data:r })}>수정</button>
                            <button className="btn-text-danger" onClick={() => deleteShip(r.id)}>삭제</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody></table></div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ═══ 수리내역조회 (신규 빈 페이지) ═══ */}
        {tab === 'history' && (
          <div style={{textAlign:'center',padding:'80px 0',color:'var(--tl-text-hint)'}}>
            <div style={{fontSize:48,marginBottom:16}}>🔍</div>
            <div style={{fontSize:18,fontWeight:600,marginBottom:8}}>수리내역 조회</div>
            <div>다음 단계에서 구현 예정입니다</div>
          </div>
        )}

        {/* ═══ 부속가격 (기존 유지) ═══ */}
        {tab === 'parts' && (
          <>
            <h1 className="page-title">부속 가격표</h1>
            <div className="filter-bar">
              <input placeholder="코드, 부품명, 규격 검색..." value={partsSearch} onChange={e => setPartsSearch(e.target.value)} className="input" style={{ flex:1, minWidth:200 }} autoComplete="off" />
              <select value={partsCatFilter} onChange={e => setPartsCatFilter(e.target.value)} className="input" style={{ width:160 }}>
                {partCats.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="section">
              <div className="section-header"><span>부품 목록 ({filteredParts.length}개)</span></div>
              <div className="section-body">
                <div className="scroll-x"><table className="data-table"><thead><tr>
                  {['코드','구분','부품명','규격/사양','공임비(원)'].map(h => <th key={h}>{h}</th>)}
                </tr></thead><tbody>
                  {filteredParts.map(p => (
                    <tr key={p.id}>
                      <td className="mono" style={{fontSize:12}}>{p.code}</td>
                      <td><span className="badge-cat">{p.category || '-'}</span></td>
                      <td className="fw600">{p.name}</td>
                      <td className="text-secondary">{p.spec || '-'}</td>
                      <td className="price">₩{fmt(p.price)}</td>
                    </tr>
                  ))}
                </tbody></table></div>
              </div>
            </div>
          </>
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

      {/* ═══ 택배 MODALS (기존 유지) ═══ */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            {(modal.type === 'ship-new' || modal.type === 'ship-edit') && (
              <ShipForm initial={modal.data} onSave={d => { modal.type === 'ship-new' ? addShip(d) : updateShip(modal.data.id, d); setModal(null); }} onClose={() => setModal(null)} />
            )}
          </div>
        </div>
      )}

      {/* ═══ SMS 모달 ═══ */}
      {smsPanelId && (() => {
        const rec = asRecords.find(r => r.id === smsPanelId);
        if (!rec) return null;
        return (
          <div className="sms-modal-overlay" onClick={() => setSmsPanelId(null)}>
            <div className="sms-modal" onClick={e => e.stopPropagation()}>
              <SMSPanel record={rec} onClose={() => setSmsPanelId(null)} />
            </div>
          </div>
        );
      })()}
    </>
  );
}


/* ═══════════════════════════════════════════════
   AS 테이블 — 인라인 편집
   ═══════════════════════════════════════════════ */
function ASTable({ records, onSaveField, onAddNew, onDelete, onReload, showNewRow, onHideNewRow, smsPanelId, onOpenSms }) {
  const [editCell, setEditCell] = useState(null); // {id, field}
  const [editValue, setEditValue] = useState('');
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
      // Realtime이 자동으로 데이터를 갱신하므로 onReload 호출 불필요
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
    invoice_type:70, company_name:160, _sms:40, customer_phone:120, model:100, symptom:180, memo:100,
    repair_result:160, technician:80, status:80, repair_cost:90,
    payment_status:70, payer:80,
    release_date:120, release_carrier:70, tracking_number:130,
  };
  const COL_GROUPS = [
    { label: '입고', bg: '#E6F1FB', color: '#0C447C', border: '#85B7EB', span: 12 },
    { label: 'AS 처리', bg: '#E1F5EE', color: '#085041', border: '#5DCAA5', span: 4 },
    { label: '입금', bg: '#FAEEDA', color: '#412402', border: '#EF9F27', span: 2 },
    { label: '출고', bg: '#EEEDFE', color: '#26215C', border: '#AFA9EC', span: 3 },
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
    { key:'_sms', label:'sms', w:36, type:'icon', isSmsHeader: true },
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
    // 보라 그룹
    { key:'release_date', label:'출고일', w:115, type:'date' },
    { key:'release_carrier', label:'택배', w:70, type:'select', opts: CARRIERS_OUT },
    { key:'tracking_number', label:'운송장번호', w:130, type:'text' },
  ];

  const renderCell = (r, col) => {
    const val = col.fromDb ? col.fromDb(r[col.key]) : r[col.key];
    const isEditing = editCell?.id === r.id && editCell?.field === col.key;

    if (isEditing) {
      if (col.type === 'select') {
        return (
          <select className="as-cell-input" value={editValue} autoFocus
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => e.key === 'Enter' && commitEdit()}
          >
            <option value=""></option>
            {col.opts.map(o => <option key={o} value={col.toDb ? col.toDb(o) : o}>{o}</option>)}
          </select>
        );
      }
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
    const empty = <span className="empty-dot" />;

    if (col.key === '_sms') {
      return <span className="sms-icon" title="문자" onClick={e => { e.stopPropagation(); onOpenSms && onOpenSms(r.id); }}><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 2.5A1.5 1.5 0 012.5 1h9A1.5 1.5 0 0113 2.5v6A1.5 1.5 0 0111.5 10H5l-3 2.5V10H2.5A1.5 1.5 0 011 8.5v-6z" stroke="#9BA3B2" strokeWidth="1.2" strokeLinejoin="round"/></svg></span>;
    }
    // 1. 구분
    if (col.key === 'record_type') {
      const label = dbToRecordType(r.record_type);
      const m = { as_repair:['#E6F1FB','#0C447C'], product_sale:['#E1F5EE','#085041'], parts_sale:['#FAEEDA','#412402'] };
      const [bg,c] = m[r.record_type] || ['#F4F6FA','#5A6070'];
      return B(bg, c, label);
    }
    // 2. 입고일 / 11. 출고일
    if (col.type === 'date') return val ? B('#E8EBF0','#3A3F4B',fmtDate(val)) : empty;
    // 3. 브랜드
    if (col.key === 'brand') {
      if (!val) return empty;
      const m = {'콜라보':['#EEEDFE','#3C3489'],'마끼다':['#FAEEDA','#412402'],'디월트':['#E1F5EE','#085041'],'프레레':['#E6F1FB','#0C447C']};
      const [bg,c] = m[val] || ['#EEEDFE','#3C3489'];
      return B(bg, c, val);
    }
    // 4. 택배(입고) / 10. 택배(출고)
    if (col.key === 'intake_carrier' || col.key === 'release_carrier') return val ? B('#E8EBF0','#3A3F4B',val) : empty;
    // 5. 계산서
    if (col.key === 'invoice_type') {
      if (!val || val === '없음(일반소매)') return val ? B('#E8EBF0','#7A8194','일반') : empty;
      if (val === '계산서(거래처)') return B('#E6F1FB','#0C447C','계산서');
      if (val === '월말') return B('#FAEEDA','#412402','월말');
      return B('#E8EBF0','#7A8194',val);
    }
    // 6. 모델명
    if (col.key === 'model') return val ? B('#E6F1FB','#0C447C',val) : empty;
    // 7. 처리자
    if (col.key === 'technician') return val ? B('#E6F1FB','#0C447C',val) : empty;
    // 8. AS상태
    if (col.key === 'status') {
      if (!val) return empty;
      const m = {'접수':['#E6F1FB','#0C447C'],'진단중':['#FAEEDA','#412402'],'부품대기':['#FAEEDA','#412402'],'수리중':['#FAEEDA','#412402'],'완료':['#E1F5EE','#085041'],'수리X':['#FCEBEB','#791F1F'],'폐기':['#FCEBEB','#791F1F']};
      const [bg,c] = m[val] || ['#E8EBF0','#3A3F4B'];
      return B(bg, c, val);
    }
    // 9. 입금
    if (col.key === 'payment_status') {
      if (!val) return empty;
      const m = {'완료':['#E1F5EE','#085041'],'무상':['#E8EBF0','#3A3F4B'],'대기':['#FAEEDA','#412402'],'명세서':['#FAEEDA','#412402'],'카드':['#E6F1FB','#0C447C'],'방문결제':['#E6F1FB','#0C447C']};
      const [bg,c] = m[val] || ['#FAEEDA','#412402'];
      return B(bg, c, val);
    }
    // 12. 운송장번호
    if (col.key === 'tracking_number') return val ? B('#E8EBF0','#3A3F4B',val,{fontFamily:'monospace',fontSize:10}) : empty;
    // AS비용
    if (col.key === 'repair_cost') return val ? <span style={{color:'#185FA5',fontWeight:700}}>{fmt(val)}</span> : empty;
    // 거래처/성함 — 파란 링크 스타일
    if (col.key === 'company_name') {
      const p = [r.company_name, r.customer_name].filter(Boolean);
      if (p.length === 0) return empty;
      return <span className="customer-link" onClick={e => { e.stopPropagation(); console.log('고객 클릭:', r.customer_name, r.customer_phone); }}>{p.join(' / ')}</span>;
    }
    // 연락처
    if (col.key === 'customer_phone') return val ? <span style={{fontSize:12,color:'#5A6070'}}>{val}</span> : empty;
    return val || empty;
  };

  const renderNewCell = (col) => {
    if (col.key === '_sms') return null;
    const val = col.key === 'company_name' ? newRow.company_name : newRow[col.key] ?? '';
    if (col.type === 'select') {
      return (
        <select className="as-cell-input" value={col.toDb ? col.toDb(val) : val} onChange={e => {
          const v = col.fromDb ? col.fromDb(e.target.value) : e.target.value;
          setNewRow(p => ({ ...p, [col.key]: col.toDb ? col.toDb(v || e.target.value) : e.target.value }));
        }}>
          <option value=""></option>
          {col.opts.map(o => <option key={o} value={col.toDb ? col.toDb(o) : o}>{o}</option>)}
        </select>
      );
    }
    if (col.type === 'date') {
      return <input type="date" className="as-cell-input" value={val} onChange={e => setNewRow(p => ({...p,[col.key]:e.target.value}))} />;
    }
    return (
      <input className="as-cell-input" value={val} placeholder={col.label}
        onChange={e => setNewRow(p => ({...p,[col.key]:e.target.value}))}
        onKeyDown={e => { if (e.key === 'Enter') handleNewRowSave(); }}
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
              {c.isSmsHeader ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{verticalAlign:'middle'}}><path d="M1 2.5A1.5 1.5 0 012.5 1h9A1.5 1.5 0 0113 2.5v6A1.5 1.5 0 0111.5 10H5l-3 2.5V10H2.5A1.5 1.5 0 011 8.5v-6z" stroke="#9BA3B2" strokeWidth="1.2" strokeLinejoin="round"/></svg>
              ) : c.label}
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
              <td key={c.key} style={c.groupEnd && c.groupBorderColorBody ? {borderRight:`2px solid ${c.groupBorderColorBody}`} : undefined}>
                {c.key === '_sms' ? (
                  <div style={{display:'flex',gap:4}}>
                    <button className="btn-primary" style={{fontSize:11,padding:'4px 8px',whiteSpace:'nowrap'}} onClick={handleNewRowSave}>저장</button>
                    <button className="btn-secondary" style={{fontSize:11,padding:'4px 8px',whiteSpace:'nowrap'}} onClick={onHideNewRow}>취소</button>
                  </div>
                ) : renderNewCell(c)}
              </td>
            ))}
          </tr>
        )}
        {/* 데이터 행 */}
        {records.map((r, rowIdx) => (
          <tr key={r.id} className="as-data-row" style={smsPanelId === r.id ? {background:'#E6F1FB'} : (rowIdx % 2 === 1 ? {background:'#FAFBFC'} : undefined)}>
            {COLS.map(c => (
                <td key={c.key} style={c.groupEnd && c.groupBorderColorBody ? {borderRight:`2px solid ${c.groupBorderColorBody}`} : undefined}
                  onClick={() => {
                    if (c.key === '_sms') return;
                    const val = c.key === 'company_name' ? (r.company_name || '') :
                      c.fromDb ? (c.fromDb(r[c.key]) || '') :
                      (c.key === 'repair_cost' ? (r[c.key]?.toString() || '') : (r[c.key] || ''));
                    startEdit(r.id, c.key, c.toDb ? c.toDb(val) : val);
                  }}
                >
                  {renderCell(r, c)}
                </td>
            ))}
          </tr>
        ))}
        {records.length === 0 && (
          <tr><td colSpan={COLS.length} className="empty">조건에 맞는 AS 건이 없습니다</td></tr>
        )}
      </tbody>
    </table>
  );
}


/* ═══ SHIP FORM (기존 유지) ═══ */
function ShipForm({ initial, onSave, onClose }) {
  const i = initial || {};
  const [f, setF] = useState({
    shipDate: i.ship_date || today(), carrier: i.carrier || 'CJ대한통운', trackingNo: i.tracking_no || '',
    senderName: i.sender_name || '', receiverName: i.receiver_name || '', receiverPhone: i.receiver_phone || '',
    receiverAddress: i.receiver_address || '', contents: i.contents || '', memo: i.memo || '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const CARRIERS = ["CJ대한통운","한진택배","롯데택배","로젠택배","우체국택배","경동택배","대신택배","대신화물","기타"];

  return (
    <>
      <div className="modal-header"><h2>{initial ? '발송 수정' : '새 택배 발송'}</h2><button onClick={onClose} className="modal-close">✕</button></div>
      <div className="modal-body">
        <div className="form-grid">
          <div className="form-field"><label className="label">발송일</label><input type="date" value={f.shipDate} onChange={e => set('shipDate', e.target.value)} className="input" /></div>
          <div className="form-field"><label className="label">택배사</label><select value={f.carrier} onChange={e => set('carrier', e.target.value)} className="input">{CARRIERS.map(c => <option key={c}>{c}</option>)}</select></div>
        </div>
        <div className="form-field"><label className="label">송장번호</label><input value={f.trackingNo} onChange={e => set('trackingNo', e.target.value)} placeholder="송장번호 입력" className="input mono" /></div>
        <hr className="form-divider" />
        <div className="form-field"><label className="label">보내는분</label><input value={f.senderName} onChange={e => set('senderName', e.target.value)} placeholder="보내는분" className="input" /></div>
        <div className="form-grid">
          <div className="form-field"><label className="label">수령인</label><input value={f.receiverName} onChange={e => set('receiverName', e.target.value)} placeholder="받는분 이름" className="input" /></div>
          <div className="form-field"><label className="label">수령인 연락처</label><input value={f.receiverPhone} onChange={e => set('receiverPhone', e.target.value)} placeholder="010-0000-0000" className="input" /></div>
        </div>
        <div className="form-field"><label className="label">수령인 주소</label><input value={f.receiverAddress} onChange={e => set('receiverAddress', e.target.value)} placeholder="주소" className="input" /></div>
        <div className="form-field"><label className="label">내용물</label><input value={f.contents} onChange={e => set('contents', e.target.value)} placeholder="메인보드, 모터 등" className="input" /></div>
        <div className="form-field"><label className="label">메모</label><input value={f.memo} onChange={e => set('memo', e.target.value)} placeholder="메모" className="input" /></div>
      </div>
      <div className="modal-footer"><button onClick={onClose} className="btn-secondary">취소</button><button onClick={() => onSave(f)} className="btn-primary">저장</button></div>
    </>
  );
}


/* ═══ SMS PANEL ═══ */
function SMSPanel({ record, onClose }) {
  const r = record;
  const [msgInput, setMsgInput] = useState('');
  const [smsMessages, setSmsMessages] = useState([]);

  useEffect(() => {
    if (!r.customer_phone) return;
    supabase.from('sms_messages').select('*')
      .eq('phone', r.customer_phone)
      .order('sent_at', { ascending: true })
      .then(({ data }) => { if (data) setSmsMessages(data); });
  }, [r.customer_phone, r.id]);

  const STATUS_STEPS = ['접수', '진단', '수리중', '출고', '완료'];
  const statusIndex = (() => {
    const map = { '접수': 0, '진단중': 1, '부품대기': 2, '수리중': 2, '완료': 4, '수리X': -1, '폐기': -1 };
    const idx = map[r.status];
    if (idx === undefined) return 0;
    if (r.release_date && idx < 3) return 3;
    return idx;
  })();

  const handleSend = () => {
    if (!msgInput.trim()) return;
    alert('SMS 연동이 필요합니다.\n설정 → SMS 연동에서 httpSMS API 키를 입력해주세요.');
    setMsgInput('');
  };

  return (
    <div className="sms-panel">
      {/* 헤더 */}
      <div className="sms-panel-header">
        <div>
          <div style={{fontSize:16,fontWeight:700}}>{r.customer_name || r.company_name || '고객'}</div>
          <div style={{fontSize:13,opacity:0.85}}>{r.customer_phone || '연락처 없음'}</div>
        </div>
        <button className="sms-panel-close" onClick={onClose}>✕</button>
      </div>

      {/* AS 정보 요약 */}
      <div className="sms-section">
        <div className="sms-info-grid">
          <div><span className="sms-info-label">입고일</span><span className="sms-info-value">{fmtDate(r.receipt_date)}</span></div>
          <div><span className="sms-info-label">브랜드</span><span className="sms-info-value">{r.brand || '-'}</span></div>
          <div><span className="sms-info-label">모델명</span><span className="sms-info-value">{r.model || '-'}</span></div>
          <div><span className="sms-info-label">계산서</span><span className="sms-info-value">{r.invoice_type || '-'}</span></div>
          <div><span className="sms-info-label">증상</span><span className="sms-info-value">{r.symptom || '-'}</span></div>
          <div><span className="sms-info-label">입금상태</span><span className="sms-info-value">{r.payment_status || '-'}</span></div>
        </div>
      </div>

      {/* 진행 상황 바 */}
      <div className="sms-section">
        <div className="sms-progress-bar">
          {STATUS_STEPS.map((step, i) => {
            let color = '#EAECF2';
            let textColor = '#9BA3B2';
            if (statusIndex >= 0) {
              if (i < statusIndex) { color = '#1D9E75'; textColor = '#1D9E75'; }
              else if (i === statusIndex) { color = '#EF9F27'; textColor = '#EF9F27'; }
            }
            return (
              <div key={step} className="sms-progress-step">
                <div className="sms-progress-dot" style={{background:color}} />
                {i < STATUS_STEPS.length - 1 && <div className="sms-progress-line" style={{background: i < statusIndex ? '#1D9E75' : '#EAECF2'}} />}
                <div className="sms-progress-label" style={{color:textColor}}>{step}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 교체 부품 / 비용 */}
      <div className="sms-section">
        <div className="sms-info-label" style={{marginBottom:4}}>처리결과</div>
        <div style={{fontSize:13,marginBottom:8}}>{r.repair_result || '-'}</div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span className="sms-info-label">AS 비용</span>
          <span style={{fontSize:16,fontWeight:700,color:'#185FA5'}}>{r.repair_cost ? fmt(r.repair_cost) + '원' : '0원'}</span>
        </div>
      </div>

      {/* 문자 내역 */}
      <div className="sms-chat-area">
        {smsMessages.length === 0 ? (
          <div className="sms-chat-empty">문자 내역이 없습니다</div>
        ) : (
          smsMessages.map(msg => (
            <div key={msg.id} className={`sms-bubble ${msg.direction === 'outgoing' ? 'sms-bubble-out' : 'sms-bubble-in'}`}>
              <div className="sms-bubble-text">{msg.content}</div>
              <div className="sms-bubble-time">{new Date(msg.sent_at).toLocaleString('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
            </div>
          ))
        )}
      </div>

      {/* 문자 입력창 */}
      <div className="sms-input-bar">
        <input className="input" value={msgInput} onChange={e => setMsgInput(e.target.value)} placeholder="문자 입력..." onKeyDown={e => e.key === 'Enter' && handleSend()} style={{flex:1}} />
        <button className="btn-primary" onClick={handleSend} style={{whiteSpace:'nowrap'}}>전송</button>
      </div>
    </div>
  );
}
