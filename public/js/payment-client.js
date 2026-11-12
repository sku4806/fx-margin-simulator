/**
 * 📑 payment-client.js
 * BigShine Korea 경비 정산 및 전자결재 전용 Supabase 클라이언트 (Project 2: omtcanlmnpbiqoiakylp)
 * ERP 메인 DB(fx-margin-simulator)와 영수증 스토리지 및 전표 DB를 분리하여 운영 (방안 A)
 */

export const PAYMENT_SUPABASE_URL = 'https://omtcanlmnpbiqoiakylp.supabase.co';
export const PAYMENT_SUPABASE_KEY = 'sb_publishable_80MMaw7IKefD7v2lx8PgeA_eWuX2Yeq';
export const ADMIN_PIN = '7788';

export const paymentSupabase = (typeof window !== 'undefined' && window.supabase)
  ? window.supabase.createClient(PAYMENT_SUPABASE_URL, PAYMENT_SUPABASE_KEY)
  : null;

if (typeof window !== 'undefined') {
  window.paymentSupabase = paymentSupabase;
}
