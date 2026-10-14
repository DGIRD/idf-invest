declare global {
  interface ImportMeta {
    env: {
      IMMOZEN_ENV: string;
      IMMOZEN_SUPABASE_URL: string;
      IMMOZEN_SUPABASE_ANON_KEY: string;
    };
  }
}

// Chaque valeur doit être écrite en entier (import.meta.env.NOM) : le build remplace
// exactement ces expressions par leur valeur. Ne pas lire import.meta.env globalement.
export const config = {
  env: import.meta.env.IMMOZEN_ENV as 'development' | 'test' | 'production',
  supabaseUrl: import.meta.env.IMMOZEN_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.IMMOZEN_SUPABASE_ANON_KEY,
};

/** Mode démonstration : aucun projet Supabase configuré, ou ?demo dans l'URL hors production. */
export function isDemoMode(): boolean {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return true;
  return config.env !== 'production' && new URLSearchParams(location.search).has('demo');
}
