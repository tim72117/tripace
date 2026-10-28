package main

// global_api_test.go 測全域旗標 -api 有沒有真的傳到 partner-grant / geocode / notify。
//
// 背景:main() 會先把 -api 從 os.Args 剝掉再分派子命令,子命令若沒拿到解析好的
// 值、又各自寫死預設,-api 就被默默忽略——曾經 partner-grant 因此一律打到
// http://localhost:8080、geocode/notify 一律打到預設的正式站,而不是使用者指定的
// 位址。這是 main() 層級的行為,只能編譯出實際的 binary 來跑才測得到。

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func buildCLI(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "tripace-cli-test")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	cmd := exec.Command("go", "build", "-o", bin, ".")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	return bin
}

func TestGlobalAPIFlagReachesGlobalCommands(t *testing.T) {
	bin := buildCLI(t)
	srv, got := newFakeServer(t)
	withToken(t, srv.URL, "tok")

	cases := []struct {
		name     string
		args     []string
		wantPath string
	}{
		{"partner-grant", []string{"partner-grant", "-email", "a@b.c", "-name", "n"}, "/internal/maintenance/partners"},
		{"geocode", []string{"geocode", "-place", "東京"}, "/internal/maintenance/geocode"},
		{"notify", []string{"notify", "-trip", "trip1"}, "/internal/trips/trip1/notify"},
	}
	for _, c := range cases {
		for _, pos := range []string{"before", "after"} {
			t.Run(c.name+"/-api "+pos+" subcommand", func(t *testing.T) {
				*got = capturedReq{}
				var args []string
				if pos == "before" {
					args = append([]string{"-api", srv.URL}, c.args...)
				} else {
					args = append(append([]string{}, c.args...), "-api", srv.URL)
				}
				cmd := exec.Command(bin, args...)
				cmd.Env = os.Environ()
				out, _ := cmd.CombinedOutput()
				if got.path != c.wantPath {
					t.Fatalf("請求沒有打到指定的 -api(%s):收到 path=%q,預期 %q\n輸出: %s", srv.URL, got.path, c.wantPath, out)
				}
				if got.auth != "Bearer tok" {
					t.Fatalf("Authorization = %q", got.auth)
				}
			})
		}
	}
}

// partner-grant 的 -name 選填:不給也要能送出(只帶 email)。
func TestPartnerGrantNameIsOptional(t *testing.T) {
	bin := buildCLI(t)
	srv, got := newFakeServer(t)
	withToken(t, srv.URL, "tok")

	out, err := exec.Command(bin, "-api", srv.URL, "partner-grant", "-email", "a@b.c").CombinedOutput()
	if err != nil {
		t.Fatalf("不給 -name 不該失敗: %v\n%s", err, out)
	}
	if got.path != "/internal/maintenance/partners" || got.body["email"] != "a@b.c" {
		t.Fatalf("請求內容不對: path=%q body=%v", got.path, got.body)
	}
}
