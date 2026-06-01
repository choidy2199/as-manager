import './globals.css';

export const metadata = {
  title: 'AS Manager — 콜라보 콤프레샤',
  description: '콜라보 콤프레샤 AS 관리 시스템',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
