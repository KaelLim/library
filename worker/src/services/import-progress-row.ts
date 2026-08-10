// Pure mapping from the ImportProgress payload to the `weekly` table's import_* columns.
// No I/O.
//
// `weekly` has no dedicated column for「哪一步失敗」，所以失敗時把真正失敗的步驟
// 塞進 import_progress（該欄在失敗列本來就是 null），reader 端再取回。非失敗列
// import_progress 照常放人類可讀的進度文字。搭配 dashboard 的 getLatestImportStatus。

export interface ImportProgressLike {
  step: string;
  progress?: string;
  error?: string;
  failedStep?: string;
}

export interface ProgressRow {
  import_step: string;
  import_progress: string | null;
  import_error: string | null;
}

export function toProgressRow(p: ImportProgressLike): ProgressRow {
  const isFailed = p.step === 'failed';
  return {
    import_step: p.step,
    import_progress: (isFailed ? p.failedStep : p.progress) ?? null,
    import_error: p.error ?? null,
  };
}
