export async function POST() {
  return Response.json({ error: '검수판에서는 문자 발송이나 수신을 처리하지 않습니다.' }, { status: 403 });
}
