import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const autoLogin = typeof window !== 'undefined' && localStorage.getItem('as_auto_login') === 'true';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: autoLogin,
    autoRefreshToken: autoLogin,
  }
});
