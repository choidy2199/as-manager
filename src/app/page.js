'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

const MODELS = ["DC660","DC661","DC662","DC886","DC990X1","DC990K","DC990S","DC991","DC992","DC993","DC995","DC998","KOL-30AD","KOL-A20","DA25","DAC990X1","DW30AD","FVC-20C","기타"];
const ERROR_CODES = ["없음","E01","E02","E04","E08","E16","기타"];
const STATUS_LIST = ["접수","진단중","부품대기","수리중","수리완료","발송완료","완료"];
const CARRIERS = ["CJ대한통운","한진택배","롯데택배","로젠택배","우체국택배","경동택배","기타"];

const fmt = (n) => n?.toLocaleString('ko-KR') ?? '0';
const today = () => new Date().toISOString().split('T')[0];
const statusBadge = (s) => {
  const m = { '접수':'badge-blue','진단중':'badge-amber','부품대기':'badge-amber','수리중':'badge-blue','수리완료':'badge-green','발송완료':'badge-green','완료':'badge-gray' };
  return m[s] || 'badge-gray';
};

export default function Home() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState('dashboard');
  const [asRecords, setAsRecords] = useState([]);
  const [shipRecords, setShipRecords] = useState([]);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('전체');
  const [partsSearch, setPartsSearch] = useState('');
  const [partsCatFilter, setPartsCatFilter] = useState('전체');
  const [detail, setDetail] = useState(null);

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

  /* ── Data Load ── */
  const loadData = useCallback(async () => {
    setLoading(true);
    const [asRes, shipRes, partsRes] = await Promise.all([
      supabase.from('as_records').select('*').order('created_at', { ascending: false }),
      supabase.from('ship_records').select('*').order('created_at', { ascending: false }),
      supabase.from('parts').select('*').order('code'),
    ]);
    if (asRes.data) setAsRecords(asRes.data);
    if (shipRes.data) setShipRecords(shipRes.data);
    if (partsRes.data) setParts(partsRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { if (user) loadData(); }, [user, loadData]);

  /* ── Realtime subscription ── */
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'as_records' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ship_records' }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, loadData]);

  /* ── AS CRUD ── */
  const addAS = async (d) => {
    await supabase.from('as_records').insert({
      receipt_date: d.receiptDate, model: d.model, error_code: d.errorCode, status: d.status,
      customer_name: d.customerName, customer_phone: d.customerPhone, customer_address: d.customerAddress,
      symptom: d.symptom, diagnosis: d.diagnosis, parts_used: d.partsUsed,
      parts_used_codes: d.partsUsedCodes, run_hours: d.runHours ? parseInt(d.runHours) : null, memo: d.memo,
    });
    loadData();
  };
  const updateAS = async (id, d) => {
    await supabase.from('as_records').update({
      receipt_date: d.receiptDate, model: d.model, error_code: d.errorCode, status: d.status,
      customer_name: d.customerName, customer_phone: d.customerPhone, customer_address: d.customerAddress,
      symptom: d.symptom, diagnosis: d.diagnosis, parts_used: d.partsUsed,
      parts_used_codes: d.partsUsedCodes, run_hours: d.runHours ? parseInt(d.runHours) : null, memo: d.memo,
    }).eq('id', id);
    loadData();
  };
  const deleteAS = async (id) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await supabase.from('as_records').delete().eq('id', id);
    if (detail === id) setDetail(null);
    loadData();
  };

  /* ── Ship CRUD ── */
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

  /* ── Logout ── */
  const logout = async () => { await supabase.auth.signOut(); setUser(null); };

  /* ── Backup ── */
  const backup = () => {
    const blob = new Blob([JSON.stringify({ asRecords, shipRecords, parts, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `AS-Manager-backup-${today()}.json`; a.click();
  };

  /* ── Stats ── */
  const ym = new Date().toISOString().slice(0, 7);
  const monthAS = asRecords.filter(r => r.receipt_date?.startsWith(ym));
  const activeAS = asRecords.filter(r => r.status && !['완료'].includes(r.status));
  const doneMonth = monthAS.filter(r => ['완료','수리완료','발송완료'].includes(r.status));

  /* ── Filters ── */
  const filteredAS = asRecords.filter(r => {
    const ms = !search || [r.model,r.error_code,r.customer_name,r.customer_phone,r.symptom,r.diagnosis,r.parts_used,r.memo].some(f => f?.toLowerCase().includes(search.toLowerCase()));
    const mst = statusFilter === '전체' || r.status === statusFilter;
    return ms && mst;
  });
  const filteredParts = parts.filter(p => {
    const ms = !partsSearch || [p.code,p.name,p.spec,p.category].some(f => f?.toLowerCase().includes(partsSearch.toLowerCase()));
    const mc = partsCatFilter === '전체' || (p.category && p.category.includes(partsCatFilter));
    return ms && mc;
  });
  const partCats = ['전체', ...new Set(parts.map(p => p.category).filter(Boolean))];

  /* ── Auth gate ── */
  if (authLoading) return <div className="loading"><span>로딩 중...</span></div>;
  if (!user) {
    // redirect to login
    if (typeof window !== 'undefined') window.location.href = '/login';
    return <div className="loading"><span>로그인 페이지로 이동 중...</span></div>;
  }
  if (loading) return <div className="loading"><div style={{ textAlign:'center' }}><div style={{ fontSize:20, fontWeight:700, color:'var(--tl-primary)', marginBottom:8 }}>AS Manager</div><div>데이터 로딩 중...</div></div></div>;

  const detailRecord = detail ? asRecords.find(r => r.id === detail) : null;

  return (
    <>
      {/* ── NAV ── */}
      <nav className="top-nav">
        <div className="nav-logo">AS Manager</div>
        <div className="nav-tabs">
          {[['dashboard','대시보드'],['as','AS 일지'],['ship','택배발송'],['parts','부속가격']].map(([k,v]) => (
            <button key={k} onClick={() => { setTab(k); setDetail(null); }} className={`nav-tab ${tab===k?'active':''}`}>{v}</button>
          ))}
        </div>
        <div className="nav-actions">
          <span className="nav-user">{user.email?.split('@')[0]}</span>
          <button onClick={backup} className="btn-ghost">백업</button>
          <button onClick={logout} className="btn-ghost">로그아웃</button>
        </div>
      </nav>

      <div className="container">

        {/* ═══ DASHBOARD ═══ */}
        {tab === 'dashboard' && (
          <>
            <h1 className="page-title">콜라보 콤프레샤 AS 관리</h1>
            <div className="kpi-grid">
              <div className="kpi-card primary"><div className="kpi-label">이번달 접수</div><div className="kpi-value">{monthAS.length}<span className="kpi-sub">건</span></div></div>
              <div className="kpi-card light"><div className="kpi-label">처리 중</div><div className="kpi-value">{activeAS.length}<span className="kpi-sub">건</span></div></div>
              <div className="kpi-card light"><div className="kpi-label">이번달 완료</div><div className="kpi-value">{doneMonth.length}<span className="kpi-sub">건</span></div></div>
              <div className="kpi-card light"><div className="kpi-label">누적 AS</div><div className="kpi-value">{asRecords.length}<span className="kpi-sub">건</span></div></div>
            </div>

            <div className="section">
              <div className="section-header"><span>최근 AS 접수</span><button className="btn-link" style={{color:'#fff'}} onClick={() => setTab('as')}>전체보기 →</button></div>
              <div className="section-body">
                {asRecords.length === 0 ? <div className="empty">아직 AS 접수 내역이 없습니다</div> : (
                  <div className="scroll-x"><table className="data-table"><thead><tr>
                    {['접수일','모델','에러코드','고객명','증상 요약','상태'].map(h => <th key={h}>{h}</th>)}
                  </tr></thead><tbody>
                    {asRecords.slice(0,5).map(r => (
                      <tr key={r.id} className="clickable" onClick={() => { setTab('as'); setDetail(r.id); }}>
                        <td>{r.receipt_date}</td><td className="fw600">{r.model}</td>
                        <td>{r.error_code && r.error_code !== '없음' ? <span className="err-code">{r.error_code}</span> : '-'}</td>
                        <td>{r.customer_name || '-'}</td><td className="ellipsis">{r.symptom || '-'}</td>
                        <td><span className={`badge ${statusBadge(r.status)}`}>{r.status || '미정'}</span></td>
                      </tr>
                    ))}
                  </tbody></table></div>
                )}
              </div>
            </div>

            <div className="section">
              <div className="section-header"><span>최근 택배 발송</span><button className="btn-link" style={{color:'#fff'}} onClick={() => setTab('ship')}>전체보기 →</button></div>
              <div className="section-body">
                {shipRecords.length === 0 ? <div className="empty">아직 발송 내역이 없습니다</div> : (
                  <div className="scroll-x"><table className="data-table"><thead><tr>
                    {['발송일','택배사','송장번호','수령인','내용물'].map(h => <th key={h}>{h}</th>)}
                  </tr></thead><tbody>
                    {shipRecords.slice(0,5).map(r => (
                      <tr key={r.id}><td>{r.ship_date}</td><td>{r.carrier}</td><td className="mono">{r.tracking_no}</td><td>{r.receiver_name}</td><td>{r.contents}</td></tr>
                    ))}
                  </tbody></table></div>
                )}
              </div>
            </div>

            {asRecords.length > 0 && (
              <div className="section">
                <div className="section-header"><span>모델별 AS 현황</span></div>
                <div className="section-body">
                  <div className="model-stats">
                    {Object.entries(asRecords.reduce((a, r) => { a[r.model] = (a[r.model]||0)+1; return a; }, {})).sort((a,b) => b[1]-a[1]).map(([m, c]) => (
                      <div key={m} className="model-chip"><span className="model-chip-name">{m}</span><span className="model-chip-count">{c}</span></div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ AS LIST ═══ */}
        {tab === 'as' && !detail && (
          <>
            <div className="page-header">
              <h1 className="page-title" style={{marginBottom:0}}>AS 일지</h1>
              <button onClick={() => setModal({ type:'as-new' })} className="btn-primary">+ 새 AS 접수</button>
            </div>
            <div className="filter-bar">
              <input placeholder="모델, 고객명, 증상 검색..." value={search} onChange={e => setSearch(e.target.value)} className="input" style={{ flex:1, minWidth:200 }} />
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input" style={{ width:120 }}>
                <option>전체</option>{STATUS_LIST.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="section">
              <div className="section-header"><span>AS 목록 ({filteredAS.length}건)</span></div>
              <div className="section-body">
                {filteredAS.length === 0 ? <div className="empty">조건에 맞는 AS 건이 없습니다</div> : (
                  <div className="scroll-x"><table className="data-table"><thead><tr>
                    {['접수일','모델','에러코드','고객명','연락처','증상 요약','상태',''].map(h => <th key={h}>{h}</th>)}
                  </tr></thead><tbody>
                    {filteredAS.map(r => (
                      <tr key={r.id} className="clickable" onClick={() => setDetail(r.id)}>
                        <td>{r.receipt_date}</td><td className="fw600">{r.model}</td>
                        <td>{r.error_code && r.error_code !== '없음' ? <span className="err-code">{r.error_code}</span> : '-'}</td>
                        <td>{r.customer_name || '-'}</td><td>{r.customer_phone || '-'}</td>
                        <td className="ellipsis">{r.symptom || '-'}</td>
                        <td><span className={`badge ${statusBadge(r.status)}`}>{r.status || '미정'}</span></td>
                        <td onClick={e => e.stopPropagation()}><button className="btn-text-danger" onClick={() => deleteAS(r.id)}>삭제</button></td>
                      </tr>
                    ))}
                  </tbody></table></div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ═══ AS DETAIL ═══ */}
        {tab === 'as' && detail && (() => {
          const r = detailRecord;
          if (!r) { setDetail(null); return null; }
          const usedCodes = r.parts_used_codes || [];
          const partsCost = usedCodes.reduce((s, c) => { const p = parts.find(x => x.code === c); return s + (p?.price || 0); }, 0);
          return (
            <>
              <button onClick={() => setDetail(null)} className="btn-link" style={{ marginBottom:12 }}>← AS 목록으로</button>
              <div className="page-header">
                <h1 className="page-title" style={{marginBottom:0}}>{r.model} {r.error_code && r.error_code !== '없음' ? `(${r.error_code})` : ''} — AS 상세</h1>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => setModal({ type:'as-edit', data: r })} className="btn-primary">수정</button>
                  <button onClick={() => { deleteAS(r.id); }} className="btn-danger">삭제</button>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:16 }}>
                <div className="section"><div className="section-header"><span>기본 정보</span></div><div className="section-body">
                  <div className="info-row"><div className="info-label">접수일</div><div className="info-value">{r.receipt_date}</div></div>
                  <div className="info-row"><div className="info-label">모델</div><div className="info-value">{r.model}</div></div>
                  <div className="info-row"><div className="info-label">에러코드</div><div className="info-value">{r.error_code || '-'}</div></div>
                  <div className="info-row"><div className="info-label">상태</div><div className="info-value"><span className={`badge ${statusBadge(r.status)}`}>{r.status}</span></div></div>
                  <div className="info-row"><div className="info-label">가동시간</div><div className="info-value">{r.run_hours ? `${r.run_hours}시간` : '-'}</div></div>
                </div></div>
                <div className="section"><div className="section-header"><span>고객 정보</span></div><div className="section-body">
                  <div className="info-row"><div className="info-label">고객명</div><div className="info-value">{r.customer_name || '-'}</div></div>
                  <div className="info-row"><div className="info-label">연락처</div><div className="info-value">{r.customer_phone || '-'}</div></div>
                  <div className="info-row"><div className="info-label">주소</div><div className="info-value">{r.customer_address || '-'}</div></div>
                </div></div>
              </div>
              <div className="section"><div className="section-header"><span>증상 및 진단</span></div><div className="section-body">
                <div className="info-row"><div className="info-label">증상</div><div className="info-value">{r.symptom || '-'}</div></div>
                <div className="info-row"><div className="info-label">체크방법 / 진단</div><div className="info-value">{r.diagnosis || '-'}</div></div>
                <div className="info-row"><div className="info-label">교체부품</div><div className="info-value">{r.parts_used || '-'}</div></div>
                <div className="info-row"><div className="info-label">메모</div><div className="info-value">{r.memo || '-'}</div></div>
              </div></div>
              {usedCodes.length > 0 && (
                <div className="section"><div className="section-header"><span>교체부품 비용 상세</span></div><div className="section-body">
                  <div className="scroll-x"><table className="data-table"><thead><tr>
                    {['코드','구분','부품명','공임비'].map(h => <th key={h}>{h}</th>)}
                  </tr></thead><tbody>
                    {usedCodes.map((code, i) => { const p = parts.find(x => x.code === code); return p ? (
                      <tr key={i}><td>{p.code}</td><td>{p.category}</td><td>{p.name}</td><td className="price">₩{fmt(p.price)}</td></tr>
                    ) : null; })}
                    <tr><td colSpan={3} style={{ textAlign:'right', fontWeight:700 }}>합계</td><td className="price" style={{ fontSize:15 }}>₩{fmt(partsCost)}</td></tr>
                  </tbody></table></div>
                </div></div>
              )}
            </>
          );
        })()}

        {/* ═══ SHIPPING ═══ */}
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

        {/* ═══ PARTS ═══ */}
        {tab === 'parts' && (
          <>
            <h1 className="page-title">부속 가격표</h1>
            <div className="filter-bar">
              <input placeholder="코드, 부품명, 규격 검색..." value={partsSearch} onChange={e => setPartsSearch(e.target.value)} className="input" style={{ flex:1, minWidth:200 }} />
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
      </div>

      {/* ═══ MODALS ═══ */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            {(modal.type === 'as-new' || modal.type === 'as-edit') && (
              <ASForm initial={modal.data} parts={parts} onSave={d => { modal.type === 'as-new' ? addAS(d) : updateAS(modal.data.id, d); setModal(null); }} onClose={() => setModal(null)} />
            )}
            {(modal.type === 'ship-new' || modal.type === 'ship-edit') && (
              <ShipForm initial={modal.data} onSave={d => { modal.type === 'ship-new' ? addShip(d) : updateShip(modal.data.id, d); setModal(null); }} onClose={() => setModal(null)} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ═══ AS FORM ═══ */
function ASForm({ initial, parts, onSave, onClose }) {
  const i = initial || {};
  const [f, setF] = useState({
    receiptDate: i.receipt_date || today(), model: i.model || 'DC886', errorCode: i.error_code || '없음',
    status: i.status || '접수', customerName: i.customer_name || '', customerPhone: i.customer_phone || '',
    customerAddress: i.customer_address || '', symptom: i.symptom || '', diagnosis: i.diagnosis || '',
    partsUsed: i.parts_used || '', partsUsedCodes: i.parts_used_codes || [], runHours: i.run_hours?.toString() || '', memo: i.memo || '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const togglePart = (code) => set('partsUsedCodes', f.partsUsedCodes.includes(code) ? f.partsUsedCodes.filter(c => c !== code) : [...f.partsUsedCodes, code]);

  const [showParts, setShowParts] = useState(false);
  const [pq, setPq] = useState('');
  const pf = parts.filter(p => !pq || [p.code,p.name,p.category].some(x => x?.toLowerCase().includes(pq.toLowerCase())));
  const totalCost = f.partsUsedCodes.reduce((s, c) => { const p = parts.find(x => x.code === c); return s + (p?.price || 0); }, 0);

  return (
    <>
      <div className="modal-header"><h2>{initial ? 'AS 수정' : '새 AS 접수'}</h2><button onClick={onClose} className="modal-close">✕</button></div>
      <div className="modal-body">
        <div className="form-grid">
          <div className="form-field"><label className="label">접수일</label><input type="date" value={f.receiptDate} onChange={e => set('receiptDate', e.target.value)} className="input" /></div>
          <div className="form-field"><label className="label">모델</label><select value={f.model} onChange={e => set('model', e.target.value)} className="input">{MODELS.map(m => <option key={m}>{m}</option>)}</select></div>
          <div className="form-field"><label className="label">에러코드</label><select value={f.errorCode} onChange={e => set('errorCode', e.target.value)} className="input">{ERROR_CODES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="form-field"><label className="label">상태</label><select value={f.status} onChange={e => set('status', e.target.value)} className="input">{STATUS_LIST.map(s => <option key={s}>{s}</option>)}</select></div>
          <div className="form-field"><label className="label">가동시간(h)</label><input type="number" value={f.runHours} onChange={e => set('runHours', e.target.value)} placeholder="시간" className="input" /></div>
        </div>
        <hr className="form-divider" />
        <div className="form-grid">
          <div className="form-field"><label className="label">고객명</label><input value={f.customerName} onChange={e => set('customerName', e.target.value)} placeholder="이름" className="input" /></div>
          <div className="form-field"><label className="label">연락처</label><input value={f.customerPhone} onChange={e => set('customerPhone', e.target.value)} placeholder="010-0000-0000" className="input" /></div>
        </div>
        <div className="form-field"><label className="label">주소</label><input value={f.customerAddress} onChange={e => set('customerAddress', e.target.value)} placeholder="배송 주소" className="input" /></div>
        <hr className="form-divider" />
        <div className="form-field"><label className="label">증상</label><textarea value={f.symptom} onChange={e => set('symptom', e.target.value)} rows={3} placeholder="증상을 상세히 기록" className="input" /></div>
        <div className="form-field"><label className="label">체크방법 / 진단</label><textarea value={f.diagnosis} onChange={e => set('diagnosis', e.target.value)} rows={3} placeholder="진단 과정 기록" className="input" /></div>
        <div className="form-field"><label className="label">교체부품 (텍스트)</label><input value={f.partsUsed} onChange={e => set('partsUsed', e.target.value)} placeholder="PCB교체, 모터교체 등" className="input" /></div>
        <div style={{ marginTop:8 }}>
          <button onClick={() => setShowParts(!showParts)} className="btn-secondary" style={{ fontSize:12, marginBottom:8 }}>
            {showParts ? '▲ 부품 선택 닫기' : '▼ 부품 코드로 선택'}{f.partsUsedCodes.length > 0 && ` (${f.partsUsedCodes.length}개)`}
          </button>
          {showParts && (
            <div className="parts-selector">
              <input placeholder="부품 검색..." value={pq} onChange={e => setPq(e.target.value)} className="input" style={{ marginBottom:8 }} />
              {pf.map(p => (
                <label key={p.code} style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0', cursor:'pointer', fontSize:12 }}>
                  <input type="checkbox" checked={f.partsUsedCodes.includes(p.code)} onChange={() => togglePart(p.code)} />
                  <span className="mono" style={{ color:'var(--tl-text-secondary)', minWidth:44 }}>{p.code}</span>
                  <span style={{ flex:1 }}>{p.category} — {p.name}</span>
                  <span style={{ fontWeight:600, color:'var(--tl-primary)' }}>₩{fmt(p.price)}</span>
                </label>
              ))}
            </div>
          )}
          {f.partsUsedCodes.length > 0 && (
            <div className="parts-total"><span style={{ fontWeight:500 }}>선택 부품 합계</span><span style={{ fontWeight:700, color:'var(--tl-primary)' }}>₩{fmt(totalCost)}</span></div>
          )}
        </div>
        <div className="form-field"><label className="label">메모</label><textarea value={f.memo} onChange={e => set('memo', e.target.value)} rows={2} placeholder="기타 메모" className="input" /></div>
      </div>
      <div className="modal-footer"><button onClick={onClose} className="btn-secondary">취소</button><button onClick={() => onSave(f)} className="btn-primary">저장</button></div>
    </>
  );
}

/* ═══ SHIP FORM ═══ */
function ShipForm({ initial, onSave, onClose }) {
  const i = initial || {};
  const [f, setF] = useState({
    shipDate: i.ship_date || today(), carrier: i.carrier || 'CJ대한통운', trackingNo: i.tracking_no || '',
    senderName: i.sender_name || '', receiverName: i.receiver_name || '', receiverPhone: i.receiver_phone || '',
    receiverAddress: i.receiver_address || '', contents: i.contents || '', memo: i.memo || '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

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
