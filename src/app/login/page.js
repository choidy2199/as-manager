'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError('이메일 또는 비밀번호가 올바르지 않습니다.');
    else window.location.href = '/';
    setLoading(false);
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-title">AS Manager</div>
        <div className="login-sub">콜라보 콤프레샤 AS 관리 시스템</div>
        <form onSubmit={handleLogin}>
          <div className="login-input">
            <input className="input" type="email" placeholder="이메일" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="login-input">
            <input className="input" type="password" placeholder="비밀번호" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary login-btn" disabled={loading}>
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}
