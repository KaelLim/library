#!/bin/bash
# 備份 Supabase Storage 到本機

BACKUP_DIR="$(dirname "$0")/volumes/storage-backup"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "備份 Storage 到 $BACKUP_DIR..."

# 確保目錄存在
mkdir -p "$BACKUP_DIR"

# 從容器複製資料
docker cp supabase-storage:/var/lib/storage/. "$BACKUP_DIR/"

echo "備份完成: $BACKUP_DIR"
echo "檔案數量: $(find "$BACKUP_DIR" -type f | wc -l)"
