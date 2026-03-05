import { supabase } from '../services/supabase.js';
import type { User, Session } from '@supabase/supabase-js';

type AuthCallback = (isAuthenticated: boolean) => void;

const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

class AuthStore {
  private _user: User | null = null;
  private _session: Session | null = null;
  private _providerToken: string | null = null;
  private _isAllowed = false;
  private _initialized = false;
  private _listeners: AuthCallback[] = [];

  get user(): User | null {
    return this._user;
  }

  get session(): Session | null {
    return this._session;
  }

  get isAuthenticated(): boolean {
    return this._user !== null && this._isAllowed;
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  get userEmail(): string | null {
    return this._user?.email ?? null;
  }

  get providerToken(): string | null {
    return this._providerToken;
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      // 用 raw fetch 驗證 session 是否仍然有效
      // 繞過 Supabase client，避免 client 內部 token refresh lock 卡住
      const validSession = await this.validateSession(session);

      if (!validSession) {
        console.warn('[Auth] Session expired, clearing');
        this.clearLocalStorage();
        this._initialized = true;
        return;
      }

      this._session = validSession;
      this._user = validSession.user;
      this._isAllowed = await this.checkAllowedUser(validSession.user.email);
    }

    // 初始 session 也可能含 provider_token（從 localStorage 恢復）
    if (this._session?.provider_token) {
      this._providerToken = this._session.provider_token;
    }

    // Listen for auth changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      this._session = session;
      this._user = session?.user ?? null;

      // 保存 provider_token（只在 SIGNED_IN 時出現）
      if (session?.provider_token) {
        this._providerToken = session.provider_token;
      }

      // TOKEN_REFRESHED 只是 JWT 刷新，不需要重新查詢 allowed_users
      if (event === 'TOKEN_REFRESHED') {
        return;
      }

      try {
        if (session?.user?.email) {
          this._isAllowed = await this.checkAllowedUser(session.user.email);
        } else {
          this._isAllowed = false;
        }
      } catch (error) {
        console.error('Auth state change error:', error);
        return;
      }

      this.notifyListeners();
    });

    this._initialized = true;
  }

  /**
   * 用 raw fetch 驗證 session（繞過 Supabase client 避免 lock）
   * 返回有效的 session 或 null
   */
  private async validateSession(session: Session): Promise<Session | null> {
    try {
      // 1. 用 access token 驗證
      const resp = await fetch('/auth/v1/user', {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (resp.ok) return session;

      // 2. Access token 無效，嘗試 refresh
      if (resp.status === 401 && session.refresh_token) {
        const refreshResp = await fetch('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ refresh_token: session.refresh_token }),
        });

        if (refreshResp.ok) {
          const tokens = await refreshResp.json();
          // 用新 token 更新 Supabase client
          await supabase.auth.setSession({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
          });
          // 重新取得更新後的 session
          const { data } = await supabase.auth.getSession();
          return data.session;
        }
      }

      return null;
    } catch {
      // 網路錯誤，給予 benefit of the doubt
      return session;
    }
  }

  private async checkAllowedUser(email: string | undefined): Promise<boolean> {
    if (!email) return false;

    const { data, error } = await supabase
      .from('allowed_users')
      .select('is_active')
      .eq('email', email)
      .single();

    if (error || !data) return false;
    return data.is_active === true;
  }

  /**
   * 清除所有 Supabase 相關的 localStorage
   * 直接操作 localStorage 避免 supabase.auth.signOut() 也卡住
   */
  private clearLocalStorage(): void {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('sb-'))
      .forEach((k) => localStorage.removeItem(k));
    this._session = null;
    this._user = null;
    this._isAllowed = false;
  }

  async signInWithGoogle(): Promise<{ error?: string }> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: 'https://www.googleapis.com/auth/drive.readonly',
      },
    });

    if (error) {
      return { error: error.message };
    }

    return {};
  }

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
    this._user = null;
    this._session = null;
    this._isAllowed = false;
    this.notifyListeners();
  }

  subscribe(callback: AuthCallback): () => void {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== callback);
    };
  }

  private notifyListeners(): void {
    for (const listener of this._listeners) {
      listener(this.isAuthenticated);
    }
  }
}

export const authStore = new AuthStore();
