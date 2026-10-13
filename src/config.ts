declare global {
  interface ImportMeta {
    env: {
      IMMOZEN_ENV: string;
      IMMOZEN_SUPABASE_URL: string;
      IMMOZEN_SUPABASE_ANON_KEY: string;
    };
  }
}

const env = (typeof import.meta !== 'undefined' && import.meta.env) || { IMMOZEN_ENV: 'development', IMMOZEN_SUPABASE_URL: '', IMMOZEN_SUPABASE_ANON_KEY: '' };

export const config = {
  env: env.IMMOZEN_ENV as 'development' | 'test' | 'production',
  supabaseUrl: env.IMMOZEN_SUPABASE_URL,
  supabaseAnonKey: env.IMMOZEN_SUPABASE_ANON_KEY,
};

/** Mode démonstration : aucun projet Supabase configuré, ou ?demo dans l'URL hors production. */
export function isDemoMode(): boolean {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return true;
  return config.env !== 'production' && new URLSearchParams(location.search).has('demo');
}
