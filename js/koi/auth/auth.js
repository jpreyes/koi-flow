// ─────────────────────────────────────────────────────────────────────────────
// auth.js — autenticación de koi-flow contra Supabase (GoTrue) por fetch PURO.
// Sin la librería supabase-js: el frontend sigue vanilla, sin build ni npm.
// Maneja registro / login / logout / reset, persiste la sesión en localStorage y
// refresca el token antes de que venza. La seguridad de datos la da la RLS.
// ─────────────────────────────────────────────────────────────────────────────
import { AUTH_URL, SUPABASE_KEY } from './config.js?v=13';

const SKEY = 'koi_session';
let _session = _cargar();
const _subs = new Set();
let _timer = null;

function _cargar() { try { return JSON.parse(localStorage.getItem(SKEY)) || null; } catch { return null; } }
function _guardar(s) {
  _session = s || null;
  if (_session) localStorage.setItem(SKEY, JSON.stringify(_session));
  else localStorage.removeItem(SKEY);
  _programarRefresh();
  for (const fn of _subs) { try { fn(_session); } catch {} }
}

// Suscripción al estado de sesión (para pintar la UI). Llama de una con el estado actual.
export function onAuth(fn) { _subs.add(fn); try { fn(_session); } catch {} return () => _subs.delete(fn); }
export function sesion() { return _session; }
export function usuario() { return _session?.user || null; }
export function estaAutenticado() { return !!(_session && _session.access_token); }

// Llamada base a GoTrue. Traduce el error de Supabase a un mensaje humano.
async function _req(path, { method = 'POST', body, token, params } = {}) {
  const url = new URL(AUTH_URL + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {}; try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || data.error || `Error ${res.status}`);
  return data;
}

function _setFromToken(t) {
  const now = Math.floor(Date.now() / 1000);
  _guardar({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: t.expires_at || (now + (t.expires_in || 3600)),
    user: t.user || null,
  });
}

// Registro. Con "Confirm email" ON, NO devuelve sesión hasta que el usuario confirma.
export async function registrar(email, password) {
  const data = await _req('/signup', { body: { email, password } });
  if (data.access_token) _setFromToken(data);
  return { user: data.user || data, necesitaConfirmar: !data.access_token };
}

export async function login(email, password) {
  const data = await _req('/token', { params: { grant_type: 'password' }, body: { email, password } });
  _setFromToken(data);
  return _session;
}

export async function logout() {
  try { if (_session?.access_token) await _req('/logout', { token: _session.access_token }); } catch {}
  _guardar(null);
}

export async function resetPassword(email) { await _req('/recover', { body: { email } }); }

export async function refrescar() {
  if (!_session?.refresh_token) return null;
  try {
    const data = await _req('/token', { params: { grant_type: 'refresh_token' }, body: { refresh_token: _session.refresh_token } });
    _setFromToken(data);
    return _session;
  } catch { _guardar(null); return null; }   // refresh inválido → sesión caída
}

// Devuelve un access_token válido (refresca si está por vencer) para REST/Storage.
export async function tokenValido() {
  if (!_session) return null;
  if ((_session.expires_at * 1000) - Date.now() < 60000) await refrescar();
  return _session?.access_token || null;
}

function _programarRefresh() {
  clearTimeout(_timer);
  if (!_session?.expires_at) return;
  const ms = (_session.expires_at * 1000) - Date.now() - 60000;   // 1 min antes de vencer
  _timer = setTimeout(refrescar, Math.max(5000, ms));
}

if (_session) _programarRefresh();   // al cargar, reprograma (y refresca si tocaba)
if (typeof window !== 'undefined') window.__koiAuth = { sesion, usuario, estaAutenticado, logout };
