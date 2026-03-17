import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getSupabase } from './supabase.js';

let initialized = false;

function initFirebase() {
  if (initialized) return;

  let serviceAccount: admin.ServiceAccount;

  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
      const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
        || resolve(process.cwd(), 'firebase-service-account.json');
      serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Firebase] Failed to load service account:', msg);
    throw new Error(`Firebase initialization failed: ${msg}`);
  }

  if (!serviceAccount.projectId && !(serviceAccount as any).project_id) {
    throw new Error('Firebase service account missing project_id');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  initialized = true;
}

/**
 * 儲存 FCM token
 */
export async function subscribeToken(token: string) {
  initFirebase();

  const { error } = await getSupabase()
    .from('push_subscriptions')
    .upsert({ token, active: true, updated_at: new Date().toISOString() }, { onConflict: 'token' });

  if (error) throw error;
  return { success: true };
}

/**
 * 停用 FCM token
 */
export async function unsubscribeToken(token: string) {
  const { error } = await getSupabase()
    .from('push_subscriptions')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('token', token);

  if (error) throw error;
  return { success: true };
}

/**
 * 發送推播通知給所有訂閱者
 */
export async function sendPushNotification(options: {
  title: string;
  body: string;
  url?: string;
}) {
  initFirebase();

  const { data: subs, error } = await getSupabase()
    .from('push_subscriptions')
    .select('token')
    .eq('active', true);

  if (error) throw error;
  if (!subs || subs.length === 0) return { sent: 0, failed: 0 };

  const tokens = subs.map((s: any) => s.token);

  // 只使用 data payload（不用 notification payload）
  // 避免背景時瀏覽器自動顯示 + onBackgroundMessage 手動顯示 = 雙重通知
  const message: admin.messaging.MulticastMessage = {
    tokens,
    data: {
      title: options.title,
      body: options.body,
      url: options.url || '/',
    },
  };

  const response = await admin.messaging().sendEachForMulticast(message);

  // 記錄失敗原因並清理無效 token
  const invalidTokens: string[] = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success) {
      console.error(`[Push] Token ${idx} failed:`, resp.error?.code, resp.error?.message);
      if (resp.error?.code === 'messaging/registration-token-not-registered') {
        invalidTokens.push(tokens[idx]);
      }
    }
  });

  if (invalidTokens.length > 0) {
    await getSupabase()
      .from('push_subscriptions')
      .update({ active: false, updated_at: new Date().toISOString() })
      .in('token', invalidTokens);
  }

  return {
    sent: response.successCount,
    failed: response.failureCount,
  };
}
