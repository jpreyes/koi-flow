// ─────────────────────────────────────────────────────────────────────────────
// config.js — configuración del backend Supabase (koi-flow, Fase A).
// La URL y la PUBLISHABLE key son PÚBLICAS por diseño: van en el frontend y la
// seguridad real la da la Row-Level Security (RLS) de Postgres. La `secret` key
// (sb_secret_…) JAMÁS va acá ni en ningún archivo del frontend.
// ─────────────────────────────────────────────────────────────────────────────
export const SUPABASE_URL = 'https://wmmqpiztnrjdrfvvzgor.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_abDlW1kH5bNMRV5Pb4kIGw_HjgCqbEr';

export const AUTH_URL = `${SUPABASE_URL}/auth/v1`;       // GoTrue (registro/login/reset)
export const REST_URL = `${SUPABASE_URL}/rest/v1`;       // PostgREST (tablas: orgs/projects)
export const STORAGE_URL = `${SUPABASE_URL}/storage/v1`; // Storage (binarios .koi)
