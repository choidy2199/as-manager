import './globals.css';
export const metadata = {
  title: 'AS Manager 입고체크 검수판',
  description: '합성 데이터만 사용하는 입고체크 검수판',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }) {
  return (
    <html lang="ko"><body>
      <div style={{position:'fixed',right:12,bottom:12,zIndex:10001,pointerEvents:'none',borderRadius:5,padding:'5px 9px',background:'#185FA5',color:'#fff',font:'600 12px system-ui'}}>입고체크 검수용 · 가상 데이터</div>
      {children}
    </body></html>
  );
}
