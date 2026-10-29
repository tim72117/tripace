package photostorage

import (
	"context"
	"errors"
	"testing"
)

func TestIsStorageFailureDistinguishesInfrastructureFromBadInput(t *testing.T) {
	store := NewMemoryObjectStore()
	u := NewForTest("b", store)

	// 正常上傳。
	if _, err := u.UploadDataURI(context.Background(), "k", "data:image/jpeg;base64,aGk="); err != nil {
		t.Fatal(err)
	}

	// GCS 寫入失敗(帳單停用之類):屬於儲存異常,且保留原本的錯誤訊息前綴。
	boom := errors.New("403 accountDisabled")
	store.WriteErr = boom
	_, err := u.UploadDataURI(context.Background(), "k2", "data:image/jpeg;base64,aGk=")
	if !IsStorageFailure(err) || !errors.Is(err, boom) {
		t.Fatalf("寫入失敗應是 storage failure 且可 unwrap: %v", err)
	}
	if got := err.Error(); got != "上傳 GCS 失敗: 403 accountDisabled" {
		t.Fatalf("錯誤訊息改變了: %q", got)
	}

	// 單張圖片的問題、未設定 bucket:不是儲存異常,不該讓斷路器跳閘。
	store.WriteErr = nil
	if _, err := u.UploadDataURI(context.Background(), "k3", "not-a-data-uri"); err == nil || IsStorageFailure(err) {
		t.Fatalf("格式錯誤不該算 storage failure: %v", err)
	}
	if _, err := (&Uploader{}).UploadDataURI(context.Background(), "k4", "data:image/jpeg;base64,aGk="); IsStorageFailure(err) {
		t.Fatalf("ErrNoBucket 不該算 storage failure: %v", err)
	}
}

func TestProbe(t *testing.T) {
	store := NewMemoryObjectStore()
	u := NewForTest("b", store)
	if err := u.Probe(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !store.Written[probeObjectName] {
		t.Fatalf("探測應寫入固定物件 %s: %v", probeObjectName, store.Written)
	}

	store.WriteErr = errors.New("403")
	if err := u.Probe(context.Background()); !IsStorageFailure(err) {
		t.Fatalf("寫入失敗的探測應回 storage failure: %v", err)
	}

	if err := (&Uploader{}).Probe(context.Background()); !errors.Is(err, ErrNoBucket) {
		t.Fatalf("沒接 bucket 應回 ErrNoBucket: %v", err)
	}
	if (&Uploader{}).Configured() || !u.Configured() {
		t.Fatal("Configured 判斷不對")
	}
}
