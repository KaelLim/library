import { createHmac } from 'crypto';

// Types
export interface FlipBookConfig {
  bgBeginColor?: string;
  bgEndColor?: string;
  pageBackgroundColor?: string;
  toolbarColor?: string;
  iconColor?: string;
  FlipStyle?: string;
  FlipDirection?: string | number;
  RightToLeft?: string | boolean;
  googleAnalyticsID?: string;
  googleTagManagerID?: string;
  [key: string]: string | boolean | number | undefined;
}

export interface UploadResult {
  success: boolean;
  fileName?: string;
  fileSrc?: string;
  message?: string;
}

export interface CreateBookResult {
  success: boolean;
  bookId?: string;
  bookUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  message?: string;
}

export interface FlipBookMetadata {
  // 通用欄位
  author?: string;
  publisher?: string;
  isbn?: string;
  book_date?: string;
  category?: string;
  // 週報專用（可選）
  weekly_id?: number;
  // 自定義欄位
  [key: string]: string | number | undefined;
}

// Get credentials from environment
function getCredentials() {
  const accessKeyId = process.env.FLIPHTML5_ACCESS_KEY_ID;
  const accessKeySecret = process.env.FLIPHTML5_ACCESS_KEY_SECRET;

  if (!accessKeyId || !accessKeySecret) {
    throw new Error('FLIPHTML5_ACCESS_KEY_ID and FLIPHTML5_ACCESS_KEY_SECRET must be set');
  }

  return { accessKeyId, accessKeySecret };
}

// Generate HMAC-SHA1 signature
function generateSignature(signString: string, secret: string): string {
  const hmac = createHmac('sha1', secret);
  hmac.update(signString);
  return hmac.digest('base64');
}

// Generate GMT date string
function getGMTDate(): string {
  return new Date().toUTCString();
}

// Default book configuration
export function getDefaultBookConfig(): FlipBookConfig {
  return {
    bgBeginColor: '#505050',
    bgEndColor: '#505050',
    bgMRotation: '30',
    pageBackgroundColor: '#FFFFFF',
    backgroundPosition: 'Stretch',
    backgroundOpacity: '100',
    backgroundScene: 'None',
    toolbarColor: '#333333',
    ToolBarAlpha: '0.8',
    iconColor: '#EEEEEE',
    iconFontColor: '#EEEEEE',
    pageNumColor: '#1B2930',
    formFontColor: '#EEEEEE',
    formBackgroundColor: '#3963A5',
    LinkDownColor: '#808080',
    LinkAlpha: '0.5',
    borderColor: '#572F0D',
    cornerRound: '8',
    hardCoverBorderWidth: '8',
    LeftShadowWidth: '100',
    LeftShadowAlpha: '1',
    RightShadowWidth: '40',
    RightShadowAlpha: '1',
    ShowTopLeftShadow: 'Yes',
    searchFontColor: '#FFFFFF',
    searchKeywordFontColor: '#FFB000',
    searchHightlightColor: '#FDC606',
    topMargin: '10',
    bottomMargin: '10',
    leftMargin: '10',
    rightMargin: '10',
    topMarginOnMobile: '0',
    bottomMarginOnMobile: '0',
    leftMarginOnMobile: '0',
    rightMarginOnMobile: '0',
    logoPadding: '10',
    logoTop: '0',
    logoHeight: '42',
    FlipStyle: 'Flip',
    FlipDirection: '0',
    mouseWheelFlip: 'yes',
    autoDoublePage: 'auto',
    flippingTime: '0.3',
    CurlingPageCorner: 'Yes',
    retainBookCenter: 'Yes',
    pageHighlightType: 'magazine',
    BindingType: 'side',
    thicknessWidthType: 'Thick',
    thicknessColor: '#FFFFFF',
    isStopMouseMenu: 'yes',
    updateURLForPage: 'Yes',
    ToolBarVisible: 'Yes',
    toolbarAlwaysShow: 'No',
    ThumbnailsButtonVisible: 'true',
    ZoomButtonVisible: 'true',
    SearchButtonVisible: 'Show',
    BookMarkButtonVisible: 'true',
    TableOfContentButtonVisible: 'Show',
    ShareButtonVisible: 'false',
    AutoPlayButtonVisible: 'Show',
    FullscreenButtonVisible: 'Show',
    flipshortcutbutton: 'Show',
    phoneFlipShortcutButton: 'Hide',
    loadingCaption: '電子書載入中',
    loadingCaptionFontSize: '20',
    loadingCaptionColor: '#DDDDDD',
    loadingBackground: '#323232',
    loadingDisplayTime: '0',
    QRCode: 'true',
    OpenWindow: 'Blank',
    googleAnalyticsID: 'G-CYJJ36SS8M',
    googleTagManagerID: 'GTM-KD3PM6KH',
    highDefinitionConversion: 'yes',
    RightToLeft: 'Yes',
  };
}

/**
 * Upload PDF file to FlipHTML5
 */
export async function uploadPdfToFlipHTML5(pdfBuffer: Buffer, filename: string): Promise<UploadResult> {
  const { accessKeyId, accessKeySecret } = getCredentials();

  const url = 'https://api.fliphtml5.com/api/common/upload-file';
  const date = getGMTDate();
  const resource = '/api/common/upload-file';

  // Generate signature
  const signString = `${date}\n${resource}`;
  const signature = generateSignature(signString, accessKeySecret);
  const authorization = `${accessKeyId}:${signature}`;

  // Create FormData with file
  const formData = new FormData();
  const blob = new Blob([pdfBuffer as unknown as BlobPart], { type: 'application/pdf' });
  formData.append('file', blob, filename);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        Date: date,
        'x-yzw-apiversion': '0.1.0',
      },
      body: formData,
    });

    if (!response.ok) {
      return {
        success: false,
        message: `HTTP error: ${response.status} ${response.statusText}`,
      };
    }

    const result = await response.json();

    if (result.code === 'OK') {
      console.log(`[FlipHTML5] Upload success: ${result.data.fileSrc}`);
      return {
        success: true,
        fileName: result.data.fileName,
        fileSrc: result.data.fileSrc,
      };
    } else {
      return {
        success: false,
        message: result.msg || 'Unknown error',
      };
    }
  } catch (error) {
    console.error('[FlipHTML5] Upload error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create FlipBook from uploaded file
 */
export async function createFlipBook(
  fileSrc: string,
  title: string,
  description?: string,
  folderId?: number,
  metadata?: FlipBookMetadata,
  customConfig?: Partial<FlipBookConfig>
): Promise<CreateBookResult> {
  const { accessKeyId, accessKeySecret } = getCredentials();

  const url = 'https://api.fliphtml5.com/api/book/create-book-multi';
  const date = getGMTDate();

  // Merge default config with custom config
  const bookConfig = JSON.stringify({
    ...getDefaultBookConfig(),
    ...customConfig,
  });

  // Build parameters
  const params: Record<string, string> = {
    title,
    description: description || title,
    keyword: title,
    folderId: String(folderId || 7742461),
    filePath: JSON.stringify([{ link: fileSrc }]),
    bookConfig,
  };

  // Add metadata
  if (metadata) {
    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params[key] = String(value);
      }
    });
  }

  // Sort parameters alphabetically
  const sortedKeys = Object.keys(params).sort();
  const signPairs = sortedKeys.map((k) => `${k}=${params[k]}`);
  const queryString = signPairs.join('&');

  // Generate signature
  const signString = `${date}\n/api/book/create-book-multi?${queryString}`;
  const signature = generateSignature(signString, accessKeySecret);
  const authorization = `${accessKeyId}:${signature}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        Date: date,
        'x-yzw-apiversion': '0.1.0',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: queryString,
    });

    if (!response.ok) {
      return {
        success: false,
        message: `HTTP error: ${response.status} ${response.statusText}`,
      };
    }

    const result = await response.json();

    if (result.code === 'OK') {
      console.log(`[FlipHTML5] Book created: ${result.data.bookId}`);
      return {
        success: true,
        bookId: result.data.bookId,
        bookUrl: result.data.bookUrl,
        thumbnailUrl: result.data.thumbnailUrl,
        title,
      };
    } else {
      // If signature mismatch (often caused by non-ASCII characters), try with fallback title
      if (result.msg?.includes('SIGNATURE_NOT_MATCH')) {
        console.log('[FlipHTML5] Signature mismatch, retrying with ASCII-only fallback title...');
        return createFlipBookWithFallbackTitle(fileSrc, title, folderId, metadata, customConfig);
      }

      return {
        success: false,
        message: result.msg || 'Unknown error',
      };
    }
  } catch (error) {
    console.error('[FlipHTML5] Create book error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Retry with ASCII-only fallback title
 * 當中文標題導致簽名錯誤時，使用 ASCII 標題重試
 */
async function createFlipBookWithFallbackTitle(
  fileSrc: string,
  originalTitle: string,
  folderId?: number,
  metadata?: FlipBookMetadata,
  customConfig?: Partial<FlipBookConfig>
): Promise<CreateBookResult> {
  const { accessKeyId, accessKeySecret } = getCredentials();

  const url = 'https://api.fliphtml5.com/api/book/create-book-multi';
  const date = getGMTDate();

  // Use fallback title (ASCII only to avoid signature issues)
  const fallbackTitle = `Book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const bookConfig = JSON.stringify({
    ...getDefaultBookConfig(),
    ...customConfig,
  });

  const params: Record<string, string> = {
    title: fallbackTitle,
    description: fallbackTitle,
    keyword: fallbackTitle,
    folderId: String(folderId || 7742461),
    filePath: JSON.stringify([{ link: fileSrc }]),
    bookConfig,
  };

  if (metadata) {
    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params[key] = String(value);
      }
    });
  }

  const sortedKeys = Object.keys(params).sort();
  const signPairs = sortedKeys.map((k) => `${k}=${params[k]}`);
  const queryString = signPairs.join('&');

  const signString = `${date}\n/api/book/create-book-multi?${queryString}`;
  const signature = generateSignature(signString, accessKeySecret);
  const authorization = `${accessKeyId}:${signature}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        Date: date,
        'x-yzw-apiversion': '0.1.0',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: queryString,
    });

    const result = await response.json();

    if (result.code === 'OK') {
      console.log(`[FlipHTML5] Book created with fallback title: ${result.data.bookId}`);
      return {
        success: true,
        bookId: result.data.bookId,
        bookUrl: result.data.bookUrl,
        thumbnailUrl: result.data.thumbnailUrl,
        title: originalTitle, // Return original title
      };
    }

    return {
      success: false,
      message: result.msg || 'Unknown error',
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export interface UpdateBookResult {
  success: boolean;
  message?: string;
}

/**
 * Update FlipBook settings
 * 更新 FlipHTML5 電子書設定（如翻頁方向等）
 * 注意：FlipHTML5 API 需要發送完整的 bookConfig，不能只發送部分設定
 */
export async function updateFlipBookConfig(
  bookId: string,
  config: Partial<FlipBookConfig>
): Promise<UpdateBookResult> {
  const { accessKeyId, accessKeySecret } = getCredentials();

  const url = 'https://api.fliphtml5.com/api/book/update-book';
  const date = getGMTDate();

  // 合併默認配置和要更新的配置（必須發送完整的 bookConfig）
  const fullConfig = {
    ...getDefaultBookConfig(),
    ...config,
  };
  const bookConfig = JSON.stringify(fullConfig);

  // Build parameters
  const params: Record<string, string> = {
    bookId,
    bookConfig,
  };

  // Sort parameters alphabetically
  const sortedKeys = Object.keys(params).sort();
  const signPairs = sortedKeys.map((k) => `${k}=${params[k]}`);
  const queryString = signPairs.join('&');

  // Generate signature
  const signString = `${date}\n/api/book/update-book?${queryString}`;
  const signature = generateSignature(signString, accessKeySecret);
  const authorization = `${accessKeyId}:${signature}`;

  try {
    console.log(`[FlipHTML5] Updating book ${bookId} config, RightToLeft=${fullConfig.RightToLeft}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        Date: date,
        'x-yzw-apiversion': '0.1.0',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: queryString,
    });

    if (!response.ok) {
      return {
        success: false,
        message: `HTTP error: ${response.status} ${response.statusText}`,
      };
    }

    const result = await response.json();

    if (result.code === 'OK') {
      console.log(`[FlipHTML5] Book ${bookId} config updated successfully`);
      return { success: true };
    } else {
      return {
        success: false,
        message: result.msg || 'Unknown error',
      };
    }
  } catch (error) {
    console.error('[FlipHTML5] Update book error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Convert turn_page setting to FlipHTML5 RightToLeft config
 * FlipHTML5 API 期望字串 "Yes" 或 "No"
 */
export function turnPageToRightToLeft(turnPage: 'left' | 'right'): string {
  // left = 由右向左翻頁（中文/日文）= RightToLeft: "Yes"
  // right = 由左向右翻頁（英文）= RightToLeft: "No"
  return turnPage === 'left' ? 'Yes' : 'No';
}

/**
 * Upload PDF and create FlipBook in one call
 */
export async function createFlipBookFromPdf(
  pdfBuffer: Buffer,
  filename: string,
  title: string,
  options?: {
    description?: string;
    folderId?: number;
    metadata?: FlipBookMetadata;
    config?: Partial<FlipBookConfig>;
  }
): Promise<CreateBookResult> {
  // Step 1: Upload PDF
  const uploadResult = await uploadPdfToFlipHTML5(pdfBuffer, filename);

  if (!uploadResult.success || !uploadResult.fileSrc) {
    return {
      success: false,
      message: `Upload failed: ${uploadResult.message}`,
    };
  }

  // Step 2: Create FlipBook
  return createFlipBook(
    uploadResult.fileSrc,
    title,
    options?.description,
    options?.folderId,
    options?.metadata,
    options?.config
  );
}
