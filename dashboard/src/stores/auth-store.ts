import { supabase } from '../services/supabase.js';
import type { User, Session } from '@supabase/supabase-js';

type AuthCallback = (isAuthenticated: boolean) => void;

class AuthStore {
  private _user: User | null = null;
  private _session: Session | null = null;
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

  async initialize(): Promise<void> {
    if (this._initialized) return;

    // Get current session
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      this._session = session;
      this._user = session.user;
      this._isAllowed = await this.checkAllowedUser(session.user.email);
    }

    // Listen for auth changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      this._session = session;
      this._user = session?.user ?? null;

      if (session?.user?.email) {
        this._isAllowed = await this.checkAllowedUser(session.user.email);
      } else {
        this._isAllowed = false;
      }

      this.notifyListeners();
    });

    this._initialized = true;
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

  async signInWithGoogle(): Promise<{ error?: string }> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
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
