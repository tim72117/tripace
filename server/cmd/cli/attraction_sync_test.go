package main

// attraction_sync_test.go 定義 attraction-sync / attraction-sync-setup
// 兩個子命令的旗標解析行為（見 docs/ATTRACTION_SYNC_DESIGN.md「五、CLI
// 指令介面」）。比照 command_test.go 的模式：用 fakeClient 斷言「命令列
// 參數是否被正確翻譯成 client 呼叫」，不在這裡測 client 實作本身打的
// HTTP 對不對（那是 http_test.go 的職責）。
//
// cmdAttractionSync/cmdAttractionSyncSetup、client 介面上對應的方法
// （attractionSync/attractionSyncSetup）此時都還沒有實作，先寫測試定義
// 預期的呼叫簽章與輸出形狀。

import (
	"testing"
)

// fakeSyncClient 擴充 fakeClient，記錄 attraction-sync 系列方法收到的參數。
// 獨立成一個型別（內嵌 fakeClient）而非直接改 fakeClient 本身，避免
// command_test.go 既有測試需要跟著補齊新欄位的初始化。
type fakeSyncClient struct {
	fakeClient

	syncSetupTarget string

	syncDirection   string
	syncAllowDelete bool
	syncApply       bool
	syncRetry       bool
}

func (f *fakeSyncClient) attractionSyncSetup(target string) (any, error) {
	f.syncSetupTarget = target
	return f.result, nil
}

func (f *fakeSyncClient) attractionSync(direction string, allowDelete, apply, retry bool) (any, error) {
	f.syncDirection = direction
	f.syncAllowDelete = allowDelete
	f.syncApply = apply
	f.syncRetry = retry
	return f.result, nil
}

func TestCmdAttractionSyncSetup(t *testing.T) {
	c := &fakeSyncClient{fakeClient: fakeClient{result: map[string]any{"ok": true}}}

	captureOutput(t, func() {
		cmdAttractionSyncSetup(c, []string{"-target", "https://tripace.shuttle.tools"})
	})

	if c.syncSetupTarget != "https://tripace.shuttle.tools" {
		t.Errorf("attractionSyncSetup 收到 target = %q，預期 %q", c.syncSetupTarget, "https://tripace.shuttle.tools")
	}
}

func TestCmdAttractionSync_DefaultsToDryRun(t *testing.T) {
	// 對應設計文件：「預設是 dry-run（只顯示差異報告，不寫入）；加上
	// -apply 才會真正執行寫入」——不帶 -apply 時，syncApply 應該是 false。
	c := &fakeSyncClient{fakeClient: fakeClient{result: map[string]any{"report": "..."}}}

	captureOutput(t, func() {
		cmdAttractionSync(c, []string{"-direction", "push"})
	})

	if c.syncDirection != "push" {
		t.Errorf("direction = %q，預期 push", c.syncDirection)
	}
	if c.syncApply {
		t.Error("未帶 -apply，預期 syncApply = false（dry-run 是預設值）")
	}
	if c.syncAllowDelete {
		t.Error("未帶 -allow-delete，預期 syncAllowDelete = false（安全預設值）")
	}
}

func TestCmdAttractionSync_PullWithAllFlags(t *testing.T) {
	c := &fakeSyncClient{fakeClient: fakeClient{result: map[string]any{"report": "..."}}}

	captureOutput(t, func() {
		cmdAttractionSync(c, []string{"-direction", "pull", "-allow-delete", "-apply", "-retry"})
	})

	if c.syncDirection != "pull" {
		t.Errorf("direction = %q，預期 pull", c.syncDirection)
	}
	if !c.syncAllowDelete {
		t.Error("帶了 -allow-delete，預期 syncAllowDelete = true")
	}
	if !c.syncApply {
		t.Error("帶了 -apply，預期 syncApply = true")
	}
	if !c.syncRetry {
		t.Error("帶了 -retry，預期 syncRetry = true")
	}
}

// TestCmdAttractionSync_RejectsInvalidDirection 對應設計文件：
// `-direction push|pull` 只接受這兩個值——這是命令列解析層該擋下的
// 輸入錯誤，不該讓一個打錯字的 direction 值一路傳到 HTTP 層才發現。
//
// 沿用 command_test.go 開頭註解提到的既有限制：cmd* 函式的錯誤路徑目前
// 一律走 fatal()（=os.Exit(1)），還沒有可注入、可在測試裡攔截的錯誤
// 處理機制，所以這個案例暫時無法直接斷言「fatal 被呼叫」。實作時需要
// 先決定：要嘛跟現有慣例一致（一樣走 fatal，這個測試案例先略過，記錄在
// 這裡當提醒），要嘛藉著這個新命令引入可注入的錯誤處理（會是比這次
// 同步功能更大範圍的既有慣例調整，需要另外討論）。
func TestCmdAttractionSync_RejectsInvalidDirection(t *testing.T) {
	t.Skip("cmd* 錯誤路徑目前一律走 fatal()（os.Exit），尚無可注入的方式在測試裡斷言——見上方註解")
}
