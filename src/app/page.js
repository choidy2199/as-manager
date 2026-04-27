'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

/* ── 상수 ── */
const BRANDS = ["콜라보","마끼다","디월트","프레레","기타"];
const STATUS_LIST = ["접수","부품대기","수리중","완료","수리X","폐기"];
const RECORD_TYPES = ["AS 수리","제품 판매","부품 판매"];
const CARRIERS_IN = ["롯데","CJ","한진","경동","로젠","우체국","대신택배","대신화물","경동화물","방문","용차","퀵"];
const CARRIERS_OUT = [...CARRIERS_IN, "매장"];
const INVOICE_TYPES = ["없음(일반소매)","계산서(거래처)","월말"];
const PAYMENT_STATUS = ["완료","대기","명세서","무상","카드","방문결제"];

const fmt = (n) => n?.toLocaleString('ko-KR') ?? '0';
const today = () => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' })); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getMonth()+1}월 ${dt.getDate()}일`;
};
const toE164 = (p) => { if (!p) return ''; const d = p.replace(/[^0-9]/g, ''); if (d.startsWith('0')) return '+82' + d.slice(1); return '+' + d; };
const toLocal = (p) => { if (!p) return ''; const d = p.replace(/[^0-9]/g, ''); if (d.startsWith('82')) return '0' + d.slice(2); return d; };
const recordTypeToDb = (t) => ({ 'AS 수리':'as_repair','제품 판매':'product_sale','부품 판매':'parts_sale' }[t] || 'as_repair');
const dbToRecordType = (t) => ({ 'as_repair':'AS 수리','product_sale':'제품 판매','parts_sale':'부품 판매' }[t] || 'AS 수리');

/* 발주이력 전용 대분류 정렬 (사장님 지정) — part_categories DB sort_order는 무수정 */
/* ═══ PDF 생성 헬퍼 — 발주서 출력 (Pretendard + NotoSansSC) ═══ */
let _pdfFontsLoaded = false;
async function loadPdfFonts(pdfMake) {
  if (_pdfFontsLoaded) return;
  let pretendardBuf;
  let pretendardFilename = 'Pretendard-Regular.ttf';
  try {
    const r = await fetch('/fonts/Pretendard-Regular.ttf');
    if (!r.ok) throw new Error('ttf not found');
    pretendardBuf = await r.arrayBuffer();
  } catch {
    const r = await fetch('/fonts/Pretendard-Regular.otf');
    if (!r.ok) throw new Error('Pretendard 폰트(.ttf, .otf 모두) 로드 실패. public/fonts/ 확인');
    pretendardBuf = await r.arrayBuffer();
    pretendardFilename = 'Pretendard-Regular.otf';
  }
  const scRes = await fetch('/fonts/NotoSansSC-Regular.ttf');
  if (!scRes.ok) throw new Error('NotoSansSC 폰트 로드 실패. public/fonts/NotoSansSC-Regular.ttf 확인');
  const scBuf = await scRes.arrayBuffer();
  const toBase64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  };
  pdfMake.vfs = {
    [pretendardFilename]: toBase64(pretendardBuf),
    'NotoSansSC-Regular.ttf': toBase64(scBuf),
  };
  pdfMake.fonts = {
    Pretendard: {
      normal: pretendardFilename,
      bold: pretendardFilename,
      italics: pretendardFilename,
      bolditalics: pretendardFilename,
    },
    SC: {
      normal: 'NotoSansSC-Regular.ttf',
      bold: 'NotoSansSC-Regular.ttf',
      italics: 'NotoSansSC-Regular.ttf',
      bolditalics: 'NotoSansSC-Regular.ttf',
    },
  };
  _pdfFontsLoaded = true;
}

async function loadImageAsBase64(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

async function generateOrderPDF(order, orderItems, parts) {
  const pdfMakeMod = await import('pdfmake/build/pdfmake');
  const pdfMake = pdfMakeMod.default || pdfMakeMod;
  await loadPdfFonts(pdfMake);

  const partsById = {};
  parts.forEach(p => { partsById[p.id] = p; });

  const items = (orderItems || []).filter(it => it.order_id === order.id);

  const sortedItems = [...items].sort((a, b) => {
    const partA = partsById[a.part_id];
    const partB = partsById[b.part_id];
    const firstCatA = (partA?.big_category || '').split('|')[0].trim();
    const firstCatB = (partB?.big_category || '').split('|')[0].trim();
    const orderA = HISTORY_BIG_CAT_ORDER[firstCatA] ?? 999;
    const orderB = HISTORY_BIG_CAT_ORDER[firstCatB] ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    if (firstCatA !== firstCatB) return firstCatA.localeCompare(firstCatB, 'ko-KR');
    return (partA?.name || '').localeCompare(partB?.name || '', 'ko-KR');
  });

  const itemRows = await Promise.all(sortedItems.map(async (it, i) => {
    const part = partsById[it.part_id];
    const imgBase64 = part?.image_url ? await loadImageAsBase64(part.image_url) : null;
    return {
      no: i + 1,
      image: imgBase64,
      big_category: (part?.big_category || '').split('|').map(s => s.trim()).filter(Boolean).join(' / ') || '—',
      model_kr: (part?.category || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean).join(' / ') || '—',
      model_cn: ((part?.chinese_model || part?.category || '')).split(/[\/,]/).map(s => s.trim()).filter(Boolean).join(' / ') || '—',
      name_cn: part?.chinese_name || part?.name || '—',
      quantity: it.quantity,
    };
  }));

  const tableBody = [
    [
      { text: 'No', style: 'th', alignment: 'center' },
      { text: '사진', style: 'th', alignment: 'center' },
      { text: '모델명(한국)', style: 'th', alignment: 'center' },
      { text: '대분류', style: 'th', alignment: 'center' },
      { text: '모델명(CN)', style: 'th', alignment: 'center' },
      { text: '부속이름(CN)', style: 'th', alignment: 'left' },
      { text: '수량', style: 'th', alignment: 'center' },
    ],
    ...itemRows.map(row => [
      { text: String(row.no), alignment: 'center', fontSize: 11, bold: true, color: '#1A1D23' },
      row.image
        ? { image: row.image, width: 36, height: 36, alignment: 'center' }
        : { text: '—', alignment: 'center', color: '#1A1D23', bold: true },
      { text: row.model_kr, alignment: 'center', fontSize: 11, bold: true, color: '#1A1D23' },
      { text: row.big_category, alignment: 'center', fontSize: 11, bold: true, color: '#1A1D23' },
      { text: row.model_cn, alignment: 'center', fontSize: 11, bold: true, color: '#1A1D23' },
      { text: row.name_cn, fontSize: 12, bold: true, color: '#1A1D23' },
      { text: String(row.quantity), alignment: 'center', fontSize: 13, bold: true, color: '#1A1D23' },
    ]),
  ];

  const totalQty = itemRows.reduce((s, r) => s + (r.quantity || 0), 0);

  const docDef = {
    content: [
      {
        text: [
          { text: '발주서', font: 'Pretendard' },
          { text: ' / ', font: 'Pretendard' },
          { text: '订货单', font: 'SC' },
        ],
        fontSize: 22, bold: true, alignment: 'center', margin: [0, 0, 0, 18]
      },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: `발주번호: ${order.order_no || '(작성중)'}`, fontSize: 11, margin: [0, 0, 0, 4] },
              { text: `발주일자: ${order.order_date || '—'}`, fontSize: 11, margin: [0, 0, 0, 4] },
              ...(order.memo ? [{ text: `메모: ${order.memo}`, fontSize: 11, color: '#5A6070' }] : []),
            ],
          },
          {
            width: 'auto',
            stack: [
              { text: `합계 ${itemRows.length}종 / ${totalQty}개`, fontSize: 12, bold: true, alignment: 'right', color: '#185FA5' },
            ],
          },
        ],
        margin: [0, 0, 0, 14],
      },
      {
        table: {
          headerRows: 1,
          widths: [22, 44, 70, 60, 70, '*', 32],
          body: tableBody,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#DDE1EB',
          vLineColor: () => '#DDE1EB',
          paddingTop: () => 6,
          paddingBottom: () => 6,
          paddingLeft: () => 6,
          paddingRight: () => 6,
        },
      },
    ],
    defaultStyle: {
      font: 'Pretendard',
      fontSize: 10,
      color: '#1A1D23',
    },
    styles: {
      th: { bold: true, fillColor: '#1A1D23', color: '#FFFFFF', fontSize: 10 },
    },
    pageMargins: [40, 40, 40, 40],
    pageOrientation: 'portrait',
  };

  const filename = `발주서_${order.order_no || 'draft'}_${order.order_date || ''}.pdf`.replace(/\s+/g, '');
  const pdf = pdfMake.createPdf(docDef);

  return new Promise((resolve, reject) => {
    pdf.getBlob(blob => {
      const blobUrl = URL.createObjectURL(blob);
      resolve({ blob, blobUrl, filename });
    }, reject);
  });
}

function downloadPdfBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}


const HISTORY_BIG_CAT_ORDER = {
  '2HP-900W': 1,
  '4HP-1,500W': 2,
  '5HP-2,200W': 3,
  '8HP-4,000W': 4,
  '유무선': 5,
  '충전': 6,
  '금속절단기': 7,
  '기타': 8,
};
const sortByBigCategory = (a, b) => {
  const tokenA = (a.big_category || '').split('|')[0]?.trim() || '';
  const tokenB = (b.big_category || '').split('|')[0]?.trim() || '';
  const oa = HISTORY_BIG_CAT_ORDER[tokenA] ?? 999;
  const ob = HISTORY_BIG_CAT_ORDER[tokenB] ?? 999;
  if (oa !== ob) return oa - ob;
  const na = (a.name || '').localeCompare(b.name || '');
  if (na !== 0) return na;
  return (a.spec || '').localeCompare(b.spec || '');
};

export default function Home() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState(() => { if (typeof window !== 'undefined') { return localStorage.getItem('as_active_tab') || 'as'; } return 'as'; });
  const [asRecords, setAsRecords] = useState([]);
  const [shipRecords, setShipRecords] = useState([]);
  const [parts, setParts] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [confirmMap, setConfirmMap] = useState({}); // {phone: true} 견적 안내 발송 여부
  const [loading, setLoading] = useState(true);

  /* ── AS 필터 ── */
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [typeFilter, setTypeFilter] = useState('전체');
  const [statusFilter, setStatusFilter] = useState('전체');
  const [brandFilter, setBrandFilter] = useState('전체');
  const [monthFilter] = useState(new Date().toISOString().slice(0,7)); // 택배발송/설정용 유지
  const [dateFilterMode, setDateFilterMode] = useState(() => {
    if (typeof window === 'undefined') return 'month';
    return localStorage.getItem('as_date_filter_mode') || 'month';
  });
  const [dateFrom, setDateFrom] = useState(() => {
    if (typeof window === 'undefined') return today();
    const mode = localStorage.getItem('as_date_filter_mode') || 'month';
    if (mode === 'today') return today();
    if (mode === 'all') return '';
    if (mode === 'custom') return localStorage.getItem('as_date_from') || today();
    const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-01';
  });
  const [dateTo, setDateTo] = useState(() => {
    if (typeof window === 'undefined') return today();
    const mode = localStorage.getItem('as_date_filter_mode') || 'month';
    if (mode === 'all') return '';
    if (mode === 'custom') { const saved = localStorage.getItem('as_date_to'); return (saved && saved >= today()) ? saved : today(); }
    if (mode === 'today') return today();
    // month: 해당월 말일
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' })); const y=d.getFullYear(), m=d.getMonth()+1; const lastDay=new Date(y,m,0).getDate(); return y+'-'+String(m).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
  });
  const [dateAll, setDateAll] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (localStorage.getItem('as_date_filter_mode') || 'month') === 'all';
  });

  /* ── 새 접수 입력 행 표시 ── */
  const [showNewRow, setShowNewRow] = useState(false);
  const [kpiFilter, setKpiFilter] = useState(null);
  const [paymentFilter, setPaymentFilter] = useState(null);
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
  const [shipDateFilterMode, setShipDateFilterMode] = useState(() => {
    if (typeof window === 'undefined') return 'month';
    return localStorage.getItem('ship_date_filter_mode') || 'month';
  });
  const [shipDateFrom, setShipDateFrom] = useState(() => {
    if (typeof window === 'undefined') return today();
    const mode = localStorage.getItem('ship_date_filter_mode') || 'month';
    if (mode === 'today') return today();
    if (mode === 'all') return '';
    if (mode === 'custom') return localStorage.getItem('ship_date_from') || today();
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' })); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-01';
  });
  const [shipDateTo, setShipDateTo] = useState(() => {
    if (typeof window === 'undefined') return today();
    const mode = localStorage.getItem('ship_date_filter_mode') || 'month';
    if (mode === 'all') return '';
    if (mode === 'custom') { const saved = localStorage.getItem('ship_date_to'); return (saved && saved >= today()) ? saved : today(); }
    if (mode === 'today') return today();
    // month: 해당월 말일
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' })); const y=d.getFullYear(), m=d.getMonth()+1; const lastDay=new Date(y,m,0).getDate(); return y+'-'+String(m).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
  });
  const [shipDateAll, setShipDateAll] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (localStorage.getItem('ship_date_filter_mode') || 'month') === 'all';
  });
  const [showNewShipRow, setShowNewShipRow] = useState(false);

  /* ── 부속 기존 state ── */
  const [partsSubTab, setPartsSubTab] = useState('parts'); // 'parts' | 'products' | 'order'
  const [partsSearch, setPartsSearch] = useState('');
  const [partsCatFilter, setPartsCatFilter] = useState('전체');
  const [partsBigCatFilter, setPartsBigCatFilter] = useState('전체');
  const [partCategories, setPartCategories] = useState([]);
  const [partLightbox, setPartLightbox] = useState(null); // { url, name, code } | null
  const [modal, setModal] = useState(null);

  /* ── 부속발주 (Phase 2-1a) state ── */
  const [cart, setCart] = useState([]); // [{ ...part fields, part_id, quantity }]
  const [currentDraftId, setCurrentDraftId] = useState(null);
  const [templates, setTemplates] = useState([]); // [{id, name, memo, updated_at, items: [{part_id, quantity, sort_order}]}]
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [orders, setOrders] = useState([]);
  const [orderItems, setOrderItems] = useState([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [pdfPreview, setPdfPreview] = useState(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  /* ── 제품가격 state ── */
  const [products, setProducts] = useState([]);
  const [productsSearch, setProductsSearch] = useState('');

  /* ── 거래처 state ── */
  const [companies, setCompanies] = useState([]);

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

  /* ── Data Load (날짜 범위 기반, 검색어 있으면 전체) ── */
  const loadData = useCallback(async (unused, fullSearch) => {
    let asQuery = supabase.from('as_records').select('*').order('created_at', { ascending: false });
    if (!fullSearch && !dateAll && dateFrom && dateTo) {
      asQuery = asQuery.gte('receipt_date', dateFrom).lte('receipt_date', dateTo);
    }
    const [asRes, shipRes, partsRes, productsRes, techRes, compRes, catRes] = await Promise.all([
      asQuery,
      (() => { let q = supabase.from('ship_records').select('*').order('ship_date', { ascending: false }); if (!shipDateAll && shipDateFrom && shipDateTo) { q = q.gte('ship_date', shipDateFrom).lte('ship_date', shipDateTo); } return q; })(),
      supabase.from('parts').select('*').order('code'),
      supabase.from('products').select('*').order('sort_order', { ascending: true }),
      supabase.from('technicians').select('*').order('created_at'),
      supabase.from('companies').select('*').order('created_at', { ascending: false }),
      supabase.from('part_categories').select('id, name, sort_order').order('sort_order', { ascending: true }),
    ]);
    if (asRes.data) {
      setAsRecords(asRes.data);
      // 견적 안내 발송 여부 일괄 조회 (phone 기준, message_type에 '견적' 포함)
      const phones = [...new Set(asRes.data.map(r => toLocal(r.customer_phone)).filter(Boolean))];
      if (phones.length > 0) {
        const { data: smsConf } = await supabase.from('sms_messages').select('phone').eq('direction', 'outgoing').ilike('message_type', '%견적%').in('phone', phones);
        const map = {};
        if (smsConf) smsConf.forEach(s => { map[s.phone] = true; });
        setConfirmMap(map);
      } else { setConfirmMap({}); }
    }
    if (shipRes.data) setShipRecords(shipRes.data);
    if (partsRes.data) setParts([...partsRes.data].sort((a, b) => (a.name || '').localeCompare(b.name || '') || (a.spec || '').localeCompare(b.spec || '')));
    if (productsRes.data) setProducts(productsRes.data);
    if (techRes.data) setTechnicians(techRes.data);
    if (compRes.data) setCompanies(compRes.data);
    if (catRes.data) setPartCategories(catRes.data);
    if (loading) setLoading(false);
  }, [dateFrom, dateTo, dateAll, shipDateFrom, shipDateTo, shipDateAll]);

  const loadTemplates = useCallback(async () => {
    const [tplRes, itemRes] = await Promise.all([
      supabase.from('parts_templates').select('*').order('updated_at', { ascending: false }),
      supabase.from('parts_template_items').select('*').order('sort_order', { ascending: true }),
    ]);
    if (tplRes.data) {
      const itemsByTpl = {};
      (itemRes.data || []).forEach(item => {
        if (!itemsByTpl[item.template_id]) itemsByTpl[item.template_id] = [];
        itemsByTpl[item.template_id].push(item);
      });
      setTemplates(tplRes.data.map(t => ({ ...t, items: itemsByTpl[t.id] || [] })));
    }
  }, []);

  useEffect(() => { if (user) loadData(null, debouncedSearch.length >= 2); }, [user, dateFrom, dateTo, dateAll, shipDateFrom, shipDateTo, shipDateAll, loadData, debouncedSearch]);
  useEffect(() => { if (user) loadTemplates(); }, [user, loadTemplates]);

  /* ── Realtime ── */
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'as_records' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ship_records' }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, loadData]);

  /* ── AS inline save ── */
  const saveASField = async (id, field, value) => {
    const { error } = await supabase.from('as_records').update({ [field]: value }).eq('id', id);
    if (error) { console.error('AS save error:', error); alert('저장 실패: ' + error.message); }
  };

  /* ── 자동 문자 발송 유틸 ── */
  const sendAutoSMS = async (type, record) => {
    try {
      const phone = toLocal(record.customer_phone);
      if (!phone) return;
      // 중복 발송 방지: 같은 as_record_id + 같은 type
      const tag = type === 'intake' ? '입고' : '출고';
      const { count } = await supabase.from('sms_messages').select('*', { count: 'exact', head: true })
        .eq('phone', phone).eq('direction', 'outgoing').ilike('content', `%${tag}%`)
        .eq('as_record_id', record.id);
      if (count > 0) return; // 이미 발송됨
      // 템플릿 조회
      const tplKey = type === 'intake' ? 'sms_template_intake' : 'sms_template_release';
      const { data: tplData } = await supabase.from('settings').select('value').eq('key', tplKey).single();
      let tpl = tplData?.value;
      if (!tpl || typeof tpl !== 'string') {
        tpl = tplData?.value;
        if (typeof tpl === 'object' && tpl !== null) tpl = JSON.stringify(tpl);
        if (!tpl) return;
      }
      tpl = tpl.replace(/^"+|"+$/g, '');
      // 변수 치환
      const intakeDate = record.receipt_date ? fmtDate(record.receipt_date) : '';
      const releaseDate = record.release_date ? fmtDate(record.release_date) : '';
      const content = tpl
        .replace(/\{고객명\}/g, record.customer_name || record.company_name || '')
        .replace(/\{거래처명\}/g, record.company_name || '')
        .replace(/\{모델명\}/g, record.model || '')
        .replace(/\{입고날짜\}/g, intakeDate)
        .replace(/\{브랜드\}/g, record.brand || '')
        .replace(/\{택배사\}/g, record.release_carrier || '')
        .replace(/\{운송장번호\}/g, record.tracking_number || '')
        .replace(/\{출고날짜\}/g, releaseDate);
      if (!content.trim()) return;
      // 발송
      const res = await fetch('/api/sms/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: phone, content }) });
      const result = await res.json();
      if (result.error) { console.error('자동 문자 발송 실패:', result.error); return; }
      // sms_messages 기록
      await supabase.from('sms_messages').insert({ phone, content, direction: 'outgoing', sent_at: new Date().toISOString(), as_record_id: record.id });
    } catch (e) { console.error('자동 문자 발송 에러:', e); }
  };

  const addNewAS = async (row) => {
    const { data, error } = await supabase.from('as_records').insert(row).select().single();
    if (error) { alert('저장 실패: ' + error.message); console.error('addNewAS error:', error); return; }
    if (data) setAsRecords(prev => [data, ...prev]);
    loadData();
    // 입고 알림 자동 발송: AS수리일 때만 + 연락처+성함/거래처+모델명 모두 있을 때
    if (data && data.record_type === 'as_repair' && data.customer_phone && (data.customer_name || data.company_name) && data.model) {
      sendAutoSMS('intake', data);
    }
  };

  const deleteAS = async (id) => {
    console.log('deleteAS called:', id);
    setAsRecords(prev => prev.filter(r => r.id !== id));
    const { error } = await supabase.from('as_records').delete().eq('id', id);
    if (error) { console.error('삭제 실패:', error); alert('삭제 실패: ' + error.message); }
    loadData();
  };

  /* ── Ship CRUD (기존 유지) ── */
  const addShip = async (d) => {
    const row = {
      ship_date: d.shipDate, carrier: d.carrier, tracking_no: d.trackingNo,
      sender_name: d.senderName || '선택',
      receiver_name: d.receiverName, receiver_phone: d.receiverPhone,
      receiver_address: d.receiverAddress, contents: d.contents, memo: d.memo,
    };
    if (d.asRecordId) row.as_record_id = d.asRecordId;
    if (d.deliveryMessage) row.delivery_message = d.deliveryMessage;
    if (Number.isFinite(d.quantity) && d.quantity >= 1) row.quantity = d.quantity;
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
    const rows = data.map(r => [r.receiver_name||'',r.receiver_phone||'',r.receiver_address||'',r.contents||'','1',r.delivery_message||'',r.sender_name||'선불',r.carrier||'']);
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
    const mk = !kpiFilter || (KPI_STATUS_MAP[kpiFilter] || []).includes(r.status);
    const mp = !paymentFilter || r.payment_status === paymentFilter;
    return ms && mt && mst && mb && mk && mp;
  });

  /* ── KPI ── */
  const monthAS = asRecords; // 이미 날짜 범위로 필터된 데이터
  const kpiTotal = monthAS.length;
  const kpiReception = monthAS.filter(r => ['접수','진단중'].includes(r.status)).length;
  const kpiRepairing = monthAS.filter(r => ['수리중','부품대기'].includes(r.status)).length;
  const kpiDone = monthAS.filter(r => r.status === '완료').length;
  const kpiNoRepair = monthAS.filter(r => ['수리X','폐기'].includes(r.status)).length;

  // 입금 상태 건수 (kpiFilter 적용된 범위 내에서 계산)
  const paymentBase = monthAS.filter(r => !kpiFilter || (KPI_STATUS_MAP[kpiFilter] || []).includes(r.status));
  const payDone = paymentBase.filter(r => r.payment_status === '완료').length;
  const payWait = paymentBase.filter(r => r.payment_status === '대기').length;
  const payInvoice = paymentBase.filter(r => r.payment_status === '명세서').length;
  const payFree = paymentBase.filter(r => r.payment_status === '무상').length;
  const payCard = paymentBase.filter(r => r.payment_status === '카드').length;
  const payVisit = paymentBase.filter(r => r.payment_status === '방문결제').length;

  /* ── 부속발주 (Phase 2-1a) 핵심 함수 ── */
  const loadOrders = useCallback(async () => {
    const [ordersRes, itemsRes] = await Promise.all([
      supabase.from('parts_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('parts_order_items').select('*'),
    ]);
    const o = ordersRes.data || [];
    const it = itemsRes.data || [];
    setOrders(o);
    setOrderItems(it);
    return { orders: o, items: it };
  }, []);

  const handleAddToCart = useCallback((part) => {
    setCart(prev => {
      const idx = prev.findIndex(item => item.part_id === part.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { ...part, part_id: part.id, quantity: part.quantity || 1 }];
    });
  }, []);

  const saveDraft = useCallback(async () => {
    if (cart.length === 0) { alert('장바구니가 비어있습니다'); return null; }
    let orderId = currentDraftId;
    if (!orderId) {
      const { data, error } = await supabase.from('parts_orders').insert({ status: 'draft' }).select().single();
      if (error) { alert('저장 실패: ' + error.message); return null; }
      orderId = data.id;
      setCurrentDraftId(orderId);
    } else {
      await supabase.from('parts_orders').update({ memo: null }).eq('id', orderId);
    }
    await supabase.from('parts_order_items').delete().eq('order_id', orderId);
    const itemsToInsert = cart.map((item, idx) => ({
      order_id: orderId,
      part_id: item.part_id,
      quantity: item.quantity,
      price_snapshot: item.price || 0,
      sort_order: idx,
    }));
    const { error: itemsError } = await supabase.from('parts_order_items').insert(itemsToInsert);
    if (itemsError) { alert('저장 실패: ' + itemsError.message); return null; }
    await loadOrders();
    return orderId;
  }, [cart, currentDraftId, loadOrders]);

  const confirmOrder = useCallback(async () => {
    if (cart.length === 0) { alert('장바구니가 비어있습니다'); return; }
    const savedId = await saveDraft();
    if (!savedId) return;
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const dateStr = `${y}${m}${d}`;
    const { data: existing } = await supabase
      .from('parts_orders').select('order_no').like('order_no', `${dateStr}-%`);
    const nextNum = (existing?.length || 0) + 1;
    const orderNo = `${dateStr}-${String(nextNum).padStart(3, '0')}`;
    const { error } = await supabase
      .from('parts_orders')
      .update({ status: 'confirmed', order_no: orderNo, order_date: `${y}-${m}-${d}` })
      .eq('id', savedId);
    if (error) { alert('확정 실패: ' + error.message); return; }
    setCart([]);
    setCurrentDraftId(null);
    setShowConfirmModal(false);
    await loadOrders();
    alert(`발주 확정 완료: ${orderNo}`);
  }, [cart, saveDraft, loadOrders]);

  const loadDraft = useCallback(async (orderId) => {
    const { data: items } = await supabase
      .from('parts_order_items').select('*').eq('order_id', orderId).order('sort_order');
    if (!items) return;
    const cartData = items.map(item => {
      const part = parts.find(p => p.id === item.part_id);
      return part ? { ...part, part_id: item.part_id, quantity: item.quantity } : null;
    }).filter(Boolean);
    cartData.sort(sortByBigCategory);
    setCart(cartData);
    setCurrentDraftId(orderId);
    setShowHistoryModal(false);
  }, [parts]);

  /* ── 부속 필터 (기존) ── */
  const filteredParts = parts.filter(p => {
    const ms = !partsSearch || [p.code,p.name,p.spec,p.category,p.chinese_model].some(f => f?.toLowerCase().includes(partsSearch.toLowerCase()));
    const partTokens = [
      ...(p.category || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean),
      ...(p.chinese_model || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean),
    ];
    const mc = partsCatFilter === '전체' || partTokens.includes(partsCatFilter);
    const bigCatTokens = (p.big_category || '').split('|').map(s => s.trim()).filter(Boolean);
    const mb = partsBigCatFilter === '전체' || bigCatTokens.includes(partsBigCatFilter);
    return ms && mc && mb;
  });
  const partBigCats = ['전체', ...partCategories.map(c => c.name)];
  const partCats = ['전체', ...Array.from(new Set(
    parts.flatMap(p => [
      ...(p.category || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean),
      ...(p.chinese_model || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean),
    ])
  )).sort()];

  /* ── 제품 필터 ── */
  const filteredProducts = products.filter(p => {
    if (!productsSearch) return true;
    const q = productsSearch.toLowerCase();
    return [p.brand, p.model].some(f => f?.toLowerCase().includes(q));
  });

  /* ── Auth gate ── */
  if (authLoading) return <div className="loading"><span>로딩 중...</span></div>;
  if (!user) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    return <div className="loading"><span>로그인 페이지로 이동 중...</span></div>;
  }
  if (loading) return <div className="loading"><div style={{ textAlign:'center' }}><div style={{ fontSize:20, fontWeight:700, color:'var(--tl-primary)', marginBottom:8 }}>AS Manager</div><div>데이터 로딩 중...</div></div></div>;

  const dateLabel = (() => {
    if (dateAll) return '전체 기간';
    const fmt2 = (d) => { const dt = new Date(d + 'T00:00:00'); return `${dt.getFullYear()}년 ${dt.getMonth()+1}월 ${dt.getDate()}일`; };
    if (dateFrom === dateTo) return fmt2(dateFrom);
    const f = new Date(dateFrom + 'T00:00:00'); const t = new Date(dateTo + 'T00:00:00');
    if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()) return `${f.getFullYear()}년 ${f.getMonth()+1}월 ${f.getDate()}일 ~ ${t.getDate()}일`;
    return `${fmt2(dateFrom)} ~ ${fmt2(dateTo)}`;
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
          {[['as','AS 일지'],['ship','택배발송'],['companies','거래처'],['parts','제품/부속가격'],['settings','설정']].map(([k,v]) => (
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
                <input className="input as-filter-search" placeholder="이름, 연락처, 모델, 증상 검색..." value={search} onChange={e => setSearch(e.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} onKeyDown={e => e.key === 'Escape' && setSearch('')} autoComplete="off" />
                {/* 고객 검색 드롭다운 */}
                {searchFocused && search.length >= 2 && (() => {
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
                        <span style={{fontSize:11,color:'#9BA3B2'}}>클릭 → 필터링</span>
                      </div>
                      {customers.slice(0, 8).map((c, i) => (
                        <div key={i} className="search-dropdown-item" style={{padding:'12px 16px'}} onMouseDown={e => e.preventDefault()} onClick={() => { setSearch(c.name || c.company || c.phone || ''); if (document.activeElement) document.activeElement.blur(); }}>
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
              <div className="as-filter-pair" style={{marginLeft:'auto'}}>
                <span className="as-filter-label">기간</span>
                <div style={{display:'flex',alignItems:'center',height:32,border:'0.5px solid #DDE1EB',borderRadius:6,padding:'0 6px',background:'#fff'}}>
                  <input type="date" value={dateAll ? '' : dateFrom} onChange={e => { setDateAll(false); setDateFrom(e.target.value); setDateFilterMode('custom'); localStorage.setItem('as_date_filter_mode','custom'); localStorage.setItem('as_date_from',e.target.value); localStorage.setItem('as_date_to',dateTo); }} style={{fontSize:12,height:28,border:'none',width:130,background:'transparent',fontFamily:'inherit',outline:'none',color:'#1A1D23'}} />
                  <span style={{color:'#9BA3B2',padding:'0 4px',fontSize:12}}>~</span>
                  <input type="date" value={dateAll ? '' : dateTo} onChange={e => { setDateAll(false); setDateTo(e.target.value); setDateFilterMode('custom'); localStorage.setItem('as_date_filter_mode','custom'); localStorage.setItem('as_date_from',dateFrom); localStorage.setItem('as_date_to',e.target.value); }} style={{fontSize:12,height:28,border:'none',width:130,background:'transparent',fontFamily:'inherit',outline:'none',color:'#1A1D23'}} />
                </div>
                {(() => { const active = {height:32,padding:'0 10px',borderRadius:4,fontSize:11,fontWeight:600,border:'none',cursor:'pointer',fontFamily:'inherit',background:'#185FA5',color:'#fff'}; const inactive = {...active,background:'#E6F1FB',color:'#0C447C'}; return (
                <div style={{display:'flex',gap:4,marginLeft:4}}>
                  <button onClick={() => { setDateAll(false); setDateFrom(today()); setDateTo(today()); setDateFilterMode('today'); localStorage.setItem('as_date_filter_mode','today'); }} style={dateFilterMode==='today'?active:inactive}>오늘</button>
                  <button onClick={() => { setDateAll(false); const d=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Seoul'})); const y=d.getFullYear(), m=d.getMonth()+1; setDateFrom(y+'-'+String(m).padStart(2,'0')+'-01'); const lastDay=new Date(y,m,0).getDate(); setDateTo(y+'-'+String(m).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0')); setDateFilterMode('month'); localStorage.setItem('as_date_filter_mode','month'); }} style={dateFilterMode==='month'?active:inactive}>이번 달</button>
                  <button onClick={() => { setDateAll(true); setDateFilterMode('all'); localStorage.setItem('as_date_filter_mode','all'); }} style={dateFilterMode==='all'?active:inactive}>전체</button>
                </div>); })()}
              </div>
            </div>

            {/* 페이지 요약 + 버튼 */}
            <div className="page-header">
              <div className="page-header-summary">
                <span style={{fontSize:12,color:'var(--tl-text-hint)'}}>{dateLabel}</span>
                <span style={{fontSize:13,fontWeight:700,color:'var(--tl-text)',marginLeft:4}}>— {filteredAS.length}건</span>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button style={{position:'relative',display:'inline-flex',alignItems:'center',gap:5,padding:'6px 14px',borderRadius:6,border:'1.5px solid #185FA5',background:'#fff',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:600,color:'#185FA5'}} onClick={() => setSmsPopup(true)}>
                  <svg width="16" height="16" viewBox="0 0 14 14" fill="none"><path d="M2 2.5C2 1.7 2.7 1 3.5 1h7C11.3 1 12 1.7 12 2.5v5c0 .8-.7 1.5-1.5 1.5H8l-2.5 2.5V9H3.5C2.7 9 2 8.3 2 7.5v-5z" fill="#185FA5"/></svg>
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
                  <button style={{background:'#185FA5',color:'#fff',padding:'5px 12px',borderRadius:4,fontSize:11,fontWeight:600,cursor:'pointer',border:'none',fontFamily:'inherit',outline:(!kpiFilter&&!paymentFilter)?'2px solid white':'none',outlineOffset:1}} onClick={() => { setKpiFilter(null); setPaymentFilter(null); }}>
                    전체 {kpiTotal}
                  </button>
                  <span style={{color:'rgba(255,255,255,0.2)',margin:'0 6px',fontSize:16,userSelect:'none'}}>|</span>
                  {[
                    { key: 'reception', label: '접수', value: kpiReception, bg: '#185FA5' },
                    { key: 'repairing', label: '수리중', value: kpiRepairing, bg: '#EF9F27', bold: true },
                    { key: 'done', label: '완료', value: kpiDone, bg: '#185FA5' },
                    { key: 'norepair', label: '불가', value: kpiNoRepair, bg: '#185FA5' },
                  ].map(k => (
                    <button key={k.label} style={{background:k.bg,color:'#fff',padding:'5px 12px',borderRadius:4,fontSize:11,fontWeight:k.bold?700:600,cursor:'pointer',border:'none',fontFamily:'inherit',outline:kpiFilter===k.key?'2px solid white':'none',outlineOffset:1}} onClick={() => setKpiFilter(kpiFilter === k.key ? null : k.key)}>
                      {k.label} {k.value}
                    </button>
                  ))}
                  <span style={{color:'rgba(255,255,255,0.2)',margin:'0 6px',fontSize:16,userSelect:'none'}}>|</span>
                  {[
                    { key:'완료', label:'완료', value:payDone, bg:'#1D9E75' },
                    { key:'대기', label:'대기', value:payWait, bg:'#EF9F27', bold: true },
                    { key:'명세서', label:'명세서', value:payInvoice, bg:'#1D9E75' },
                    { key:'무상', label:'무상', value:payFree, bg:'#1D9E75' },
                    { key:'카드', label:'카드', value:payCard, bg:'#1D9E75' },
                    { key:'방문결제', label:'방문결제', value:payVisit, bg:'#1D9E75' },
                  ].map(p => (
                    <button key={p.key} style={{background:p.bg,color:'#fff',padding:'5px 12px',borderRadius:4,fontSize:11,fontWeight:p.bold?700:600,cursor:'pointer',border:'none',fontFamily:'inherit',outline:paymentFilter===p.key?'2px solid white':'none',outlineOffset:1}} onClick={() => setPaymentFilter(paymentFilter===p.key?null:p.key)}>
                      {p.label} {p.value}
                    </button>
                  ))}
                  <span style={{color:'rgba(255,255,255,0.2)',margin:'0 6px',fontSize:16,userSelect:'none'}}>|</span>
                  <button style={{background: deleteMode ? '#1D9E75' : '#CC2222', border:'none', color:'#fff', fontSize:11, fontWeight:700, padding:'5px 12px', borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}
                    onClick={() => setDeleteMode(!deleteMode)}>{deleteMode ? '완료' : '삭제'}</button>
                </div>
              </div>
              <div className="as-table-wrapper">
                <ASTable
                  records={filteredAS}
                  onSaveField={saveASField}
                  onAddNew={addNewAS}
                  onDelete={deleteAS}
                  onReload={() => loadData()}
                  showNewRow={showNewRow}
                  onHideNewRow={() => setShowNewRow(false)}
                  deleteMode={deleteMode}
                  technicians={technicians}
                  products={products}
                  companies={companies}
                  sendAutoSMS={sendAutoSMS}
                  confirmMap={confirmMap}
                  onOpenCustomer={(name, phone, company) => setCustomerPopup({ name, phone, company })}
                  onAddShip={async (r) => {
                    await addShip({ shipDate: today(), carrier: null, trackingNo: null, senderName: '선택', receiverName: r.customer_name || r.company_name || '', receiverPhone: r.customer_phone, receiverAddress: null, contents: r.model || null, memo: null, asRecordId: r.id, deliveryMessage: r.repair_result || null });
                    alert('택배발송에 입력되었습니다');
                  }}
                />
              </div>
            </div>
          </>
        )}

        {/* ═══ 택배발송 ═══ */}
        {tab === 'ship' && (() => {
          const SHIP_CARRIERS = ['롯데','CJ','한진','경동','로젠','우체국','대신택배','대신화물','경동화물','퀵'];
          const filtered = shipRecords.filter(r => {
            const ms = !shipSearch || [r.receiver_name, r.receiver_phone, r.contents].some(f => f?.toLowerCase().includes(shipSearch.toLowerCase()));
            const mc = shipCarrierFilter === '전체' || r.carrier === shipCarrierFilter;
            const mt = shipTrackingFilter === '전체' || (shipTrackingFilter === '미입력' ? !r.tracking_no : !!r.tracking_no);
            return ms && mc && mt;
          });
          const shipDateLabel = (() => {
            if (shipDateAll) return '전체 기간';
            const fmt2 = (ds) => { const dt = new Date(ds + 'T00:00:00'); return `${dt.getFullYear()}. ${String(dt.getMonth()+1).padStart(2,'0')}. ${String(dt.getDate()).padStart(2,'0')}.`; };
            if (shipDateFrom === shipDateTo) return fmt2(shipDateFrom);
            return `${fmt2(shipDateFrom)} ~ ${fmt2(shipDateTo)}`;
          })();
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
              <div className="as-filter-pair" style={{marginLeft:'auto'}}>
                <span className="as-filter-label">기간</span>
                <div style={{display:'flex',alignItems:'center',height:32,border:'0.5px solid #DDE1EB',borderRadius:6,padding:'0 6px',background:'#fff'}}>
                  <input type="date" value={shipDateAll ? '' : shipDateFrom} onChange={e => { setShipDateAll(false); setShipDateFrom(e.target.value); setShipDateFilterMode('custom'); localStorage.setItem('ship_date_filter_mode','custom'); localStorage.setItem('ship_date_from',e.target.value); localStorage.setItem('ship_date_to',shipDateTo); }} style={{fontSize:12,height:28,border:'none',width:130,background:'transparent',fontFamily:'inherit',outline:'none',color:'#1A1D23'}} />
                  <span style={{color:'#9BA3B2',padding:'0 4px',fontSize:12}}>~</span>
                  <input type="date" value={shipDateAll ? '' : shipDateTo} onChange={e => { setShipDateAll(false); setShipDateTo(e.target.value); setShipDateFilterMode('custom'); localStorage.setItem('ship_date_filter_mode','custom'); localStorage.setItem('ship_date_from',shipDateFrom); localStorage.setItem('ship_date_to',e.target.value); }} style={{fontSize:12,height:28,border:'none',width:130,background:'transparent',fontFamily:'inherit',outline:'none',color:'#1A1D23'}} />
                </div>
                {(() => { const active = {height:32,padding:'0 10px',borderRadius:4,fontSize:11,fontWeight:600,border:'none',cursor:'pointer',fontFamily:'inherit',background:'#185FA5',color:'#fff'}; const inactive = {...active,background:'#E6F1FB',color:'#0C447C'}; return (
                <div style={{display:'flex',gap:4,marginLeft:4}}>
                  <button onClick={() => { setShipDateAll(false); setShipDateFrom(today()); setShipDateTo(today()); setShipDateFilterMode('today'); localStorage.setItem('ship_date_filter_mode','today'); }} style={shipDateFilterMode==='today'?active:inactive}>오늘</button>
                  <button onClick={() => { setShipDateAll(false); const d=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Seoul'})); const y=d.getFullYear(), m=d.getMonth()+1; setShipDateFrom(y+'-'+String(m).padStart(2,'0')+'-01'); const lastDay=new Date(y,m,0).getDate(); setShipDateTo(y+'-'+String(m).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0')); setShipDateFilterMode('month'); localStorage.setItem('ship_date_filter_mode','month'); }} style={shipDateFilterMode==='month'?active:inactive}>이번 달</button>
                  <button onClick={() => { setShipDateAll(true); setShipDateFilterMode('all'); localStorage.setItem('ship_date_filter_mode','all'); }} style={shipDateFilterMode==='all'?active:inactive}>전체</button>
                </div>); })()}
              </div>
            </div>
            <div className="page-header">
              <div />
              <div style={{display:'flex',gap:8}}>
                <button className="btn-outline-secondary" onClick={() => exportShipExcel(filtered, shipDateLabel)}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{marginRight:4,verticalAlign:-1}}><path d="M2 1.5h8M3 4.5h6M4 7.5h4M5 10.5h2" stroke="#5A6070" strokeWidth="1" strokeLinecap="round"/></svg>
                  송장 엑셀 출력
                </button>
                <button className="btn-primary" onClick={() => setShowNewShipRow(true)}>+ 새 발송</button>
              </div>
            </div>
            <div className="section">
              <div className="section-header">
                <span style={{fontSize:12,fontWeight:600}}>택배 발송</span>
                <span style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>{shipDateLabel} — {filtered.length}건</span>
              </div>
              <div className="as-table-wrapper" style={{maxHeight:'calc(100vh - 220px)'}}>
                <ShipTable
                  records={filtered}
                  asRecords={asRecords}
                  companies={companies}
                  onSave={async (id, field, value) => { const {error} = await supabase.from('ship_records').update({[field]:value}).eq('id',id); if(error) { console.error('Ship save error:', error); alert('저장 실패: '+error.message); } loadData(); }}
                  onAdd={addShip}
                  onDelete={deleteShip}
                  showNewRow={showNewShipRow}
                  onHideNewRow={() => setShowNewShipRow(false)}
                  saveASField={saveASField}
                  sendAutoSMS={sendAutoSMS}
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

        {/* ═══ 거래처 ═══ */}
        {tab === 'companies' && (
          <CompaniesTab companies={companies} setCompanies={setCompanies} onReload={loadData} />
        )}

        {/* ═══ 제품/부속가격 ═══ */}
        {tab === 'parts' && (
          <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 110px)'}}>
            {/* 서브탭 헤더 */}
            <div style={{display:'flex',borderBottom:'0.5px solid #DDE1EB',background:'#fff',flexShrink:0}}>
              {[['parts','부속가격'],['products','제품가격'],['order','부속발주']].map(([k,v]) => (
                <div key={k} onClick={() => setPartsSubTab(k)} style={{padding:'9px 16px',fontSize:12,cursor:'pointer',color:partsSubTab===k?'#185FA5':'#5A6070',fontWeight:partsSubTab===k?500:400,borderBottom:partsSubTab===k?'2px solid #185FA5':'2px solid transparent',marginBottom:'-0.5px',userSelect:'none'}}>{v}</div>
              ))}
            </div>

            {/* 서브탭 본문 — 부속가격 */}
            {partsSubTab === 'parts' && (
              <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                <div className="as-filter-row" style={{padding:'8px 12px'}}>
                  <div className="as-filter-search-wrap" style={{flex:1}}>
                    <svg className="as-filter-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="#9BA3B2" strokeWidth="1.2"/><path d="M9.5 9.5L13 13" stroke="#9BA3B2" strokeWidth="1.2" strokeLinecap="round"/></svg>
                    <input className="input as-filter-search" placeholder="부품코드, 품명, 스펙, 모델명 검색..." value={partsSearch} onChange={e => setPartsSearch(e.target.value)} autoComplete="off" />
                  </div>
                </div>
                <div style={{padding:'4px 12px 6px',display:'flex',alignItems:'flex-start',gap:8,flexWrap:'wrap'}}>
                  <span style={{fontSize:11,color:'#9BA3B2',padding:'5px 4px',flexShrink:0,minWidth:40}}>대분류</span>
                  <div style={{display:'flex',flexWrap:'wrap',gap:4,flex:1}}>
                    {partBigCats.map(c => {
                      const active = partsBigCatFilter === c;
                      return (
                        <button key={c} onClick={() => setPartsBigCatFilter(c)}
                          style={{padding:'4px 12px',fontSize:12,background: active ? '#185FA5' : '#fff',color: active ? '#fff' : '#5A6070',border: active ? '0.5px solid #185FA5' : '0.5px solid #DDE1EB',borderRadius:4,cursor:'pointer',whiteSpace:'nowrap',fontFamily:'inherit',fontWeight: active ? 500 : 400}}>{c}</button>
                      );
                    })}
                  </div>
                </div>
                <div style={{padding:'0 12px 8px',display:'flex',alignItems:'flex-start',gap:8,flexWrap:'wrap',borderBottom:'0.5px solid #DDE1EB'}}>
                  <span style={{fontSize:11,color:'#9BA3B2',padding:'5px 4px',flexShrink:0,minWidth:40}}>모델</span>
                  <div style={{display:'flex',flexWrap:'wrap',gap:4,flex:1}}>
                    {partCats.map(c => {
                      const active = partsCatFilter === c;
                      return (
                        <button key={c} onClick={() => setPartsCatFilter(c)}
                          style={{padding:'4px 12px',fontSize:12,background: active ? '#185FA5' : '#fff',color: active ? '#fff' : '#5A6070',border: active ? '0.5px solid #185FA5' : '0.5px solid #DDE1EB',borderRadius:4,cursor:'pointer',whiteSpace:'nowrap',fontFamily:'inherit',fontWeight: active ? 500 : 400}}>{c}</button>
                      );
                    })}
                  </div>
                </div>
                <div className="section" style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                  <div className="section-header">
                    <span style={{fontSize:12,fontWeight:600}}>부속가격</span>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <span style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>총 {filteredParts.length}건</span>
                      <button className="btn-primary" style={{fontSize:11,padding:'4px 12px'}} onClick={() => setModal({type:'part-new'})}>+ 새 부품</button>
                    </div>
                  </div>
                  <div className="as-table-wrapper" style={{flex:1,overflow:'auto'}}>
                    <PartsTable parts={filteredParts} setParts={setParts} categories={partCategories} setCategories={setPartCategories} products={products} onPhotoClick={info => setPartLightbox(info)} onEdit={p => setModal({type:'part-edit',data:p})} onCopy={p => setModal({type:'part-new',data:{...p, id: undefined, code: ''}})} />
                  </div>
                </div>
              </div>
            )}

            {/* 서브탭 본문 — 제품가격 */}
            {partsSubTab === 'products' && (
              <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                <div className="as-filter-row" style={{padding:'8px 12px'}}>
                  <div className="as-filter-search-wrap">
                    <svg className="as-filter-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="#9BA3B2" strokeWidth="1.2"/><path d="M9.5 9.5L13 13" stroke="#9BA3B2" strokeWidth="1.2" strokeLinecap="round"/></svg>
                    <input className="input as-filter-search" placeholder="브랜드, 모델 검색..." value={productsSearch} onChange={e => setProductsSearch(e.target.value)} autoComplete="off" />
                  </div>
                </div>
                <div className="section" style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                  <div className="section-header">
                    <span style={{fontSize:12,fontWeight:600}}>제품가격</span>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <span style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>총 {filteredProducts.length}건</span>
                      <button className="btn-primary" style={{fontSize:11,padding:'4px 12px'}} onClick={async () => {
                        const maxOrder = products.reduce((m, p) => Math.max(m, p.sort_order || 0), 0);
                        const { data, error } = await supabase.from('products').insert({ brand: '', model: '', price: 0, sort_order: maxOrder + 1 }).select().single();
                        if (error) { alert('추가 실패: ' + error.message); return; }
                        setProducts(prev => [...prev, data]);
                      }}>+ 제품 추가</button>
                    </div>
                  </div>
                  <div className="as-table-wrapper" style={{flex:1,overflow:'auto'}}>
                    <ProductsTable products={filteredProducts} onReload={() => loadData()} setProducts={setProducts} />
                  </div>
                </div>
              </div>
            )}

            {/* 서브탭 본문 — 부속발주 (Phase 2-1a) */}
            {partsSubTab === 'order' && (
              <PartsOrderTab
                parts={parts}
                models={partCats}
                categories={partCategories}
                onPhotoClick={info => setPartLightbox(info)}
                cart={cart}
                setCart={setCart}
                currentDraftId={currentDraftId}
                onAddToCart={handleAddToCart}
                onSaveDraft={async () => {
                  const id = await saveDraft();
                  if (id) {
                    alert('작성중으로 저장되었습니다');
                    setCart([]);
                    setCurrentDraftId(null);
                  }
                }}
                onConfirm={() => setShowConfirmModal(true)}
                onShowHistory={() => setShowHistoryModal(true)}
                onShowTemplate={() => setShowTemplateModal(true)}
                loadOrders={loadOrders}
                loadDraft={loadDraft}
              />
            )}
          </div>
        )}

        {/* 부속 사진 라이트박스 */}
        {partLightbox && (
          <PhotoLightbox
            url={partLightbox.url}
            name={partLightbox.name}
            code={partLightbox.code}
            partId={partLightbox.partId}
            readOnly={partLightbox.readOnly}
            onClose={() => setPartLightbox(null)}
            onUpdate={(newUrl) => {
              if (!partLightbox?.partId) return;
              setParts(prev => prev.map(p => p.id === partLightbox.partId ? { ...p, image_url: newUrl } : p));
            }}
          />
        )}

        {/* 부속발주 확정 모달 */}
        {showConfirmModal && (
          <OrderConfirmModal cart={cart} onConfirm={confirmOrder} onClose={() => setShowConfirmModal(false)} />
        )}

        {/* 부속발주 이력 모달 */}
        {showHistoryModal && (
          <OrderHistoryModal
            orders={orders}
            orderItems={orderItems}
            parts={parts}
            onLoadDraft={loadDraft}
            onClose={() => setShowHistoryModal(false)}
            onGeneratePdf={async (order) => {
              try {
                const result = await generateOrderPDF(order, orderItems, parts);
                setPdfPreview(result);
              } catch (err) {
                alert('PDF 생성 실패: ' + (err?.message || err));
                console.error(err);
              }
            }}
            onDeleteOrder={async (order) => {
              const isConfirmed = order.status === 'confirmed';
              const message = isConfirmed
                ? '이 확정된 발주를 삭제하시겠습니까?\n⚠️ 이미 거래처에 전달된 발주일 수 있습니다.\n삭제하면 복구할 수 없습니다.'
                : '이 작성중 발주를 삭제하시겠습니까?\n장바구니에 불러온 상태라면 함께 비워집니다.';
              if (!confirm(message)) return;
              const { error } = await supabase.from('parts_orders').delete().eq('id', order.id);
              if (error) { alert('삭제 실패: ' + error.message); return; }
              if (currentDraftId === order.id) {
                setCart([]);
                setCurrentDraftId(null);
              }
              await loadOrders();
            }}
          />
        )}

        {pdfPreview && (
          <PdfPreviewModal
            preview={pdfPreview}
            onClose={() => {
              if (pdfPreview?.blobUrl) URL.revokeObjectURL(pdfPreview.blobUrl);
              setPdfPreview(null);
            }}
            onDownload={() => {
              if (pdfPreview?.blob && pdfPreview?.filename) {
                downloadPdfBlob(pdfPreview.blob, pdfPreview.filename);
              }
            }}
          />
        )}

        {showTemplateModal && (
          <TemplateModal
            templates={templates}
            parts={parts}
            cart={cart}
            onApply={(items) => {
              const itemsToAdd = items.map(it => {
                const part = parts.find(p => p.id === it.part_id);
                if (!part) return null;
                return { ...part, part_id: part.id, quantity: it.quantity };
              }).filter(Boolean);
              setCart(prev => {
                const next = [...prev];
                for (const newItem of itemsToAdd) {
                  const idx = next.findIndex(c => (c.part_id || c.id) === newItem.part_id);
                  if (idx >= 0) next[idx] = { ...next[idx], quantity: (next[idx].quantity || 0) + newItem.quantity };
                  else next.push(newItem);
                }
                return next;
              });
              setShowTemplateModal(false);
            }}
            onSave={async ({ name, memo, items }) => {
              const { data: tpl, error: tplErr } = await supabase
                .from('parts_templates')
                .insert({ name, memo })
                .select()
                .single();
              if (tplErr) { alert('템플릿 저장 실패: ' + tplErr.message); return null; }
              if (items.length > 0) {
                const newItems = items.map((it, i) => ({
                  template_id: tpl.id,
                  part_id: it.part_id,
                  quantity: it.quantity,
                  sort_order: i,
                }));
                const { error: itemErr } = await supabase.from('parts_template_items').insert(newItems);
                if (itemErr) { alert('항목 저장 실패: ' + itemErr.message); return null; }
              }
              await loadTemplates();
              return tpl.id;
            }}
            onUpdate={async (id, { name, memo, items }) => {
              const { error: tplErr } = await supabase
                .from('parts_templates')
                .update({ name, memo, updated_at: new Date().toISOString() })
                .eq('id', id);
              if (tplErr) { alert('저장 실패: ' + tplErr.message); return; }
              await supabase.from('parts_template_items').delete().eq('template_id', id);
              if (items.length > 0) {
                const newItems = items.map((it, i) => ({
                  template_id: id,
                  part_id: it.part_id,
                  quantity: it.quantity,
                  sort_order: i,
                }));
                const { error: itemErr } = await supabase.from('parts_template_items').insert(newItems);
                if (itemErr) { alert('항목 저장 실패: ' + itemErr.message); return; }
              }
              await loadTemplates();
            }}
            onDelete={async (id) => {
              const { error } = await supabase.from('parts_templates').delete().eq('id', id);
              if (error) { alert('삭제 실패: ' + error.message); return; }
              await loadTemplates();
            }}
            onClose={() => setShowTemplateModal(false)}
          />
        )}

        {/* 부품 모달 */}
        {modal && (modal.type === 'part-new' || modal.type === 'part-edit') && (
          <PartModal
            initial={modal.data}
            categories={partCategories}
            onSave={async (d) => {
              if (modal.type === 'part-new') {
                const { error } = await supabase.from('parts').insert(d);
                if (error) alert('저장 실패: ' + error.message);
              } else {
                const { error } = await supabase.from('parts').update(d).eq('id', modal.data.id);
                if (error) alert('수정 실패: ' + error.message);
              }
              setModal(null); loadData();
            }}
            onDelete={modal.type === 'part-edit' ? async () => {
              if (!confirm('이 부품을 삭제하시겠습니까?')) return;
              await supabase.from('parts').delete().eq('id', modal.data.id);
              setModal(null); loadData();
            } : null}
            onClose={() => setModal(null)}
          />
        )}

        {/* ═══ 설정 ═══ */}
        {tab === 'settings' && (
          <SettingsTab asRecords={asRecords} />
        )}
      </div>

      {/* ═══ 기타 MODALS (부품 모달이 아닐 때만) ═══ */}
      {modal && modal.type !== 'part-new' && modal.type !== 'part-edit' && (
        <div className="modal-overlay">
          <div className="modal-content" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* ═══ 고객 이력 팝업 ═══ */}
      {smsPopup && <SMSPopup onClose={() => setSmsPopup(false)} onUnreadChange={setUnreadCount} onConfirmSent={(phone) => setConfirmMap(prev => ({...prev, [phone]: true}))} />}
      {customerPopup && (
        <CustomerPopup
          customer={customerPopup}
          onClose={() => setCustomerPopup(null)}
          onConfirmSent={(phone) => setConfirmMap(prev => ({...prev, [phone]: true}))}
        />
      )}
    </>
  );
}


/* ═══════════════════════════════════════════════
   AS 테이블 — 인라인 편집
   ═══════════════════════════════════════════════ */
function ASTable({ records, onSaveField, onAddNew, onDelete, onReload, showNewRow, onHideNewRow, onOpenCustomer, onAddShip, deleteMode, technicians, products, companies, sendAutoSMS, confirmMap }) {
  const [editCell, setEditCell] = useState(null); // {id, field} — 텍스트/숫자/날짜용
  const [editValue, setEditValue] = useState('');
  const [badgeOpen, setBadgeOpen] = useState(null); // {id, field} — 뱃지 펼침용
  const [newRow, setNewRow] = useState(emptyRow());
  // showNewRow 열릴 때마다 오늘 날짜로 리셋
  useEffect(() => { if (showNewRow) setNewRow(emptyRow()); }, [showNewRow]);
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
      record_type: 'as_repair', receipt_date: today(), brand: '', intake_carrier: '롯데',
      shipping_fee: '', invoice_type: '없음(일반소매)', company_name: '', customer_name: '',
      customer_phone: '', model: '', symptom: '', memo: '',
      repair_result: '', technician: '', status: '접수', repair_cost: '',
      payment_status: '대기', payer: '',
      release_date: '', release_carrier: '', tracking_number: '', release_memo: '',
    };
  }

  // 뱃지 펼침 바깥 클릭/스크롤 닫기 (모델명/출고택배는 긴 목록이므로 바깥 클릭/스크롤로 안 닫힘)
  useEffect(() => {
    if (!badgeOpen) return;
    const isLongList = badgeOpen.field === 'model' || badgeOpen.field === 'release_carrier' || badgeOpen.field === 'intake_carrier';
    const handler = (e) => { if (!e.target.closest('.badge-expand-panel')) { setBadgeOpen(null); setBadgePos(null); } };
    const escHandler = (e) => { if (e.key === 'Escape') { setBadgeOpen(null); setBadgePos(null); } };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
      document.addEventListener('keydown', escHandler);
    }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', escHandler); };
  }, [badgeOpen]);

  // 뱃지 선택 → 즉시 저장
  const saveBadge = async (id, field, value) => {
    setBadgeOpen(null);
    await onSaveField(id, field, value);
    // 입고 택배사 "방문" 선택 시 운임 자동 0원
    if (field === 'intake_carrier' && value === '방문') {
      await onSaveField(id, 'shipping_fee', '0');
    }
    // 출고 택배 선택해제("") 시 출고 관련 3필드 비움
    if (field === 'release_carrier' && value === '') {
      await onSaveField(id, 'release_date', null);
      await onSaveField(id, 'tracking_number', '');
      onReload();
      return;
    }
    // 출고 택배 "방문" 선택 시 출고일+운송장 자동 설정
    if (field === 'release_carrier' && value === '방문') {
      await onSaveField(id, 'release_date', today());
      await onSaveField(id, 'tracking_number', '방문');
      // 출고 알림 자동 발송
      const row = records.find(r => r.id === id);
      if (row && sendAutoSMS) {
        sendAutoSMS('release', { ...row, release_carrier: '방문', release_date: today(), tracking_number: '방문' });
      }
    }
    // 구분 → 부품판매 선택 시 모델명 자동 설정
    if (field === 'record_type' && value === 'parts_sale') {
      await onSaveField(id, 'model', '부품판매');
    }
    // 구분 → 부품판매에서 다른 값으로 변경 시 모델명 초기화
    if (field === 'record_type' && value !== 'parts_sale') {
      const row = records.find(r => r.id === id);
      if (row && row.record_type === 'parts_sale') {
        await onSaveField(id, 'model', '');
      }
    }
    onReload();
  };

  const startEdit = (id, field, value) => {
    setEditCell({ id, field });
    setEditValue(value ?? '');
  };

  const commitEdit = async () => {
    if (!editCell) return;
    const { id, field } = editCell;
    setEditCell(null);

    // 거래처/성함: "거래처 / 성함" 형태 → 분리 저장
    if (field === 'company_name') {
      const parts = editValue.split('/').map(s => s.trim());
      const nextCompany = parts[0] || '';
      const nextCustomer = parts[1] || '';
      const row = records.find(r => r.id === id);
      const prevCompany = row?.company_name || '';
      const prevCustomer = row?.customer_name || '';
      let changed = false;
      if (nextCompany !== prevCompany) { await onSaveField(id, 'company_name', nextCompany || null); changed = true; }
      if (nextCustomer !== prevCustomer) { await onSaveField(id, 'customer_name', nextCustomer || null); changed = true; }
      if (changed) onReload();
      return;
    }

    let val = editValue;
    if (field === 'repair_cost') val = parseInt(String(val).replace(/,/g, '')) || 0;
    const finalVal = val || null;

    const row = records.find(r => r.id === id);
    const prevVal = row ? row[field] : undefined;
    const prev = (prevVal === undefined || prevVal === null) ? null : prevVal;
    const next = (finalVal === undefined || finalVal === null || finalVal === '') ? null : finalVal;

    if (String(prev ?? '') !== String(next ?? '')) {
      await onSaveField(id, field, next);
      onReload();
    }
  };

  const handleNewRowSave = async () => {
    const row = { ...newRow };
    row.repair_cost = parseInt(String(row.repair_cost).replace(/,/g,'')) || 0;
    // 거래처/성함 분리 저장: "거래처 / 성함" → company_name + customer_name
    if (row.company_name && row.company_name.includes('/')) {
      const parts = row.company_name.split('/').map(s => s.trim());
      row.company_name = parts[0] || '';
      if (parts[1]) row.customer_name = parts[1];
    } else if (row.company_name && !row.customer_name) {
      // "/" 없이 이름만 입력 → 일반소비자 (customer_name으로 이동)
      row.customer_name = row.company_name;
      row.company_name = '';
    }
    Object.keys(row).forEach(k => { if (row[k] === '') row[k] = null; });
    // 필수값 강제 설정
    row.receipt_date = row.receipt_date || today();
    row.record_type = row.record_type || 'as_repair';
    row.status = row.status || '접수';
    await onAddNew(row);
    setNewRow(emptyRow());
    setCompanyQuery(''); setCompanyDropOpen(false);
    if (onHideNewRow) onHideNewRow();
  };

  const DEFAULT_WIDTHS = {
    record_type:70, receipt_date:120, brand:70, intake_carrier:70, shipping_fee:80,
    invoice_type:70, company_name:160, _msg:30, _confirm:50, customer_phone:120, model:100, symptom:180, memo:100,
    repair_result:160, technician:80, status:80, repair_cost:90,
    payment_status:70, payer:80,
    release_date:120, release_carrier:80, tracking_number:130, _ship_btn:55,
  };
  const COL_GROUPS = [
    { label: '입고', bg: '#E6F1FB', color: '#0C447C', border: '#85B7EB', span: 13 },
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
    { key:'company_name', label:'거래처/성함', w:150, type:'text', combined: true },
    { key:'_msg', label:'msg', w:30, type:'action', isMsgCol: true },
    { key:'_confirm', label:'확인', w:50, type:'action' },
    { key:'customer_phone', label:'연락처', w:115, type:'text' },
    { key:'model', label:'모델명', w:100, type:'select', opts: (() => { const list = [...new Set((products||[]).map(p=>p.model).filter(Boolean))].sort(); if (!list.includes('부품판매')) list.unshift('부품판매'); if (!list.includes('기타')) list.push('기타'); return list; })() },
    { key:'symptom', label:'증상', w:180, type:'text' },
    { key:'memo', label:'비고', w:100, type:'memo', groupEnd: true, groupBorderColor: '#B5D4F4', groupBorderColorBody: '#E6F1FB' },
    // 초록 그룹
    { key:'repair_result', label:'처리결과', w:160, type:'text' },
    { key:'technician', label:'처리자', w:80, type:'select', opts: (technicians || []).map(t => t.name) },
    { key:'status', label:'AS상태', w:80, type:'select', opts: STATUS_LIST },
    { key:'repair_cost', label:'AS비용', w:90, type:'number', groupEnd: true, groupBorderColor: '#9FE1CB', groupBorderColorBody: '#E1F5EE' },
    // 노란 그룹
    { key:'payment_status', label:'입금', w:80, type:'select', opts: PAYMENT_STATUS },
    { key:'payer', label:'입금자', w:80, type:'text', groupEnd: true, groupBorderColor: '#FAC775', groupBorderColorBody: '#FAEEDA' },
    // 보라 그룹 — 읽기전용 (택배발송에서 자동 입력)
    { key:'release_date', label:'출고일', w:115, type:'readonly' },
    { key:'release_carrier', label:'택배', w:80, type:'select', opts: ["롯데","CJ","한진","경동","로젠","우체국","대신택배","대신화물","경동화물","방문","용차","퀵"] },
    { key:'tracking_number', label:'운송장번호', w:130, type:'readonly' },
    { key:'_ship_btn', label:'택배', w:55, type:'action' },
  ];

  // 뱃지 색상 매핑
  const CARRIER_COLORS = { '롯데':['#185FA5','#FFFFFF'],'롯데택배':['#185FA5','#FFFFFF'],'CJ':['#1D9E75','#FFFFFF'],'CJ대한통운':['#1D9E75','#FFFFFF'],'한진':['#534AB7','#FFFFFF'],'한진택배':['#534AB7','#FFFFFF'],'경동':['#854F0B','#FFFFFF'],'경동택배':['#854F0B','#FFFFFF'],'경동화물':['#854F0B','#FFFFFF'],'대신화물':['#D85A30','#FFFFFF'],'대신택배':['#D85A30','#FFFFFF'],'로젠':['#CC2222','#FFFFFF'],'로젠택배':['#CC2222','#FFFFFF'],'우체국':['#EF9F27','#FFFFFF'],'방문':['#5A6070','#FFFFFF'],'용차':['#5A6070','#FFFFFF'],'퀵':['#6B7280','#FFFFFF'],'매장':['#5A6070','#FFFFFF'] };
  const BADGE_COLORS = {
    record_type: { as_repair:['#E6F1FB','#0C447C'], product_sale:['#E1F5EE','#085041'], parts_sale:['#FAEEDA','#412402'] },
    brand: { '콜라보':['#E6F1FB','#0C447C'],'마끼다':['#E1F5EE','#085041'],'디월트':['#FAEEDA','#412402'],'프레레':['#EEEDFE','#26215C'],'기타':['#F1EFE8','#2C2C2A'] },
    status: { '접수':['#185FA5','#FFFFFF'],'진단중':['#185FA5','#FFFFFF'],'부품대기':['#EF9F27','#FFFFFF'],'수리중':['#D85A30','#FFFFFF'],'완료':['#1D9E75','#FFFFFF'],'수리X':['#CC2222','#FFFFFF'],'폐기':['#5A6070','#FFFFFF'] },
    payment_status: { '완료':['#1D9E75','#FFFFFF'],'대기':['#185FA5','#FFFFFF'],'명세서':['#854F0B','#FFFFFF'],'무상':['#5A6070','#FFFFFF'],'카드':['#CC2222','#FFFFFF'],'방문결제':['#534AB7','#FFFFFF'] },
    invoice_type: { '없음(일반소매)':['#F1EFE8','#2C2C2A'],'계산서(거래처)':['#E6F1FB','#0C447C'],'월말':['#FAEEDA','#412402'] },
    intake_carrier: CARRIER_COLORS,
    release_carrier: CARRIER_COLORS,
  };
  const getBadgeColor = (field, v) => {
    if (field === 'technician' && v) return ['#E6F1FB','#0C447C'];
    return (BADGE_COLORS[field] && BADGE_COLORS[field][v]) || ['#F4F6FA','#1A1D23'];
  };
  const getBadgeLabel = (col, v) => col.fromDb ? col.fromDb(v) : (col.key === 'invoice_type' ? (v === '없음(일반소매)' ? '일반' : v === '계산서(거래처)' ? '계산서' : v) : v);

  const [badgePos, setBadgePos] = useState(null);

  const renderBadgeExpand = (r, col) => {
    const dbVal = r[col.key];
    const displayVal = col.fromDb ? col.fromDb(dbVal) : dbVal;
    // 부품판매: 모델명 읽기 전용
    if (col.key === 'model' && r.record_type === 'parts_sale') {
      const modelVal = r.model || '부품판매';
      const [bg2, c2] = getBadgeColor(col.key, modelVal);
      return <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,whiteSpace:'nowrap',fontFamily:'Pretendard,sans-serif',background:bg2,color:c2,cursor:'default'}}>{modelVal}</span>;
    }
    const isOpen = badgeOpen?.id === r.id && badgeOpen?.field === col.key;
    const [bg, c] = getBadgeColor(col.key, dbVal || displayVal);
    const empty = <span className="empty-dot">●</span>;
    return (
      <div className="badge-expand-panel" style={{overflow:'hidden'}} onClick={e => e.stopPropagation()}>
        <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',fontFamily:'Pretendard,sans-serif',background: displayVal ? bg : '#F4F6FA',color: displayVal ? c : '#9BA3B2',cursor:'pointer',border: isOpen ? `2px solid ${c}` : '2px solid transparent'}}
          onClick={e => { if (isOpen) { setBadgeOpen(null); setBadgePos(null); } else { const rect = e.currentTarget.getBoundingClientRect(); setBadgePos({top:rect.bottom+2,left:rect.left}); setBadgeOpen({id:r.id, field:col.key}); } }}>
          {displayVal ? getBadgeLabel(col, dbVal) : '—'}
        </span>
        {isOpen && badgePos && (
          <div onMouseDown={e => e.stopPropagation()} style={{position:'fixed',top:badgePos.top,left:badgePos.left,zIndex:9999,background:'#fff',border:'1px solid #DDE1EB',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',padding:4,minWidth:80,maxHeight:(col.key==='model'||col.key==='release_carrier'||col.key==='intake_carrier')?300:200,overflowY:'auto',WebkitOverflowScrolling:'touch'}}>
            {col.key === 'release_carrier' && <div style={{display:'flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'Pretendard,sans-serif',background:'#F4F6FA',color:'#9BA3B2',marginBottom:2,border:!dbVal?'2px solid #9BA3B2':'2px solid transparent',whiteSpace:'nowrap'}} onClick={() => saveBadge(r.id, col.key, '')}>—</div>}
            {col.opts.map(o => {
              const ov = col.toDb ? col.toDb(o) : o;
              const [obg,oc] = getBadgeColor(col.key, ov);
              const selected = (dbVal === ov) || (displayVal === o);
              return <div key={o} style={{display:'flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'Pretendard,sans-serif',background:obg,color:oc,marginBottom:2,border: selected ? `2px solid ${oc}` : '2px solid transparent',whiteSpace:'nowrap'}}
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

    // 메모 타입 — 아이콘 버튼 + 팝업
    if (col.type === 'memo') {
      const hasContent = !!val;
      const iconColor = col.key === 'repair_result' ? (hasContent ? '#1D9E75' : '#9BA3B2') : (hasContent ? '#185FA5' : '#9BA3B2');
      const title = col.key === 'repair_result' ? '처리결과' : '비고';
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{cursor:'pointer',display:'block',margin:'0 auto'}}
          onClick={e => { e.stopPropagation(); openMemoPopup(r.id, col.key, r[col.key], title); }}>
          <path d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v9a1.5 1.5 0 01-1.5 1.5H6l-3 2.5V2.5z" fill={iconColor}/>
          {hasContent && <path d="M5.5 5h5M5.5 7.5h3.5" stroke="#fff" strokeWidth="1" strokeLinecap="round"/>}
        </svg>
      );
    }

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
    const B = (bg, color, text, extra) => <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',fontFamily:'Pretendard,sans-serif',background:bg,color,...(extra||{})}}>{text}</span>;
    const empty = <span className="empty-dot">●</span>;

    // 읽기전용 셀 (출고 그룹)
    if (col.type === 'readonly') {
      if (!val) return empty;
      if (col.key === 'release_date') return <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,background:'#5A6070',color:'#FFFFFF',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',fontFamily:'Pretendard,sans-serif'}}>{fmtDate(val)}</span>;
      if (col.key === 'tracking_number') return <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,background:'#5A6070',color:'#FFFFFF',whiteSpace:'nowrap',fontFamily:'Pretendard,sans-serif'}}>{val}</span>;
      return <span style={{fontSize:13,fontWeight:400,color:'#1A1D23',fontFamily:'Pretendard,sans-serif'}}>{val}</span>;
    }
    // 문자 아이콘 컬럼
    if (col.key === '_msg') {
      return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{cursor:'pointer',opacity:0.7,display:'block',margin:'0 auto'}} onClick={e => { e.stopPropagation(); onOpenCustomer && onOpenCustomer(r.customer_name, r.customer_phone, r.company_name); }} onMouseOver={e => e.currentTarget.style.opacity='1'} onMouseOut={e => e.currentTarget.style.opacity='0.7'}><path d="M2 2.5C2 1.7 2.7 1 3.5 1h7C11.3 1 12 1.7 12 2.5v5c0 .8-.7 1.5-1.5 1.5H8l-2.5 2.5V9H3.5C2.7 9 2 8.3 2 7.5v-5z" fill="#185FA5"/></svg>;
    }
    // 확인 컬럼
    if (col.key === '_confirm') {
      if (confirmMap && r.customer_phone && confirmMap[toLocal(r.customer_phone)]) return <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',background:'#FCEBEB',color:'#791F1F',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',fontFamily:'Pretendard,sans-serif'}}>발송완료</span>;
      return empty;
    }
    // 입고일
    if (col.type === 'date') return val ? <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,background:'#5A6070',color:'#FFFFFF',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',fontFamily:'Pretendard,sans-serif'}}>{fmtDate(val)}</span> : empty;
    // 택배 버튼
    if (col.key === '_ship_btn') {
      if (r.release_date || r.tracking_number) return empty;
      if (r.status !== '완료' && r.status !== '수리X') return empty;
      if (r.payment_status !== '완료') return empty;
      return <button style={{display:'inline-flex',justifyContent:'center',alignItems:'center',background:'#CC2222',color:'#FFFFFF',border:'none',borderRadius:4,padding:'4px 8px',fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',fontFamily:'Pretendard,sans-serif'}} onClick={e => { e.stopPropagation(); onAddShip && onAddShip(r); }}>발송</button>;
    }
    // AS비용
    if (col.key === 'repair_cost') return val ? <span style={{fontSize:13,fontWeight:700,color:'#185FA5',fontFamily:'Pretendard,sans-serif'}}>{fmt(val)}</span> : empty;
    // 운임
    if (col.key === 'shipping_fee') {
      if (r.intake_carrier === '방문') return B('#F4F6FA','#5A6070','방문');
      return val ? <span style={{fontSize:13,fontWeight:700,color:'#185FA5',fontFamily:'Pretendard,sans-serif'}}>{val}</span> : empty;
    }
    // 거래처/성함
    if (col.key === 'company_name') {
      if (isEditing) {
        return (
          <input className="as-cell-input" value={editValue} autoFocus placeholder="거래처 / 성함"
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }}} />
        );
      }
      const p = [r.company_name, r.customer_name].filter(Boolean);
      if (p.length === 0) return empty;
      return <span style={{fontSize:13,fontWeight:400,color:'#1A1D23',fontFamily:'Pretendard,sans-serif',cursor:'text'}}>{p.join(' / ')}</span>;
    }
    // 연락처
    if (col.key === 'customer_phone') return val ? <span style={{fontSize:13,fontWeight:400,color:'#1A1D23',fontFamily:'Pretendard,sans-serif'}}>{val}</span> : empty;
    // 처리결과 — 쉼표 기준 뱃지 분리
    if (col.key === 'repair_result') {
      if (!val) return empty;
      const parts = String(val).split(',').map(s => s.trim()).filter(Boolean);
      return <span style={{display:'flex',flexWrap:'wrap',gap:3,justifyContent:'center'}}>{parts.map((p, i) => <span key={i} style={{display:'inline-flex',padding:'2px 6px',borderRadius:4,fontSize:11,fontWeight:600,background:'#E1F5EE',color:'#085041',whiteSpace:'nowrap',fontFamily:'Pretendard,sans-serif'}}>{p}</span>)}</span>;
    }
    return val ? <span style={{fontSize:13,fontWeight:400,color:'#1A1D23',fontFamily:'Pretendard,sans-serif'}}>{val}</span> : empty;
  };

  const [newBadgeOpen, setNewBadgeOpen] = useState(null); // field name
  const [newBadgePos, setNewBadgePos] = useState(null);
  const [memoPopup, setMemoPopup] = useState(null); // {id, field, value, title, isNew}
  const [memoValue, setMemoValue] = useState('');
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productPickerSearch, setProductPickerSearch] = useState('');
  const [companyQuery, setCompanyQuery] = useState('');
  const [companyDropOpen, setCompanyDropOpen] = useState(false);
  const [companyDropPos, setCompanyDropPos] = useState(null);
  const companyInputRef = useRef(null);

  const openMemoPopup = (id, field, currentVal, title, isNew = false) => {
    setMemoPopup({ id, field, title, isNew });
    setMemoValue(currentVal || '');
  };
  const saveMemoPopup = async () => {
    if (!memoPopup) return;
    if (memoPopup.isNew) {
      setNewRow(p => ({...p, [memoPopup.field]: memoValue || ''}));
    } else {
      await onSaveField(memoPopup.id, memoPopup.field, memoValue || null);
      onReload();
    }
    setMemoPopup(null);
  };

  // 거래처 자동완성 바깥 클릭 닫기
  useEffect(() => {
    if (!companyDropOpen) return;
    const h = (e) => { if (!e.target.closest('.company-autocomplete')) { setCompanyDropOpen(false); setCompanyDropPos(null); } };
    const timer = setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', h); };
  }, [companyDropOpen]);

  useEffect(() => {
    if (!newBadgeOpen) return;
    const isModel = newBadgeOpen === 'model';
    const h = (e) => { if (!e.target.closest('.badge-expand-panel')) { setNewBadgeOpen(null); setNewBadgePos(null); } };
    const esc = (e) => { if (e.key === 'Escape') { setNewBadgeOpen(null); setNewBadgePos(null); } };
    const scrollH = () => { setNewBadgeOpen(null); setNewBadgePos(null); };
    const timer = setTimeout(() => {
      if (!isModel) { document.addEventListener('click', h); document.addEventListener('scroll', scrollH, true); }
      document.addEventListener('keydown', esc);
    }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', h); document.removeEventListener('keydown', esc); document.removeEventListener('scroll', scrollH, true); };
  }, [newBadgeOpen]);

  const renderNewCell = (col) => {
    const val = col.key === 'company_name' ? newRow.company_name : newRow[col.key] ?? '';
    if (col.type === 'select') {
      // 부품판매: 모델명 읽기 전용
      if (col.key === 'model' && newRow.record_type === 'parts_sale') {
        const [bg, c] = getBadgeColor(col.key, '부품판매');
        return <span style={{display:'inline-flex',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600,whiteSpace:'nowrap',background:bg,color:c,cursor:'default'}}>부품판매</span>;
      }
      // val이 이미 DB값일 수 있으므로(emptyRow/선택 시 DB값 저장), fromDb로 변환 가능하면 그대로 사용
      const dbVal = col.toDb && col.fromDb ? (col.fromDb(val) !== val ? val : col.toDb(val)) : (col.toDb ? col.toDb(val) : val);
      const displayVal = col.fromDb ? col.fromDb(dbVal) : dbVal;
      const isOpen = newBadgeOpen === col.key;
      const [bg, c] = getBadgeColor(col.key, dbVal || displayVal);
      return (
        <div className="badge-expand-panel" onClick={e => e.stopPropagation()}>
          <span style={{display:'inline-flex',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600,whiteSpace:'nowrap',background:displayVal?bg:'#F4F6FA',color:displayVal?c:'#9BA3B2',cursor:'pointer',border:isOpen?`2px solid ${c}`:'2px solid transparent'}}
            onClick={e => { if (isOpen) { setNewBadgeOpen(null); setNewBadgePos(null); } else { const rect = e.currentTarget.getBoundingClientRect(); setNewBadgePos({top:rect.bottom+2,left:rect.left}); setNewBadgeOpen(col.key); } }}>
            {displayVal ? getBadgeLabel(col, dbVal) : '선택'}
          </span>
          {isOpen && newBadgePos && (
            <div style={{position:'fixed',top:newBadgePos.top,left:newBadgePos.left,zIndex:9999,background:'#fff',border:'1px solid #DDE1EB',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',padding:4,minWidth:80,maxHeight:col.key==='model'?300:200,overflowY:'auto',WebkitOverflowScrolling:'touch'}}>
              {col.opts.map(o => {
                const ov = col.toDb ? col.toDb(o) : o;
                const [obg,oc] = getBadgeColor(col.key, ov);
                return <div key={o} style={{padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:600,cursor:'pointer',background:obg,color:oc,marginBottom:2,whiteSpace:'nowrap',border:dbVal===ov?`2px solid ${oc}`:'2px solid transparent'}}
                  onClick={() => { setNewRow(p => { const next = {...p, [col.key]: ov}; if (col.key === 'intake_carrier' && ov === '방문') next.shipping_fee = '0'; if (col.key === 'release_carrier' && ov === '방문') { next.release_date = today(); next.tracking_number = '방문'; } if (col.key === 'record_type' && ov === 'parts_sale') next.model = '부품판매'; if (col.key === 'record_type' && ov !== 'parts_sale' && p.record_type === 'parts_sale') next.model = ''; return next; }); setNewBadgeOpen(null); setNewBadgePos(null); if (col.key === 'record_type' && ov === 'product_sale') { setProductPickerSearch(''); setProductPickerOpen(true); } }}>{getBadgeLabel(col, ov)}</div>;
              })}
            </div>
          )}
        </div>
      );
    }
    if (col.type === 'date') {
      if (col.key === 'receipt_date') {
        const d = new Date(); const m = d.getMonth() + 1; const dd = d.getDate();
        return <span style={{display:'inline-flex',padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:600,background:'#F4F6FA',color:'#5A6070',whiteSpace:'nowrap'}}>{m}월 {dd}일</span>;
      }
      return <input type="date" className="as-cell-input" value={val} onChange={e => setNewRow(p => ({...p,[col.key]:e.target.value}))} />;
    }
    if (col.type === 'memo') {
      const hasContent = !!val;
      const iconColor = col.key === 'repair_result' ? (hasContent ? '#1D9E75' : '#9BA3B2') : (hasContent ? '#185FA5' : '#9BA3B2');
      const title = col.key === 'repair_result' ? '처리결과' : '비고';
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{cursor:'pointer',display:'block',margin:'0 auto'}}
          onClick={e => { e.stopPropagation(); openMemoPopup(null, col.key, val, title, true); }}>
          <path d="M3 2.5A1.5 1.5 0 014.5 1h7A1.5 1.5 0 0113 2.5v9a1.5 1.5 0 01-1.5 1.5H6l-3 2.5V2.5z" fill={iconColor}/>
          {hasContent && <path d="M5.5 5h5M5.5 7.5h3.5" stroke="#fff" strokeWidth="1" strokeLinecap="round"/>}
        </svg>
      );
    }
    // 거래처/성함 — 자동완성
    if (col.key === 'company_name') {
      const INVOICE_BADGE_AC = { '월말': ['#185FA5','#FFFFFF'], '계산서': ['#1D9E75','#FFFFFF'] };
      // "/" 앞부분(거래처명)으로 검색
      const searchPart = companyQuery.split('/')[0].trim();
      const matchedCompanies = searchPart.length >= 2 ? (companies || []).filter(c => c.company_name?.toLowerCase().includes(searchPart.toLowerCase())) : [];
      return (
        <div className="company-autocomplete" style={{position:'relative'}}>
          <input className="as-cell-input" ref={companyInputRef} value={companyQuery} placeholder="거래처 / 성함"
            onChange={e => { const v = e.target.value; setCompanyQuery(v); setNewRow(p => ({...p, company_name: v})); const sp = v.split('/')[0].trim(); if (sp.length >= 2 && !v.includes('/')) { const rect = e.currentTarget.getBoundingClientRect(); setCompanyDropPos({top:rect.bottom+2,left:rect.left}); setCompanyDropOpen(true); } else { setCompanyDropOpen(false); } }}
            onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
            onFocus={e => { const sp = companyQuery.split('/')[0].trim(); if (sp.length >= 2 && !companyQuery.includes('/')) { const rect = e.currentTarget.getBoundingClientRect(); setCompanyDropPos({top:rect.bottom+2,left:rect.left}); setCompanyDropOpen(true); } }}
          />
          {companyDropOpen && companyDropPos && (
            <div style={{position:'fixed',top:companyDropPos.top,left:companyDropPos.left,zIndex:9999,background:'#fff',border:'1px solid #DDE1EB',borderRadius:6,width:240,maxHeight:300,overflowY:'auto',boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}>
              {/* 일반 소비자 */}
              <div style={{padding:'8px 12px',background:'#FAFBFC',borderBottom:'1px solid #DDE1EB',cursor:'pointer',display:'flex',alignItems:'center',gap:8}}
                onClick={() => { setNewRow(p => ({...p, company_name: '', customer_name: searchPart, invoice_type: '없음(일반소매)', customer_phone: ''})); setCompanyQuery(searchPart); setCompanyDropOpen(false); }}>
                <span style={{width:8,height:8,borderRadius:'50%',background:'#1D9E75',flexShrink:0}}></span>
                <span style={{fontSize:12,fontWeight:500,color:'#0F6E56',fontFamily:'Pretendard,sans-serif'}}>일반 소비자</span>
              </div>
              {matchedCompanies.map(co => { const [bbg,btc] = INVOICE_BADGE_AC[co.invoice_type] || [null,null]; return (
                <div key={co.id} style={{padding:'8px 12px',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',gap:6,fontFamily:'Pretendard,sans-serif'}}
                  onMouseOver={e => e.currentTarget.style.background='#E6F1FB'} onMouseOut={e => e.currentTarget.style.background=''}
                  onClick={() => { setNewRow(p => ({...p, company_name: co.company_name + ' / ', invoice_type: co.invoice_type === '월말' ? '월말' : co.invoice_type === '계산서' ? '계산서(거래처)' : '없음(일반소매)', customer_phone: co.phone || '', customer_name: ''})); setCompanyQuery(co.company_name + ' / '); setCompanyDropOpen(false); setTimeout(() => companyInputRef.current?.focus(), 50); }}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:500,color:'#1A1D23',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{co.company_name}</div>
                    {co.phone && <div style={{fontSize:11,color:'#9BA3B2'}}>{co.phone}</div>}
                  </div>
                  {bbg && <span style={{display:'inline-flex',padding:'2px 6px',borderRadius:3,fontSize:10,fontWeight:700,background:bbg,color:btc,whiteSpace:'nowrap',flexShrink:0}}>{co.invoice_type}</span>}
                </div>
              ); })}
              {matchedCompanies.length === 0 && <div style={{padding:'10px 12px',fontSize:11,color:'#9BA3B2',textAlign:'center'}}>일치하는 거래처 없음</div>}
            </div>
          )}
        </div>
      );
    }
    return (
      <input className="as-cell-input" value={val} placeholder={col.label}
        onChange={e => setNewRow(p => ({...p,[col.key]:e.target.value}))}
        onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
      />
    );
  };

  return (<>
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
            <th key={c.key} style={{ position: 'sticky', top: 34, zIndex: 20, background: '#EAECF2', fontSize: 12, fontWeight: 600, color: '#5A6070', textAlign: 'center', padding: '8px 10px', boxShadow: '0 1px 0 0 #DDE1EB', borderRight: c.groupEnd && c.groupBorderColor ? `2px solid ${c.groupBorderColor}` : '1px solid #DDE1EB', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none' }}>
              {showNewRow && idx === 0 ? (
                <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                  <button style={{background:'#1D9E75',color:'#FFFFFF',border:'none',borderRadius:4,padding:'4px 10px',fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',fontFamily:'Pretendard,sans-serif'}} onClick={handleNewRowSave}>저장</button>
                  <button style={{background:'#5A6070',color:'#FFFFFF',border:'none',borderRadius:4,padding:'4px 10px',fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',fontFamily:'Pretendard,sans-serif'}} onClick={onHideNewRow}>취소</button>
                </div>
              ) : c.isMsgCol ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{verticalAlign:'middle'}}><path d="M2 2.5C2 1.7 2.7 1 3.5 1h7C11.3 1 12 1.7 12 2.5v5c0 .8-.7 1.5-1.5 1.5H8l-2.5 2.5V9H3.5C2.7 9 2 8.3 2 7.5v-5z" fill="#185FA5"/></svg> : c.label}
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
                {c.type === 'action' ? null : renderNewCell(c)}
              </td>
            ))}
          </tr>
        )}
        {/* 데이터 행 */}
        {records.map((r, rowIdx) => (
          <tr key={r.id} className="as-data-row" style={rowIdx % 2 === 1 ? {background:'#FAFBFC'} : undefined}>
            {COLS.map(c => {
                const tdStyle = { ...(c.groupEnd && c.groupBorderColorBody ? {borderRight:`2px solid ${c.groupBorderColorBody}`} : {}), ...(c.type === 'select' ? {overflow:'visible',position:'relative'} : {}), ...(c.type === 'readonly' ? {cursor:'default'} : {}), ...(deleteMode && c.key === 'record_type' ? {position:'relative'} : {}) };
                return (
                <td key={c.key} style={Object.keys(tdStyle).length ? tdStyle : undefined}
                  onClick={() => {
                    if (c.isLink || c.type === 'action' || c.type === 'select' || c.type === 'readonly' || c.type === 'memo') return;
                    const val = c.key === 'company_name' ? [r.company_name, r.customer_name].filter(Boolean).join(' / ') :
                      c.fromDb ? (c.fromDb(r[c.key]) || '') :
                      (c.key === 'repair_cost' ? (r[c.key]?.toString() || '') : (r[c.key] || ''));
                    startEdit(r.id, c.key, c.toDb ? c.toDb(val) : val);
                  }}
                >
                  {deleteMode && c.key === 'record_type' && (
                    <button style={{position:'absolute',left:2,top:'50%',transform:'translateY(-50%)',zIndex:5,background:'#CC2222',color:'#FFFFFF',padding:'1px 4px',borderRadius:3,fontSize:9,fontWeight:700,border:'none',cursor:'pointer',lineHeight:1,fontFamily:'inherit'}}
                      onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }}
                      onClick={e => { e.stopPropagation(); e.preventDefault(); e.nativeEvent?.stopImmediatePropagation?.(); const name = r.customer_name || r.company_name || '미입력'; const model = r.model || '미입력'; const symptom = r.symptom ? ` / 증상: ${r.symptom}` : ''; if (confirm(`정말 삭제하시겠습니까?\n고객: ${name} / 모델: ${model}${symptom}`)) { onDelete(r.id); } }}>X</button>
                  )}
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
    {/* 비고/처리결과 팝업 */}
    {memoPopup && (
      <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
        <div style={{background:'#fff',borderRadius:12,width:400,maxHeight:'85vh',overflow:'hidden',boxShadow:'0 20px 60px rgba(0,0,0,0.15)'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:16,borderBottom:'1px solid #DDE1EB'}}>
            <h3 style={{fontSize:16,fontWeight:600,margin:0}}>{memoPopup.title}</h3>
            <button style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'#5A6070',padding:4}} onClick={() => setMemoPopup(null)}>✕</button>
          </div>
          <div style={{padding:16}}>
            <textarea value={memoValue} onChange={e => setMemoValue(e.target.value)}
              style={{width:'100%',minHeight:120,fontSize:14,fontFamily:'Pretendard, sans-serif',border:'0.5px solid #DDE1EB',borderRadius:8,padding:12,resize:'vertical',outline:'none',boxSizing:'border-box'}}
              onFocus={e => e.target.style.borderColor='#185FA5'}
              onBlur={e => e.target.style.borderColor='#DDE1EB'}
              autoFocus />
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:8,padding:'12px 16px',borderTop:'1px solid #DDE1EB'}}>
            <button onClick={() => setMemoPopup(null)} style={{background:'#fff',color:'#5A6070',border:'0.5px solid #DDE1EB',borderRadius:6,padding:'6px 16px',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>취소</button>
            <button onClick={saveMemoPopup} style={{background:'#185FA5',color:'#fff',border:'none',borderRadius:6,padding:'6px 16px',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>저장</button>
          </div>
        </div>
      </div>
    )}
    {/* 제품 선택 팝업 */}
    {productPickerOpen && (
      <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
        <div style={{background:'#fff',borderRadius:12,width:500,maxHeight:'80vh',overflow:'hidden',boxShadow:'0 20px 60px rgba(0,0,0,0.15)',display:'flex',flexDirection:'column'}}>
          <div style={{background:'#1A1D23',padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
            <span style={{fontSize:15,fontWeight:600,color:'#fff'}}>제품 선택</span>
            <button onClick={() => setProductPickerOpen(false)} style={{width:32,height:32,borderRadius:'50%',background:'rgba(255,255,255,0.2)',color:'#fff',border:'none',fontSize:18,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
          </div>
          <div style={{padding:'8px 12px',borderBottom:'1px solid #EAECF2',flexShrink:0}}>
            <input className="input" style={{width:'100%',height:36,fontSize:13,padding:'8px 12px',borderRadius:6}} placeholder="브랜드, 모델넘버 검색..." value={productPickerSearch} onChange={e => setProductPickerSearch(e.target.value)} autoComplete="off" autoFocus />
          </div>
          <div style={{flex:1,overflowY:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#EAECF2'}}>
                <th style={{padding:'8px 10px',fontSize:12,fontWeight:600,color:'#5A6070',textAlign:'center'}}>브랜드</th>
                <th style={{padding:'8px 10px',fontSize:12,fontWeight:600,color:'#5A6070',textAlign:'left'}}>모델넘버</th>
                <th style={{padding:'8px 10px',fontSize:12,fontWeight:600,color:'#5A6070',textAlign:'right'}}>제품가격</th>
              </tr></thead>
              <tbody>
                {(() => {
                  const q = productPickerSearch.toLowerCase();
                  const filtered = (products || []).filter(p => !q || [p.brand, p.model].some(f => f?.toLowerCase().includes(q)));
                  if (filtered.length === 0) return <tr><td colSpan={3} style={{padding:'40px 0',textAlign:'center',fontSize:13,color:'#9BA3B2'}}>등록된 제품이 없습니다.<br/>제품/부속가격 탭에서 먼저 등록해주세요.</td></tr>;
                  const BC = {'콜라보':['#EEEDFE','#3C3489'],'마끼다':['#FAEEDA','#412402'],'디월트':['#E1F5EE','#085041'],'프레레':['#E6F1FB','#0C447C'],'기타':['#F4F6FA','#5A6070']};
                  return filtered.map(p => {
                    const [bg,c] = BC[p.brand] || ['#F4F6FA','#5A6070'];
                    return (
                      <tr key={p.id} style={{cursor:'pointer',borderBottom:'1px solid #F0F2F7'}}
                        onMouseOver={e => e.currentTarget.style.background='#F4F6FA'} onMouseOut={e => e.currentTarget.style.background='transparent'}
                        onClick={() => {
                          setNewRow(prev => ({...prev, brand: '콜라보', model: p.model || '', status: '완료', repair_cost: p.price || 0 }));
                          setProductPickerOpen(false);
                        }}>
                        <td style={{padding:'10px',textAlign:'center'}}><span style={{display:'inline-flex',padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:600,background:bg,color:c}}>{p.brand || '-'}</span></td>
                        <td style={{padding:'10px',fontSize:13,color:'#1A1D23'}}>{p.model || <span className="empty-dot">●</span>}</td>
                        <td style={{padding:'10px',textAlign:'right',fontSize:13,fontWeight:700,color:'#185FA5'}}>{p.price?.toLocaleString('ko-KR') || '0'}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )}
    </>
  );
}


/* ═══ SHIP TABLE — 인라인 편집 ═══ */
function ShipTable({ records, asRecords, companies, onSave, onAdd, onDelete, showNewRow, onHideNewRow, saveASField, sendAutoSMS }) {
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [newRow, setNewRow] = useState({ ship_date: today(), carrier: '롯데', tracking_no: '', sender_name: '선택', receiver_name: '', receiver_phone: '', receiver_address: '', contents: '', delivery_message: '', as_record_id: null, quantity: 1, memo: '' });
  const [recipientQuery, setRecipientQuery] = useState('');
  const [companyDropOpen, setCompanyDropOpen] = useState(false);
  const [companyDropPos, setCompanyDropPos] = useState(null);
  const [calendarOpen, setCalendarOpen] = useState(null); // {id, pos:{top,left}}
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [calendarSelected, setCalendarSelected] = useState(today());
  const companyInputRef = useRef(null);
  const SHIP_CARRIERS = ['롯데','CJ','한진','경동','로젠','우체국','대신택배','대신화물','경동화물','퀵'];
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
    { key:'quantity', label:'수량', w:45, type:'number' },
    { key:'delivery_message', label:'배송메시지', w:120, type:'text' },
    { key:'sender_name', label:'선불/착불', w:80, type:'select', opts: ['선택','선불','착불'] },
    { key:'_origin', label:'출고처', w:50, type:'static', value:'AS' },
    { key:'carrier', label:'택배사', w:100, type:'select', opts: SHIP_CARRIERS },
    { key:'tracking_no', label:'운송장번호', w:140, type:'text' },
    { key:'memo', label:'비고', w:130, type:'text' },
    { key:'_delete', label:'', w:45, type:'action' },
  ];

  const DEFAULT_SHIP_WIDTHS = { ship_date:90, receiver_name:90, receiver_phone:110, receiver_address:180, contents:90, quantity:45, delivery_message:120, sender_name:80, _origin:50, carrier:100, tracking_no:140, memo:130, _delete:45 };
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
    // 1. 운송장번호 미입력 → 최상위
    const aEmpty = !a.tracking_no;
    const bEmpty = !b.tracking_no;
    if (aEmpty !== bEmpty) return aEmpty ? -1 : 1;
    // 2. 같은 그룹 내에서는 날짜 역순(최신순), 동일 날짜면 created_at 역순
    const da = a.ship_date || '', db = b.ship_date || '';
    if (da !== db) return da < db ? 1 : -1;
    const ca = a.created_at || '', cb = b.created_at || '';
    return ca < cb ? 1 : -1;
  });

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
    const timer = setTimeout(() => { document.addEventListener('mousedown', h); document.addEventListener('keydown', esc); }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, [shipBadgeOpen, newShipBadgeOpen]);

  // 거래처 자동완성 드롭다운 바깥 클릭 시 닫기
  useEffect(() => {
    if (!companyDropOpen) return;
    const h = (e) => { if (!e.target.closest('.ship-company-dropdown')) setCompanyDropOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setCompanyDropOpen(false); };
    const timer = setTimeout(() => { document.addEventListener('mousedown', h); document.addEventListener('keydown', esc); }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, [companyDropOpen]);

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
    // 수량 전용 검증: 정수 & 최소 1. 유효하지 않으면 저장 없이 원래 값 유지
    if (field === 'quantity') {
      setEditCell(null);
      const trimmed = String(editValue ?? '').trim();
      if (trimmed === '') return;
      const n = parseInt(trimmed, 10);
      if (!Number.isFinite(n) || n < 1 || String(n) !== trimmed) return;
      const prevN = typeof prev === 'number' ? prev : parseInt(prev, 10);
      if (n !== prevN) await onSave(id, field, n);
      return;
    }
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
        // 출고 알림 자동 발송
        if (sendAutoSMS) {
          const asRow = asRecords.find(r => r.id === row.as_record_id);
          if (asRow) {
            sendAutoSMS('release', { ...asRow, tracking_number: editValue, release_date: today(), release_carrier: row.carrier || null });
          }
        }
      }
    }
  };

  const handleNewSave = async () => {
    if (!newRow.ship_date) return;
    const row = { ...newRow };
    Object.keys(row).forEach(k => { if (row[k] === '') row[k] = null; });
    row.ship_date = row.ship_date || today();
    const qn = parseInt(String(row.quantity ?? '1'), 10);
    const qty = (Number.isFinite(qn) && qn >= 1) ? qn : 1;
    await onAdd({ shipDate: row.ship_date, carrier: row.carrier, trackingNo: row.tracking_no, senderName: row.sender_name, receiverName: row.receiver_name, receiverPhone: row.receiver_phone, receiverAddress: row.receiver_address, contents: row.contents, memo: row.memo, deliveryMessage: row.delivery_message, asRecordId: row.as_record_id, quantity: qty });
    setNewRow({ ship_date: today(), carrier: '롯데', tracking_no: '', sender_name: '선택', receiver_name: '', receiver_phone: '', receiver_address: '', contents: '', delivery_message: '', as_record_id: null, quantity: 1, memo: '' });
    setRecipientQuery('');
    onHideNewRow();
  };

  const SHIP_BADGE_COLORS = { '선택':['#FCEBEB','#CC2222'], '선불':['#E1F5EE','#085041'], '착불':['#FAEEDA','#854F0B'] };
  const SHIP_BADGE_BORDERS = { '선택':'#CC2222', '선불':'#1D9E75', '착불':'#EF9F27' };
  const SHIP_BADGE_DOTS = { '선택':'#CC2222', '선불':'#1D9E75', '착불':'#EF9F27' };
  const SHIP_CARRIER_COLORS = { '롯데':['#185FA5','#FFFFFF'],'롯데택배':['#185FA5','#FFFFFF'],'CJ':['#1D9E75','#FFFFFF'],'CJ대한통운':['#1D9E75','#FFFFFF'],'한진':['#534AB7','#FFFFFF'],'한진택배':['#534AB7','#FFFFFF'],'경동':['#854F0B','#FFFFFF'],'경동택배':['#854F0B','#FFFFFF'],'경동화물':['#854F0B','#FFFFFF'],'대신화물':['#D85A30','#FFFFFF'],'대신택배':['#D85A30','#FFFFFF'],'로젠':['#CC2222','#FFFFFF'],'로젠택배':['#CC2222','#FFFFFF'],'우체국':['#EF9F27','#FFFFFF'],'방문':['#5A6070','#FFFFFF'],'용차':['#5A6070','#FFFFFF'],'퀵':['#6B7280','#FFFFFF'],'매장':['#5A6070','#FFFFFF'] };
  const getShipBadgeColor = (key, v) => {
    if (key === 'sender_name' && SHIP_BADGE_COLORS[v]) return SHIP_BADGE_COLORS[v];
    if (key === 'carrier' && SHIP_CARRIER_COLORS[v]) return SHIP_CARRIER_COLORS[v];
    return ['#E8EBF0','#3A3F4B'];
  };

  const renderShipBadge = (r, col) => {
    const dbVal = r[col.key];
    const isOpen = shipBadgeOpen?.id === r.id && shipBadgeOpen?.field === col.key;
    // sender_name 커스텀 뱃지: null/빈값 → "선택" 표시
    if (col.key === 'sender_name') {
      const displayVal = dbVal || '선택';
      const [bg, c] = SHIP_BADGE_COLORS[displayVal] || SHIP_BADGE_COLORS['선택'];
      const borderColor = SHIP_BADGE_BORDERS[displayVal] || SHIP_BADGE_BORDERS['선택'];
      return (
        <div className="badge-expand-panel" style={{overflow:'visible'}} onClick={e => e.stopPropagation()}>
          <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',gap:4,padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,whiteSpace:'nowrap',fontFamily:'Pretendard,sans-serif',background:bg,color:c,cursor:'pointer',border:`1px solid ${borderColor}`}}
            onClick={e => { if (isOpen) { setShipBadgeOpen(null); } else { const rect = e.currentTarget.getBoundingClientRect(); setShipBadgePos({top:rect.bottom+2,left:rect.left}); setShipBadgeOpen({id:r.id,field:col.key}); } }}>
            {displayVal}<span style={{fontSize:8,marginLeft:2}}>▼</span>
          </span>
          {isOpen && shipBadgePos && (
            <div style={{position:'fixed',top:shipBadgePos.top,left:shipBadgePos.left,zIndex:9999,background:'#fff',border:'1px solid #DDE1EB',borderRadius:8,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',padding:4,minWidth:90}}>
              {col.opts.map(o => (
                <div key={o} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 10px',borderRadius:4,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'Pretendard,sans-serif',color:'#1A1D23',background:displayVal===o?'#F4F6FA':'transparent'}}
                  onMouseEnter={e => { if (displayVal!==o) e.currentTarget.style.background='#F4F6FA'; }} onMouseLeave={e => { if (displayVal!==o) e.currentTarget.style.background='transparent'; }}
                  onClick={() => saveShipBadge(r.id, col.key, o)}>
                  <span style={{width:8,height:8,borderRadius:'50%',background:SHIP_BADGE_DOTS[o],flexShrink:0}} />{o}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    const [bg, c] = dbVal ? getShipBadgeColor(col.key, dbVal) : ['#F4F6FA','#9BA3B2'];
    return (
      <div className="badge-expand-panel" style={{overflow:'hidden'}} onClick={e => e.stopPropagation()}>
        <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',fontFamily:'Pretendard,sans-serif',background:bg,color:c,cursor:'pointer',border:isOpen?`2px solid ${c}`:'2px solid transparent'}}
          onClick={e => { if (isOpen) { setShipBadgeOpen(null); } else { const rect = e.currentTarget.getBoundingClientRect(); setShipBadgePos({top:rect.bottom+2,left:rect.left}); setShipBadgeOpen({id:r.id,field:col.key}); } }}>
          {dbVal || '—'}
        </span>
        {isOpen && shipBadgePos && (
          <div onMouseDown={e => e.stopPropagation()} style={{position:'fixed',top:shipBadgePos.top,left:shipBadgePos.left,zIndex:9999,background:'#fff',border:'1px solid #DDE1EB',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',padding:4,minWidth:80,maxHeight:300,overflowY:'auto',WebkitOverflowScrolling:'touch'}}>
            {col.opts.map(o => {
              const [obg,oc] = getShipBadgeColor(col.key, o);
              return <div key={o} style={{display:'flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'Pretendard,sans-serif',background:obg,color:oc,marginBottom:2,border:dbVal===o?`2px solid ${oc}`:'2px solid transparent',whiteSpace:'nowrap'}}
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
    const B = (bg,c,t,ex) => <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',fontFamily:'Pretendard,sans-serif',background:bg,color:c,...(ex||{})}}>{t}</span>;

    // 고정값 셀
    if (col.type === 'static') return B('#F4F6FA','#5A6070', col.value);
    // 읽기전용 뱃지
    if (col.type === 'readonly-badge') return val ? B('#E6F1FB','#0C447C',val) : <span className="empty-dot">●</span>;
    // 읽기전용
    if (col.type === 'readonly') {
      if (!val) return <span className="empty-dot">●</span>;
      if (col.key === 'ship_date') return <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,background:'#5A6070',color:'#FFFFFF',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',fontFamily:'Pretendard,sans-serif',cursor:'pointer'}}
        onClick={e => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const top = rect.bottom + 4; const left = rect.left; const popH = 320; const flipUp = top + popH > window.innerHeight; setCalendarOpen({ id: r.id, pos: { top: flipUp ? rect.top - popH - 4 : top, left } }); setCalendarSelected(val || today()); const d = new Date(val || today()); setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() }); }}>{fmtDate(val)}</span>;
      return <span style={{fontSize:13,fontWeight:400,color:'#1A1D23',fontFamily:'Pretendard,sans-serif'}}>{val}</span>;
    }
    // 뱃지 선택
    if (col.type === 'select') return renderShipBadge(r, col);
    // 삭제 버튼
    if (col.key === '_delete') {
      return <button style={{background:'#CC2222',color:'#FFFFFF',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:700,cursor:'pointer',border:'none',whiteSpace:'nowrap',fontFamily:'Pretendard,sans-serif'}} onClick={async (e) => {
        e.stopPropagation();
        if (!confirm('이 발송 건을 삭제하시겠습니까?')) return;
        if (r.as_record_id) {
          await supabase.from('as_records').update({ tracking_number: null, release_date: null, release_carrier: null }).eq('id', r.as_record_id);
        }
        await onDelete(r.id);
      }}>삭제</button>;
    }
    // 편집 모드 - 수량 (숫자 전용)
    if (isEditing && col.key === 'quantity') {
      return <input type="number" min="1" step="1" className="as-cell-input" value={editValue} autoFocus
        onFocus={e => e.target.select()}
        onChange={e => setEditValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
          else if (e.key === 'Escape') { e.preventDefault(); setEditCell(null); }
        }} />;
    }
    // 편집 모드
    if (isEditing) {
      return <input className="as-cell-input" value={editValue} autoFocus onChange={e => setEditValue(e.target.value)} onBlur={commitEdit} onKeyDown={e => e.key === 'Enter' && commitEdit()} />;
    }
    // 수량
    if (col.key === 'quantity') return <span style={{fontSize:13,fontWeight:400,color:'#1A1D23',fontFamily:'Pretendard,sans-serif'}}>{val ?? 1}</span>;
    // 운송장번호
    if (col.key === 'tracking_no') return val ? <span style={{fontFamily:'Pretendard,sans-serif',fontSize:13,fontWeight:600,color:'#1A1D23'}}>{val}</span> : <span style={{fontSize:13,color:'#9BA3B2',fontFamily:'Pretendard,sans-serif'}}>미입력</span>;
    return val ? <span style={{fontSize:13,fontWeight:400,color:'#1A1D23',fontFamily:'Pretendard,sans-serif'}}>{val}</span> : empty;
  };

  const noTracking = (r) => !r.tracking_no;

  return (<>
    <table className="as-table" ref={tableRef} style={{width: COLS.reduce((s,c) => s + getColWidth(c.key), 0)}}>
      <colgroup>{COLS.map(c => <col key={c.key} style={{width: getColWidth(c.key)}} />)}</colgroup>
      <thead>
        <tr className="as-col-header">
          {COLS.map((c, idx) => (
            <th key={c.key} style={{background:'#EAECF2',fontSize:12,fontWeight:600,color:'#5A6070',textAlign:'center',fontFamily:'Pretendard,sans-serif'}}>
              {c.label}
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
                  (() => {
                    const q = recipientQuery.trim().toLowerCase();
                    const matchedCompanies = q.length >= 2 ? (companies || []).filter(comp =>
                      comp.company_name?.toLowerCase().includes(q) || comp.contact_person?.toLowerCase().includes(q) || comp.phone?.includes(q)
                    ) : [];
                    const hasAS = pendingShip.length > 0;
                    const hasComp = matchedCompanies.length > 0;
                    const showDrop = showNewRow && recipientQuery.length >= 1 && (hasAS || hasComp);
                    return (
                    <>
                      <input ref={companyInputRef} className="as-cell-input" value={newRow.receiver_name||''} placeholder="수령자명"
                        onChange={e => { setNewRow(p=>({...p, receiver_name: e.target.value, as_record_id: null})); setRecipientQuery(e.target.value); setCompanyDropOpen(true); }}
                        onFocus={() => { if (recipientQuery.length >= 1) setCompanyDropOpen(true); }}
                        onKeyDown={e => { if (e.key==='Enter') e.preventDefault(); }} />
                      {showDrop && companyDropOpen && (() => {
                        const rect = companyInputRef.current?.getBoundingClientRect();
                        if (!rect) return null;
                        return (
                        <div className="ship-company-dropdown" style={{position:'fixed',top:rect.bottom+2,left:rect.left,zIndex:9999,background:'#fff',border:'1px solid #DDE1EB',borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,0.12)',minWidth:380,maxHeight:320,overflowY:'auto'}}>
                          {/* 직접 입력 */}
                          <div style={{padding:'8px 12px',cursor:'pointer',borderBottom:'1px solid #F0F1F3',display:'flex',alignItems:'center',gap:8}}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => { setCompanyDropOpen(false); setRecipientQuery(''); }}>
                            <span style={{fontSize:11,fontWeight:600,color:'#185FA5'}}>✏️ 직접 입력</span>
                            <span style={{fontSize:11,color:'#9BA3B2'}}>"{newRow.receiver_name}" 그대로 사용</span>
                          </div>
                          {/* AS 발송 대기 */}
                          {hasAS && (
                            <>
                              <div style={{padding:'6px 12px',background:'#F8F9FB',borderBottom:'1px solid #F0F1F3'}}>
                                <span style={{fontSize:10,fontWeight:700,color:'#5A6070'}}>📦 발송 대기 {pendingShip.length}건</span>
                              </div>
                              {pendingShip.slice(0,5).map(ar => (
                                <div key={ar.id} style={{padding:'8px 12px',cursor:'pointer',display:'flex',alignItems:'center',gap:8,borderBottom:'1px solid #F8F9FB'}}
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={() => {
                                    setNewRow(p => ({...p, receiver_name: ar.customer_name || '', receiver_phone: ar.customer_phone || '', contents: ar.model || '', as_record_id: ar.id }));
                                    setRecipientQuery(''); setCompanyDropOpen(false);
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
                            </>
                          )}
                          {/* 거래처 목록 */}
                          {hasComp && (
                            <>
                              <div style={{padding:'6px 12px',background:'#F8F9FB',borderBottom:'1px solid #F0F1F3'}}>
                                <span style={{fontSize:10,fontWeight:700,color:'#5A6070'}}>🏢 거래처 {matchedCompanies.length}건</span>
                              </div>
                              {matchedCompanies.slice(0,5).map(comp => (
                                <div key={comp.id} style={{padding:'8px 12px',cursor:'pointer',display:'flex',alignItems:'center',gap:8,borderBottom:'1px solid #F8F9FB'}}
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={() => {
                                    setNewRow(p => ({...p, receiver_name: comp.contact_person || comp.company_name || '', receiver_phone: comp.phone || '', receiver_address: comp.address || '', as_record_id: null }));
                                    setRecipientQuery(''); setCompanyDropOpen(false);
                                    // 다음 필드로 포커스
                                    setTimeout(() => { const next = document.querySelector('.as-new-row td:nth-child(4) input'); if (next) next.focus(); }, 50);
                                  }}>
                                  <div style={{width:28,height:28,borderRadius:6,background:'#185FA5',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:11,fontWeight:700,flexShrink:0}}>{(comp.company_name || '?')[0]}</div>
                                  <div style={{flex:1,minWidth:0}}>
                                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                                      <span style={{fontSize:12,fontWeight:600,color:'#1A1D23'}}>{comp.company_name}</span>
                                      {comp.contact_person && <span style={{fontSize:11,color:'#5A6070'}}>{comp.contact_person}</span>}
                                    </div>
                                    <div style={{fontSize:11,color:'#9BA3B2',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{comp.phone || '-'} · {comp.address ? comp.address.slice(0,25)+(comp.address.length>25?'…':'') : '주소 없음'}</div>
                                  </div>
                                </div>
                              ))}
                            </>
                          )}
                          {!hasAS && !hasComp && (
                            <div style={{padding:'12px',textAlign:'center',fontSize:11,color:'#9BA3B2'}}>검색 결과 없음</div>
                          )}
                        </div>);
                      })()}
                    </>);
                  })()
                ) : c.type === 'select' ? (
                  <div className="badge-expand-panel" onClick={e => e.stopPropagation()}>
                    {(() => {
                      if (c.key === 'sender_name') {
                        const dv = newRow[c.key] || '선택';
                        const [nbg,nc] = SHIP_BADGE_COLORS[dv] || SHIP_BADGE_COLORS['선택'];
                        const bdr = SHIP_BADGE_BORDERS[dv] || SHIP_BADGE_BORDERS['선택'];
                        return (<span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',gap:4,padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,whiteSpace:'nowrap',fontFamily:'Pretendard,sans-serif',background:nbg,color:nc,cursor:'pointer',border:`1px solid ${bdr}`}}
                          onClick={e => { if (newShipBadgeOpen===c.key) { setNewShipBadgeOpen(null); } else { const rect=e.currentTarget.getBoundingClientRect(); setNewShipBadgePos({top:rect.bottom+2,left:rect.left}); setNewShipBadgeOpen(c.key); } }}>
                          {dv}<span style={{fontSize:8,marginLeft:2}}>▼</span></span>);
                      }
                      const [nbg,nc] = newRow[c.key] ? getShipBadgeColor(c.key, newRow[c.key]) : ['#F4F6FA','#9BA3B2'];
                      return (<span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',fontFamily:'Pretendard,sans-serif',background:nbg,color:nc,cursor:'pointer',border:newShipBadgeOpen===c.key?`2px solid ${nc}`:'2px solid transparent'}}
                        onClick={e => { if (newShipBadgeOpen===c.key) { setNewShipBadgeOpen(null); } else { const rect=e.currentTarget.getBoundingClientRect(); setNewShipBadgePos({top:rect.bottom+2,left:rect.left}); setNewShipBadgeOpen(c.key); } }}>
                        {newRow[c.key] || '선택'}</span>);
                    })()}
                    {newShipBadgeOpen===c.key && newShipBadgePos && (
                      <div style={{position:'fixed',top:newShipBadgePos.top,left:newShipBadgePos.left,zIndex:9999,background:'#fff',border:'1px solid #DDE1EB',borderRadius:c.key==='sender_name'?8:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',padding:4,minWidth:c.key==='sender_name'?90:80,maxHeight:200,overflowY:'auto'}}>
                        {c.opts.map(o => {
                          if (c.key === 'sender_name') {
                            const dv = newRow[c.key] || '선택';
                            return (<div key={o} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 10px',borderRadius:4,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'Pretendard,sans-serif',color:'#1A1D23',background:dv===o?'#F4F6FA':'transparent'}}
                              onMouseEnter={e => { if (dv!==o) e.currentTarget.style.background='#F4F6FA'; }} onMouseLeave={e => { if (dv!==o) e.currentTarget.style.background='transparent'; }}
                              onClick={() => { setNewRow(p=>({...p,[c.key]:o})); setNewShipBadgeOpen(null); }}>
                              <span style={{width:8,height:8,borderRadius:'50%',background:SHIP_BADGE_DOTS[o],flexShrink:0}} />{o}</div>);
                          }
                          const [obg,oc] = getShipBadgeColor(c.key, o);
                          return (<div key={o} style={{display:'flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'Pretendard,sans-serif',background:obg,color:oc,marginBottom:2,border:newRow[c.key]===o?`2px solid ${oc}`:'2px solid transparent',whiteSpace:'nowrap'}}
                            onClick={() => { setNewRow(p=>({...p,[c.key]:o})); setNewShipBadgeOpen(null); }}>{o}</div>);
                        })}
                      </div>
                    )}
                  </div>
                ) : c.type === 'date' ? (
                  <input type="date" className="as-cell-input" value={newRow[c.key]||''} onChange={e => setNewRow(p=>({...p,[c.key]:e.target.value}))} />
                ) : c.type === 'number' ? (
                  <input type="number" min="1" step="1" className="as-cell-input" value={newRow[c.key] ?? 1} onChange={e => setNewRow(p=>({...p,[c.key]: e.target.value}))} onKeyDown={e => { if (e.key==='Enter') e.preventDefault(); }} />
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
    {calendarOpen && calendarOpen.pos && (() => {
      const todayStr = today();
      const { year, month } = calendarMonth;
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const daysInPrev = new Date(year, month, 0).getDate();
      const cells = [];
      for (let i = 0; i < firstDay; i++) cells.push({ day: daysInPrev - firstDay + 1 + i, cur: false, date: (() => { const d = new Date(year, month - 1, daysInPrev - firstDay + 1 + i); return d.toISOString().slice(0,10); })() });
      for (let i = 1; i <= daysInMonth; i++) cells.push({ day: i, cur: true, date: `${year}-${String(month+1).padStart(2,'0')}-${String(i).padStart(2,'0')}` });
      const rem = (7 - cells.length % 7) % 7;
      for (let i = 1; i <= rem; i++) cells.push({ day: i, cur: false, date: (() => { const d = new Date(year, month + 1, i); return d.toISOString().slice(0,10); })() });
      const monthLabel = `${year}년 ${month + 1}월`;
      const prevMonth = () => setCalendarMonth(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 });
      const nextMonth = () => setCalendarMonth(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 });
      return (
        <div style={{position:'fixed',top:calendarOpen.pos.top,left:calendarOpen.pos.left,zIndex:9999,background:'#fff',border:'0.5px solid #DDE1EB',borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,0.1)',width:260,padding:12,fontFamily:'Pretendard,sans-serif'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <button onClick={prevMonth} style={{width:26,height:26,border:'0.5px solid #DDE1EB',borderRadius:4,background:'#fff',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',justifyContent:'center'}}>◀</button>
            <span style={{fontSize:13,fontWeight:600,color:'#1A1D23'}}>{monthLabel}</span>
            <button onClick={nextMonth} style={{width:26,height:26,border:'0.5px solid #DDE1EB',borderRadius:4,background:'#fff',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',justifyContent:'center'}}>▶</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,textAlign:'center',marginBottom:4}}>
            {['일','월','화','수','목','금','토'].map(d => <div key={d} style={{fontSize:11,fontWeight:500,color:'#9BA3B2',padding:'4px 0'}}>{d}</div>)}
            {cells.map((cell, idx) => {
              const isToday = cell.date === todayStr;
              const isSel = cell.date === calendarSelected;
              return <div key={idx} onClick={() => { setCalendarSelected(cell.date); if (!cell.cur) { const d = new Date(cell.date); setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() }); } }} style={{width:32,height:32,lineHeight:'32px',borderRadius:6,fontSize:12,cursor:'pointer',margin:'0 auto',color: isSel ? '#fff' : cell.cur ? '#1A1D23' : '#9BA3B2',background: isSel ? '#185FA5' : 'transparent',border: isToday && !isSel ? '1.5px solid #185FA5' : '1.5px solid transparent',fontWeight: isToday || isSel ? 600 : 400}}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background='#E6F1FB'; }} onMouseLeave={e => { if (!isSel) e.currentTarget.style.background='transparent'; }}>{cell.day}</div>;
            })}
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:8}}>
            <button onClick={() => setCalendarOpen(null)} style={{background:'transparent',color:'#5A6070',border:'0.5px solid #DDE1EB',borderRadius:6,padding:'7px 16px',fontSize:12,fontWeight:600,cursor:'pointer'}}>취소</button>
            <button onClick={async () => { await onSave(calendarOpen.id, 'ship_date', calendarSelected); setCalendarOpen(null); }} style={{background:'#185FA5',color:'#fff',border:'none',borderRadius:6,padding:'7px 16px',fontSize:12,fontWeight:600,cursor:'pointer'}}>저장</button>
          </div>
        </div>
      );
    })()}
  </>);
}


/* ═══ CUSTOMER POPUP ═══ */
function CustomerPopup({ customer, onClose, onConfirmSent }) {
  const { name, phone, company } = customer;
  const [records, setRecords] = useState([]);
  const [smsMessages, setSmsMessages] = useState([]);
  const [msgInput, setMsgInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const chatRef = useRef(null);
  const [clipboards, setClipboards] = useState([]);
  const [clipModal, setClipModal] = useState(false);
  const [selectedClipTitle, setSelectedClipTitle] = useState(null);

  const CLIP_COLORS = ['#E6F1FB','#FAEEDA','#E1F5EE','#EEEDFE','#FAECE7','#FBEAF0'];
  const CLIP_TEXT_COLORS = { '#E6F1FB':'#0C447C','#FAEEDA':'#412402','#E1F5EE':'#085041','#EEEDFE':'#26215C','#FAECE7':'#6B2012','#FBEAF0':'#6B1240' };

  useEffect(() => {
    supabase.from('settings').select('*').eq('key','sms_clipboard').single().then(({ data }) => {
      if (data?.value && Array.isArray(data.value)) setClipboards(data.value);
      else setClipboards([
        { title: '입고안내', content: '안녕하세요. 대한공구 AS센터입니다.\n보내주신 제품이 입고되었습니다.\n점검 후 안내드리겠습니다.', color: '#E6F1FB' },
        { title: '수리완료', content: '안녕하세요. 대한공구 AS센터입니다.\n수리가 완료되었습니다.\n발송 예정이오니 확인 부탁드립니다.', color: '#E1F5EE' },
        { title: '부품대기', content: '안녕하세요. 대한공구 AS센터입니다.\n부품 입고 대기중입니다.\n입고되는대로 안내드리겠습니다.', color: '#FAEEDA' },
        { title: '출고안내', content: '안녕하세요. 대한공구 AS센터입니다.\n택배 발송 완료되었습니다.\n감사합니다.', color: '#EEEDFE' },
      ]);
    });
  }, []);

  const saveClipboards = async (items) => {
    setClipboards(items);
    await supabase.from('settings').upsert({ key: 'sms_clipboard', value: items, updated_at: new Date().toISOString() });
  };

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

      // 문자 내역 (전화번호 정규화하여 조회)
      if (phone) {
        const { data: smsData } = await supabase.from('sms_messages').select('*').eq('phone', toLocal(phone)).order('sent_at', { ascending: true });
        if (smsData) setSmsMessages(smsData);
      }
      setLoading(false);
    };
    loadAll();
  }, [name, phone]);

  // Realtime: 새 문자 수신 시 즉시 반영
  useEffect(() => {
    if (!phone) return;
    const normalPhone = toLocal(phone);
    const chName = 'cp-sms-realtime';
    // 기존 동일 채널 정리
    const existing = supabase.getChannels().find(c => c.topic === 'realtime:' + chName);
    if (existing) supabase.removeChannel(existing);
    const ch = supabase.channel(chName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sms_messages', filter: `phone=eq.${normalPhone}` }, (payload) => {
        setSmsMessages(prev => prev.some(m => m.id === payload.new.id) ? prev : [...prev, payload.new]);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [phone]);

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

  const textareaRef = useRef(null);
  const modalRef = useRef(null);
  const [dragPos, setDragPos] = useState(null);
  const dragRef = useRef(null);

  const onHeaderMouseDown = (e) => {
    if (e.target.closest('button') || e.target.closest('.cp-stat')) return;
    const modal = modalRef.current; if (!modal) return;
    const rect = modal.getBoundingClientRect();
    const offsetX = e.clientX - rect.left, offsetY = e.clientY - rect.top;
    dragRef.current = { offsetX, offsetY };
    document.body.style.cursor = 'grabbing'; document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      const x = Math.max(0, Math.min(ev.clientX - offsetX, window.innerWidth - rect.width));
      const y = Math.max(0, Math.min(ev.clientY - offsetY, window.innerHeight - rect.height));
      setDragPos({ x, y });
    };
    const onUp = () => { dragRef.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  };

  const autoResizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    const modal = modalRef.current;
    const maxH = modal ? Math.floor(modal.offsetHeight * 0.5) : 300;
    el.style.height = 'auto';
    el.style.height = Math.min(Math.max(el.scrollHeight, 54), maxH) + 'px';
  };

  // resize 크기 localStorage 저장
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    const saved = (() => { try { return JSON.parse(localStorage.getItem('cp_popup_size')); } catch { return null; } })();
    if (saved?.width) modal.style.width = saved.width + 'px';
    if (saved?.height) modal.style.height = saved.height + 'px';
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        localStorage.setItem('cp_popup_size', JSON.stringify({ width: Math.round(width), height: Math.round(height) }));
      }
    });
    ro.observe(modal);
    return () => ro.disconnect();
  }, []);

  const handleSend = async () => {
    if (!msgInput.trim() || !phone || isSending) return;
    setIsSending(true);
    try {
      const res = await fetch('/api/sms/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to: phone, content: msgInput.trim() }) });
      const result = await res.json();
      if (result.error) { alert('문자 발송 실패: ' + result.error); return; }
      const normalPhone = toLocal(phone);
      const msg = { phone: normalPhone, content: msgInput.trim(), direction: 'outgoing', sent_at: new Date().toISOString(), ...(selectedClipTitle ? { message_type: selectedClipTitle } : {}) };
      const { data } = await supabase.from('sms_messages').insert(msg).select();
      if (data) setSmsMessages(prev => [...prev, ...data]);
      if (selectedClipTitle && selectedClipTitle.includes('견적') && onConfirmSent) onConfirmSent(normalPhone);
      setMsgInput('');
      setSelectedClipTitle(null);
      if (textareaRef.current) { textareaRef.current.style.height = '54px'; }
    } catch (e) {
      console.error('[CP Send Error]', e);
      alert('문자 전송에 실패했습니다.');
    } finally {
      setIsSending(false);
    }
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
    <>
    <div className="cp-overlay" style={dragPos ? {pointerEvents:'none'} : undefined}>
      <div className="cp-modal" ref={modalRef} onClick={e => e.stopPropagation()} style={dragPos ? {position:'fixed',top:dragPos.y,left:dragPos.x,margin:0,pointerEvents:'auto'} : undefined}>
        {/* 헤더 */}
        <div className="cp-header" style={{cursor:'grab'}} onMouseDown={onHeaderMouseDown}>
          <div style={{display:'flex',alignItems:'center',gap:12,flex:1}}>
            <div className="cp-avatar">{(name || '?')[0]}</div>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:'#fff'}}>{name || '-'}</div>
              <div style={{fontSize:12,color:'rgba(255,255,255,0.75)'}}>{phone || '연락처 없음'}{company ? ` · ${company}` : ''}</div>
            </div>
          </div>
          <div style={{display:'flex',gap:20,alignItems:'center',flexShrink:0}}>
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
            {/* 클립보드 — 좌측 하단 */}
            <div className="cp-clipboard-area">
              <div className="cp-clipboard-header">
                <span style={{fontSize:11,fontWeight:600,color:'#5A6070'}}>클립보드</span>
                <button className="cp-clipboard-edit-badge" onClick={() => setClipModal(true)}>수정</button>
              </div>
              <div className="cp-clipboard-grid">
                {clipboards.map((c, i) => (
                  <button key={i} className="cp-clipboard-btn" style={{background: c.color || '#E6F1FB', color: CLIP_TEXT_COLORS[c.color] || '#0C447C'}}
                    onClick={() => { setMsgInput(c.content); setSelectedClipTitle(c.title); if (textareaRef.current) { textareaRef.current.focus(); setTimeout(autoResizeTextarea, 0); } }}>
                    {c.title}
                  </button>
                ))}
              </div>
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
                    {msg.media_url && (
                      <div style={{marginBottom: msg.content ? 6 : 0}}>
                        <img src={msg.media_url} alt="MMS 이미지" style={{maxWidth:240,borderRadius:8,cursor:'pointer',display:'block'}}
                          onClick={() => window.open(msg.media_url, '_blank')}
                          onError={e => { e.target.style.display='none'; e.target.nextSibling && (e.target.nextSibling.style.display='block'); }}
                        /><span style={{display:'none',fontSize:11,color:'#9BA3B2'}}>이미지를 불러올 수 없습니다</span>
                      </div>
                    )}
                    {msg.content && <div className="cp-bubble-text">{msg.content}</div>}
                    <div className="cp-bubble-time">{new Date(msg.sent_at).toLocaleString('ko-KR', {hour:'2-digit',minute:'2-digit'})}</div>
                  </div>
                );
              })}
            </div>
            <div style={{flexShrink:0}}>
              <div className="cp-chat-hint">*Shift+Enter = 텍스트 줄바꿈됩니다</div>
              <div className="cp-chat-input">
                <textarea ref={textareaRef} rows={3} value={msgInput} onChange={e => { setMsgInput(e.target.value); autoResizeTextarea(); }} placeholder="문자 입력..." onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} />
                <button className="btn-primary cp-send-btn" onClick={handleSend} disabled={isSending}>{isSending ? '전송 중...' : '전송'}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* 클립보드 수정 모달 — cp-overlay 바깥에 위치하여 이벤트 버블링 방지 */}
    {clipModal && <ClipboardEditModal clipboards={clipboards} colors={CLIP_COLORS} textColors={CLIP_TEXT_COLORS} onSave={(items) => { saveClipboards(items); setClipModal(false); }} onClose={() => setClipModal(false)} />}
    </>
  );
}

function ClipboardEditModal({ clipboards, colors, textColors, onSave, onClose }) {
  const [items, setItems] = useState(clipboards.map(c => ({ ...c })));
  const [editIdx, setEditIdx] = useState(null);
  const [form, setForm] = useState({ title: '', content: '', color: colors[0] });

  const startEdit = (i) => { setEditIdx(i); setForm({ ...items[i] }); };
  const startNew = () => { setEditIdx(-1); setForm({ title: '', content: '', color: colors[0] }); };
  const cancelEdit = () => { setEditIdx(null); setForm({ title: '', content: '', color: colors[0] }); };

  const saveItem = () => {
    if (!form.title.trim()) return;
    const next = [...items];
    if (editIdx === -1) next.push({ ...form });
    else next[editIdx] = { ...form };
    setItems(next);
    setEditIdx(null);
  };

  const deleteItem = (i) => {
    const next = items.filter((_, idx) => idx !== i);
    setItems(next);
    if (editIdx === i) setEditIdx(null);
  };

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" style={{zIndex:300}}>
      <div className="modal-content" style={{maxWidth:480,maxHeight:'80vh',overflow:'auto'}} onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h2 style={{fontSize:15}}>클립보드 관리</h2><button onClick={onClose} className="modal-close">✕</button></div>
        <div style={{padding:16}}>
          {items.map((c, i) => (
            <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:'1px solid #EAECF2'}}>
              <div style={{width:8,height:8,borderRadius:2,background:c.color,flexShrink:0}} />
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:'#1A1D23'}}>{c.title}</div>
                <div style={{fontSize:11,color:'#9BA3B2',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.content.replace(/\n/g,' ')}</div>
              </div>
              <button style={{fontSize:11,color:'#185FA5',background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:500}} onClick={() => startEdit(i)}>수정</button>
              <button style={{fontSize:11,color:'#CC2222',background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:500}} onClick={() => deleteItem(i)}>삭제</button>
            </div>
          ))}
          {items.length < 8 && editIdx === null && (
            <button style={{marginTop:8,fontSize:12,color:'#185FA5',background:'none',border:'1px dashed #B5D4F4',borderRadius:6,padding:'6px 12px',cursor:'pointer',width:'100%',fontFamily:'inherit'}} onClick={startNew}>+ 새 클립보드 추가</button>
          )}

          {editIdx !== null && (
            <div style={{marginTop:12,padding:12,background:'#F8F9FB',borderRadius:8,border:'1px solid #EAECF2'}}>
              <div style={{marginBottom:8}}>
                <label style={{fontSize:11,fontWeight:600,color:'#5A6070',display:'block',marginBottom:4}}>제목</label>
                <input className="input" value={form.title} onChange={e => setForm(p => ({...p, title: e.target.value}))} style={{width:'100%',fontSize:12,height:32}} />
              </div>
              <div style={{marginBottom:8}}>
                <label style={{fontSize:11,fontWeight:600,color:'#5A6070',display:'block',marginBottom:4}}>내용</label>
                <textarea className="input" value={form.content} onChange={e => setForm(p => ({...p, content: e.target.value}))} style={{width:'100%',fontSize:12,minHeight:60,resize:'vertical',fontFamily:'inherit',lineHeight:1.5}} />
              </div>
              <div style={{marginBottom:8}}>
                <label style={{fontSize:11,fontWeight:600,color:'#5A6070',display:'block',marginBottom:4}}>색상</label>
                <div style={{display:'flex',gap:6}}>
                  {colors.map(c => (
                    <div key={c} onClick={() => setForm(p => ({...p, color: c}))}
                      style={{width:24,height:24,borderRadius:4,background:c,cursor:'pointer',border: form.color === c ? '2px solid #185FA5' : '2px solid transparent'}} />
                  ))}
                </div>
              </div>
              <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                <button className="btn-primary" style={{fontSize:11,padding:'4px 12px'}} onClick={saveItem}>저장</button>
                <button style={{fontSize:11,padding:'4px 12px',background:'#E8EBF0',border:'none',borderRadius:4,cursor:'pointer',fontFamily:'inherit'}} onClick={cancelEdit}>취소</button>
              </div>
            </div>
          )}

          <div style={{marginTop:16,display:'flex',justifyContent:'flex-end',gap:8}}>
            <button className="btn-primary" style={{fontSize:12,padding:'6px 16px'}} onClick={() => onSave(items)}>확인</button>
            <button style={{fontSize:12,padding:'6px 16px',background:'#E8EBF0',border:'none',borderRadius:6,cursor:'pointer',fontFamily:'inherit'}} onClick={onClose}>취소</button>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ═══ PARTS ORDER TAB — Phase 2-1a (장바구니 + 발주확정 + 이력) ═══ */
function PartsOrderTab({ parts, models, categories, onPhotoClick, cart, setCart, currentDraftId, onAddToCart, onSaveDraft, onConfirm, onShowHistory, onShowTemplate, loadOrders, loadDraft }) {
  const [orderSearch, setOrderSearch] = useState('');
  const [orderModel, setOrderModel] = useState('전체');
  const [orderBigCat, setOrderBigCat] = useState('전체');

  // 진입 시 발주 목록만 로드 (자동 복원 없음 — 장바구니 = 항상 빈 작업대)
  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const filtered = parts.filter(p => {
    const q = orderSearch.trim().toLowerCase();
    if (q) {
      const hit = (p.code || '').toLowerCase().includes(q)
        || (p.name || '').toLowerCase().includes(q)
        || (p.spec || '').toLowerCase().includes(q)
        || (p.category || '').toLowerCase().includes(q)
        || (p.chinese_model || '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (orderModel && orderModel !== '전체') {
      if (p.category !== orderModel && p.chinese_model !== orderModel) return false;
    }
    if (orderBigCat === '전체') return true;
    if (orderBigCat === '미분류') return !p.big_category;
    const bigCatTokens = (p.big_category || '').split('|').map(s => s.trim()).filter(Boolean);
    return bigCatTokens.includes(orderBigCat);
  });

  const pillItems = ['전체', ...(categories || []).map(c => c.name), '미분류'];
  const modelOptions = models && models.length ? models : ['전체'];

  return (
    <div style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden'}}>
      {/* 필터바 */}
      <div className="as-filter-row" style={{padding:'8px 12px'}}>
        <div className="as-filter-search-wrap">
          <svg className="as-filter-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="#9BA3B2" strokeWidth="1.2"/><path d="M9.5 9.5L13 13" stroke="#9BA3B2" strokeWidth="1.2" strokeLinecap="round"/></svg>
          <input className="input as-filter-search" placeholder="부품코드, 품명, 스펙, 모델명 검색..." value={orderSearch} onChange={e => setOrderSearch(e.target.value)} autoComplete="off" />
        </div>
        <div className="as-filter-pair"><span className="as-filter-label">모델</span>
          <select className="input as-filter-select" value={orderModel} onChange={e => setOrderModel(e.target.value)}>
            {modelOptions.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* pill 필터 (대분류) */}
      <div style={{padding:10, background:'#F4F6FA', display:'flex', flexWrap:'wrap', gap:6, borderBottom:'0.5px solid #DDE1EB', flexShrink:0}}>
        {pillItems.map(item => {
          const active = orderBigCat === item;
          return (
            <div key={item} onClick={() => setOrderBigCat(item)} style={{padding:'6px 12px', borderRadius:999, fontSize:11, cursor:'pointer', userSelect:'none', background: active ? '#185FA5' : '#fff', color: active ? '#fff' : '#5A6070', fontWeight: active ? 500 : 400, border: active ? '0.5px solid #185FA5' : '0.5px solid #DDE1EB', whiteSpace:'nowrap'}}>{item}</div>
          );
        })}
      </div>

      {/* 좌(부속목록) : 우(장바구니) 5:5 */}
      <div style={{flex:1, display:'flex', overflow:'hidden'}}>
        <div style={{flex:1, borderRight:'0.5px solid #DDE1EB', display:'flex', flexDirection:'column', overflow:'hidden'}}>
          <PartsOrderTable parts={filtered} onPhotoClick={onPhotoClick} onAdd={onAddToCart} />
        </div>
        <div style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden'}}>
          <OrderCart cart={cart} setCart={setCart} currentDraftId={currentDraftId} onSaveDraft={onSaveDraft} onConfirm={onConfirm} onShowHistory={onShowHistory} onShowTemplate={onShowTemplate} />
        </div>
      </div>
    </div>
  );
}


/* ═══ PARTS ORDER TABLE — 10컬럼 SELECT only (Phase 2-1a: 담기 활성화) ═══ */
function PartsOrderTable({ parts, onPhotoClick, onAdd }) {
  const ALL_COLS = [
    { key:'image_url',     label:'사진',         w:80  },
    { key:'name_spec',     label:'부품스펙',     w:220 },
    { key:'big_category',  label:'대분류',       w:110 },
    { key:'category',      label:'모델명(한국)', w:120 },
    { key:'chinese_model', label:'모델명(中)',   w:120 },
    { key:'chinese_name',  label:'부속이름(中)', w:110 },
    { key:'quantity',      label:'수량',         w:55  },
    { key:'_add',          label:'담기',         w:70  },
  ];
  const DEFAULT_W = Object.fromEntries(ALL_COLS.map(c => [c.key, c.w]));

  const [visibleCols, setVisibleCols] = useState(() => {
    const initial = Object.fromEntries(ALL_COLS.map(c => [c.key, true]));
    if (typeof window === 'undefined') return initial;
    try {
      const v = JSON.parse(localStorage.getItem('partsOrderVisibleColumns'));
      if (v && typeof v === 'object') {
        return Object.fromEntries(ALL_COLS.map(c => [c.key, v[c.key] !== false]));
      }
    } catch {}
    return initial;
  });

  const [showColPanel, setShowColPanel] = useState(false);
  const [colPanelPos, setColPanelPos] = useState(null);
  const colBtnRef = useRef(null);
  const tableRef = useRef(null);
  const savedWidthsRef = useRef((() => {
    if (typeof window === 'undefined') return {};
    try { const v = JSON.parse(localStorage.getItem('partsOrderColumnWidths')); return (v && typeof v === 'object') ? v : {}; } catch { return {}; }
  })());

  const COLS = ALL_COLS.filter(c => visibleCols[c.key]);
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
      localStorage.setItem('partsOrderColumnWidths', JSON.stringify(savedWidthsRef.current));
    };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  };

  const toggleCol = (key) => {
    const visibleCount = ALL_COLS.filter(c => visibleCols[c.key]).length;
    if (visibleCols[key] && visibleCount <= 1) return; // 마지막 1개 보호
    const next = { ...visibleCols, [key]: !visibleCols[key] };
    setVisibleCols(next);
    try { localStorage.setItem('partsOrderVisibleColumns', JSON.stringify(next)); } catch {}
  };

  const openColPanel = () => {
    if (showColPanel) { setShowColPanel(false); return; }
    const rect = colBtnRef.current?.getBoundingClientRect();
    if (rect) setColPanelPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 240) });
    setShowColPanel(true);
  };

  useEffect(() => {
    if (!showColPanel) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowColPanel(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showColPanel]);

  const renderCell = (p, key) => {
    if (key === 'code') return <span style={{fontSize:13, color:'#5A6070'}}>{p.code || <span className="empty-dot">●</span>}</span>;
    if (key === 'image_url') return <PartThumbnail url={p.image_url} name={p.name} code={p.code} onClick={() => p.image_url && onPhotoClick && onPhotoClick({url:p.image_url, name:p.name, code:p.code, partId:p.id, readOnly:true})} />;
    if (key === 'name_spec') return (
      <div style={{minWidth:0}}>
        <div style={{fontSize:13, fontWeight:500, color:'#1A1D23', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{p.name || <span className="empty-dot">●</span>}</div>
        {p.spec && <div style={{fontSize:11, color:'#5A6070', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{p.spec}</div>}
      </div>
    );
    if (key === 'big_category') {
      const tokens = (p.big_category || '').split('|').map(s => s.trim()).filter(Boolean);
      if (tokens.length === 0) return <span style={{display:'inline-block', padding:'2px 7px', border:'0.5px dashed #DDE1EB', color:'#9BA3B2', borderRadius:999, fontSize:11, whiteSpace:'nowrap'}}>미분류</span>;
      return (
        <div style={{display:'flex',flexWrap:'wrap',gap:3,justifyContent:'center',alignItems:'center'}}>
          {tokens.map((t, i) => (
            <span key={i} style={{display:'inline-block', padding:'2px 7px', background:'#EDEBFE', color:'#5046B0', borderRadius:999, fontSize:11, fontWeight:500, whiteSpace:'nowrap'}}>{t}</span>
          ))}
        </div>
      );
    }
    if (key === 'category') {
      const tokens = (p.category || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean);
      if (tokens.length === 0) return <span className="empty-dot">●</span>;
      return (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:3,padding:'0 4px'}}>
          {tokens.map((t, i) => (
            <span key={i} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:500,background:'#E8EFF7',color:'#185FA5',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{t}</span>
          ))}
        </div>
      );
    }
    if (key === 'chinese_model') {
      const source = p.chinese_model || p.category;
      const tokens = (source || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean);
      if (tokens.length === 0) return <span className="empty-dot">●</span>;
      return (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:3,padding:'0 4px'}}>
          {tokens.map((t, i) => (
            <span key={i} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:500,background:'#E0F4F0',color:'#0E7A5F',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{t}</span>
          ))}
        </div>
      );
    }
    if (key === 'chinese_name') {
      const display = p.chinese_name || p.name;
      if (!display) return <span className="empty-dot">●</span>;
      return <span>{display}</span>;
    }
    if (key === 'quantity') return p.quantity == null ? <span className="empty-dot">●</span> : p.quantity;
    if (key === 'price') return <span style={{color:'#185FA5', fontWeight:700, fontVariantNumeric:'tabular-nums'}}>{p.price?.toLocaleString('ko-KR') || '0'}</span>;
    if (key === '_add') return <button onClick={() => onAdd && onAdd(p)} style={{padding:'4px 10px', fontSize:11, background:'#185FA5', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>+ 담기</button>;
    return null;
  };

  return (
    <>
      <div className="section" style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden'}}>
        <div className="section-header">
          <span style={{fontSize:12, fontWeight:600}}>부속 목록</span>
          <div style={{display:'flex', alignItems:'center', gap:10}}>
            <span style={{fontSize:12, color:'rgba(255,255,255,0.5)'}}>총 {parts.length}건</span>
            <button ref={colBtnRef} onClick={openColPanel} style={{display:'inline-flex', alignItems:'center', gap:4, padding:'4px 9px', background:'transparent', border:'0.5px solid rgba(255,255,255,0.3)', color:'#fff', borderRadius:4, fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              컬럼
            </button>
          </div>
        </div>
        <div className="as-table-wrapper" style={{flex:1, overflow:'auto'}}>
          <table className="as-table" ref={tableRef} style={{width: COLS.reduce((s,c) => s + getW(c.key), 0)}}>
            <colgroup>{COLS.map(c => <col key={c.key} style={{width: getW(c.key)}} />)}</colgroup>
            <thead><tr className="as-col-header">
              {COLS.map((c, idx) => (
                <th key={c.key} style={{position:'sticky', top:0, zIndex:10, background:'#EAECF2', color:'#5A6070', fontSize:13, fontWeight:500, padding:'8px 10px', height:36, lineHeight:'20px', boxShadow:'0 1px 0 0 #DDE1EB', userSelect:'none'}}>
                  {c.label}
                  <span className="col-resize-handle" onMouseDown={e => startResize(idx, c.key, e)} />
                </th>
              ))}
            </tr></thead>
            <tbody>
              {parts.map((p, i) => (
                <tr key={p.id} className="as-data-row" style={i % 2 === 1 ? {background:'#FAFBFC'} : undefined}>
                  {COLS.map(c => (
                    <td key={c.key} style={{textAlign: c.key === 'name_spec' ? 'left' : c.key === 'price' ? 'right' : 'center', padding: c.key === 'image_url' ? '8px 4px' : c.key === 'name_spec' ? '10px 8px' : '8px 10px'}}>
                      {renderCell(p, c.key)}
                    </td>
                  ))}
                </tr>
              ))}
              {parts.length === 0 && <tr><td colSpan={COLS.length} className="empty">부품이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {showColPanel && colPanelPos && (
        <ColumnSettingsPanel allCols={ALL_COLS} visible={visibleCols} onToggle={toggleCol} position={colPanelPos} onClose={() => setShowColPanel(false)} />
      )}
    </>
  );
}


/* ═══ COLUMN SETTINGS PANEL — 컬럼 표시/숨김 (position:fixed) ═══ */
function ColumnSettingsPanel({ allCols, visible, onToggle, position, onClose }) {
  const visibleCount = allCols.filter(c => visible[c.key]).length;
  return (
    <div style={{position:'fixed', top:position.top, left:position.left, zIndex:1000, background:'#fff', border:'0.5px solid #DDE1EB', borderRadius:8, padding:'12px 14px', boxShadow:'0 4px 12px rgba(26,29,35,0.08)', width:240}}
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{fontSize:12, fontWeight:500, color:'#1A1D23', paddingBottom:8, borderBottom:'0.5px solid #DDE1EB'}}>컬럼 표시 설정</div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px 16px', padding:'10px 0', fontSize:11}}>
        {allCols.map(c => {
          const isVisible = !!visible[c.key];
          const isLastVisible = isVisible && visibleCount <= 1;
          return (
            <label key={c.key} style={{display:'flex', alignItems:'center', gap:6, cursor: isLastVisible ? 'not-allowed' : 'pointer', color: isLastVisible ? '#9BA3B2' : '#1A1D23', userSelect:'none'}}>
              <input type="checkbox" checked={isVisible} disabled={isLastVisible} onChange={() => onToggle(c.key)} style={{margin:0, cursor: isLastVisible ? 'not-allowed' : 'pointer'}} />
              {c.label}
            </label>
          );
        })}
      </div>
      <div style={{fontSize:11, color:'#9BA3B2', paddingTop:8, borderTop:'0.5px solid #DDE1EB'}}>최소 1개 필수 · 브라우저에 저장됨</div>
    </div>
  );
}


/* ═══ CART PLACEHOLDER — Phase 1 빈 상태 (장바구니 state 없음) ═══ */
function CartPlaceholder() {
  return (
    <div className="section" style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden'}}>
      <div className="section-header">
        <span style={{fontSize:12, fontWeight:600}}>장바구니</span>
        <span style={{fontSize:12, color:'rgba(255,255,255,0.5)'}}>0건</span>
      </div>
      <div style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:260, padding:24, gap:12, background:'#fff'}}>
        <div style={{width:48, height:48, borderRadius:'50%', background:'#F4F6FA', display:'flex', alignItems:'center', justifyContent:'center'}}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9BA3B2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
        </div>
        <div style={{fontSize:12, fontWeight:500, color:'#5A6070'}}>장바구니가 비어있습니다</div>
        <div style={{fontSize:11, color:'#9BA3B2', textAlign:'center'}}>좌측 &quot;+ 담기&quot; 클릭 시 항목이 추가됩니다</div>
        <div style={{marginTop:8, padding:'6px 12px', background:'#F4F6FA', borderRadius:6, fontSize:11, color:'#9BA3B2'}}>Phase 2에서 실제 로직 구현</div>
      </div>
    </div>
  );
}


/* ═══ ORDER CART — Phase 2-1a 장바구니 ═══ */
const CART_COLS = [
  { key:'image_url',     label:'사진',         defaultOn:true  },
  { key:'name_spec',     label:'부품스펙',     defaultOn:true  },
  { key:'big_category',  label:'대분류',       defaultOn:true  },
  { key:'category',      label:'모델명(한국)', defaultOn:true  },
  { key:'chinese_model', label:'모델명(中)',   defaultOn:true  },
  { key:'chinese_name',  label:'부속이름(中)', defaultOn:true  },
  { key:'quantity',      label:'수량',         defaultOn:true  },
  { key:'price',         label:'단가',         defaultOn:false },
  { key:'subtotal',      label:'합계',         defaultOn:false },
];

function OrderCart({ cart, setCart, currentDraftId, onSaveDraft, onConfirm, onShowHistory, onShowTemplate }) {
  const [visibleCols, setVisibleCols] = useState(() => {
    const initial = Object.fromEntries(CART_COLS.map(c => [c.key, c.defaultOn]));
    if (typeof window === 'undefined') return initial;
    try {
      const v = JSON.parse(localStorage.getItem('orderCartVisibleColumns'));
      if (v && typeof v === 'object') {
        return Object.fromEntries(CART_COLS.map(c => [c.key, v[c.key] !== undefined ? !!v[c.key] : c.defaultOn]));
      }
    } catch {}
    return initial;
  });
  const [showColPanel, setShowColPanel] = useState(false);
  const [colPanelPos, setColPanelPos] = useState(null);
  const colBtnRef = useRef(null);

  const toggleCol = (key) => {
    const visibleCount = CART_COLS.filter(c => visibleCols[c.key]).length;
    if (visibleCols[key] && visibleCount <= 1) return;
    const next = { ...visibleCols, [key]: !visibleCols[key] };
    setVisibleCols(next);
    try { localStorage.setItem('orderCartVisibleColumns', JSON.stringify(next)); } catch {}
  };

  const openColPanel = () => {
    if (showColPanel) { setShowColPanel(false); return; }
    const rect = colBtnRef.current?.getBoundingClientRect();
    if (rect) setColPanelPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 240) });
    setShowColPanel(true);
  };

  useEffect(() => {
    if (!showColPanel) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowColPanel(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showColPanel]);

  const updateQty = (idx, newQty) => {
    if (newQty < 1) {
      if (!confirm('장바구니에서 제거하시겠습니까?')) return;
      setCart(prev => prev.filter((_, i) => i !== idx));
      return;
    }
    setCart(prev => prev.map((item, i) => i === idx ? { ...item, quantity: newQty } : item));
  };

  const removeItem = (idx) => {
    setCart(prev => prev.filter((_, i) => i !== idx));
  };

  const visible = CART_COLS.filter(c => visibleCols[c.key]);
  const totalQty = cart.reduce((s, x) => s + (x.quantity || 0), 0);
  const totalAmount = cart.reduce((s, x) => s + (x.quantity || 0) * (x.price || 0), 0);
  const isEmpty = cart.length === 0;

  return (
    <>
      <div className="section" style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden'}}>
        <div className="section-header">
          <span style={{fontSize:12, fontWeight:600}}>장바구니</span>
          <span style={{fontSize:12, color:'rgba(255,255,255,0.5)'}}>{cart.length}건</span>
          <div style={{marginLeft:'auto', display:'flex', gap:6}}>
            <button ref={colBtnRef} onClick={openColPanel} style={{display:'inline-flex', alignItems:'center', gap:4, padding:'4px 9px', background:'transparent', border:'0.5px solid rgba(255,255,255,0.3)', color:'#fff', borderRadius:4, fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              컬럼
            </button>
            <button onClick={onShowTemplate} style={{display:'inline-flex', alignItems:'center', gap:4, padding:'4px 9px', background:'transparent', border:'0.5px solid rgba(255,255,255,0.3)', color:'#fff', borderRadius:4, fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              템플릿
            </button>
            <button onClick={onShowHistory} style={{display:'inline-flex', alignItems:'center', gap:4, padding:'4px 9px', background:'transparent', border:'0.5px solid rgba(255,255,255,0.3)', color:'#fff', borderRadius:4, fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              이력
            </button>
          </div>
        </div>

        {/* 항목 리스트 */}
        <div style={{flex:1, overflow:'auto', background:'#fff'}}>
          {isEmpty ? (
            <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:260, padding:24, gap:12, height:'100%'}}>
              <div style={{width:48, height:48, borderRadius:'50%', background:'#F4F6FA', display:'flex', alignItems:'center', justifyContent:'center'}}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9BA3B2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
              </div>
              <div style={{fontSize:12, fontWeight:500, color:'#5A6070'}}>장바구니가 비어있습니다</div>
              <div style={{fontSize:11, color:'#9BA3B2', textAlign:'center'}}>좌측 &quot;+ 담기&quot; 클릭 시 항목이 추가됩니다</div>
            </div>
          ) : (
            <table className="as-table" style={{width:'100%'}}>
              <thead><tr className="as-col-header">
                {visible.map(c => (
                  <th key={c.key} style={{position:'sticky', top:0, zIndex:10, background:'#EAECF2', color:'#5A6070', fontSize:12, fontWeight:500, padding:'8px 8px', height:36, lineHeight:'20px', boxShadow:'0 1px 0 0 #DDE1EB', userSelect:'none'}}>{c.label}</th>
                ))}
                <th style={{position:'sticky', top:0, zIndex:10, background:'#EAECF2', boxShadow:'0 1px 0 0 #DDE1EB', width:36, padding:'8px 4px'}} />
              </tr></thead>
              <tbody>
                {cart.map((item, idx) => (
                  <tr key={item.part_id + ':' + idx} style={idx % 2 === 1 ? {background:'#FAFBFC'} : undefined}>
                    {visible.map(c => {
                      const td = (content, extra={}) => (<td key={c.key} style={{padding:'6px 8px', fontSize:12, textAlign:'center', ...extra}}>{content}</td>);
                      if (c.key === 'image_url') return td(<PartThumbnail url={item.image_url} name={item.name} code={item.code} />, {padding:'6px 4px'});
                      if (c.key === 'name_spec') return td(
                        <div style={{textAlign:'left'}}>
                          <div style={{fontSize:12, fontWeight:500, color:'#1A1D23'}}>{item.name || <span className="empty-dot">●</span>}</div>
                          {item.spec && <div style={{fontSize:10, color:'#9BA3B2', marginTop:2}}>{item.spec}</div>}
                        </div>,
                        {padding:'6px 8px', textAlign:'left'}
                      );
                      if (c.key === 'big_category') {
                        const tokens = (item.big_category || '').split('|').map(s => s.trim()).filter(Boolean);
                        if (tokens.length === 0) return td(<span className="empty-dot">●</span>);
                        return td(
                          <div style={{display:'flex',flexWrap:'wrap',gap:3,justifyContent:'center'}}>
                            {tokens.map((t, i) => (
                              <span key={i} style={{display:'inline-block',padding:'2px 7px',background:'#EDEBFE',color:'#5046B0',borderRadius:999,fontSize:11,fontWeight:500,whiteSpace:'nowrap'}}>{t}</span>
                            ))}
                          </div>
                        );
                      }
                      if (c.key === 'category') {
                        const tokens = (item.category || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean);
                        if (tokens.length === 0) return td(<span className="empty-dot">●</span>);
                        return td(
                          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:3,padding:'0 4px'}}>
                            {tokens.map((t, i) => (
                              <span key={i} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:500,background:'#E8EFF7',color:'#185FA5',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{t}</span>
                            ))}
                          </div>
                        );
                      }
                      if (c.key === 'chinese_model') {
                        const source = item.chinese_model || item.category;
                        const tokens = (source || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean);
                        if (tokens.length === 0) return td(<span className="empty-dot">●</span>);
                        return td(
                          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:3,padding:'0 4px'}}>
                            {tokens.map((t, i) => (
                              <span key={i} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:500,background:'#E0F4F0',color:'#0E7A5F',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{t}</span>
                            ))}
                          </div>
                        );
                      }
                      if (c.key === 'chinese_name') {
                        const display = item.chinese_name || item.name;
                        return td(display ? <span style={{fontSize:12}}>{display}</span> : <span className="empty-dot">●</span>);
                      }
                      if (c.key === 'name') return td(<span style={{fontSize:12, fontWeight:500, color:'#1A1D23'}}>{item.name || <span className="empty-dot">●</span>}</span>);
                      if (c.key === 'spec') return td(<span style={{fontSize:11, color:'#5A6070'}}>{item.spec || <span className="empty-dot">●</span>}</span>);
                      if (c.key === 'quantity') return td(
                        <div style={{display:'inline-flex', alignItems:'center', gap:4, justifyContent:'center'}}>
                          <button onClick={() => updateQty(idx, item.quantity - 1)} style={{width:22, height:22, fontSize:13, border:'0.5px solid #DDE1EB', background:'#fff', color:'#5A6070', borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>−</button>
                          <input type="number" min="1" value={item.quantity} onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) updateQty(idx, v); else if (e.target.value === '') updateQty(idx, 1); }} style={{width:42, height:22, padding:'0 4px', fontSize:12, border:'0.5px solid #DDE1EB', borderRadius:4, textAlign:'center', fontFamily:'inherit'}} />
                          <button onClick={() => updateQty(idx, item.quantity + 1)} style={{width:22, height:22, fontSize:13, border:'0.5px solid #DDE1EB', background:'#fff', color:'#5A6070', borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>+</button>
                        </div>
                      );
                      if (c.key === 'price') return td(<span style={{color:'#185FA5', fontWeight:600, fontVariantNumeric:'tabular-nums'}}>{(item.price || 0).toLocaleString('ko-KR')}</span>);
                      if (c.key === 'subtotal') return td(<span style={{color:'#185FA5', fontWeight:700, fontVariantNumeric:'tabular-nums'}}>{((item.quantity||0)*(item.price||0)).toLocaleString('ko-KR')}</span>);
                      return td(null);
                    })}
                    <td style={{padding:'6px 4px', textAlign:'center', width:36}}>
                      <button onClick={() => removeItem(idx)} title="삭제" style={{width:22, height:22, fontSize:12, border:'0.5px solid #DDE1EB', background:'#fff', color:'#9BA3B2', borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 합계 바 */}
        {!isEmpty && (
          <div style={{flexShrink:0, padding:'8px 12px', background:'#FAFBFC', borderTop:'0.5px solid #DDE1EB', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:12}}>
            <span style={{color:'#5A6070'}}>합계 {cart.length}종 · {totalQty}개</span>
            <span style={{color:'#185FA5', fontWeight:700, fontVariantNumeric:'tabular-nums'}}>{totalAmount.toLocaleString('ko-KR')}원</span>
          </div>
        )}

        {/* 버튼 영역 */}
        <div style={{flexShrink:0, padding:'10px 12px', background:'#fff', borderTop:'0.5px solid #DDE1EB', display:'flex', gap:8, justifyContent:'flex-end'}}>
          <button onClick={onSaveDraft} disabled={isEmpty} style={{padding:'7px 16px', fontSize:12, fontWeight:500, background:'#fff', color: isEmpty ? '#9BA3B2' : '#185FA5', border: isEmpty ? '0.5px solid #DDE1EB' : '0.5px solid #185FA5', borderRadius:6, cursor: isEmpty ? 'not-allowed' : 'pointer', opacity: isEmpty ? 0.5 : 1, fontFamily:'inherit'}}>💾 저장</button>
          <button onClick={onConfirm} disabled={isEmpty} style={{padding:'7px 16px', fontSize:12, fontWeight:500, background: isEmpty ? '#DDE1EB' : '#185FA5', color:'#fff', border:'none', borderRadius:6, cursor: isEmpty ? 'not-allowed' : 'pointer', opacity: isEmpty ? 0.6 : 1, fontFamily:'inherit'}}>📤 발주확정</button>
        </div>
      </div>

      {showColPanel && colPanelPos && (
        <CartColumnSettingsPanel allCols={CART_COLS} visible={visibleCols} onToggle={toggleCol} position={colPanelPos} onClose={() => setShowColPanel(false)} />
      )}
    </>
  );
}


/* ═══ CART COLUMN SETTINGS PANEL — 장바구니 컬럼 표시/숨김 ═══ */
function CartColumnSettingsPanel({ allCols, visible, onToggle, position, onClose }) {
  const visibleCount = allCols.filter(c => visible[c.key]).length;
  return (
    <div style={{position:'fixed', top:position.top, left:position.left, zIndex:1000, background:'#fff', border:'0.5px solid #DDE1EB', borderRadius:8, padding:'12px 14px', boxShadow:'0 4px 12px rgba(26,29,35,0.08)', width:240}}
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{fontSize:12, fontWeight:500, color:'#1A1D23', paddingBottom:8, borderBottom:'0.5px solid #DDE1EB'}}>장바구니 컬럼 설정</div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px 16px', padding:'10px 0', fontSize:11}}>
        {allCols.map(c => {
          const isVisible = !!visible[c.key];
          const isLastVisible = isVisible && visibleCount <= 1;
          return (
            <label key={c.key} style={{display:'flex', alignItems:'center', gap:6, cursor: isLastVisible ? 'not-allowed' : 'pointer', color: isLastVisible ? '#9BA3B2' : '#1A1D23', userSelect:'none'}}>
              <input type="checkbox" checked={isVisible} disabled={isLastVisible} onChange={() => onToggle(c.key)} style={{margin:0, cursor: isLastVisible ? 'not-allowed' : 'pointer'}} />
              {c.label}
            </label>
          );
        })}
      </div>
      <div style={{fontSize:11, color:'#9BA3B2', paddingTop:8, borderTop:'0.5px solid #DDE1EB'}}>최소 1개 필수 · 브라우저에 저장됨</div>
    </div>
  );
}


/* ═══ ORDER CONFIRM MODAL — 발주확정 확인 모달 ═══ */
function OrderConfirmModal({ cart, onConfirm, onClose }) {
  const [previewOrderNo, setPreviewOrderNo] = useState('계산 중...');

  useEffect(() => {
    (async () => {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');
      const dateStr = `${y}${m}${d}`;
      const { data } = await supabase.from('parts_orders').select('order_no').like('order_no', `${dateStr}-%`);
      const nextNum = (data?.length || 0) + 1;
      setPreviewOrderNo(`${dateStr}-${String(nextNum).padStart(3, '0')}`);
    })();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const today = new Date();
  const dateLabel = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const totalQty = cart.reduce((s, x) => s + (x.quantity || 0), 0);

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, zIndex:10001, background:'rgba(26,29,35,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding:24}}>
      <div onClick={e => e.stopPropagation()} style={{background:'#fff', borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,0.2)', width:'100%', maxWidth:380, fontFamily:'Pretendard, -apple-system, sans-serif'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 18px', borderBottom:'0.5px solid #DDE1EB'}}>
          <div style={{fontSize:14, fontWeight:600, color:'#1A1D23'}}>발주확정</div>
          <button onClick={onClose} style={{background:'none', border:'none', fontSize:18, cursor:'pointer', color:'#9BA3B2', padding:0, lineHeight:1, fontFamily:'inherit'}}>✕</button>
        </div>
        <div style={{padding:'18px'}}>
          <div style={{fontSize:12, color:'#1A1D23', marginBottom:14}}>아래 내용으로 확정하시겠습니까?</div>
          <div style={{fontSize:11, color:'#9BA3B2', marginBottom:14}}>확정 후 새 작성중 발주가 시작됩니다.</div>
          <div style={{padding:'12px 14px', background:'#FAFBFC', border:'0.5px solid #DDE1EB', borderRadius:6, fontSize:12}}>
            <div style={{display:'flex', justifyContent:'space-between', padding:'4px 0'}}><span style={{color:'#5A6070'}}>발주번호</span><span style={{fontFamily:'var(--font-mono, "SF Mono", Menlo, Consolas, monospace)', color:'#185FA5', fontWeight:600}}>{previewOrderNo}</span></div>
            <div style={{display:'flex', justifyContent:'space-between', padding:'4px 0'}}><span style={{color:'#5A6070'}}>발주일</span><span style={{color:'#1A1D23'}}>{dateLabel}</span></div>
            <div style={{display:'flex', justifyContent:'space-between', padding:'4px 0'}}><span style={{color:'#5A6070'}}>항목 수</span><span style={{color:'#1A1D23'}}>{cart.length}종 / {totalQty}개</span></div>
          </div>
        </div>
        <div style={{display:'flex', gap:8, justifyContent:'flex-end', padding:'12px 18px', borderTop:'0.5px solid #DDE1EB'}}>
          <button onClick={onClose} style={{padding:'7px 16px', fontSize:12, background:'#fff', color:'#5A6070', border:'0.5px solid #DDE1EB', borderRadius:6, cursor:'pointer', fontFamily:'inherit'}}>취소</button>
          <button onClick={onConfirm} style={{padding:'7px 16px', fontSize:12, fontWeight:500, background:'#185FA5', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontFamily:'inherit'}}>확정</button>
        </div>
      </div>
    </div>
  );
}


/* ═══ ORDER HISTORY MODAL — 발주 이력 (작성중/확정) ═══ */
/* ═══ PDF PREVIEW MODAL — 미리보기 + 다운로드 ═══ */
function PdfPreviewModal({ preview, onClose, onDownload }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!preview) return null;
  return (
    <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:9100, display:'flex', alignItems:'center', justifyContent:'center', padding:24}}
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{background:'#fff', borderRadius:8, width:'min(960px, 90vw)', height:'90vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 12px 32px rgba(0,0,0,0.3)'}}>
        <div style={{flexShrink:0, padding:'12px 16px', background:'#1A1D23', color:'#fff', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <span style={{fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginRight:12}}>📄 PDF 미리보기 — {preview.filename}</span>
          <div style={{display:'flex', gap:8, flexShrink:0}}>
            <button onClick={onDownload} style={{padding:'5px 12px', background:'#185FA5', color:'#fff', border:'none', borderRadius:4, fontSize:12, fontWeight:500, cursor:'pointer', fontFamily:'inherit'}}>📥 다운로드</button>
            <button onClick={onClose} style={{padding:'5px 10px', background:'transparent', color:'#fff', border:'0.5px solid rgba(255,255,255,0.3)', borderRadius:4, fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>닫기</button>
          </div>
        </div>
        <iframe src={preview.blobUrl} style={{flex:1, width:'100%', border:'none', background:'#525659'}} title="PDF 미리보기" />
      </div>
    </div>
  );
}


function OrderHistoryModal({ orders, orderItems, parts, onLoadDraft, onClose, onDeleteOrder, onGeneratePdf }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('전체');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const itemsByOrder = orderItems.reduce((acc, it) => {
    (acc[it.order_id] = acc[it.order_id] || []).push(it);
    return acc;
  }, {});

  const filtered = orders.filter(o => {
    if (statusFilter === '작성중' && o.status !== 'draft') return false;
    if (statusFilter === '확정' && o.status !== 'confirmed') return false;
    const q = search.trim().toLowerCase();
    if (q) {
      const hit = (o.order_no || '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });

  const draftCount = orders.filter(o => o.status === 'draft').length;
  const confirmedCount = orders.filter(o => o.status === 'confirmed').length;

  const fmtDateMD = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };
  const fmtDateYMD = (s) => {
    if (!s) return '—';
    const [y, m, d] = s.split('-');
    return `${y}.${m}.${d}`;
  };

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, zIndex:10001, background:'rgba(26,29,35,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding:24}}>
      <div onClick={e => e.stopPropagation()} style={{background:'#fff', borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,0.2)', width:'100%', maxWidth:760, maxHeight:'85vh', display:'flex', flexDirection:'column', fontFamily:'Pretendard, -apple-system, sans-serif'}}>
        {/* 헤더 */}
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 18px', borderBottom:'0.5px solid #DDE1EB', flexShrink:0}}>
          <div style={{fontSize:14, fontWeight:600, color:'#1A1D23'}}>
            발주이력 <span style={{fontSize:11, fontWeight:400, color:'#9BA3B2', marginLeft:8}}>총 {orders.length}건 · 작성중 {draftCount} / 확정 {confirmedCount}</span>
          </div>
          <button onClick={onClose} style={{background:'none', border:'none', fontSize:18, cursor:'pointer', color:'#9BA3B2', padding:0, lineHeight:1, fontFamily:'inherit'}}>✕</button>
        </div>

        {/* 필터 바 */}
        <div style={{padding:'10px 18px', display:'flex', gap:8, borderBottom:'0.5px solid #DDE1EB', flexShrink:0}}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="발주번호 검색..." autoComplete="off" style={{flex:1, padding:'6px 10px', fontSize:12, border:'0.5px solid #DDE1EB', borderRadius:6, fontFamily:'inherit'}} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{padding:'6px 10px', fontSize:12, border:'0.5px solid #DDE1EB', borderRadius:6, background:'#fff', fontFamily:'inherit'}}>
            <option>전체</option>
            <option>작성중</option>
            <option>확정</option>
          </select>
        </div>

        {/* 리스트 */}
        <div style={{flex:1, overflow:'auto'}}>
          <table className="as-table" style={{width:'100%'}}>
            <thead><tr className="as-col-header">
              {['발주번호','날짜','상태','항목','합계','액션'].map(h => (
                <th key={h} style={{position:'sticky', top:0, zIndex:10, background:'#EAECF2', color:'#5A6070', fontSize:12, fontWeight:500, padding:'8px 10px', height:36, lineHeight:'20px', boxShadow:'0 1px 0 0 #DDE1EB', userSelect:'none'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map((o, i) => {
                const items = itemsByOrder[o.id] || [];
                const totalQty = items.reduce((s, it) => s + (it.quantity || 0), 0);
                const totalAmount = items.reduce((s, it) => s + (it.quantity || 0) * (it.price_snapshot || 0), 0);
                const isDraft = o.status === 'draft';
                return (
                  <tr key={o.id} style={i % 2 === 1 ? {background:'#FAFBFC'} : undefined}>
                    <td style={{padding:'8px 10px', fontSize:12, textAlign:'center'}}>
                      {o.order_no
                        ? <span style={{fontFamily:'var(--font-mono, "SF Mono", Menlo, Consolas, monospace)', color:'#1A1D23'}}>{o.order_no}</span>
                        : <span style={{color:'#9BA3B2'}}>—</span>}
                    </td>
                    <td style={{padding:'8px 10px', fontSize:12, textAlign:'center', color:'#5A6070'}}>
                      {isDraft ? `${fmtDateMD(o.created_at)} 작성` : fmtDateYMD(o.order_date)}
                    </td>
                    <td style={{padding:'8px 10px', fontSize:12, textAlign:'center'}}>
                      {isDraft
                        ? <span style={{display:'inline-block', padding:'2px 8px', background:'#FFF4D6', color:'#8A6300', borderRadius:999, fontSize:11, fontWeight:500, whiteSpace:'nowrap'}}>작성중</span>
                        : <span style={{display:'inline-block', padding:'2px 8px', background:'#E6F4EA', color:'#1A6F2E', borderRadius:999, fontSize:11, fontWeight:500, whiteSpace:'nowrap'}}>확정</span>}
                    </td>
                    <td style={{padding:'8px 10px', fontSize:12, textAlign:'center', color:'#5A6070'}}>{items.length}종 / {totalQty}개</td>
                    <td style={{padding:'8px 10px', fontSize:12, textAlign:'right', color:'#185FA5', fontWeight:600, fontVariantNumeric:'tabular-nums'}}>{totalAmount.toLocaleString('ko-KR')}원</td>
                    <td style={{padding:'8px 10px', fontSize:12, textAlign:'center'}}>
                      {isDraft ? (
                        <div style={{display:'flex', gap:4, justifyContent:'center'}}>
                          <button onClick={() => onLoadDraft(o.id)} style={{padding:'4px 10px', fontSize:11, fontWeight:500, background:'#FFF4D6', color:'#8A6300', border:'0.5px solid #F0D27A', borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>📥 불러오기</button>
                          <button onClick={() => onDeleteOrder && onDeleteOrder(o)} title="작성중 발주 삭제" style={{padding:'4px 8px', fontSize:11, background:'#fff', color:'#9BA3B2', border:'0.5px solid #DDE1EB', borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>🗑</button>
                        </div>
                      ) : (
                        <div style={{display:'flex', gap:4, justifyContent:'center'}}>
                          <button onClick={() => onGeneratePdf && onGeneratePdf(o)} style={{padding:'4px 10px', fontSize:11, fontWeight:500, background:'#185FA5', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>📄 PDF</button>
                          <button onClick={() => onDeleteOrder && onDeleteOrder(o)} title="확정 발주 삭제 (주의)" style={{padding:'4px 8px', fontSize:11, background:'#FEE2E2', color:'#7a3030', border:'0.5px solid #F0B5B5', borderRadius:4, cursor:'pointer', fontFamily:'inherit'}}>🗑</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={6} style={{padding:'40px 0', textAlign:'center', fontSize:12, color:'#9BA3B2'}}>발주 내역이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>

        {/* 푸터 */}
        <div style={{display:'flex', justifyContent:'flex-end', padding:'12px 18px', borderTop:'0.5px solid #DDE1EB', flexShrink:0}}>
          <button onClick={onClose} style={{padding:'7px 16px', fontSize:12, background:'#fff', color:'#5A6070', border:'0.5px solid #DDE1EB', borderRadius:6, cursor:'pointer', fontFamily:'inherit'}}>닫기</button>
        </div>
      </div>
    </div>
  );
}


/* ═══ PART THUMBNAIL — 72px 투명 배경 ═══ */
function PartThumbnail({ url, name, code, onClick }) {
  if (!url) {
    return (
      <div onClick={onClick} title={onClick ? '클릭하여 사진 추가' : undefined} style={{width:72,height:72,display:'inline-flex',alignItems:'center',justifyContent:'center',background:'#F4F6FA',borderRadius:6,color:'#9BA3B2',fontSize:28,fontWeight:300,cursor: onClick ? 'pointer' : 'default',userSelect:'none'}}>
        {onClick ? '+' : (name || code || '?').toString().charAt(0)}
      </div>
    );
  }
  return (
    <div onClick={onClick} title="클릭하여 확대" style={{width:72,height:72,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',background:'transparent',borderRadius:6,overflow:'hidden'}}>
      <img src={url} alt={name || ''} style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain',background:'transparent'}} />
    </div>
  );
}


/* ═══ PHOTO LIGHTBOX ═══ */
function PhotoLightbox({ url, name, code, partId, readOnly, onClose, onUpdate }) {
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(async (blob) => {
          if (!blob) { alert('이미지 변환 실패'); return; }
          setBusy(true);
          const fileName = `part_${Date.now()}.png`;
          const { error: upErr } = await supabase.storage.from('parts-images').upload(fileName, blob, { contentType: 'image/png', upsert: true });
          if (upErr) { setBusy(false); alert('이미지 업로드 실패: ' + upErr.message); return; }
          const { data: urlData } = supabase.storage.from('parts-images').getPublicUrl(fileName);
          const newUrl = urlData?.publicUrl || null;
          if (!newUrl || newUrl.startsWith('blob:')) { setBusy(false); alert('업로드 URL 생성 실패'); return; }
          const { error } = await supabase.from('parts').update({ image_url: newUrl }).eq('id', partId);
          if (error) { setBusy(false); alert('저장 실패: ' + error.message); return; }
          setBusy(false);
          if (onUpdate) onUpdate(newUrl);
          onClose();
        }, 'image/png');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = async () => {
    if (!confirm('사진을 삭제하시겠습니까?')) return;
    setBusy(true);
    const { error } = await supabase.from('parts').update({ image_url: null }).eq('id', partId);
    if (error) { setBusy(false); alert('삭제 실패: ' + error.message); return; }
    setBusy(false);
    if (onUpdate) onUpdate(null);
    onClose();
  };

  const canEdit = !readOnly && !!partId;

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,zIndex:10000,background:'rgba(10,12,15,0.82)',display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{position:'absolute',top:16,right:16,color:'#fff',fontSize:11,opacity:0.7,display:'flex',alignItems:'center',gap:6}}>
        <span style={{padding:'2px 6px',background:'rgba(255,255,255,0.15)',borderRadius:3,fontFamily:'var(--font-mono, "SF Mono", Menlo, Consolas, monospace)'}}>ESC</span>
        <span>또는 바깥 클릭으로 닫기</span>
      </div>
      <div onClick={e => e.stopPropagation()} style={{background:'#fff',borderRadius:8,padding:28,maxWidth:'90vw',maxHeight:'90vh',display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
        {url ? (
          <img src={url} alt={name || ''} style={{maxWidth:'calc(90vw - 56px)',maxHeight:'calc(90vh - 120px)',objectFit:'contain'}} />
        ) : (
          <div style={{width:320,height:240,display:'flex',alignItems:'center',justifyContent:'center',background:'#F4F6FA',borderRadius:6,color:'#9BA3B2',fontSize:13}}>등록된 사진 없음</div>
        )}
        <div style={{textAlign:'center',color:'#1A1D23'}}>
          <div style={{fontWeight:500,fontSize:13}}>{name || '(이름 없음)'} · 내부코드 {code || '-'}</div>
        </div>
        {canEdit && (
          <div style={{display:'flex', gap:8, justifyContent:'center', marginTop:4}}>
            <button onClick={() => fileInputRef.current?.click()} disabled={busy} style={{padding:'7px 16px', fontSize:12, fontWeight:500, background:'#185FA5', color:'#fff', border:'none', borderRadius:6, cursor: busy?'not-allowed':'pointer', fontFamily:'inherit', opacity: busy?0.6:1}}>{busy ? '처리 중...' : '📷 사진 변경'}</button>
            {url && (
              <button onClick={handleDelete} disabled={busy} style={{padding:'7px 16px', fontSize:12, fontWeight:500, background:'#FEE2E2', color:'#7a3030', border:'0.5px solid #F0B5B5', borderRadius:6, cursor: busy?'not-allowed':'pointer', fontFamily:'inherit', opacity: busy?0.6:1}}>🗑 사진 삭제</button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleFileChange} />
          </div>
        )}
      </div>
    </div>
  );
}


/* ═══ CATEGORY DROPDOWN — position:fixed, 항목 클릭으로만 닫힘 ═══ */
/* ═══ TEMPLATE MODAL — Phase 2-1c 부속 템플릿 ═══ */
const DEFAULT_TEMPLATE_WIDTHS = { image_url:48, name_spec:200, big_category:90, category:100, chinese_model:100, chinese_name:90, quantity:90, action:40 };
const TEMPLATE_COL_KEYS = ['image_url','name_spec','big_category','category','chinese_model','chinese_name','quantity','action'];

function TemplateModal({ templates, parts, cart, onApply, onSave, onUpdate, onDelete, onClose }) {
  const [selectedId, setSelectedId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editMemo, setEditMemo] = useState('');
  const [editItems, setEditItems] = useState([]);
  const [partSearch, setPartSearch] = useState('');
  const [showPartDropdown, setShowPartDropdown] = useState(false);
  const itemTableRef = useRef(null);
  const savedWidthsRef = useRef((() => {
    if (typeof window === 'undefined') return {};
    try { const v = JSON.parse(localStorage.getItem('templateModalColumnWidths')); return (v && typeof v === 'object') ? v : {}; } catch { return {}; }
  })());
  const getW = (k) => savedWidthsRef.current[k] || DEFAULT_TEMPLATE_WIDTHS[k] || 80;

  const startResize = (colIdx, colKey, e) => {
    e.preventDefault(); e.stopPropagation();
    const table = itemTableRef.current; if (!table) return;
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
      try { localStorage.setItem('templateModalColumnWidths', JSON.stringify(savedWidthsRef.current)); } catch {}
    };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    if (selectedId === null) {
      setEditName(''); setEditMemo(''); setEditItems([]);
    } else {
      const tpl = templates.find(t => t.id === selectedId);
      if (tpl) {
        setEditName(tpl.name || '');
        setEditMemo(tpl.memo || '');
        setEditItems((tpl.items || []).map(it => ({
          part_id: it.part_id,
          quantity: it.quantity,
          sort_order: it.sort_order || 0,
        })));
      }
    }
  }, [selectedId, templates]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isNewMode = selectedId === null;
  const isDirty = (() => {
    if (isNewMode) return editName.trim() || editItems.length > 0;
    const tpl = templates.find(t => t.id === selectedId);
    if (!tpl) return false;
    if (editName !== (tpl.name || '')) return true;
    if (editMemo !== (tpl.memo || '')) return true;
    if (editItems.length !== (tpl.items || []).length) return true;
    for (let i = 0; i < editItems.length; i++) {
      const a = editItems[i];
      const b = tpl.items[i];
      if (a.part_id !== b.part_id || a.quantity !== b.quantity) return true;
    }
    return false;
  })();

  const partsById = (() => {
    const m = {};
    parts.forEach(p => { m[p.id] = p; });
    return m;
  })();

  const filteredParts = parts.filter(p => {
    if (!partSearch) return true;
    const q = partSearch.toLowerCase();
    return [p.code, p.name, p.spec, p.category].some(f => f?.toLowerCase().includes(q));
  });

  const addItem = (part) => {
    const idx = editItems.findIndex(it => it.part_id === part.id);
    if (idx >= 0) {
      setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: it.quantity + 1 } : it));
    } else {
      setEditItems(prev => [...prev, { part_id: part.id, quantity: 1, sort_order: prev.length }]);
    }
    setShowPartDropdown(false);
    setPartSearch('');
  };

  const updateItemQty = (idx, newQty) => {
    if (newQty < 1) {
      setEditItems(prev => prev.filter((_, i) => i !== idx));
      return;
    }
    setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: newQty } : it));
  };

  const removeItem = (idx) => {
    setEditItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!editName.trim()) { alert('템플릿 이름을 입력하세요'); return; }
    if (editItems.length === 0) { alert('최소 1개의 부품을 추가하세요'); return; }
    if (isNewMode) {
      const newId = await onSave({ name: editName.trim(), memo: editMemo.trim() || null, items: editItems });
      if (newId) setSelectedId(newId);
    } else {
      await onUpdate(selectedId, { name: editName.trim(), memo: editMemo.trim() || null, items: editItems });
    }
  };

  const handleApply = () => {
    if (selectedId === null) { alert('적용할 템플릿을 선택하세요'); return; }
    if (editItems.length === 0) { alert('항목이 없습니다'); return; }
    onApply(editItems);
  };

  const handleSaveCartAsNew = () => {
    if (cart.length === 0) { alert('장바구니가 비어있습니다'); return; }
    setSelectedId(null);
    setEditName('');
    setEditMemo('');
    setEditItems(cart.map((c, i) => ({
      part_id: c.part_id || c.id,
      quantity: c.quantity || 1,
      sort_order: i,
    })));
  };

  return (
    <div onMouseDown={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:9000,display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div onMouseDown={e => e.stopPropagation()} style={{background:'#fff',borderRadius:8,width:'min(1280px,95vw)',height:'min(680px,90vh)',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 12px 32px rgba(0,0,0,0.18)'}}>
        <div style={{flexShrink:0,padding:'12px 16px',background:'#1A1D23',color:'#fff',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:13,fontWeight:600}}>부속 템플릿 관리</span>
          <button onClick={onClose} style={{background:'transparent',border:'0.5px solid rgba(255,255,255,0.3)',color:'#fff',padding:'4px 10px',fontSize:11,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>닫기</button>
        </div>

        <div style={{flex:1,display:'flex',overflow:'hidden'}}>
          <div style={{width:'24%',display:'flex',flexDirection:'column',borderRight:'0.5px solid #DDE1EB',background:'#FAFBFC'}}>
            <div style={{flexShrink:0,padding:'8px 12px',display:'flex',gap:6,borderBottom:'0.5px solid #DDE1EB'}}>
              <button onClick={() => setSelectedId(null)} style={{flex:1,padding:'5px 10px',fontSize:11,background: selectedId === null ? '#185FA5' : '#fff',color: selectedId === null ? '#fff' : '#5A6070',border:'0.5px solid '+(selectedId === null ? '#185FA5' : '#DDE1EB'),borderRadius:4,cursor:'pointer',fontFamily:'inherit',fontWeight: selectedId === null ? 500 : 400}}>+ 새 템플릿</button>
              <button onClick={handleSaveCartAsNew} title="현재 장바구니 내용으로 새 템플릿" style={{flex:1,padding:'5px 10px',fontSize:11,background:'#fff',color:'#185FA5',border:'0.5px solid #185FA5',borderRadius:4,cursor:'pointer',fontFamily:'inherit',fontWeight:500}}>장바구니→템플릿</button>
            </div>
            <div style={{flex:1,overflow:'auto'}}>
              {templates.length === 0 ? (
                <div style={{padding:24,textAlign:'center',fontSize:12,color:'#9BA3B2'}}>저장된 템플릿이 없습니다</div>
              ) : templates.map(t => {
                const active = selectedId === t.id;
                return (
                  <div key={t.id} onClick={() => setSelectedId(t.id)}
                    style={{padding:'10px 12px',cursor:'pointer',borderBottom:'0.5px solid #F0F2F7',background: active ? '#E8EFF7' : 'transparent',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:active ? 600 : 500,color: active ? '#185FA5' : '#1A1D23',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.name}</div>
                      <div style={{fontSize:10,color:'#9BA3B2',marginTop:2}}>{(t.items || []).length}종</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); if (confirm(`"${t.name}" 템플릿을 삭제하시겠습니까?`)) onDelete(t.id); }}
                      title="삭제"
                      style={{padding:'2px 6px',fontSize:11,background:'#fff',color:'#9BA3B2',border:'0.5px solid #DDE1EB',borderRadius:3,cursor:'pointer',fontFamily:'inherit',flexShrink:0}}
                    >🗑</button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{flexShrink:0,padding:'12px 16px',borderBottom:'0.5px solid #DDE1EB',background:'#fff'}}>
              <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
                <label style={{fontSize:11,color:'#5A6070',width:48,flexShrink:0}}>이름</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="예) 콜라보 기본 세트"
                  style={{flex:1,padding:'5px 8px',fontSize:12,border:'0.5px solid #DDE1EB',borderRadius:4,fontFamily:'inherit'}}
                />
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <label style={{fontSize:11,color:'#5A6070',width:48,flexShrink:0}}>메모</label>
                <input value={editMemo} onChange={e => setEditMemo(e.target.value)} placeholder="(선택사항)"
                  style={{flex:1,padding:'5px 8px',fontSize:12,border:'0.5px solid #DDE1EB',borderRadius:4,fontFamily:'inherit'}}
                />
              </div>
            </div>

            <div style={{flexShrink:0,padding:'8px 16px',borderBottom:'0.5px solid #DDE1EB',background:'#FAFBFC',position:'relative'}}>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{fontSize:11,color:'#5A6070',flexShrink:0}}>부속 추가</span>
                <input value={partSearch} onChange={e => { setPartSearch(e.target.value); setShowPartDropdown(true); }}
                  onFocus={() => setShowPartDropdown(true)}
                  placeholder="부품코드/품명 검색..."
                  style={{flex:1,padding:'5px 8px',fontSize:12,border:'0.5px solid #DDE1EB',borderRadius:4,fontFamily:'inherit'}}
                />
              </div>
              {showPartDropdown && (
                <>
                  <div onMouseDown={() => setShowPartDropdown(false)} style={{position:'fixed',inset:0,zIndex:9098}} />
                  <div style={{position:'absolute',top:'100%',left:16,right:16,background:'#fff',border:'0.5px solid #DDE1EB',borderRadius:4,boxShadow:'0 4px 12px rgba(0,0,0,0.12)',maxHeight:280,overflow:'auto',zIndex:9099}}>
                    {filteredParts.length === 0 ? (
                      <div style={{padding:16,textAlign:'center',fontSize:11,color:'#9BA3B2'}}>검색 결과 없음</div>
                    ) : filteredParts.slice(0, 50).map(p => (
                      <div key={p.id} onMouseDown={(e) => { e.preventDefault(); addItem(p); }}
                        style={{padding:'7px 12px',fontSize:11,cursor:'pointer',borderBottom:'0.5px solid #F0F2F7',display:'flex',gap:8,alignItems:'center'}}
                        onMouseEnter={e => e.currentTarget.style.background = '#F4F6FA'}
                        onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                      >
                        <span style={{color:'#9BA3B2',fontFamily:'var(--font-mono, "SF Mono", Menlo, Consolas, monospace)',width:60,flexShrink:0}}>{p.code || '—'}</span>
                        <span style={{flex:1,fontWeight:500}}>{p.name || '(이름 없음)'}</span>
                        <span style={{color:'#5A6070',fontSize:10}}>{p.spec || ''}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div style={{flex:1,overflow:'auto'}}>
              {editItems.length === 0 ? (
                <div style={{padding:32,textAlign:'center',fontSize:11,color:'#9BA3B2'}}>위 검색창에서 부속을 추가하세요</div>
              ) : (
                <table ref={itemTableRef} className="as-table" style={{width: TEMPLATE_COL_KEYS.reduce((s, k) => s + getW(k), 0), tableLayout:'fixed'}}>
                  <colgroup>
                    {TEMPLATE_COL_KEYS.map(k => <col key={k} style={{width: getW(k)}} />)}
                  </colgroup>
                  <thead>
                    <tr className="as-col-header">
                      {[
                        { key:'image_url', label:'사진', align:'center' },
                        { key:'name_spec', label:'부품스펙', align:'left' },
                        { key:'big_category', label:'대분류', align:'center' },
                        { key:'category', label:'모델명(한국)', align:'center' },
                        { key:'chinese_model', label:'모델명(中)', align:'center' },
                        { key:'chinese_name', label:'부속이름(中)', align:'center' },
                        { key:'quantity', label:'수량', align:'center' },
                        { key:'action', label:'', align:'center' },
                      ].map((c, idx) => (
                        <th key={c.key} style={{textAlign:c.align,position:'relative'}}>
                          {c.label}
                          {idx < 7 && <span className="col-resize-handle" onMouseDown={e => startResize(idx, c.key, e)} />}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {editItems.map((it, idx) => {
                      const p = partsById[it.part_id];
                      if (!p) return (
                        <tr key={idx}>
                          <td colSpan={8} style={{padding:'6px 8px',fontSize:11,color:'#CC2222'}}>⚠️ 부품 정보 없음 (id: {it.part_id})</td>
                        </tr>
                      );
                      const bigCatTokens = (p.big_category || '').split('|').map(s => s.trim()).filter(Boolean);
                      const catTokens = (p.category || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean);
                      const cnModelSource = p.chinese_model || p.category;
                      const cnModelTokens = (cnModelSource || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean);
                      const cnName = p.chinese_name || p.name;
                      return (
                        <tr key={idx} style={idx % 2 === 1 ? {background:'#FAFBFC'} : undefined}>
                          <td style={{textAlign:'center',padding:'6px 4px'}}>
                            <PartThumbnail url={p.image_url} name={p.name} code={p.code} />
                          </td>
                          <td style={{padding:'6px 8px',fontSize:12,overflow:'hidden'}}>
                            <div style={{fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.name || '—'}</div>
                            {p.spec && <div style={{fontSize:10,color:'#9BA3B2',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.spec}</div>}
                          </td>
                          <td style={{textAlign:'center',padding:'6px 4px'}}>
                            {bigCatTokens.length === 0 ? <span className="empty-dot">●</span> : (
                              <div style={{display:'flex',flexWrap:'wrap',gap:2,justifyContent:'center'}}>
                                {bigCatTokens.map((t, i) => (
                                  <span key={i} style={{display:'inline-block',padding:'2px 6px',background:'#EDEBFE',color:'#5046B0',borderRadius:999,fontSize:10,fontWeight:500,whiteSpace:'nowrap'}}>{t}</span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td style={{textAlign:'center',padding:'6px 4px'}}>
                            {catTokens.length === 0 ? <span className="empty-dot">●</span> : (
                              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:2,padding:'0 2px'}}>
                                {catTokens.map((t, i) => (
                                  <span key={i} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'2px 6px',borderRadius:4,fontSize:10,fontWeight:500,background:'#E8EFF7',color:'#185FA5',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{t}</span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td style={{textAlign:'center',padding:'6px 4px'}}>
                            {cnModelTokens.length === 0 ? <span className="empty-dot">●</span> : (
                              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:2,padding:'0 2px'}}>
                                {cnModelTokens.map((t, i) => (
                                  <span key={i} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'2px 6px',borderRadius:4,fontSize:10,fontWeight:500,background:'#E0F4F0',color:'#0E7A5F',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{t}</span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td style={{textAlign:'center',padding:'6px 4px',fontSize:11,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                            {cnName ? cnName : <span className="empty-dot">●</span>}
                          </td>
                          <td style={{textAlign:'center',padding:'6px 4px'}}>
                            <div style={{display:'inline-flex',alignItems:'center',gap:4,justifyContent:'center'}}>
                              <button onClick={() => updateItemQty(idx, it.quantity - 1)} style={{width:22,height:22,fontSize:13,border:'0.5px solid #DDE1EB',background:'#fff',color:'#5A6070',borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>−</button>
                              <input type="number" min="1" value={it.quantity} onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) updateItemQty(idx, v); else if (e.target.value === '') updateItemQty(idx, 1); }} style={{width:34,height:22,padding:'0 4px',fontSize:12,border:'0.5px solid #DDE1EB',borderRadius:4,textAlign:'center',fontFamily:'inherit'}} />
                              <button onClick={() => updateItemQty(idx, it.quantity + 1)} style={{width:22,height:22,fontSize:13,border:'0.5px solid #DDE1EB',background:'#fff',color:'#5A6070',borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>+</button>
                            </div>
                          </td>
                          <td style={{padding:'6px 4px',textAlign:'center'}}>
                            <button onClick={() => removeItem(idx)} title="제거" style={{width:22,height:22,fontSize:12,border:'0.5px solid #DDE1EB',background:'#fff',color:'#9BA3B2',borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{flexShrink:0,padding:'10px 16px',borderTop:'0.5px solid #DDE1EB',background:'#FAFBFC',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
              <span style={{fontSize:11,color:'#5A6070'}}>합계 {editItems.length}종 · {editItems.reduce((s, it) => s + (it.quantity || 0), 0)}개</span>
              <div style={{display:'flex',gap:6}}>
                <button onClick={handleSave} disabled={!isDirty}
                  style={{padding:'6px 14px',fontSize:11,background: isDirty ? '#185FA5' : '#DDE1EB',color: isDirty ? '#fff' : '#9BA3B2',border:'none',borderRadius:4,cursor: isDirty ? 'pointer' : 'not-allowed',fontFamily:'inherit',fontWeight:500}}>
                  {isNewMode ? '+ 새 템플릿 저장' : '변경 저장'}
                </button>
                <button onClick={handleApply} disabled={isNewMode || editItems.length === 0}
                  style={{padding:'6px 14px',fontSize:11,background: (!isNewMode && editItems.length > 0) ? '#0E7A5F' : '#DDE1EB',color: (!isNewMode && editItems.length > 0) ? '#fff' : '#9BA3B2',border:'none',borderRadius:4,cursor: (!isNewMode && editItems.length > 0) ? 'pointer' : 'not-allowed',fontFamily:'inherit',fontWeight:500}}>
                  → 장바구니 추가
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function CategoryDropdown({ categories, selectedTokens, position, onToggle, onClear, onAddNew, onCancel }) {
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const popupRef = useRef(null);
  const [adjTop, setAdjTop] = useState(position.top);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  useEffect(() => {
    setAdjTop(position.top);
    if (!popupRef.current) return;
    requestAnimationFrame(() => {
      if (!popupRef.current) return;
      const rect = popupRef.current.getBoundingClientRect();
      const margin = 8;
      const overflow = rect.bottom - (window.innerHeight - margin);
      if (overflow > 0) {
        setAdjTop(Math.max(margin, position.top - overflow));
      }
    });
  }, [position.top, position.left]);

  const confirmAddNew = () => {
    const trimmed = newName.trim();
    if (!trimmed) { setAddingNew(false); setNewName(''); return; }
    onAddNew(trimmed);
    setAddingNew(false); setNewName('');
  };

  const tokenSet = selectedTokens instanceof Set ? selectedTokens : new Set(selectedTokens || []);
  const selectedCount = tokenSet.size;

  return (
    <div ref={popupRef} style={{position:'fixed',top:adjTop,left:position.left,zIndex:9999,background:'#fff',border:'0.5px solid #DDE1EB',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.12)',minWidth:Math.max(180,position.width),maxHeight:'min(420px, calc(100vh - 16px))',overflow:'auto'}}
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{padding:'8px 12px',background:'#FAFBFC',borderBottom:'0.5px solid #DDE1EB',fontSize:11,color:'#5A6070',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,zIndex:1}}>
        <span>대분류 선택{selectedCount > 0 ? ` · ${selectedCount}/3` : ''}</span>
        <span style={{color:'#9BA3B2'}}>ESC 닫기</span>
      </div>
      <div onClick={onClear} style={{padding:'8px 14px',fontSize:11,cursor:'pointer',color:'#9BA3B2',borderBottom:'0.5px solid #DDE1EB',background:'#FAFBFC'}}
        onMouseEnter={e => e.currentTarget.style.background = '#F4F6FA'}
        onMouseLeave={e => e.currentTarget.style.background = '#FAFBFC'}
      >전체 해제 (미분류로)</div>
      {categories.map(c => {
        const selected = tokenSet.has(c.name);
        return (
          <div key={c.id} onClick={() => onToggle(c.name)}
            style={{padding:'9px 14px',fontSize:12,cursor:'pointer',borderBottom:'0.5px solid #F0F2F7',display:'flex',alignItems:'center',gap:8,background: selected ? '#EDEBFE' : '#fff',color: selected ? '#5046B0' : '#1A1D23',fontWeight: selected ? 500 : 400}}
            onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#F4F6FA'; }}
            onMouseLeave={e => { if (!selected) e.currentTarget.style.background = '#fff'; }}
          >
            <span style={{width:14,height:14,borderRadius:3,flexShrink:0,display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:11,background: selected ? '#5046B0' : 'transparent',color:'#fff',border: selected ? 'none' : '1px solid #DDE1EB'}}>
              {selected ? '✓' : ''}
            </span>
            {c.name}
          </div>
        );
      })}
      {!addingNew ? (
        <div onClick={() => setAddingNew(true)} style={{padding:'9px 14px',fontSize:12,cursor:'pointer',background:'#FAFBFC',color:'#185FA5',fontWeight:500,borderTop:'0.5px solid #DDE1EB'}}>+ 새 대분류 추가</div>
      ) : (
        <div style={{padding:'8px 10px',background:'#FAFBFC',display:'flex',gap:4,borderTop:'0.5px solid #DDE1EB'}}>
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmAddNew(); else if (e.key === 'Escape') { setAddingNew(false); setNewName(''); } }}
            placeholder="새 대분류 이름"
            style={{flex:1,padding:'4px 8px',fontSize:12,border:'0.5px solid #DDE1EB',borderRadius:4,fontFamily:'inherit'}}
          />
          <button onClick={confirmAddNew} style={{padding:'4px 10px',fontSize:12,background:'#185FA5',color:'#fff',border:'none',borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>추가</button>
        </div>
      )}
    </div>
  );
}


/* ═══ MODEL SELECT DROPDOWN — 모델명(한국) 멀티 선택 ═══ */
function ModelSelectDropdown({ part, products, position, onToggle, onClose }) {
  const popupRef = useRef(null);
  const [adjTop, setAdjTop] = useState(position.top);
  const tokens = new Set((part.category || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean));

  const sorted = [...(products || [])].sort((a, b) => {
    const brandA = a.brand || '';
    const brandB = b.brand || '';
    if (brandA !== brandB) {
      if (brandA === '콜라보') return -1;
      if (brandB === '콜라보') return 1;
      return brandA.localeCompare(brandB);
    }
    return (a.model || '').localeCompare(b.model || '');
  });

  const groupedByBrand = {};
  sorted.forEach(p => {
    if (!p.model) return;
    const b = p.brand || '(브랜드 없음)';
    if (!groupedByBrand[b]) groupedByBrand[b] = [];
    groupedByBrand[b].push(p.model);
  });

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    setAdjTop(position.top);
    if (!popupRef.current) return;
    requestAnimationFrame(() => {
      if (!popupRef.current) return;
      const rect = popupRef.current.getBoundingClientRect();
      const margin = 8;
      const overflow = rect.bottom - (window.innerHeight - margin);
      if (overflow > 0) {
        setAdjTop(Math.max(margin, position.top - overflow));
      }
    });
  }, [position.top, position.left]);

  const selectedCount = tokens.size;
  const hasNoModels = Object.keys(groupedByBrand).length === 0;

  return (
    <div ref={popupRef} className="model-select-dropdown"
      onMouseDown={e => e.stopPropagation()}
      style={{position:'fixed',top:adjTop,left:position.left,zIndex:9999,background:'#fff',border:'0.5px solid #DDE1EB',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.12)',width:Math.max(360,position.width),maxHeight:'min(420px, calc(100vh - 16px))',overflow:'auto'}}
    >
      <div style={{padding:'8px 12px',background:'#FAFBFC',borderBottom:'0.5px solid #DDE1EB',fontSize:11,color:'#5A6070',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,zIndex:1}}>
        <span>모델 선택{selectedCount > 0 ? ` · ${selectedCount}개 선택됨` : ''}</span>
        <span style={{color:'#9BA3B2',fontFamily:'var(--font-mono, "SF Mono", Menlo, Consolas, monospace)'}}>ESC 닫기</span>
      </div>
      {hasNoModels ? (
        <div style={{padding:24,textAlign:'center',fontSize:12,color:'#9BA3B2'}}>
          제품가격에 등록된 모델이 없습니다.<br/>
          제품가격 탭에서 먼저 모델을 등록해주세요.
        </div>
      ) : Object.entries(groupedByBrand).map(([brand, models]) => (
        <div key={brand}>
          <div style={{padding:'8px 12px 4px',fontSize:11,color:'#9BA3B2',fontWeight:500}}>{brand}</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,padding:'0 8px 8px'}}>
            {models.map(m => {
              const selected = tokens.has(m);
              return (
                <div key={m}
                  onClick={() => onToggle(m)}
                  style={{padding:'6px 10px',borderRadius:4,fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',gap:6,background: selected ? '#E8EFF7' : 'transparent',color: selected ? '#185FA5' : '#1A1D23',fontWeight: selected ? 500 : 400}}
                  onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#F4F6FA'; }}
                  onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{width:12,height:12,borderRadius:2,flexShrink:0,display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:10,background: selected ? '#185FA5' : 'transparent',color:'#fff',border: selected ? 'none' : '1px solid #DDE1EB'}}>
                    {selected ? '✓' : ''}
                  </span>
                  {m}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}


/* ═══ PARTS TABLE ═══ */
function PartsTable({ parts, setParts, categories, setCategories, products, onPhotoClick, onEdit, onCopy }) {
  const [editCell, setEditCell] = useState(null); // { id, field }
  const [editValue, setEditValue] = useState('');
  const [editNameSpec, setEditNameSpec] = useState({ name: '', spec: '' }); // name_spec 통합 편집
  const [bigCatDropdown, setBigCatDropdown] = useState(null); // { id, top, left, width } | null
  const [modelDropdown, setModelDropdown] = useState(null); // { partId, top, left, width } | null
  const tableRef = useRef(null);
  const savedWidthsRef = useRef((() => {
    if (typeof window === 'undefined') return {};
    try { const v = JSON.parse(localStorage.getItem('parts_column_widths')); return (v && typeof v === 'object') ? v : {}; } catch { return {}; }
  })());
  const COLS = [
    { key:'no', label:'No', w:50 },
    { key:'code', label:'내부코드', w:90 },
    { key:'image_url', label:'사진', w:88 },
    { key:'name', label:'부품', w:260 },
    { key:'big_category', label:'대분류', w:100 },
    { key:'category', label:'모델명(한국)', w:120 },
    { key:'chinese_model', label:'모델명(中)', w:94 },
    { key:'chinese_name', label:'부속이름(中)', w:100 },
    { key:'quantity', label:'수량', w:54 },
    { key:'price', label:'공임비', w:100 },
    { key:'_edit', label:'관리', w:60 },
  ];
  const DEFAULT_W = { no:50, code:90, image_url:88, name:260, big_category:100, category:120, chinese_model:94, chinese_name:100, quantity:54, price:100, _edit:60 };

  const startEdit = (id, field, value) => {
    setEditCell({ id, field });
    setEditValue(value == null ? '' : String(value));
  };

  const commitEdit = async (overrideValue) => {
    if (!editCell) return;
    const { id, field } = editCell;
    if (field === 'name_spec') return; // 가상 필드는 commitNameSpec에서만 처리
    const sourceVal = overrideValue !== undefined ? overrideValue : editValue;
    let saveVal;
    if (field === 'quantity' || field === 'price') {
      const trimmed = String(sourceVal).trim();
      saveVal = trimmed === '' ? null : Math.max(0, parseInt(trimmed) || 0);
    } else if (field === 'big_category') {
      saveVal = sourceVal == null || sourceVal === '' ? null : sourceVal;
    } else {
      saveVal = String(sourceVal).trim() === '' ? null : sourceVal;
    }
    setEditCell(null);
    setBigCatDropdown(null);
    setParts(prev => prev.map(p => p.id === id ? { ...p, [field]: saveVal } : p));
    const { error } = await supabase.from('parts').update({ [field]: saveVal }).eq('id', id);
    if (error) { alert('저장 실패: ' + error.message); }
  };

  const cancelEdit = () => { setEditCell(null); setEditValue(''); setEditNameSpec({ name:'', spec:'' }); setBigCatDropdown(null); };

  const startEditNameSpec = (id, name, spec) => {
    setEditCell({ id, field: 'name_spec' });
    setEditNameSpec({ name: name || '', spec: spec || '' });
  };

  const commitNameSpec = async () => {
    if (!editCell || editCell.field !== 'name_spec') return;
    const { id } = editCell;
    const nameVal = editNameSpec.name.trim() || null;
    const specVal = editNameSpec.spec.trim() || null;
    const currentPart = parts.find(p => p.id === id);
    const currentChineseName = currentPart?.chinese_name;
    const shouldSyncCN = !currentChineseName || String(currentChineseName).trim() === '';
    const updatePayload = shouldSyncCN
      ? { name: nameVal, spec: specVal, chinese_name: nameVal }
      : { name: nameVal, spec: specVal };
    setEditCell(null);
    setEditNameSpec({ name:'', spec:'' });
    setParts(prev => prev.map(p => p.id === id ? { ...p, ...updatePayload } : p));
    const { error } = await supabase.from('parts').update(updatePayload).eq('id', id);
    if (error) alert('저장 실패: ' + error.message);
  };

  const openBigCatDropdown = (p, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const popH = 380;
    const margin = 8;
    const proposedTop = rect.bottom + 4;
    const flipUp = proposedTop + popH > window.innerHeight - margin;
    const top = flipUp ? Math.max(margin, rect.top - popH - 4) : proposedTop;
    setEditCell({ id: p.id, field: 'big_category' });
    setEditValue(p.big_category || '');
    setBigCatDropdown({ id: p.id, top, left: rect.left, width: Math.max(180, rect.width) });
  };

  const toggleBigCatToken = async (partId, name) => {
    const part = parts.find(p => p.id === partId);
    if (!part) return;
    const tokens = (part.big_category || '').split('|').map(s => s.trim()).filter(Boolean);
    const idx = tokens.indexOf(name);
    if (idx >= 0) {
      tokens.splice(idx, 1);
    } else {
      if (tokens.length >= 3) { alert('대분류는 최대 3개까지 선택할 수 있습니다'); return; }
      tokens.push(name);
    }
    const newBigCat = tokens.length > 0 ? tokens.join('|') : null;
    setParts(prev => prev.map(p => p.id === partId ? { ...p, big_category: newBigCat } : p));
    const { error } = await supabase.from('parts').update({ big_category: newBigCat }).eq('id', partId);
    if (error) alert('저장 실패: ' + error.message);
  };

  const removeBigCatToken = async (partId, name) => {
    const part = parts.find(p => p.id === partId);
    if (!part) return;
    const tokens = (part.big_category || '').split('|').map(s => s.trim()).filter(Boolean).filter(t => t !== name);
    const newBigCat = tokens.length > 0 ? tokens.join('|') : null;
    setParts(prev => prev.map(p => p.id === partId ? { ...p, big_category: newBigCat } : p));
    const { error } = await supabase.from('parts').update({ big_category: newBigCat }).eq('id', partId);
    if (error) alert('저장 실패: ' + error.message);
  };

  const clearBigCatTokens = async (partId) => {
    setParts(prev => prev.map(p => p.id === partId ? { ...p, big_category: null } : p));
    setBigCatDropdown(null);
    setEditCell(null);
    const { error } = await supabase.from('parts').update({ big_category: null }).eq('id', partId);
    if (error) alert('저장 실패: ' + error.message);
  };

  const addCategoryAndAddToken = async (newName) => {
    if (!bigCatDropdown) return;
    const partId = bigCatDropdown.id;
    if (categories.some(c => c.name === newName)) { alert('이미 존재하는 대분류입니다'); return; }
    const part = parts.find(p => p.id === partId);
    const currentTokens = (part?.big_category || '').split('|').map(s => s.trim()).filter(Boolean);
    if (currentTokens.length >= 3) { alert('대분류는 최대 3개까지 선택할 수 있습니다'); return; }
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order || 0), 8);
    const { data, error } = await supabase.from('part_categories').insert({ name: newName, sort_order: maxOrder + 1 }).select().single();
    if (error) { alert('대분류 추가 실패: ' + error.message); return; }
    setCategories(prev => [...prev, data].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
    const newTokens = [...currentTokens, newName];
    const newBigCat = newTokens.join('|');
    setParts(prev => prev.map(p => p.id === partId ? { ...p, big_category: newBigCat } : p));
    const { error: upErr } = await supabase.from('parts').update({ big_category: newBigCat }).eq('id', partId);
    if (upErr) alert('부품 저장 실패: ' + upErr.message);
  };

  const openModelDropdown = (p, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const popH = 420;
    const margin = 8;
    const proposedTop = rect.bottom + 4;
    const flipUp = proposedTop + popH > window.innerHeight - margin;
    const top = flipUp ? Math.max(margin, rect.top - popH - 4) : proposedTop;
    setModelDropdown({ partId: p.id, top, left: rect.left, width: Math.max(360, rect.width) });
  };

  const toggleModelToken = async (partId, model) => {
    const part = parts.find(p => p.id === partId);
    if (!part) return;
    const tokens = (part.category || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean);
    const idx = tokens.indexOf(model);
    if (idx >= 0) tokens.splice(idx, 1);
    else tokens.push(model);
    const newCategory = tokens.length > 0 ? tokens.join(',') : null;
    setParts(prev => prev.map(p => p.id === partId ? { ...p, category: newCategory, chinese_model: newCategory } : p));
    const { error } = await supabase.from('parts').update({ category: newCategory, chinese_model: newCategory }).eq('id', partId);
    if (error) alert('저장 실패: ' + error.message);
  };

  const removeModelToken = async (partId, token) => {
    const part = parts.find(p => p.id === partId);
    if (!part) return;
    const tokens = (part.category || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean).filter(t => t !== token);
    const newCategory = tokens.length > 0 ? tokens.join(',') : null;
    setParts(prev => prev.map(p => p.id === partId ? { ...p, category: newCategory, chinese_model: newCategory } : p));
    const { error } = await supabase.from('parts').update({ category: newCategory, chinese_model: newCategory }).eq('id', partId);
    if (error) alert('저장 실패: ' + error.message);
  };

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
    <>
    <table className="as-table" ref={tableRef} style={{width: COLS.reduce((s,c) => s + getW(c.key), 0)}}>
      <colgroup>{COLS.map(c => <col key={c.key} style={{width: getW(c.key)}} />)}</colgroup>
      <thead><tr className="as-col-header">
        {COLS.map((c, idx) => (
          <th key={c.key} style={{position:'sticky',top:0,zIndex:10,background:'#EAECF2',color:'#5A6070',fontSize:13,fontWeight:500,padding:'8px 10px',height:36,lineHeight:'20px',boxShadow:'0 1px 0 0 #DDE1EB',userSelect:'none'}}>
            {c.label}
            <span className="col-resize-handle" onMouseDown={e => startResize(idx, c.key, e)} />
          </th>
        ))}
      </tr></thead>
      <tbody>
        {parts.map((p, i) => (
          <tr key={p.id} className="as-data-row" style={i % 2 === 1 ? {background:'#FAFBFC'} : undefined}>
            <td style={{textAlign:'center',fontSize:12,color:'#9BA3B2',fontVariantNumeric:'tabular-nums'}}>{i + 1}</td>
            <td style={{textAlign:'center'}}><span style={{fontSize:13,color:'#5A6070'}}>{p.code || <span className="empty-dot">●</span>}</span></td>
            <td style={{textAlign:'center',padding:'8px 4px'}}>
              <PartThumbnail url={p.image_url} name={p.name} code={p.code} onClick={() => onPhotoClick && onPhotoClick({ url: p.image_url || null, name: p.name, code: p.code, partId: p.id })} />
            </td>
            <td style={{textAlign:'left',padding:'10px 8px',cursor: editCell?.id === p.id && editCell?.field === 'name_spec' ? 'text' : 'pointer'}}
                onClick={() => { if (!(editCell?.id === p.id && editCell?.field === 'name_spec')) startEditNameSpec(p.id, p.name, p.spec); }}>
              {editCell?.id === p.id && editCell?.field === 'name_spec' ? (
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  <input autoFocus value={editNameSpec.name}
                    onChange={e => setEditNameSpec(v => ({...v, name: e.target.value}))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitNameSpec(); } else if (e.key === 'Escape') cancelEdit(); }}
                    placeholder="부품명"
                    style={{width:'100%',fontSize:13,padding:'4px 6px',fontFamily:'inherit',border:'0.5px solid #DDE1EB',borderRadius:4}} />
                  <input value={editNameSpec.spec}
                    onChange={e => setEditNameSpec(v => ({...v, spec: e.target.value}))}
                    onBlur={commitNameSpec}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitNameSpec(); } else if (e.key === 'Escape') cancelEdit(); }}
                    placeholder="규격/스펙"
                    style={{width:'100%',fontSize:12,padding:'4px 6px',fontFamily:'inherit',border:'0.5px solid #DDE1EB',borderRadius:4,color:'#5A6070'}} />
                </div>
              ) : (
                <div style={{minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:'#1A1D23',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.name || <span className="empty-dot">●</span>}</div>
                  <div style={{fontSize:12,color:'#5A6070',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.spec || <span className="empty-dot">●</span>}</div>
                </div>
              )}
            </td>
            <td style={{textAlign:'center',padding:'8px 6px',cursor:'pointer'}} onClick={(e) => openBigCatDropdown(p, e)}>
              {(() => {
                const tokens = (p.big_category || '').split('|').map(s => s.trim()).filter(Boolean);
                if (tokens.length === 0) {
                  return <span style={{display:'inline-block',padding:'3px 9px',background:'#FAFBFC',color:'#9BA3B2',borderRadius:999,fontSize:11,border:'0.5px dashed #DDE1EB',whiteSpace:'nowrap',cursor:'pointer'}}>미분류</span>;
                }
                return (
                  <div style={{display:'flex',flexWrap:'wrap',gap:3,justifyContent:'center',alignItems:'center'}}>
                    {tokens.map((t, i) => (
                      <span key={i} style={{display:'inline-flex',alignItems:'center',gap:2,padding:'3px 4px 3px 9px',borderRadius:999,fontSize:11,fontWeight:600,background:'#EDEBFE',color:'#5046B0',whiteSpace:'nowrap'}}>
                        {t}
                        <span onClick={(e) => { e.stopPropagation(); removeBigCatToken(p.id, t); }}
                          title="제거"
                          style={{width:14,height:14,borderRadius:2,display:'inline-flex',alignItems:'center',justifyContent:'center',color:'#9BA3B2',fontSize:11,cursor:'pointer',lineHeight:1,flexShrink:0}}
                          onMouseEnter={e => { e.currentTarget.style.background = '#FCEBEB'; e.currentTarget.style.color = '#CC2222'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9BA3B2'; }}
                        >×</span>
                      </span>
                    ))}
                  </div>
                );
              })()}
            </td>
            <td style={{textAlign:'center',cursor:'pointer',padding:'8px 6px'}}
                onClick={(e) => openModelDropdown(p, e)}>
              {(() => {
                const tokens = (p.category || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean);
                if (tokens.length === 0) return <span className="empty-dot">●</span>;
                return (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:3,padding:'0 4px'}}>
                    {tokens.map((t, i) => (
                      <span key={i} style={{display:'inline-flex',alignItems:'center',justifyContent:'space-between',gap:2,padding:'3px 4px 3px 8px',borderRadius:4,fontSize:11,fontWeight:500,background:'#E8EFF7',color:'#185FA5'}}>
                        <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{t}</span>
                        <span onClick={(e) => { e.stopPropagation(); removeModelToken(p.id, t); }}
                          title="제거"
                          style={{width:14,height:14,borderRadius:2,display:'inline-flex',alignItems:'center',justifyContent:'center',color:'#9BA3B2',fontSize:11,cursor:'pointer',lineHeight:1,flexShrink:0}}
                          onMouseEnter={e => { e.currentTarget.style.background = '#FCEBEB'; e.currentTarget.style.color = '#CC2222'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9BA3B2'; }}
                        >×</span>
                      </span>
                    ))}
                  </div>
                );
              })()}
            </td>
            <td style={{textAlign:'center',cursor:'pointer',fontSize:13,color:'#1A1D23',padding:'8px 6px'}} onClick={() => { if (editCell?.id === p.id && editCell?.field === 'chinese_model') return; startEdit(p.id, 'chinese_model', p.chinese_model || p.category); }}>
              {editCell?.id === p.id && editCell?.field === 'chinese_model'
                ? <input autoFocus className="input" value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={() => commitEdit()} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') cancelEdit(); }} style={{width:'100%',fontSize:13,padding:'4px 6px',textAlign:'center'}} />
                : (() => {
                    const source = p.chinese_model || p.category;
                    const tokens = (source || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean);
                    if (tokens.length === 0) return <span className="empty-dot">●</span>;
                    return (
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:3,padding:'0 4px'}}>
                        {tokens.map((t, i) => (
                          <span key={i} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'3px 8px',borderRadius:4,fontSize:11,fontWeight:500,background:'#E0F4F0',color:'#0E7A5F',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{t}</span>
                        ))}
                      </div>
                    );
                  })()}
            </td>
            <td style={{textAlign:'center',cursor:'pointer',fontSize:13,color:'#1A1D23'}} onClick={() => { if (editCell?.id === p.id && editCell?.field === 'chinese_name') return; startEdit(p.id, 'chinese_name', p.chinese_name || p.name); }}>
              {editCell?.id === p.id && editCell?.field === 'chinese_name'
                ? <input autoFocus className="input" value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={() => commitEdit()} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') cancelEdit(); }} style={{width:'100%',fontSize:13,padding:'4px 6px',textAlign:'center'}} />
                : (() => {
                    const display = p.chinese_name || p.name;
                    if (!display) return <span className="empty-dot">●</span>;
                    return <span>{display}</span>;
                  })()}
            </td>
            <td style={{textAlign:'center',cursor:'pointer',fontSize:13,color:'#1A1D23'}} onClick={() => editCell?.id === p.id && editCell?.field === 'quantity' ? null : startEdit(p.id, 'quantity', p.quantity)}>
              {editCell?.id === p.id && editCell?.field === 'quantity'
                ? <input autoFocus type="number" min="0" className="input" value={editValue} onChange={e => setEditValue(e.target.value.replace(/[^0-9]/g,''))} onBlur={() => commitEdit()} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') cancelEdit(); }} style={{width:'100%',fontSize:13,padding:'4px 6px',textAlign:'center'}} />
                : (p.quantity == null ? <span className="empty-dot">●</span> : p.quantity)}
            </td>
            <td style={{textAlign:'center',cursor:'pointer',color:'#185FA5',fontWeight:700,fontSize:13,padding:'8px 10px',fontVariantNumeric:'tabular-nums'}} onClick={() => editCell?.id === p.id && editCell?.field === 'price' ? null : startEdit(p.id, 'price', p.price)}>
              {editCell?.id === p.id && editCell?.field === 'price'
                ? <input autoFocus type="number" min="0" className="input" value={editValue} onChange={e => setEditValue(e.target.value.replace(/[^0-9]/g,''))} onBlur={() => commitEdit()} onKeyDown={e => { if (e.key === 'Enter') commitEdit(); else if (e.key === 'Escape') cancelEdit(); }} style={{width:'100%',fontSize:13,padding:'4px 6px',textAlign:'center',color:'#185FA5',fontWeight:700}} />
                : (p.price == null ? <span className="empty-dot">●</span> : p.price.toLocaleString('ko-KR'))}
            </td>
            <td style={{textAlign:'center'}}>
              <span style={{display:'inline-flex',gap:8,alignItems:'center'}}>
                <button className="btn-text-edit" style={{fontSize:12,fontWeight:500}} onClick={() => onEdit(p)}>수정</button>
                <button style={{fontSize:12,fontWeight:500,color:'#5F5E5A',background:'none',border:'none',cursor:'pointer',padding:'4px 6px',fontFamily:'inherit'}} onClick={() => onCopy && onCopy(p)}>복사</button>
              </span>
            </td>
          </tr>
        ))}
        {parts.length === 0 && <tr><td colSpan={11} className="empty">부품이 없습니다</td></tr>}
      </tbody>
    </table>
    {bigCatDropdown && (() => {
      const dropPart = parts.find(p => p.id === bigCatDropdown.id);
      const currentTokens = new Set(((dropPart?.big_category || '').split('|').map(s => s.trim()).filter(Boolean)));
      return (
        <>
          <div onMouseDown={() => { setBigCatDropdown(null); setEditCell(null); }}
            style={{position:'fixed',inset:0,zIndex:9998,background:'transparent'}} />
          <CategoryDropdown
            categories={categories}
            selectedTokens={currentTokens}
            position={bigCatDropdown}
            onToggle={(name) => toggleBigCatToken(bigCatDropdown.id, name)}
            onClear={() => clearBigCatTokens(bigCatDropdown.id)}
            onAddNew={addCategoryAndAddToken}
            onCancel={() => { setBigCatDropdown(null); setEditCell(null); }}
          />
        </>
      );
    })()}
    {modelDropdown && (() => {
      const dropPart = parts.find(p => p.id === modelDropdown.partId);
      if (!dropPart) return null;
      return (
        <>
          <div onMouseDown={() => setModelDropdown(null)}
            style={{position:'fixed',inset:0,zIndex:9998,background:'transparent'}} />
          <ModelSelectDropdown
            part={dropPart}
            products={products}
            position={modelDropdown}
            onToggle={(model) => toggleModelToken(modelDropdown.partId, model)}
            onClose={() => setModelDropdown(null)}
          />
        </>
      );
    })()}
    </>
  );
}


/* ═══ PRODUCTS TABLE — 제품가격 인라인 편집 ═══ */
function ProductsTable({ products, onReload, setProducts }) {
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [badgeOpen, setBadgeOpen] = useState(null);
  const [showNewRow, setShowNewRow] = useState(false);
  const tableRef = useRef(null);
  const savedWidthsRef = useRef((() => {
    if (typeof window === 'undefined') return {};
    try { const v = JSON.parse(localStorage.getItem('products_column_widths')); return (v && typeof v === 'object') ? v : {}; } catch { return {}; }
  })());

  const COLS = [
    { key: 'brand', label: '브랜드', w: 100 },
    { key: 'model', label: '모델넘버', w: 180 },
    { key: 'price', label: '제품가격', w: 120 },
    { key: 'memo', label: '비고', w: 140 },
    { key: '_manage', label: '관리', w: 110 },
  ];
  const DEFAULT_W = { brand: 100, model: 180, price: 120, memo: 140, _manage: 110 };
  const getW = (k) => savedWidthsRef.current[k] || DEFAULT_W[k] || 80;

  const BRAND_COLORS = {
    '콜라보': ['#EEEDFE', '#3C3489'], '마끼다': ['#FAEEDA', '#412402'],
    '디월트': ['#E1F5EE', '#085041'], '프레레': ['#E6F1FB', '#0C447C'],
    '기타': ['#F4F6FA', '#5A6070'],
  };
  const BRAND_OPTS = ['콜라보', '마끼다', '디월트', '프레레', '기타'];

  // 뱃지 바깥 클릭 닫기
  useEffect(() => {
    if (!badgeOpen) return;
    const h = (e) => { if (!e.target.closest('.badge-expand-panel')) setBadgeOpen(null); };
    const esc = (e) => { if (e.key === 'Escape') setBadgeOpen(null); };
    const timer = setTimeout(() => { document.addEventListener('click', h); document.addEventListener('keydown', esc); }, 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', h); document.removeEventListener('keydown', esc); };
  }, [badgeOpen]);

  const saveBrand = async (id, brand) => {
    setBadgeOpen(null);
    setProducts(prev => prev.map(p => p.id === id ? { ...p, brand } : p));
    const { error } = await supabase.from('products').update({ brand, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { alert('저장 실패: ' + error.message); onReload(); }
  };

  const startEdit = (id, field, value) => {
    setEditCell({ id, field });
    setEditValue(value ?? '');
  };

  const commitEdit = async () => {
    if (!editCell) return;
    const { id, field } = editCell;
    let val = editValue;
    if (field === 'price') val = parseInt(String(val).replace(/,/g, '')) || 0;
    const saveVal = field === 'price' ? val : (val || null);
    setEditCell(null);
    setProducts(prev => prev.map(p => p.id === id ? { ...p, [field]: saveVal } : p));
    const { error } = await supabase.from('products').update({ [field]: saveVal, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { alert('저장 실패: ' + error.message); onReload(); }
  };

  const deleteProduct = async (p) => {
    if (!confirm(`이 제품을 삭제하시겠습니까?\n${p.brand || ''} ${p.model || ''}`)) return;
    setProducts(prev => prev.filter(x => x.id !== p.id));
    const { error } = await supabase.from('products').delete().eq('id', p.id);
    if (error) { alert('삭제 실패: ' + error.message); onReload(); }
  };

  // 드래그 앤 드롭
  const dragRef = useRef({ dragId: null, overId: null });
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  const handleDrop = async (dropIdx) => {
    const fromId = dragRef.current.dragId;
    if (!fromId) return;
    const sorted = [...products].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const fromIdx = sorted.findIndex(p => p.id === fromId);
    if (fromIdx === -1 || fromIdx === dropIdx) { setDragId(null); setOverId(null); return; }
    const item = sorted[fromIdx];
    const newArr = [...sorted]; newArr.splice(fromIdx, 1); newArr.splice(dropIdx, 0, item);
    // 로컬 state 즉시 갱신
    const updated = newArr.map((p, i) => ({ ...p, sort_order: i + 1 }));
    setProducts(updated);
    setDragId(null); setOverId(null);
    // Supabase 저장 — 변경된 것만
    const changes = updated.filter((p, i) => sorted.findIndex(s => s.id === p.id) !== i || p.sort_order !== sorted.find(s => s.id === p.id)?.sort_order);
    await Promise.all(changes.map(p => supabase.from('products').update({ sort_order: p.sort_order }).eq('id', p.id)));
  };

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
      localStorage.setItem('products_column_widths', JSON.stringify(savedWidthsRef.current));
    };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  };

  const empty = <span className="empty-dot">●</span>;

  const renderCell = (p, col, rowIdx) => {
    const val = p[col.key];
    const isEditing = editCell?.id === p.id && editCell?.field === col.key;

    if (col.key === 'brand') {
      const [bg, c] = BRAND_COLORS[val] || ['#F4F6FA', '#5A6070'];
      const isOpen = badgeOpen === p.id;
      return (
        <div style={{ position: 'relative' }} className="badge-expand-panel" onClick={e => e.stopPropagation()}>
          <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', background: val ? bg : '#F4F6FA', color: val ? c : '#9BA3B2', cursor: 'pointer', border: isOpen ? `2px solid ${c}` : '2px solid transparent' }}
            onClick={() => setBadgeOpen(isOpen ? null : p.id)}>
            {val || '선택'}
          </span>
          {isOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, background: '#fff', border: '1px solid #DDE1EB', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', padding: 4, marginTop: 2, minWidth: 80 }}>
              {BRAND_OPTS.map(o => {
                const [obg, oc] = BRAND_COLORS[o];
                return <div key={o} style={{ padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: obg, color: oc, marginBottom: 2, whiteSpace: 'nowrap', border: val === o ? `2px solid ${oc}` : '2px solid transparent' }}
                  onClick={() => saveBrand(p.id, o)}>{o}</div>;
              })}
            </div>
          )}
        </div>
      );
    }

    if (col.key === '_manage') {
      return (
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center', alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: '#E6F1FB', color: '#0C447C', cursor: 'pointer', whiteSpace: 'nowrap' }}
            onClick={e => { e.stopPropagation(); startEdit(p.id, 'model', p.model || ''); }}>수정</span>
          <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: '#FCEBEB', color: '#791F1F', cursor: 'pointer', whiteSpace: 'nowrap' }}
            onClick={e => { e.stopPropagation(); deleteProduct(p); }}>삭제</span>
        </div>
      );
    }

    if (isEditing) {
      return <input className="as-cell-input" value={editValue} autoFocus
        onChange={e => setEditValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(); } }} />;
    }

    if (col.key === 'price') return val ? <span style={{ color: '#185FA5', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{val.toLocaleString('ko-KR')}</span> : empty;
    return val || empty;
  };

  return (
    <table className="as-table" ref={tableRef} style={{ width: 24 + COLS.reduce((s, c) => s + getW(c.key), 0) }}>
      <colgroup>
        <col style={{ width: 24 }} />
        {COLS.map(c => <col key={c.key} style={{ width: getW(c.key) }} />)}
      </colgroup>
      <thead><tr className="as-col-header">
        <th style={{ width: 24, minWidth: 24, maxWidth: 24, padding: 0, position:'sticky', top:0, zIndex:10, background:'#EAECF2', boxShadow:'0 1px 0 0 #DDE1EB' }} />
        {COLS.map((c, idx) => (
          <th key={c.key} style={{position:'sticky',top:0,zIndex:10,background:'#EAECF2',color:'#5A6070',fontSize:13,fontWeight:500,padding:'8px 10px',height:36,lineHeight:'20px',boxShadow:'0 1px 0 0 #DDE1EB',userSelect:'none'}}>
            {c.label}
            <span className="col-resize-handle" onMouseDown={e => startResize(idx + 1, c.key, e)} />
          </th>
        ))}
      </tr></thead>
      <tbody>
        {products.map((p, i) => (
          <tr key={p.id} className="as-data-row"
            draggable={dragId === p.id}
            onDragOver={e => e.preventDefault()}
            onDragEnter={e => { e.preventDefault(); setOverId(p.id); }}
            onDragLeave={() => { if (overId === p.id) setOverId(null); }}
            onDrop={e => { e.preventDefault(); handleDrop(i); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            style={{
              ...(i % 2 === 1 && dragId !== p.id ? { background: '#FAFBFC' } : {}),
              ...(dragId === p.id ? { background: '#E6F1FB', outline: '2px solid #185FA5', opacity: 0.7 } : {}),
              ...(overId === p.id && dragId !== p.id ? { borderTop: '2px dashed #185FA5' } : {}),
            }}>
            <td style={{ width: 24, minWidth: 24, maxWidth: 24, padding: '4px 0', textAlign: 'center', cursor: 'grab', userSelect: 'none' }}
              onMouseDown={() => { dragRef.current.dragId = p.id; setDragId(p.id); }}
              onMouseUp={() => { if (!overId) { dragRef.current.dragId = null; setDragId(null); } }}>
              <span style={{ color: '#9BA3B2', fontSize: 14 }}>≡</span>
            </td>
            {COLS.map(c => (
              <td key={c.key} style={{ ...(c.key === 'brand' ? { overflow: 'visible', position: 'relative' } : {}), ...(c.key === '_manage' ? { textAlign: 'center' } : {}) }}
                onClick={() => {
                  if (c.key === 'brand' || c.key === '_manage') return;
                  startEdit(p.id, c.key, c.key === 'price' ? (p[c.key]?.toString() || '') : (p[c.key] || ''));
                }}>
                {renderCell(p, c, i)}
              </td>
            ))}
          </tr>
        ))}
        {products.length === 0 && <tr><td colSpan={6} className="empty">등록된 제품이 없습니다</td></tr>}
      </tbody>
    </table>
  );
}


/* ═══ PART MODAL ═══ */
function PartModal({ initial, categories, onSave, onDelete, onClose }) {
  const isEdit = !!initial?.id;
  const [f, setF] = useState({
    code: initial?.code || '', category: initial?.category || '', name: initial?.name || '',
    spec: initial?.spec || '', price: initial?.price?.toString() || '', image_url: initial?.image_url || '',
    chinese_model: initial?.chinese_model || '', chinese_name: initial?.chinese_name || '',
    quantity: initial?.quantity != null ? initial.quantity.toString() : '',
    big_category: initial?.big_category || '',
  });
  const [imgFile, setImgFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const handleImgChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => { setImgFile(blob); set('image_url', URL.createObjectURL(blob)); }, 'image/png');
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    let imgUrl = f.image_url;
    if (imgFile) {
      const fileName = `part_${Date.now()}.png`;
      const { data, error } = await supabase.storage.from('parts-images').upload(fileName, imgFile, { contentType: 'image/png', upsert: true });
      if (error || !data) {
        alert('이미지 업로드 실패: ' + (error?.message || '알 수 없는 오류') + '\n저장이 중단되었습니다.');
        setSaving(false);
        return;
      }
      const { data: urlData } = supabase.storage.from('parts-images').getPublicUrl(fileName);
      imgUrl = urlData?.publicUrl || null;
    }
    if (imgUrl && typeof imgUrl === 'string' && imgUrl.startsWith('blob:')) imgUrl = null;
    const qtyTrimmed = String(f.quantity).trim();
    const qtyVal = qtyTrimmed === '' ? null : Math.max(0, parseInt(qtyTrimmed) || 0);
    const trimOrNull = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
    const intOrNull = (v) => { const s = String(v ?? '').replace(/,/g, '').trim(); if (s === '') return null; const n = parseInt(s); return isNaN(n) ? null : n; };
    await onSave({
      code: trimOrNull(f.code),
      category: trimOrNull(f.category),
      name: trimOrNull(f.name),
      spec: trimOrNull(f.spec),
      price: intOrNull(f.price),
      image_url: imgUrl || null,
      chinese_model: trimOrNull(f.chinese_model),
      chinese_name: trimOrNull(f.chinese_name),
      quantity: qtyVal,
      big_category: trimOrNull(f.big_category),
    });
    setSaving(false);
  };

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="modal-overlay">
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
            <div className="form-field"><label className="label">모델명(한국)</label><div style={{padding:'8px 10px',background:'#FAFBFC',border:'0.5px solid #DDE1EB',borderRadius:6,fontSize:11,color:'#9BA3B2',lineHeight:1.5}}>저장 후 부속가격 테이블에서 모델 선택 가능</div></div>
          </div>
          <div className="form-field">
            <label className="label">대분류</label>
            <div style={{padding:'8px 10px',background:'#FAFBFC',border:'0.5px solid #DDE1EB',borderRadius:6,fontSize:11,color:'#9BA3B2',lineHeight:1.5}}>저장 후 부속가격 테이블에서 대분류 선택 가능 (최대 3개)</div>
          </div>
          <div className="form-grid">
            <div className="form-field"><label className="label">모델명(中)</label><input value={f.chinese_model} onChange={e => set('chinese_model', e.target.value)} className="input" placeholder="예) DC990" /></div>
            <div className="form-field"><label className="label">부속이름(中)</label><input value={f.chinese_name} onChange={e => set('chinese_name', e.target.value)} className="input" placeholder="예) 电机总成" /></div>
          </div>
          <div className="form-field"><label className="label">규격 및 품명</label><input value={f.name} onChange={e => setF(prev => { const v = e.target.value; const shouldSync = !prev.chinese_name || prev.chinese_name === prev.name; return { ...prev, name: v, chinese_name: shouldSync ? v : prev.chinese_name }; })} className="input" placeholder="품명 입력" /></div>
          <div className="form-field"><label className="label">스펙</label><input value={f.spec} onChange={e => set('spec', e.target.value)} className="input" placeholder="사양/규격" /></div>
          <div className="form-grid">
            <div className="form-field"><label className="label">수량</label><input type="number" min="0" value={f.quantity} onChange={e => set('quantity', e.target.value.replace(/[^0-9]/g,''))} className="input" placeholder="0" /></div>
            <div className="form-field"><label className="label">공임비 (원)</label><input value={f.price} onChange={e => set('price', e.target.value.replace(/[^0-9]/g,''))} className="input" placeholder="0" /></div>
          </div>
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


/* ═══ COMPANIES TAB ═══ */
function CompaniesTab({ companies, setCompanies, onReload }) {
  const [search, setSearch] = useState('');
  const [showNewRow, setShowNewRow] = useState(false);
  const [newRow, setNewRow] = useState({ company_name: '', phone: '', contact_person: '', address: '', invoice_type: '', memo: '' });
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [invoiceDropdown, setInvoiceDropdown] = useState(null);
  const [invoiceDropPos, setInvoiceDropPos] = useState(null);
  const tableRef = useRef(null);

  // 수정/저장 모드
  const [isEditMode, setIsEditMode] = useState(false);
  const [pendingEdits, setPendingEdits] = useState({}); // { [id]: { field: newValue, ... } }
  const [pendingDeletes, setPendingDeletes] = useState(new Set());
  const [saveMsg, setSaveMsg] = useState(false);

  // 컬럼 리사이즈
  const DEFAULT_WIDTHS = { _no: 50, company_name: 160, phone: 130, contact_person: 100, address: 280, invoice_type: 100, memo: 160, _delete: 60 };
  const [colWidths, setColWidths] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_WIDTHS;
    try { const s = localStorage.getItem('companies-col-widths'); return s ? { ...DEFAULT_WIDTHS, ...JSON.parse(s) } : DEFAULT_WIDTHS; } catch { return DEFAULT_WIDTHS; }
  });
  const getColWidth = (k) => colWidths[k] || DEFAULT_WIDTHS[k] || 100;
  const startResize = (idx, key, e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX; const startW = getColWidth(key);
    const onMove = (ev) => { const diff = ev.clientX - startX; const nw = Math.max(40, startW + diff); setColWidths(p => { const n = { ...p, [key]: nw }; localStorage.setItem('companies-col-widths', JSON.stringify(n)); return n; }); };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  };

  const COLS = [
    { key: '_no', label: 'No', w: 50 },
    { key: 'company_name', label: '거래처명', w: 160 },
    { key: 'phone', label: '연락처', w: 130 },
    { key: 'contact_person', label: '담당자', w: 100 },
    { key: 'address', label: '주소', w: 280, align: 'left' },
    { key: 'invoice_type', label: '계산서구분', w: 100, type: 'select', opts: ['월말', '계산서', '일반'] },
    { key: 'memo', label: '비고', w: 160 },
    { key: '_delete', label: '관리', w: 60, type: 'action' },
  ];

  const INVOICE_BADGE = { '월말': ['#185FA5', '#FFFFFF'], '계산서': ['#1D9E75', '#FFFFFF'], '일반': ['#F1EFE8', '#2C2C2A'] };

  const filtered = companies.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [c.company_name, c.contact_person, c.phone].some(f => f?.toLowerCase().includes(q));
  });

  const invoiceCount = companies.filter(c => c.invoice_type === '월말' || c.invoice_type === '계산서').length;
  const normalCount = companies.length - invoiceCount;

  // 편집된 값 가져오기 (pendingEdits 반영)
  const getDisplayVal = (c, field) => {
    if (pendingEdits[c.id] && pendingEdits[c.id][field] !== undefined) return pendingEdits[c.id][field];
    return c[field];
  };

  // 인라인 편집 시작 (수정 모드에서만)
  const startEdit = (id, field, val) => { if (!isEditMode) return; setEditCell({ id, field }); setEditValue(val || ''); };
  const commitEdit = () => {
    if (!editCell) return;
    const { id, field } = editCell;
    // pendingEdits에 저장 (Supabase에 바로 저장하지 않음)
    setPendingEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: editValue || null } }));
    setEditCell(null);
  };

  // 계산서구분 저장 (pendingEdits에)
  const saveInvoiceType = (id, val) => {
    setPendingEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), invoice_type: val } }));
    setInvoiceDropdown(null); setInvoiceDropPos(null);
  };

  // 드롭다운 바깥 클릭 닫기
  useEffect(() => {
    if (!invoiceDropdown) return;
    const h = (e) => { if (!e.target.closest('.badge-expand-panel')) { setInvoiceDropdown(null); setInvoiceDropPos(null); } };
    const timer = setTimeout(() => document.addEventListener('click', h), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', h); };
  }, [invoiceDropdown]);

  // 새 거래처 저장 (독립 — 수정 모드와 무관)
  const handleNewSave = async () => {
    if (!newRow.company_name?.trim()) { alert('거래처명을 입력하세요.'); return; }
    const { data, error } = await supabase.from('companies').insert({
      company_name: newRow.company_name.trim(),
      phone: newRow.phone?.trim() || null,
      contact_person: newRow.contact_person?.trim() || null,
      address: newRow.address?.trim() || null,
      invoice_type: newRow.invoice_type || null,
      memo: newRow.memo?.trim() || null,
    }).select().single();
    if (error) { alert('저장 실패: ' + error.message); return; }
    setCompanies(prev => [data, ...prev]);
    setNewRow({ company_name: '', phone: '', contact_person: '', address: '', invoice_type: '', memo: '' });
    setShowNewRow(false);
  };

  // "저장" 버튼 — 일괄 반영
  const handleBulkSave = async () => {
    try {
      // 수정사항 반영
      const editIds = Object.keys(pendingEdits);
      for (const id of editIds) {
        if (pendingDeletes.has(id)) continue; // 삭제 예정이면 수정 스킵
        const { error } = await supabase.from('companies').update(pendingEdits[id]).eq('id', id);
        if (error) throw new Error(`수정 실패 (${id}): ${error.message}`);
      }
      // 삭제 반영
      for (const id of pendingDeletes) {
        const { error } = await supabase.from('companies').delete().eq('id', id);
        if (error) throw new Error(`삭제 실패 (${id}): ${error.message}`);
      }
      // 로컬 state 갱신
      setCompanies(prev => {
        let next = prev.filter(c => !pendingDeletes.has(c.id));
        next = next.map(c => pendingEdits[c.id] ? { ...c, ...pendingEdits[c.id] } : c);
        return next;
      });
      setPendingEdits({}); setPendingDeletes(new Set()); setEditCell(null); setIsEditMode(false);
      setSaveMsg(true); setTimeout(() => setSaveMsg(false), 2000);
    } catch (err) {
      alert(err.message);
    }
  };

  // "취소" 버튼
  const handleCancel = () => {
    setPendingEdits({}); setPendingDeletes(new Set()); setEditCell(null); setIsEditMode(false);
  };

  const empty = <span className="empty-dot">●</span>;

  const renderCell = (c, col, rowIdx) => {
    const isDel = pendingDeletes.has(c.id);
    if (col.key === '_no') return <span style={{fontSize:13,fontWeight:400,color:'#5A6070',fontFamily:'Pretendard,sans-serif'}}>{rowIdx + 1}</span>;
    if (col.key === '_delete') {
      if (!isEditMode) return null;
      if (isDel) return <button style={{background:'#EAECF2',color:'#5A6070',border:'none',borderRadius:4,padding:'3px 8px',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'Pretendard,sans-serif'}} onClick={e => { e.stopPropagation(); setPendingDeletes(prev => { const n = new Set(prev); n.delete(c.id); return n; }); }}>복원</button>;
      return <button style={{background:'#FCEBEB',color:'#CC2222',border:'none',borderRadius:4,padding:'3px 8px',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'Pretendard,sans-serif'}} onClick={e => { e.stopPropagation(); setPendingDeletes(prev => new Set(prev).add(c.id)); }}>삭제</button>;
    }

    const val = getDisplayVal(c, col.key);
    const isEditing = editCell?.id === c.id && editCell?.field === col.key;

    // 계산서구분 — 뱃지 드롭다운
    if (col.key === 'invoice_type') {
      if (!isEditMode) {
        const [bg, tc] = INVOICE_BADGE[val] || ['#F4F6FA', '#9BA3B2'];
        if (!val) return empty;
        return <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',fontFamily:'Pretendard,sans-serif',background:bg,color:tc}}>{val}</span>;
      }
      const isOpen = invoiceDropdown === c.id;
      const [bg, tc] = INVOICE_BADGE[val] || ['#F4F6FA', '#9BA3B2'];
      return (
        <div className="badge-expand-panel" style={{overflow:'hidden'}} onClick={e => e.stopPropagation()}>
          <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',fontFamily:'Pretendard,sans-serif',background: val ? bg : '#F4F6FA',color: val ? tc : '#9BA3B2',cursor:'pointer',border: isOpen ? `2px solid ${tc}` : '2px solid transparent'}}
            onClick={e => { if (isOpen) { setInvoiceDropdown(null); setInvoiceDropPos(null); } else { const rect = e.currentTarget.getBoundingClientRect(); setInvoiceDropPos({top:rect.bottom+2,left:rect.left}); setInvoiceDropdown(c.id); } }}>
            {val || '—'}
          </span>
          {isOpen && invoiceDropPos && (
            <div style={{position:'fixed',top:invoiceDropPos.top,left:invoiceDropPos.left,zIndex:9999,background:'#fff',border:'1px solid #DDE1EB',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',padding:4,minWidth:80}}>
              {col.opts.map(o => { const [obg,oc] = INVOICE_BADGE[o] || ['#F4F6FA','#1A1D23']; return (
                <div key={o} style={{display:'flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'Pretendard,sans-serif',background:obg,color:oc,marginBottom:2,border:val===o?`2px solid ${oc}`:'2px solid transparent',whiteSpace:'nowrap'}}
                  onClick={() => saveInvoiceType(c.id, o)}>{o}</div>
              ); })}
            </div>
          )}
        </div>
      );
    }

    // 인라인 편집 모드
    if (isEditing) {
      return <input className="as-cell-input" value={editValue} autoFocus
        onChange={e => setEditValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => e.key === 'Enter' && commitEdit()} />;
    }

    // 일반 텍스트
    if (!val) return empty;
    const fw = col.key === 'company_name' ? 600 : 400;
    return <span style={{fontSize:13,fontWeight:fw,color:'#1A1D23',fontFamily:'Pretendard,sans-serif'}}>{val}</span>;
  };

  // 새 행 계산서 드롭다운
  const [newInvOpen, setNewInvOpen] = useState(false);
  const [newInvPos, setNewInvPos] = useState(null);
  useEffect(() => {
    if (!newInvOpen) return;
    const h = (e) => { if (!e.target.closest('.badge-expand-panel')) { setNewInvOpen(false); setNewInvPos(null); } };
    const timer = setTimeout(() => document.addEventListener('click', h), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', h); };
  }, [newInvOpen]);

  return (
    <>
      <div className="as-filter-row">
        <div className="as-filter-search-wrap">
          <svg className="as-filter-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="#9BA3B2" strokeWidth="1.2"/><path d="M9.5 9.5L13 13" stroke="#9BA3B2" strokeWidth="1.2" strokeLinecap="round"/></svg>
          <input className="input as-filter-search" placeholder="거래처명, 담당자, 연락처 검색..." value={search} onChange={e => setSearch(e.target.value)} autoComplete="off" />
        </div>
        <span style={{fontSize:12,color:'#5A6070',fontWeight:500,fontFamily:'Pretendard,sans-serif'}}>전체 {companies.length}건</span>
        <div style={{display:'flex',alignItems:'center',gap:6,marginLeft:'auto'}}>
          {!isEditMode ? (
            <>
              <button className="btn-primary" style={{fontSize:11,padding:'4px 12px'}} onClick={() => { setShowNewRow(true); }}>+ 새 거래처</button>
              <button style={{background:'#FAEEDA',color:'#854F0B',border:'none',borderRadius:4,padding:'4px 12px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'Pretendard,sans-serif'}} onClick={() => { setIsEditMode(true); setShowNewRow(false); }}>수정</button>
            </>
          ) : (
            <>
              <button style={{background:'#1D9E75',color:'#fff',border:'none',borderRadius:4,padding:'4px 12px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'Pretendard,sans-serif'}} onClick={handleBulkSave}>저장</button>
              <button style={{background:'#EAECF2',color:'#5A6070',border:'none',borderRadius:4,padding:'4px 12px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'Pretendard,sans-serif'}} onClick={handleCancel}>취소</button>
              <span style={{fontSize:11,color:'#EF9F27',fontWeight:600,fontFamily:'Pretendard,sans-serif',marginLeft:8}}>수정 모드 — 셀을 클릭하여 편집하세요</span>
            </>
          )}
          {saveMsg && <span style={{fontSize:11,color:'#1D9E75',fontWeight:600,fontFamily:'Pretendard,sans-serif',marginLeft:8}}>저장 완료</span>}
        </div>
      </div>

      <div className="section" style={{display:'flex',flexDirection:'column',overflow:'hidden',height:'calc(100vh - 160px)'}}>
        <div className="section-header">
          <span style={{fontSize:12,fontWeight:600}}>거래처 목록</span>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:700,background:'#185FA5',color:'#fff'}}>전체 {companies.length}</span>
            <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:700,background:'#1D9E75',color:'#fff'}}>계산서 {invoiceCount}</span>
            <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:700,background:'rgba(255,255,255,0.15)',color:'rgba(255,255,255,0.8)'}}>일반 {normalCount}</span>
          </div>
        </div>
        <div className="as-table-wrapper" style={{flex:1,overflow:'auto'}}>
          <table className="as-table" ref={tableRef} style={{width: COLS.reduce((s, c) => s + getColWidth(c.key), 0)}}>
            <colgroup>{COLS.map(c => <col key={c.key} style={{width: getColWidth(c.key)}} />)}</colgroup>
            <thead>
              <tr className="as-col-header">
                {COLS.map((c, idx) => (
                  <th key={c.key} style={{position:'sticky',top:0,zIndex:20,background:'#EAECF2',fontSize:12,fontWeight:600,color:'#5A6070',textAlign:'center',padding:'8px 10px',borderRight:'1px solid #DDE1EB',fontFamily:'Pretendard,sans-serif'}}>
                    {c.label}
                    <span className="col-resize-handle" onMouseDown={e => startResize(idx, c.key, e)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {showNewRow && !isEditMode && (
                <tr className="as-new-row" style={{background:'#E6F1FB'}}>
                  {COLS.map(c => (
                    <td key={c.key} style={{...(c.key === 'invoice_type' ? {overflow:'visible',position:'relative'} : {})}}>
                      {c.key === '_no' ? <span style={{fontSize:11,color:'#9BA3B2'}}>new</span>
                      : c.key === '_delete' ? (
                        <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                          <button style={{background:'#1D9E75',color:'#fff',border:'none',borderRadius:4,padding:'4px 10px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'Pretendard,sans-serif'}} onClick={handleNewSave}>저장</button>
                          <button style={{background:'#5A6070',color:'#fff',border:'none',borderRadius:4,padding:'4px 10px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'Pretendard,sans-serif'}} onClick={() => setShowNewRow(false)}>취소</button>
                        </div>
                      ) : c.key === 'invoice_type' ? (
                        <div className="badge-expand-panel" onClick={e => e.stopPropagation()}>
                          {(() => { const [nbg,nc] = newRow.invoice_type ? (INVOICE_BADGE[newRow.invoice_type] || ['#F4F6FA','#9BA3B2']) : ['#F4F6FA','#9BA3B2']; return (
                          <span style={{display:'inline-flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,whiteSpace:'nowrap',fontFamily:'Pretendard,sans-serif',background:nbg,color:nc,cursor:'pointer',border:newInvOpen?`2px solid ${nc}`:'2px solid transparent'}}
                            onClick={e => { if (newInvOpen) { setNewInvOpen(false); setNewInvPos(null); } else { const rect=e.currentTarget.getBoundingClientRect(); setNewInvPos({top:rect.bottom+2,left:rect.left}); setNewInvOpen(true); } }}>
                            {newRow.invoice_type || '선택'}
                          </span>); })()}
                          {newInvOpen && newInvPos && (
                            <div style={{position:'fixed',top:newInvPos.top,left:newInvPos.left,zIndex:9999,background:'#fff',border:'1px solid #DDE1EB',borderRadius:6,boxShadow:'0 4px 12px rgba(0,0,0,0.1)',padding:4,minWidth:80}}>
                              {c.opts.map(o => { const [obg,oc] = INVOICE_BADGE[o] || ['#F4F6FA','#1A1D23']; return (
                                <div key={o} style={{display:'flex',justifyContent:'center',alignItems:'center',padding:'4px 8px',borderRadius:4,fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'Pretendard,sans-serif',background:obg,color:oc,marginBottom:2,border:newRow.invoice_type===o?`2px solid ${oc}`:'2px solid transparent',whiteSpace:'nowrap'}}
                                  onClick={() => { setNewRow(p=>({...p,invoice_type:o})); setNewInvOpen(false); setNewInvPos(null); }}>{o}</div>
                              ); })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <input className="as-cell-input" value={newRow[c.key]||''} placeholder={c.label}
                          onChange={e => setNewRow(p=>({...p,[c.key]:e.target.value}))}
                          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} />
                      )}
                    </td>
                  ))}
                </tr>
              )}
              {filtered.map((c, i) => {
                const isDel = pendingDeletes.has(c.id);
                return (
                <tr key={c.id} className="as-data-row" style={{background: isDel ? '#FCEBEB' : (i % 2 === 1 ? '#FAFBFC' : undefined), ...(isDel ? {opacity:0.6} : {})}}>
                  {COLS.map(col => (
                    <td key={col.key}
                      style={{...(col.align === 'left' ? {textAlign:'left'} : {}), ...(col.type === 'select' ? {overflow:'visible',position:'relative'} : {}), ...(col.type === 'action' ? {cursor:'default'} : {}), ...(isDel ? {textDecoration:'line-through'} : {})}}
                      onClick={() => {
                        if (!isEditMode || isDel) return;
                        if (col.key === '_no' || col.key === '_delete' || col.type === 'select' || col.type === 'action') return;
                        startEdit(c.id, col.key, getDisplayVal(c, col.key) || '');
                      }}>
                      {renderCell(c, col, i)}
                    </td>
                  ))}
                </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={COLS.length} className="empty">거래처가 없습니다</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}


/* ═══ SETTINGS TAB ═══ */
function SettingsTab({ asRecords }) {
  const [subTab, setSubTab] = useState('system');
  const [pwModal, setPwModal] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState('');
  const [authOk, setAuthOk] = useState(false);
  const [billDateFilterMode, setBillDateFilterMode] = useState(() => {
    if (typeof window === 'undefined') return 'month';
    return localStorage.getItem('bill_date_filter_mode') || 'month';
  });
  const [billDateFrom, setBillDateFrom] = useState(() => {
    if (typeof window === 'undefined') return today();
    const mode = localStorage.getItem('bill_date_filter_mode') || 'month';
    if (mode === 'today') return today();
    if (mode === 'week') {
      const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(d); monday.setDate(d.getDate() + diff);
      return monday.getFullYear() + '-' + String(monday.getMonth()+1).padStart(2,'0') + '-' + String(monday.getDate()).padStart(2,'0');
    }
    if (mode === 'all') return '';
    if (mode === 'custom') return localStorage.getItem('bill_date_from') || today();
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-01';
  });
  const [billDateTo, setBillDateTo] = useState(() => {
    if (typeof window === 'undefined') return today();
    const mode = localStorage.getItem('bill_date_filter_mode') || 'month';
    if (mode === 'today') return today();
    if (mode === 'week') {
      const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(d); monday.setDate(d.getDate() + diff);
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      return sunday.getFullYear() + '-' + String(sunday.getMonth()+1).padStart(2,'0') + '-' + String(sunday.getDate()).padStart(2,'0');
    }
    if (mode === 'all') return '';
    if (mode === 'custom') { const saved = localStorage.getItem('bill_date_to'); return (saved && saved >= today()) ? saved : today(); }
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' })); const y=d.getFullYear(), m=d.getMonth()+1; const lastDay=new Date(y,m,0).getDate();
    return y+'-'+String(m).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
  });
  const [billDateAll, setBillDateAll] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (localStorage.getItem('bill_date_filter_mode') || 'month') === 'all';
  });
  const [billTypeFilter, setBillTypeFilter] = useState(null);
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

  const sRecs = asRecords.filter(r => {
    if (billDateAll) return true;
    if (!r.receipt_date) return false;
    return r.receipt_date >= billDateFrom && r.receipt_date <= billDateTo;
  });
  const aggregate = (arr) => {
    const paid = arr.filter(r => ['완료','카드','방문결제'].includes(r.payment_status));
    const unpaid = arr.filter(r => ['대기','명세서'].includes(r.payment_status));
    const free = arr.filter(r => r.payment_status === '무상');
    const sum = a => a.reduce((s,r) => s + (Number(r.repair_cost)||0), 0);
    return { count: arr.length, revenue: sum(arr), paid: sum(paid), unpaid: sum(unpaid), free: sum(free) };
  };
  const asStats = aggregate(sRecs.filter(r => r.record_type === 'as_repair'));
  const productStats = aggregate(sRecs.filter(r => r.record_type === 'product_sale'));
  const partsStats = aggregate(sRecs.filter(r => r.record_type === 'parts_sale'));
  const totalStats = aggregate(sRecs);
  const displayRecs = billTypeFilter ? sRecs.filter(r => r.record_type === billTypeFilter) : sRecs;
  const displayStats = aggregate(displayRecs);
  const sortedRecs = [...displayRecs].sort((a,b) => (b.receipt_date || '').localeCompare(a.receipt_date || ''));
  const totalRev = displayStats.revenue;
  const typeLabels = { as_repair:'AS 수리', product_sale:'제품 판매', parts_sale:'부품 판매' };
  const filterCountLabel = billTypeFilter ? `${typeLabels[billTypeFilter]} ${displayRecs.length.toLocaleString('ko-KR')}건` : `총 ${displayRecs.length.toLocaleString('ko-KR')}건`;
  const onCardBadgeClick = (type) => { if (type === null) setBillTypeFilter(null); else setBillTypeFilter(prev => prev === type ? null : type); };
  const B = (bg,c,t) => <span style={{display:'inline-flex',padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:600,whiteSpace:'nowrap',background:bg,color:c}}>{t}</span>;
  const VARS = ['{입고날짜}','{출고날짜}','{모델명}','{택배사}','{운송장번호}','{고객명}','{거래처명}','{브랜드}','{AS비용}'];

  const billDateLabel = (() => {
    if (billDateAll) return '전체 기간';
    const fmt2 = (d) => { const dt = new Date(d + 'T00:00:00'); return `${dt.getFullYear()}년 ${dt.getMonth()+1}월 ${dt.getDate()}일`; };
    if (billDateFrom === billDateTo) return fmt2(billDateFrom);
    const days = Math.round((new Date(billDateTo + 'T00:00:00') - new Date(billDateFrom + 'T00:00:00')) / 86400000) + 1;
    const f = new Date(billDateFrom + 'T00:00:00'); const t = new Date(billDateTo + 'T00:00:00');
    if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()) return `${f.getFullYear()}년 ${f.getMonth()+1}월 ${f.getDate()}일 ~ ${t.getDate()}일 (${days}일)`;
    return `${fmt2(billDateFrom)} ~ ${fmt2(billDateTo)} (${days}일)`;
  })();

  const setBillMode = (mode) => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    if (mode === 'today') {
      const t = today();
      setBillDateAll(false); setBillDateFrom(t); setBillDateTo(t); setBillDateFilterMode('today');
      localStorage.setItem('bill_date_filter_mode','today');
    } else if (mode === 'week') {
      const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(d); monday.setDate(d.getDate() + diff);
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      const f = monday.getFullYear() + '-' + String(monday.getMonth()+1).padStart(2,'0') + '-' + String(monday.getDate()).padStart(2,'0');
      const tt = sunday.getFullYear() + '-' + String(sunday.getMonth()+1).padStart(2,'0') + '-' + String(sunday.getDate()).padStart(2,'0');
      setBillDateAll(false); setBillDateFrom(f); setBillDateTo(tt); setBillDateFilterMode('week');
      localStorage.setItem('bill_date_filter_mode','week');
    } else if (mode === 'month') {
      const y=d.getFullYear(), m=d.getMonth()+1; const lastDay=new Date(y,m,0).getDate();
      setBillDateAll(false);
      setBillDateFrom(y+'-'+String(m).padStart(2,'0')+'-01');
      setBillDateTo(y+'-'+String(m).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0'));
      setBillDateFilterMode('month');
      localStorage.setItem('bill_date_filter_mode','month');
    } else if (mode === 'all') {
      setBillDateAll(true); setBillDateFilterMode('all');
      localStorage.setItem('bill_date_filter_mode','all');
    }
  };

  return (
    <div style={{padding:'0 4px'}}>
      <div style={{display:'flex',gap:4,marginBottom:20}}>
        {[['billing','🔒 정산 관리'],['system','시스템 설정']].map(([k,v]) => (
          <button key={k} onClick={() => handleSubTab(k)} style={{padding:'8px 18px',borderRadius:6,fontSize:13,fontWeight:600,cursor:'pointer',border:'none',fontFamily:'inherit',background:subTab===k?'#185FA5':'transparent',color:subTab===k?'#fff':'#5A6070'}}>{v}</button>
        ))}
      </div>

      {pwModal && (
        <div className="modal-overlay">
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
          {/* 기간 필터 바 */}
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12,flexWrap:'wrap'}}>
            <div style={{display:'flex',alignItems:'center',height:32,border:'0.5px solid #DDE1EB',borderRadius:6,padding:'0 6px',background:'#fff'}}>
              <input type="date" value={billDateAll ? '' : billDateFrom} onChange={e => { setBillDateAll(false); setBillDateFrom(e.target.value); setBillDateFilterMode('custom'); localStorage.setItem('bill_date_filter_mode','custom'); localStorage.setItem('bill_date_from',e.target.value); localStorage.setItem('bill_date_to',billDateTo); }} style={{fontSize:12,height:28,border:'none',width:130,background:'transparent',fontFamily:'inherit',outline:'none',color:'#1A1D23'}} />
              <span style={{color:'#9BA3B2',padding:'0 4px',fontSize:12}}>~</span>
              <input type="date" value={billDateAll ? '' : billDateTo} onChange={e => { setBillDateAll(false); setBillDateTo(e.target.value); setBillDateFilterMode('custom'); localStorage.setItem('bill_date_filter_mode','custom'); localStorage.setItem('bill_date_from',billDateFrom); localStorage.setItem('bill_date_to',e.target.value); }} style={{fontSize:12,height:28,border:'none',width:130,background:'transparent',fontFamily:'inherit',outline:'none',color:'#1A1D23'}} />
            </div>
            {(() => { const active = {height:32,padding:'0 12px',borderRadius:4,fontSize:11,fontWeight:600,border:'none',cursor:'pointer',fontFamily:'inherit',background:'#185FA5',color:'#fff',whiteSpace:'nowrap'}; const inactive = {...active,background:'#E6F1FB',color:'#0C447C'}; return (
              <div style={{display:'flex',gap:4}}>
                <button onClick={() => setBillMode('today')} style={billDateFilterMode==='today'?active:inactive}>오늘</button>
                <button onClick={() => setBillMode('week')} style={billDateFilterMode==='week'?active:inactive}>이번주</button>
                <button onClick={() => setBillMode('month')} style={billDateFilterMode==='month'?active:inactive}>이번달</button>
                <button onClick={() => setBillMode('all')} style={billDateFilterMode==='all'?active:inactive}>전체</button>
              </div>
            ); })()}
            <div style={{marginLeft:'auto',fontSize:12,color:'#5A6070'}}>조회 기간: <span style={{color:'#1A1D23',fontWeight:600}}>{billDateLabel}</span></div>
          </div>

          {/* KPI 카드 4개 (구분별) */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:12,marginBottom:16}}>
            {[
              { name:'AS 수리', bg:'#185FA5', stats:asStats, totalCard:false, typeKey:'as_repair' },
              { name:'제품 판매', bg:'#0C447C', stats:productStats, totalCard:false, typeKey:'product_sale' },
              { name:'부품 판매', bg:'#5A6070', stats:partsStats, totalCard:false, typeKey:'parts_sale' },
              { name:'총 합계', bg:'#1A1D23', stats:totalStats, totalCard:true, typeKey:null },
            ].map(card => {
              const stats = card.stats;
              const isSelected = !card.totalCard && billTypeFilter === card.typeKey;
              const cellValStyle = (n) => n === 0
                ? {fontSize:14,fontWeight:500,color:'#9BA3B2',fontFamily:"'Pretendard', -apple-system, sans-serif"}
                : {fontSize:14,fontWeight:700,color:'#1A1D23',fontFamily:"'Pretendard', -apple-system, sans-serif"};
              const cardStyle = isSelected
                ? {background:'#FFFFFF',border:'2px solid #185FA5',borderRadius:8,overflow:'hidden',boxShadow:'0 0 0 3px #E6F1FB',margin:0}
                : {background:'#FFFFFF',border:'2px solid transparent',outline:'1px solid #DDE1EB',borderRadius:8,overflow:'hidden',margin:0};
              return (
                <div key={card.name} style={cardStyle}>
                  <div style={{height:40,padding:'10px 16px',background:card.bg,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <span style={{fontSize:14,fontWeight:700,color:'#fff',fontFamily:"'Pretendard', -apple-system, sans-serif"}}>{card.name}</span>
                    <button
                      type="button"
                      onClick={() => onCardBadgeClick(card.typeKey)}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.35)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; }}
                      style={{background:'rgba(255,255,255,0.2)',color:'#fff',fontSize:11,fontWeight:500,padding:'2px 8px',borderRadius:10,whiteSpace:'nowrap',border:'none',cursor:'pointer',fontFamily:"'Pretendard', -apple-system, sans-serif"}}
                    >{stats.count.toLocaleString('ko-KR')}건</button>
                  </div>
                  <div style={{padding:'16px 16px 12px',borderBottom:'1px solid #DDE1EB'}}>
                    <div style={{fontSize:11,fontWeight:500,color:'#5A6070',marginBottom:4}}>매출</div>
                    <div style={{display:'flex',alignItems:'baseline',gap:4}}>
                      <span style={{fontSize:24,fontWeight:700,letterSpacing:'-0.5px',color:card.totalCard?'#185FA5':'#1A1D23',fontFamily:"'Pretendard', -apple-system, sans-serif"}}>{stats.revenue.toLocaleString('ko-KR')}</span>
                      <span style={{fontSize:13,fontWeight:500,color:'#5A6070'}}>원</span>
                    </div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr'}}>
                    <div style={{padding:'10px 8px',textAlign:'center',borderRight:'1px solid #DDE1EB'}}>
                      <div style={{fontSize:11,fontWeight:500,color:'#5A6070',display:'flex',alignItems:'center',justifyContent:'center',gap:4,marginBottom:2,whiteSpace:'nowrap'}}><span style={{width:6,height:6,borderRadius:'50%',background:'#1D9E75',display:'inline-block'}}/>입금완료</div>
                      <div style={cellValStyle(stats.paid)}>{stats.paid.toLocaleString('ko-KR')}</div>
                    </div>
                    <div style={{padding:'10px 8px',textAlign:'center',borderRight:'1px solid #DDE1EB'}}>
                      <div style={{fontSize:11,fontWeight:500,color:'#5A6070',display:'flex',alignItems:'center',justifyContent:'center',gap:4,marginBottom:2,whiteSpace:'nowrap'}}><span style={{width:6,height:6,borderRadius:'50%',background:'#EF9F27',display:'inline-block'}}/>미수금</div>
                      <div style={cellValStyle(stats.unpaid)}>{stats.unpaid.toLocaleString('ko-KR')}</div>
                    </div>
                    <div style={{padding:'10px 8px',textAlign:'center'}}>
                      <div style={{fontSize:11,fontWeight:500,color:'#5A6070',display:'flex',alignItems:'center',justifyContent:'center',gap:4,marginBottom:2,whiteSpace:'nowrap'}}><span style={{width:6,height:6,borderRadius:'50%',background:'#9BA3B2',display:'inline-block'}}/>무상</div>
                      <div style={cellValStyle(stats.free)}>{stats.free.toLocaleString('ko-KR')}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="section">
            <div className="section-header">
              <span style={{fontSize:12,fontWeight:600}}>정산 내역</span>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {billTypeFilter && <button type="button" onClick={() => setBillTypeFilter(null)} style={{background:'rgba(255,255,255,0.18)',color:'#fff',border:'none',borderRadius:4,padding:'3px 10px',fontSize:11,fontWeight:500,cursor:'pointer',fontFamily:"'Pretendard', -apple-system, sans-serif",whiteSpace:'nowrap'}}>필터 해제 ✕</button>}
                <div style={{fontSize:12,color:'#fff',opacity:0.85}}>{filterCountLabel}</div>
              </div>
            </div>
            <div style={{overflowX:'auto',maxHeight:'calc(100vh - 340px)'}}>
              <table className="data-table"><thead><tr>
                {['날짜','거래처/고객','구분','모델','처리내용','AS비용','입금상태','계산서'].map(h => <th key={h}>{h}</th>)}
              </tr></thead><tbody>
                {sortedRecs.map((r,i) => (
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
                {displayRecs.length === 0 && <tr><td colSpan={8} className="empty">정산 내역이 없습니다</td></tr>}
              </tbody>
              {displayRecs.length > 0 && <tfoot>
                <tr style={{background:'#F4F6FA',fontWeight:700,borderTop:'2px solid #B0B8CC'}}>
                  <td colSpan={5} style={{textAlign:'right',fontSize:13,fontWeight:700}}>합계</td>
                  <td style={{textAlign:'right',color:'#185FA5',fontSize:14,fontWeight:700}}>{totalRev.toLocaleString('ko-KR')}</td>
                  <td colSpan={2}/>
                </tr>
              </tfoot>}
              </table>
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
function SMSPopup({ onClose, onUnreadChange, onConfirmSent }) {
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState(null); // phone
  const [messages, setMessages] = useState([]);
  const [msgInput, setMsgInput] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [isSending, setIsSending] = useState(false);
  const chatRef = useRef(null);
  const textareaRef = useRef(null);
  const popupRef = useRef(null);
  const [smsDragPos, setSmsDragPos] = useState(null);
  const smsDragRef = useRef(null);

  const onSmsDragDown = (e) => {
    if (e.target.closest('button')) return;
    const popup = popupRef.current; if (!popup) return;
    const rect = popup.getBoundingClientRect();
    const offsetX = e.clientX - rect.left, offsetY = e.clientY - rect.top;
    smsDragRef.current = { offsetX, offsetY };
    document.body.style.cursor = 'grabbing'; document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      const x = Math.max(0, Math.min(ev.clientX - offsetX, window.innerWidth - rect.width));
      const y = Math.max(0, Math.min(ev.clientY - offsetY, window.innerHeight - rect.height));
      setSmsDragPos({ x, y });
    };
    const onUp = () => { smsDragRef.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  };

  const [clipboards, setClipboards] = useState([]);
  const [clipModal, setClipModal] = useState(false);
  const [selectedClipTitle, setSelectedClipTitle] = useState(null);

  const CLIP_COLORS = ['#E6F1FB','#FAEEDA','#E1F5EE','#EEEDFE','#FAECE7','#FBEAF0'];
  const CLIP_TEXT_COLORS = { '#E6F1FB':'#0C447C','#FAEEDA':'#412402','#E1F5EE':'#085041','#EEEDFE':'#26215C','#FAECE7':'#6B2012','#FBEAF0':'#6B1240' };

  // 클립보드 데이터 로드 (고객이력과 동일한 sms_clipboard)
  useEffect(() => {
    supabase.from('settings').select('*').eq('key','sms_clipboard').single().then(({ data }) => {
      if (data?.value && Array.isArray(data.value)) setClipboards(data.value);
      else setClipboards([
        { title: '입고안내', content: '안녕하세요. 대한공구 AS센터입니다.\n보내주신 제품이 입고되었습니다.\n점검 후 안내드리겠습니다.', color: '#E6F1FB' },
        { title: '수리완료', content: '안녕하세요. 대한공구 AS센터입니다.\n수리가 완료되었습니다.\n발송 예정이오니 확인 부탁드립니다.', color: '#E1F5EE' },
        { title: '부품대기', content: '안녕하세요. 대한공구 AS센터입니다.\n부품 입고 대기중입니다.\n입고되는대로 안내드리겠습니다.', color: '#FAEEDA' },
        { title: '출고안내', content: '안녕하세요. 대한공구 AS센터입니다.\n택배 발송 완료되었습니다.\n감사합니다.', color: '#EEEDFE' },
      ]);
    });
  }, []);

  const saveClipboards = async (items) => {
    setClipboards(items);
    await supabase.from('settings').upsert({ key: 'sms_clipboard', value: items, updated_at: new Date().toISOString() });
  };

  const autoResizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    const popup = popupRef.current;
    const maxH = popup ? Math.floor(popup.offsetHeight * 0.5) : 300;
    el.style.height = 'auto';
    el.style.height = Math.min(Math.max(el.scrollHeight, 72), maxH) + 'px';
  };

  // 팝업 크기 localStorage 저장/복원
  useEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const saved = (() => { try { return JSON.parse(localStorage.getItem('sms_popup_size')); } catch { return null; } })();
    if (saved?.width) popup.style.width = saved.width + 'px';
    if (saved?.height) popup.style.height = saved.height + 'px';
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        localStorage.setItem('sms_popup_size', JSON.stringify({ width: Math.round(width), height: Math.round(height) }));
      }
    });
    ro.observe(popup);
    return () => ro.disconnect();
  }, []);

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
      (asData||[]).forEach(r => { if (r.customer_phone && r.customer_name) nameMap[toLocal(r.customer_phone)] = r.customer_name; });
      Object.values(grouped).forEach(c => { c.name = nameMap[toLocal(c.phone)] || c.phone; });
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

  // Realtime: 새 문자 수신 시 즉시 반영
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const onUnreadChangeRef = useRef(onUnreadChange);
  useEffect(() => { onUnreadChangeRef.current = onUnreadChange; }, [onUnreadChange]);

  useEffect(() => {
    const chName = 'sms-popup-realtime';
    // 기존 동일 채널 정리
    const existing = supabase.getChannels().find(c => c.topic === 'realtime:' + chName);
    if (existing) supabase.removeChannel(existing);
    const ch = supabase.channel(chName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sms_messages' }, (payload) => {
        const m = payload.new;
        if (!m.phone) return;
        const cur = selectedRef.current;
        const mPhone = toLocal(m.phone);
        const curPhone = cur ? toLocal(cur) : null;
        // 현재 선택된 대화면 말풍선에 추가 (중복 방지)
        if (curPhone && mPhone === curPhone) {
          setMessages(prev => {
            if (prev.some(x => x.id === m.id)) return prev;
            return [...prev, m];
          });
          if (m.direction === 'incoming' && !m.read) {
            supabase.from('sms_messages').update({ read: true }).eq('id', m.id).then(() => {});
          }
        }
        // 좌측 대화 목록 업데이트
        setCustomers(prev => {
          const exists = prev.find(c => toLocal(c.phone) === mPhone);
          if (exists) {
            return prev.map(c => toLocal(c.phone) === mPhone ? {
              ...c,
              latest: m.sent_at > (c.latest || '') ? m.sent_at : c.latest,
              latestText: m.sent_at > (c.latest || '') ? m.content : c.latestText,
              unread: m.direction === 'incoming' && mPhone !== curPhone ? c.unread + 1 : c.unread,
            } : c).sort((a,b) => (b.latest||'') > (a.latest||'') ? 1 : -1);
          } else {
            return [{ phone: mPhone, name: mPhone, unread: m.direction === 'incoming' ? 1 : 0, latest: m.sent_at, latestText: m.content }, ...prev];
          }
        });
        // 전체 읽지않음 카운트 업데이트
        if (m.direction === 'incoming' && mPhone !== curPhone) {
          supabase.from('sms_messages').select('*', { count: 'exact', head: true }).eq('direction', 'incoming').eq('read', false).then(({ count }) => {
            if (onUnreadChangeRef.current) onUnreadChangeRef.current(count || 0);
          });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => { setTimeout(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, 50); }, [messages]);

  useEffect(() => { const esc = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, [onClose]);

  const handleSend = async () => {
    if (!msgInput.trim() || !selected || isSending) return;
    setIsSending(true);
    try {
      const res = await fetch('/api/sms/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to: selected, content: msgInput.trim() }) });
      const result = await res.json();
      if (result.error) { alert('발송 실패: ' + result.error); return; }
      const normalPhone = toLocal(selected);
      const msg = { phone: normalPhone, content: msgInput.trim(), direction: 'outgoing', sent_at: new Date().toISOString(), read: true, ...(selectedClipTitle ? { message_type: selectedClipTitle } : {}) };
      const { data } = await supabase.from('sms_messages').insert(msg).select();
      if (data) setMessages(prev => [...prev, ...data]);
      if (selectedClipTitle && selectedClipTitle.includes('견적') && onConfirmSent) onConfirmSent(normalPhone);
      setMsgInput('');
      setSelectedClipTitle(null);
      if (textareaRef.current) textareaRef.current.style.height = '72px';
      setCustomers(prev => prev.map(c => c.phone === selected ? { ...c, latest: new Date().toISOString(), latestText: msgInput.trim() } : c));
    } catch (e) {
      console.error('[SMS Send Error]', e);
      alert('문자 전송에 실패했습니다.');
    } finally {
      setIsSending(false);
    }
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
    <>
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,...(smsDragPos?{pointerEvents:'none'}:{})}}>
      <div ref={popupRef} style={{width:700,height:'80vh',minWidth:600,minHeight:500,maxWidth:'95vw',maxHeight:'95vh',background:'#fff',borderRadius:12,overflow:'hidden',display:'flex',boxShadow:'0 8px 32px rgba(0,0,0,0.18)',resize:'both',...(smsDragPos?{position:'fixed',top:smsDragPos.y,left:smsDragPos.x,margin:0,pointerEvents:'auto'}:{})}} onClick={e => e.stopPropagation()}>
        {/* 좌측: 고객 목록 */}
        <div style={{width:280,flexShrink:0,display:'flex',flexDirection:'column',borderRight:'1px solid #EAECF2'}}>
          <div style={{background:'#185FA5',padding:'14px 16px',display:'flex',alignItems:'flex-start',justifyContent:'space-between',cursor:'grab'}} onMouseDown={onSmsDragDown}>
            <div>
              <div style={{fontSize:16,fontWeight:500,color:'#fff'}}>문자함</div>
              <div style={{fontSize:12,color:'rgba(255,255,255,0.6)'}}>{customers.reduce((s,c) => s + c.unread, 0)}건 새 문자</div>
            </div>
            <button onClick={onClose} style={{width:32,height:32,borderRadius:'50%',background:'rgba(255,255,255,0.2)',color:'#fff',border:'none',fontSize:18,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>✕</button>
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
                        <div style={{padding:'10px 14px',borderRadius: isOut ? '14px 14px 4px 14px' : '14px 14px 14px 4px', background:isOut?'#185FA5':'#fff',color:isOut?'#fff':'#1A1D23',fontSize:14,lineHeight:1.5,border:isOut?'none':'0.5px solid #DDE1EB'}}>
                          {m.media_url && (
                            <div style={{marginBottom: m.content ? 6 : 0}}>
                              <img src={m.media_url} alt="MMS 이미지" style={{maxWidth:240,borderRadius:8,cursor:'pointer',display:'block'}}
                                onClick={() => window.open(m.media_url, '_blank')}
                                onError={e => { e.target.style.display='none'; e.target.nextSibling && (e.target.nextSibling.style.display='block'); }}
                              /><span style={{display:'none',fontSize:11,color:isOut?'rgba(255,255,255,0.6)':'#9BA3B2'}}>이미지를 불러올 수 없습니다</span>
                            </div>
                          )}
                          {m.content}
                        </div>
                        <div style={{fontSize:11,color:'#9BA3B2',marginTop:2,textAlign:isOut?'right':'left'}}>{new Date(m.sent_at).toLocaleString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</div>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && <div style={{textAlign:'center',color:'#9BA3B2',fontSize:13,padding:'40px 0'}}>문자 내역이 없습니다</div>}
              </div>
              {/* 클립보드 */}
              <div style={{borderTop:'0.5px solid #DDE1EB',padding:'10px 16px',background:'#F4F6FA',flexShrink:0}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                  <span style={{fontSize:12,fontWeight:600,color:'#5A6070'}}>클립보드</span>
                  <button onClick={() => setClipModal(true)} style={{display:'inline-flex',padding:'3px 10px',borderRadius:4,fontSize:11,fontWeight:600,background:'#E6F1FB',color:'#0C447C',cursor:'pointer',border:'none',fontFamily:'inherit'}}>수정</button>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:6}}>
                  {clipboards.map((c, i) => (
                    <button key={i} className="cp-clipboard-btn" style={{background: c.color || '#E6F1FB', color: CLIP_TEXT_COLORS[c.color] || '#0C447C'}}
                      onClick={() => { setMsgInput(c.content); setSelectedClipTitle(c.title); if (textareaRef.current) { textareaRef.current.focus(); setTimeout(autoResizeTextarea, 0); } }}>
                      {c.title}
                    </button>
                  ))}
                </div>
              </div>
              {/* 입력 영역 */}
              <div style={{flexShrink:0}}>
                <div style={{padding:'0 12px 2px',fontSize:11,color:'#CC2222'}}>*Shift+Enter = 텍스트 줄바꿈됩니다</div>
                <div className="cp-chat-input">
                  <textarea ref={textareaRef} rows={3} value={msgInput} onChange={e => { setMsgInput(e.target.value); autoResizeTextarea(); }} placeholder="메시지 입력..." onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} />
                  <button className="btn-primary cp-send-btn" onClick={handleSend} disabled={isSending}>{isSending ? '전송 중...' : '전송'}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    {clipModal && <ClipboardEditModal clipboards={clipboards} colors={CLIP_COLORS} textColors={CLIP_TEXT_COLORS} onSave={(items) => { saveClipboards(items); setClipModal(false); }} onClose={() => setClipModal(false)} />}
    </>
  );
}
