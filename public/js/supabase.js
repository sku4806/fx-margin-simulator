const SUPABASE_PROJECT_URL = 'https://qheijtepveajdrqerxef.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_0TB2JQq4BVfvihySxCbbkw_v4ZRAF80';

export const sbClient = window.supabase ? window.supabase.createClient(SUPABASE_PROJECT_URL, SUPABASE_ANON_KEY) : null;

export async function getCurrentSession() {
  if (!sbClient) return null;
  const { data: { session } } = await sbClient.auth.getSession();
  return session;
}

export async function loginWithEmail(email, password) {
  if (!sbClient) throw new Error("Supabase 클라이언트가 초기화되지 않았습니다.");
  return await sbClient.auth.signInWithPassword({ email, password });
}

export async function logout() {
  if (!sbClient) return;
  return await sbClient.auth.signOut();
}

export async function updatePassword(newPassword) {
  if (!sbClient) throw new Error("인증 클라이언트가 없습니다.");
  return await sbClient.auth.updateUser({ password: newPassword });
}

export function subscribeAuthChange(callback) {
  if (!sbClient) return;
  sbClient.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}
