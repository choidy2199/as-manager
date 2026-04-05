import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function toLocal(phone) {
  if (!phone) return '';
  const d = phone.replace(/[^0-9]/g, '');
  if (d.startsWith('82')) return '0' + d.slice(2);
  return d;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const phone = body.data?.contact || body.data?.from || '';
    const content = body.data?.content || body.data?.body || '';
    const sentAt = body.data?.received_at || new Date().toISOString();
    const localPhone = toLocal(phone);

    if (localPhone && content) {
      await supabase.from('sms_messages').insert({
        phone: localPhone,
        direction: 'incoming',
        content: content,
        sent_at: sentAt,
      });
    }

    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}
