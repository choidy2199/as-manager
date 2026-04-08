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
    console.log('[SMS Webhook] received:', JSON.stringify(body).substring(0, 500));

    // 수신 메시지만 저장 (발신/배달완료/실패 등은 무시)
    if (body.type && body.type !== 'message.phone.received') {
      console.log('[SMS Webhook] skipped non-receive event:', body.type);
      return Response.json({ success: true });
    }

    const phone = body.data?.contact || body.data?.from || '';
    const content = body.data?.content || body.data?.body || '';
    const sentAt = body.data?.timestamp || body.data?.received_at || new Date().toISOString();
    const localPhone = toLocal(phone);

    // MMS 이미지 URL 추출 (httpSMS 향후 MMS 지원 대비 + 타 서비스 호환)
    const mediaUrl = body.data?.media_url || body.data?.media?.[0]?.url || body.data?.attachments?.[0]?.url || null;

    console.log('[SMS Webhook] parsed:', { type: body.type, phone, localPhone, contentLen: content.length, sentAt, hasMedia: !!mediaUrl });

    if (localPhone && (content || mediaUrl)) {
      const row = {
        phone: localPhone,
        direction: 'incoming',
        content: content || '',
        sent_at: sentAt,
      };
      if (mediaUrl) row.media_url = mediaUrl;
      const { error } = await supabase.from('sms_messages').insert(row);
      if (error) console.error('[SMS Webhook] DB insert error:', error);
      else console.log('[SMS Webhook] saved incoming from', localPhone);
    } else {
      console.warn('[SMS Webhook] skipped: no phone or content/media');
    }

    return Response.json({ success: true });
  } catch (e) {
    console.error('[SMS Webhook] error:', e);
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}
