import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function toE164(p) {
  if (!p) return '';
  const d = String(p).replace(/[^0-9]/g, '');
  if (d.startsWith('0')) return '+82' + d.slice(1);
  if (d.startsWith('82')) return '+' + d;
  return '+' + d;
}

function cleanJsonb(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.replace(/^"|"$/g, '');
  return String(v).replace(/^"|"$/g, '');
}

export async function POST(request) {
  try {
    const { to, content } = await request.json();

    const { data: apiKeySetting, error: e1 } = await supabase.from('settings').select('value').eq('key', 'httpsms_api_key').single();
    const { data: phoneSetting, error: e2 } = await supabase.from('settings').select('value').eq('key', 'httpsms_phone').single();

    console.log('[SMS] apiKey query:', apiKeySetting?.value, 'error:', e1?.message);
    console.log('[SMS] phone query:', phoneSetting?.value, 'error:', e2?.message);

    if (!apiKeySetting?.value || !phoneSetting?.value) {
      return Response.json({ error: `SMS 설정이 필요합니다 (apiKey: ${!!apiKeySetting?.value}, phone: ${!!phoneSetting?.value})` }, { status: 400 });
    }

    const apiKey = String(apiKeySetting.value).replace(/^"|"$/g, '');
    const fromPhone = toE164(String(phoneSetting.value).replace(/^"|"$/g, ''));
    const toPhone = toE164(to);

    console.log('[SMS] sending from:', fromPhone, 'to:', toPhone, 'apiKey length:', apiKey.length);

    const response = await fetch('https://api.httpsms.com/v1/messages/send', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ content, from: fromPhone, to: toPhone }),
    });

    const result = await response.json();

    if (!response.ok) {
      return Response.json({ error: result.message || '발송 실패' }, { status: response.status });
    }

    return Response.json({ success: true, data: result });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
