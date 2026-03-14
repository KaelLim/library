/**
 * 簡易 Markdown → HTML 轉換器
 * 用於 Dashboard 文稿預覽
 */
export function renderMarkdownToHtml(markdown: string): string {
  let html = markdown
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Images（必須在 Links 之前處理）
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<figure class="image-block"><img src="$2" alt="$1"><figcaption>$1</figcaption></figure>')
    // Links（白名單：只允許 http, https, 或相對路徑）
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match: string, text: string, url: string) => {
      const trimmed = url.trim();
      if (!/^(https?:\/\/|\/)/i.test(trimmed)) {
        return text;
      }
      const safeUrl = trimmed.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    })
    // Code blocks
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered lists
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p>')
    // Single newlines within paragraphs
    .replace(/\n/g, '<br>');

  // Wrap loose li elements in ul
  html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>');

  // Wrap in paragraph if not already wrapped
  if (!html.startsWith('<')) {
    html = '<p>' + html + '</p>';
  }

  return html;
}
