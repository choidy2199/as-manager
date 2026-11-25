'use client';
// Preview only. There is no network database, password, API key or shared storage.
const session = { user: { id: 'synthetic-reviewer', email: 'reviewer@example.invalid' } };
export const sbAuth = { auth: {
  getSession: async () => ({ data: { session } }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  signOut: async () => ({ error: null }),
}};

const orderA = 'synthetic-order-a';
const orderB = 'synthetic-order-b';
const orderC = 'synthetic-order-c';
const names = ['메인보드', '압력 스위치', '흡입 필터', '체크 밸브', '조절기', '안전 밸브', '압력계', '연결 니플', '드레인 밸브', '고무 받침', '전원 스위치', '모터 덮개'];
const parts = Array.from({ length: 32 }, (_, i) => ({
  id: `synthetic-part-${i+1}`, code: `DEMO-${String(i+1).padStart(2, '0')}`,
  name: i < names.length ? names[i] : `검수용 부품 ${i+1}`, spec: `SAMPLE-${i+1}`,
  price: 1500 + i*100, big_category: i < 12 ? '검수용 A' : '검수용 B', category: '샘플',
}));
const makeOrder = (id, n, order_name, status) => ({ id, order_name, status,
  order_no: status === 'confirmed' ? `20261125-00${n}` : null,
  created_at: `2026-11-25T0${n}:00:00.000Z`, updated_at: `2026-11-25T0${n}:00:00.000Z`,
  confirmed_at: status === 'confirmed' ? `2026-11-25T0${n}:00:00.000Z` : null,
});
const makeItems = (order_id, n, some) => parts.slice(0,n).map((p,i) => ({
  id: `${order_id}-${i+1}`, order_id, part_id: p.id, quantity: i === 0 ? 50 : 10 + i,
  price_snapshot: p.price, sort_order: i, received_qty: some && i < 2 ? (i === 0 ? 45 : 9) : null,
  receive_note: some && i === 1 ? '검수용 비고' : null, receive_op: null,
}));
const seed = {
  parts, parts_orders: [makeOrder(orderA,3,'검수용 · 부분 입고','confirmed'),
    makeOrder(orderB,2,'검수용 · 체크리스트 32종','confirmed'), makeOrder(orderC,1,'검수용 · 작성중','draft')],
  parts_order_items: [...makeItems(orderA,10,true), ...makeItems(orderB,32,false), ...makeItems(orderC,3,false)],
};
const storageKey = 'as-manager-preview-receipts-20261125-v1';
let memory;
function overrides() {
  if (memory) return memory;
  try { memory = JSON.parse(window.sessionStorage.getItem(storageKey) || '{}'); }
  catch { memory = {}; }
  return memory;
}
const fail = (message, code = 'PREVIEW') => ({ data: null, error: { message, code }, count: null });
class Query {
  constructor(table) { this.table = table; this.filters = []; this.orders = []; }
  select(fields = '*', options = {}) { this.fields = fields; this.options = options; return this; }
  order(field, {ascending = true} = {}) { this.orders.push([field, ascending]); return this; }
  eq(k,v) { this.filters.push(r => Object.is(r[k], v)); return this; }
  is(k,v) { this.filters.push(r => Object.is(r[k] ?? null, v)); return this; }
  in(k,vs) { this.filters.push(r => vs.includes(r[k])); return this; }
  gte(k,v) { this.filters.push(r => r[k] >= v); return this; }
  lte(k,v) { this.filters.push(r => r[k] <= v); return this; }
  like(k,v) { const term = String(v).replace(/^%|%$/g,''); this.filters.push(r => String(r[k] ?? '').includes(term)); return this; }
  ilike(k,v) { const term = String(v).replace(/^%|%$/g,'').toLowerCase(); this.filters.push(r => String(r[k] ?? '').toLowerCase().includes(term)); return this; }
  not(k,_,v) { this.filters.push(r => !Object.is(r[k] ?? null, v)); return this; }
  range(from,to) { this.slice = [from,to+1]; return this; }
  limit(n) { this.slice = [0,n]; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { return this.single(); }
  abortSignal(signal) { this.signal = signal; return this; }
  update(patch) { this.patch = patch; return this; }
  insert() { this.block = true; return this; }
  upsert() { this.block = true; return this; }
  delete() { this.block = true; return this; }
  then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject); }
  run() {
    if (this.signal?.aborted) return fail('Aborted');
    if (this.block) return fail('검수판에서는 입고 수량과 비고 저장만 지원합니다.');
    const local = this.table === 'parts_order_items' ? overrides() : {};
    let rows = (seed[this.table] || []).map(r => ({ ...r, ...(local[r.id] || {}) }));
    rows = rows.filter(r => this.filters.every(fn => fn(r)));
    if (this.patch) {
      const allowed = ['received_qty','receive_note','receive_op'];
      if (this.table !== 'parts_order_items' || !this.patch.receive_op || !Object.keys(this.patch).every(k => allowed.includes(k)) || !this.filters.length)
        return fail('검수판에서는 입고 수량과 비고 저장만 지원합니다.');
      if (rows.some(r => seed.parts_orders.find(o => o.id === r.order_id)?.status !== 'confirmed'))
        return fail('확정된 발주만 입고를 기록할 수 있습니다.', 'P0001');
      const qty = this.patch.received_qty;
      if (qty != null && (!Number.isInteger(qty) || qty < 0 || qty > 999999)) return fail('수량 범위를 확인해 주세요.');
      rows = rows.map(r => {
        local[r.id] = { ...(local[r.id] || {}), ...this.patch };
        return { ...r, ...this.patch };
      });
      try { window.sessionStorage.setItem(storageKey, JSON.stringify(local)); } catch {}
    }
    const count = this.options?.count ? rows.length : null;
    rows.sort((a,b) => {
      for (const [k,asc] of this.orders) { if (a[k] !== b[k]) return (a[k] > b[k] ? 1 : -1) * (asc ? 1 : -1); }
      return 0;
    });
    if (this.slice) rows = rows.slice(...this.slice);
    if (this.fields && this.fields !== '*') {
      const keys = this.fields.split(',').map(s => s.trim());
      rows = rows.map(r => Object.fromEntries(keys.map(k => [k,r[k]])));
    }
    return { data: this.options?.head ? null : this.one ? rows[0] ?? null : rows, error: null, count };
  }
}
export const sbData = {
  from: table => new Query(table),
  channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch; },
  getChannels: () => [], removeChannel: async () => 'ok',
  storage: { from: () => ({ upload: async () => fail('검수판에서는 파일을 업로드하지 않습니다.'), getPublicUrl: () => ({ data: { publicUrl: null } }) }) },
};
export const supabase = sbData;
