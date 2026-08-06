-- 修正 photo_cache 表的主鍵漂移:GORM AutoMigrate 把 photoCacheRow 的欄位從
-- photo_ref(photo resource name,依 Google Maps Platform ToS 3.2.3(b) 不能
-- 長期快取)改名成 place_id 後,只新增了 place_id 欄位,沒有刪除舊的
-- photo_ref 欄位,也沒有把主鍵從 (photo_ref, max_width_px) 改成
-- (place_id, max_width_px)——這是 AutoMigrate 的已知限制(見
-- server/internal/store/schema_check.go 的完整說明),必須手動遷移。
--
-- 目前資料表裡的既有記錄全部是舊 schema 時代寫入的、place_id 為 NULL 的
-- 快取(這批快取的 photo_ref 本來就已經是「不該長期保存」的過期識別碼,
-- 且完全沒有 place_id 可轉換),故不遷移既有資料,直接清空重建——這是
-- 純快取表,清空不影響正確性,下次查詢飯店照片時會重新從 Google 下載並
-- 寫入新 schema。
--
-- 執行前務必先備份(見 server/scripts/photo_cache_backup_*.sql 的產生方式:
--   docker exec tripace-postgres pg_dump -U tripace -d tripace -t photo_cache > backup.sql
-- )。此腳本設計為冪等:重複執行不會報錯(DROP TABLE IF EXISTS)。

BEGIN;

DROP TABLE IF EXISTS photo_cache;

CREATE TABLE photo_cache (
    place_id      text                     NOT NULL,
    max_width_px  bigint                   NOT NULL,
    data_uri      text                     NOT NULL,
    fetched_at    timestamp with time zone NOT NULL,
    PRIMARY KEY (place_id, max_width_px)
);

COMMIT;
