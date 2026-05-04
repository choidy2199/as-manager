'use client';
import { useState, useEffect } from 'react';
import { sbAuth } from '@/lib/supabase';

export default function LoginPage() {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveId, setSaveId] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);

  useEffect(() => {
    const savedId = localStorage.getItem('as_saved_id');
    const savedCheck = localStorage.getItem('as_save_id_checked');
    if (savedCheck === 'true' && savedId) {
      setUserId(savedId);
      setSaveId(true);
    }
    const autoChecked = localStorage.getItem('as_auto_login');
    if (autoChecked === 'true') {
      setAutoLogin(true);
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const email = userId.includes('@') ? userId : userId + '@daehantool.dev';

    if (saveId) {
      localStorage.setItem('as_saved_id', userId);
      localStorage.setItem('as_save_id_checked', 'true');
    } else {
      localStorage.removeItem('as_saved_id');
      localStorage.setItem('as_save_id_checked', 'false');
    }

    localStorage.setItem('as_auto_login', autoLogin ? 'true' : 'false');

    // 1) Daehan-Seoul Auth로 로그인
    const { data: signInData, error: signInError } = await sbAuth.auth.signInWithPassword({ email, password });
    if (signInError || !signInData?.user) {
      setError('아이디 또는 비밀번호가 올바르지 않습니다.');
      setLoading(false);
      return;
    }

    // 2) user_site_access에서 as_manager 권한 확인
    const { data: access, error: accessError } = await sbAuth
      .from('user_site_access')
      .select('site')
      .eq('user_id', signInData.user.id)
      .eq('site', 'as_manager')
      .maybeSingle();

    if (accessError) {
      console.error('권한 조회 실패:', accessError);
      await sbAuth.auth.signOut();
      setError('권한 확인 중 오류가 발생했습니다. 관리자에게 문의하세요.');
      setLoading(false);
      return;
    }

    if (!access) {
      await sbAuth.auth.signOut();
      setError('AS매니저 접근 권한이 없습니다.');
      setLoading(false);
      return;
    }

    // 3) 권한 있으면 메인으로
    window.location.href = '/';
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-title">AS Manager</div>
        <div className="login-sub">콜라보 콤프레샤 AS 관리 시스템</div>
        <form onSubmit={handleLogin}>
          <div className="login-input">
            <input className="input" type="text" placeholder="아이디" value={userId} onChange={e => setUserId(e.target.value)} required autoComplete="off" />
          </div>
          <div className="login-input">
            <input className="input" type="password" placeholder="비밀번호" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <div className="login-options">
            <label className="login-check">
              <input type="checkbox" checked={saveId} onChange={e => setSaveId(e.target.checked)} />
              <span>아이디 저장</span>
            </label>
            <label className="login-check">
              <input type="checkbox" checked={autoLogin} onChange={e => setAutoLogin(e.target.checked)} />
              <span>자동 로그인</span>
            </label>
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
