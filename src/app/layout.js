import './globals.css';

export const metadata = {
  title: 'AS Manager — 콜라보 콤프레샤',
  description: '콜라보 콤프레샤 AS 관리 시스템',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
