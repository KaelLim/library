export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

type ToastCallback = (toasts: Toast[]) => void;

class ToastStore {
  private _toasts: Toast[] = [];
  private _listeners: ToastCallback[] = [];
  private _idCounter = 0;

  get toasts(): Toast[] {
    return [...this._toasts];
  }

  show(type: ToastType, message: string, duration = 5000): string {
    const id = `toast-${++this._idCounter}`;
    const toast: Toast = { id, type, message, duration };

    this._toasts = [...this._toasts, toast];
    this.notifyListeners();

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        this.remove(id);
      }, duration);
    }

    return id;
  }

  success(message: string, duration?: number): string {
    return this.show('success', message, duration);
  }

  error(message: string, duration?: number): string {
    return this.show('error', message, duration ?? 8000);
  }

  info(message: string, duration?: number): string {
    return this.show('info', message, duration);
  }

  warning(message: string, duration?: number): string {
    return this.show('warning', message, duration ?? 6000);
  }

  remove(id: string): void {
    this._toasts = this._toasts.filter((t) => t.id !== id);
    this.notifyListeners();
  }

  clear(): void {
    this._toasts = [];
    this.notifyListeners();
  }

  subscribe(callback: ToastCallback): () => void {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== callback);
    };
  }

  private notifyListeners(): void {
    for (const listener of this._listeners) {
      listener(this.toasts);
    }
  }
}

export const toastStore = new ToastStore();
