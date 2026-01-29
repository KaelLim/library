import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import * as lucide from 'lucide';

@customElement('tc-icon')
export class TcIcon extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 0;
    }

    svg {
      width: var(--icon-size, 1em);
      height: var(--icon-size, 1em);
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
    }

    :host([size='sm']) svg {
      --icon-size: 16px;
    }

    :host([size='md']) svg {
      --icon-size: 20px;
    }

    :host([size='lg']) svg {
      --icon-size: 24px;
    }

    :host([size='xl']) svg {
      --icon-size: 32px;
    }
  `;

  @property({ type: String }) name = '';
  @property({ type: String }) size: 'sm' | 'md' | 'lg' | 'xl' = 'md';

  render() {
    const iconName = this.toPascalCase(this.name);
    const iconData = (lucide as Record<string, unknown>)[iconName] as [string, Record<string, string>, string[]];

    if (!iconData) {
      console.warn(`Icon "${this.name}" not found in Lucide`);
      return html``;
    }

    const [, attrs, paths] = iconData;
    const svgContent = paths.map((path) => {
      if (path.startsWith('<')) {
        return path;
      }
      return `<path d="${path}"></path>`;
    }).join('');

    return html`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="${attrs.width || 24}"
        height="${attrs.height || 24}"
        viewBox="0 0 24 24"
      >
        ${unsafeHTML(svgContent)}
      </svg>
    `;
  }

  private toPascalCase(str: string): string {
    return str
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'tc-icon': TcIcon;
  }
}
