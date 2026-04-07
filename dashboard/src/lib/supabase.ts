import { createClient } from '@supabase/supabase-js';

// Substitua pelos seus dados do painel do Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://seu-projeto.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'seu-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
