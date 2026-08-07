-- migrate_photo_cache_photo_index_pk.sql
--
-- photo_cache 資料表補上 photo_index 欄位到主鍵的手動遷移。
--
-- 背景:internal/store/entity.go 的 photoCacheRow 早就把 PhotoIndex 宣告成
-- `gorm:"primaryKey;column:photo_index"`(支援同一個地點快取多張照片,見
-- 該欄位的完整說明),GORM AutoMigrate 因此已經把 photo_index 這個「欄位」
-- 加進資料表(AutoMigrate 只會 ADD 缺少的欄位),但 AutoMigrate 不會變更
-- 既有資料表的主鍵(這個限制在稍早 photo_ref -> place_id 那次遷移已經
-- 確認過),導致實際主鍵一直停留在 (place_id, max_width_px),photo_index
-- 從未真正生效——這代表「一個地點存多張照片」這個功能在資料庫層級目前
-- 是壞的:寫入第二張照片(photo_index=1)會撞既有主鍵 (place_id,
-- max_width_px) 而失敗或覆蓋掉第一張。這是用 admin 後台新增的
-- schema-check 工具(見 server/internal/store/schema_check.go)實際掃出來
-- 的落差,不是預防性猜測。
--
-- 執行前置:已用 pg_dump 備份 photo_cache 全表資料(見同目錄下
-- photo_cache_backup_<timestamp>.sql),且已確認目前 16 筆既有資料的
-- (place_id, max_width_px, photo_index) 組合沒有重複、photo_index 全部
-- 是 NULL(代表現有資料都是「第一張照片」,對齊 PhotoIndex 註解「Google
-- 清單第一張固定為 0」的既有慣例)。
--
-- 用法:
--   docker exec -i tripace-postgres psql -U tripace -d tripace < migrate_photo_cache_photo_index_pk.sql

BEGIN;

-- 1. 把既有資料的 NULL photo_index 補成 0(對齊「第一張照片」的既有慣例)。
UPDATE photo_cache SET photo_index = 0 WHERE photo_index IS NULL;

-- 2. photo_index 欄位改為 NOT NULL(主鍵欄位不可為 NULL)。
ALTER TABLE photo_cache ALTER COLUMN photo_index SET NOT NULL;

-- 3. 卸除舊主鍵、建立新的三欄複合主鍵。
ALTER TABLE photo_cache DROP CONSTRAINT photo_cache_pkey;
ALTER TABLE photo_cache ADD PRIMARY KEY (place_id, photo_index, max_width_px);

-- 4. 驗證:確認新主鍵確實剛好是這三欄(不論宣告/實體欄位順序,只比對
--    集合本身是否相符,避免用資料表物理欄位順序誤判)、且沒有殘留任何
--    NULL photo_index。
DO $$
DECLARE
  pk_cols text;
  null_count bigint;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY a.attname)
    INTO pk_cols
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'photo_cache'::regclass AND i.indisprimary;

  SELECT count(*) INTO null_count FROM photo_cache WHERE photo_index IS NULL;

  IF pk_cols IS DISTINCT FROM 'max_width_px,photo_index,place_id' THEN
    RAISE EXCEPTION '主鍵驗證失敗,實際欄位: %', pk_cols;
  END IF;
  IF null_count > 0 THEN
    RAISE EXCEPTION '仍有 % 筆 photo_index 是 NULL', null_count;
  END IF;

  RAISE NOTICE '驗證通過:主鍵 = %, NULL photo_index 筆數 = %', pk_cols, null_count;
END $$;

COMMIT;
