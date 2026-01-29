import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ImportStep, StepInfo } from '../../types/index.js';
import { IMPORT_STEPS, getStepIndex } from '../../types/index.js';
import './tc-step-item.js';
import type { StepStatus } from './tc-step-item.js';

@customElement('tc-progress-stepper')
export class TcProgressStepper extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .stepper {
      background: var(--color-bg-card);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--spacing-6);
    }

    .header {
      margin-bottom: var(--spacing-6);
      padding-bottom: var(--spacing-4);
      border-bottom: 1px solid var(--color-border);
    }

    .title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin-bottom: var(--spacing-2);
    }

    .subtitle {
      font-size: var(--font-size-sm);
      color: var(--color-text-muted);
    }

    .steps {
      padding-left: var(--spacing-2);
    }

    .completed-message {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-4);
      background: var(--color-success-bg);
      border-radius: var(--radius-md);
      margin-bottom: var(--spacing-4);
    }

    .completed-message svg {
      width: 24px;
      height: 24px;
      color: var(--color-success);
    }

    .completed-message span {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-success);
    }

    .error-message {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
      padding: var(--spacing-4);
      background: var(--color-error-bg);
      border-radius: var(--radius-md);
      margin-bottom: var(--spacing-4);
    }

    .error-message svg {
      width: 24px;
      height: 24px;
      color: var(--color-error);
      flex-shrink: 0;
    }

    .error-message span {
      font-size: var(--font-size-sm);
      color: var(--color-error);
    }
  `;

  @property({ type: String }) currentStep: ImportStep = 'starting';
  @property({ type: String }) progress = '';
  @property({ type: String }) error = '';
  @property({ type: Number }) weekNumber = 0;

  render() {
    const currentIndex = getStepIndex(this.currentStep);
    const isCompleted = this.currentStep === 'completed';
    const isFailed = this.currentStep === 'failed';

    // Filter out 'completed' and 'failed' from display steps
    const displaySteps = IMPORT_STEPS.filter(
      (s) => s.key !== 'completed' && s.key !== 'failed'
    );

    return html`
      <div class="stepper">
        <div class="header">
          <h2 class="title">匯入第 ${this.weekNumber} 期週報</h2>
          <p class="subtitle">
            ${isCompleted
              ? '匯入已完成'
              : isFailed
                ? '匯入失敗'
                : '匯入進行中...'}
          </p>
        </div>

        ${isCompleted
          ? html`
              <div class="completed-message">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                <span>所有步驟已成功完成！</span>
              </div>
            `
          : ''}

        ${isFailed && this.error
          ? html`
              <div class="error-message">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
                <span>${this.error}</span>
              </div>
            `
          : ''}

        <div class="steps">
          ${displaySteps.map((step, index) => {
            const status = this.getStepStatus(step, index, currentIndex, isCompleted, isFailed);
            const isActive = status === 'active';

            return html`
              <tc-step-item
                status=${status}
                label=${step.label}
                description=${step.description}
                progress=${isActive ? this.progress : ''}
                ?isLast=${index === displaySteps.length - 1}
              ></tc-step-item>
            `;
          })}
        </div>
      </div>
    `;
  }

  private getStepStatus(
    step: StepInfo,
    index: number,
    currentIndex: number,
    isCompleted: boolean,
    isFailed: boolean
  ): StepStatus {
    if (isCompleted) {
      return 'completed';
    }

    if (isFailed) {
      if (index < currentIndex) {
        return 'completed';
      }
      if (index === currentIndex || step.key === this.currentStep) {
        return 'error';
      }
      return 'pending';
    }

    const stepIndex = getStepIndex(step.key);
    if (stepIndex < currentIndex) {
      return 'completed';
    }
    if (stepIndex === currentIndex) {
      return 'active';
    }
    return 'pending';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-progress-stepper': TcProgressStepper;
  }
}
