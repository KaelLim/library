import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Router } from '@vaadin/router';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { ImportStep } from '../types/index.js';
import {
  subscribeToImportProgress,
  unsubscribeFromImportProgress,
  getLatestImportStatus,
  extractTextFromSessionOutput,
  type SessionOutputUpdate,
} from '../services/realtime.js';
import '../components/layout/tc-app-shell.js';
import '../components/ui/tc-button.js';
import '../components/progress/tc-progress-stepper.js';

interface RouteLocation {
  params: { id: string };
}

@customElement('page-import-progress')
export class PageImportProgress extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .container {
      max-width: 800px;
      margin: 0 auto;
    }

    .actions {
      display: flex;
      gap: var(--spacing-3);
      margin-top: var(--spacing-6);
    }

    .actions tc-button {
      flex: 1;
    }
  `;

  @property({ type: Object })
  location?: RouteLocation;

  @state()
  private weekNumber = 0;

  @state()
  private currentStep: ImportStep = 'starting';

  @state()
  private progress = '';

  @state()
  private error = '';

  private channel?: RealtimeChannel;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();

    // Get week number from route
    this.weekNumber = parseInt(this.location?.params?.id || '0', 10);

    if (this.weekNumber > 0) {
      // Load current status first
      await this.loadCurrentStatus();
      // Then subscribe to updates
      this.subscribeToUpdates();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe();
  }

  private async loadCurrentStatus(): Promise<void> {
    const status = await getLatestImportStatus(this.weekNumber);
    if (status) {
      this.currentStep = status.step;
      this.progress = status.progress || '';
      this.error = status.error || '';
    }
  }

  private subscribeToUpdates(): void {
    this.channel = subscribeToImportProgress(this.weekNumber, {
      onProgress: (update) => {
        this.currentStep = update.step;
        this.progress = update.progress || '';
        this.error = update.error || '';
      },
      onSessionOutput: (update: SessionOutputUpdate) => {
        // AI 輸出直接覆蓋 progress 顯示
        const text = extractTextFromSessionOutput(update);
        if (text && update.data.type === 'assistant') {
          this.progress = text;
        }
      },
    });
  }

  private unsubscribe(): void {
    if (this.channel) {
      unsubscribeFromImportProgress(this.channel);
      this.channel = undefined;
    }
  }

  render() {
    const isCompleted = this.currentStep === 'completed';
    const isFailed = this.currentStep === 'failed';
    const isDone = isCompleted || isFailed;

    return html`
      <tc-app-shell pageTitle="匯入進度">
        <tc-button
          slot="header-right"
          variant="ghost"
          @click=${this.handleBack}
        >
          返回列表
        </tc-button>

        <div class="container">
          <tc-progress-stepper
            currentStep=${this.currentStep}
            progress=${this.progress}
            error=${this.error}
            weekNumber=${this.weekNumber}
          ></tc-progress-stepper>

          ${isDone
            ? html`
                <div class="actions">
                  ${isCompleted
                    ? html`
                        <tc-button variant="primary" @click=${this.handleViewWeekly}>
                          查看週報
                        </tc-button>
                      `
                    : html`
                        <tc-button variant="secondary" @click=${this.handleBack}>
                          返回列表
                        </tc-button>
                        <tc-button variant="primary" @click=${this.handleRetry}>
                          重試
                        </tc-button>
                      `}
                </div>
              `
            : ''}
        </div>
      </tc-app-shell>
    `;
  }

  private handleBack(): void {
    Router.go('/');
  }

  private handleViewWeekly(): void {
    Router.go(`/weekly/${this.weekNumber}`);
  }

  private handleRetry(): void {
    // Navigate back to list where they can start a new import
    Router.go('/');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'page-import-progress': PageImportProgress;
  }
}
