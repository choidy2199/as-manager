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

// jsonb 문자열에서 깨끗한 값 추출
function extract(v) {
  if (v === null || v === undefined) return '';
  // Supabase JS는 jsonb string을 JS string으로 반환 (따옴표 이미 제거)
  // 하지만 만약 따옴표가 남아있으면 제거
  let s = typeof v === 'string' ? v : JSON.stringify(v);
  s = s.replace(/^"+|"+$/g, ''); // 앞뒤 모든 따옴표 제거
  return s.trim();
}

export async function POST(request) {
  try {
    const { to, content } = await request.json();

    const { data: apiKeySetting, error: e1 } = await supabase.from('settings').select('value').eq('key', 'httpsms_api_key').single();
    const { data: phoneSetting, error: e2 } = await supabase.from('settings').select('value').eq('key', 'httpsms_phone').single();

    const apiKey = extract(apiKeySetting?.value);
    const fromPhone = toE164(extract(phoneSetting?.value));
    const toPhone = toE164(to);

    console.log('=== SMS DEBUG ===');
    console.log('raw apiKey:', JSON.stringify(apiKeySetting?.value), 'err:', e1?.message);
    console.log('raw phone:', JSON.stringify(phoneSetting?.value), 'err:', e2?.message);
    console.log('cleaned apiKey:', apiKey.substring(0, 15) + '..., len=' + apiKey.length);
    console.log('from:', fromPhone, 'to:', toPhone);
    console.log('=================');

    if (!apiKey || !fromPhone) {
      return Response.json({ error: `SMS 설정 필요 (key:${apiKey.length > 0}, phone:${fromPhone.length > 0}, e1:${e1?.message}, e2:${e2?.message})` }, { status: 400 });
    }

    const response = await fetch('https://api.httpsms.com/v1/messages/send', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ content, from: fromPhone, to: toPhone }),
    });

    const result = await response.json();
    console.log('[SMS] httpSMS response:', response.status, JSON.stringify(result).substring(0, 200));

    if (!response.ok) {
      return Response.json({ error: result.message || JSON.stringify(result) }, { status: response.status });
    }

    return Response.json({ success: true, data: result });
  } catch (error) {
    console.error('[SMS] error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
