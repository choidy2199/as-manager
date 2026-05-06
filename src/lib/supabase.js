'use client';
import { createClient } from '@supabase/supabase-js';

// 인증용 클라이언트 - Daehan-Seoul (5명 통합 인증 마스터)
const authUrl = (process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL || '').trim();
const authKey = (process.env.NEXT_PUBLIC_SUPABASE_AUTH_ANON_KEY || '').trim();
export const sbAuth = createClient(authUrl, authKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'sb-auth-daehan-seoul',
    flowType: 'implicit',
  },
});

// 데이터용 클라이언트 - as-manager 자체 (기존 그대로)
const dataUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const dataKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
export const sbData = createClient(dataUrl, dataKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    storageKey: 'sb-data-as-manager',
  },
});

// 하위 호환: 기존 import { supabase } 사용 코드를 위한 alias
export const supabase = sbData;
