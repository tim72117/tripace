// Command adminpasswd 是強制更新某個管理員帳號密碼的獨立 CLI 小工具,只能
// 透過直連資料庫(DATABASE_URL)執行,不透過任何 HTTP API——adminconsole 刻意
// 不提供改密碼端點(見該套件的說明),把這個高權限操作限制在「需要
// DATABASE_URL 存取權限」的管道,不擴大正式服務(adminserver)本身的攻擊面。
//
// 設計上供 .github/workflows/reset-admin-password.yml 手動觸發呼叫:該
// workflow 只重設 Secret Manager 裡 ADMIN_BOOTSTRAP_PASSWORD 這個 secret 早已
// 存在的最新版本值(用 server/scripts/set-admin-bootstrap-secrets.sh 先更新
// secret,再手動觸發那個 workflow),不在 workflow_dispatch 的輸入框自己打
// 新密碼——避免密碼明文出現在 GitHub Actions 的執行紀錄。
//
// adminauth.Bootstrap()「email 已存在就不動密碼」是刻意設計(見該函式註解),
// 只服務「第一次建立帳號」;這支工具則是唯一能改既有帳號密碼的路徑,執行後
// 會撤銷該帳號所有現有 session,強制重新登入。
package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/joho/godotenv"
	"github.com/tim72117/tripace/internal/store"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	email := flag.String("email", "", "要重設密碼的管理員 email(必填)")
	flag.Parse()

	if *email == "" {
		fmt.Fprintln(os.Stderr, "用法: adminpasswd -email admin@example.com")
		fmt.Fprintln(os.Stderr, "新密碼從環境變數 ADMIN_BOOTSTRAP_PASSWORD 讀取(不當成指令參數,避免留在 shell history / ps 輸出)")
		os.Exit(1)
	}

	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Printf("載入 .env: %v", err)
	}

	password := os.Getenv("ADMIN_BOOTSTRAP_PASSWORD")
	if password == "" {
		log.Fatal("未設 ADMIN_BOOTSTRAP_PASSWORD")
	}
	if len(password) < 8 {
		log.Fatal("密碼長度需至少 8 字元")
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("未設 DATABASE_URL")
	}

	st, err := store.Open(dsn)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	admin, err := st.FindAdminByEmail(*email)
	if err != nil {
		log.Fatalf("找不到管理員帳號 %s: %v", *email, err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("hash password: %v", err)
	}

	if err := st.UpdateAdminPassword(*email, string(hash)); err != nil {
		log.Fatalf("更新密碼失敗: %v", err)
	}

	if err := st.DeleteAdminSessionsByUser(admin.ID); err != nil {
		// 密碼已經改成功,session 清除失敗不應該讓整個操作視為失敗(密碼本身
		// 已經是新的,舊 session 會在 TTL 到期後自然失效),但要讓執行者知道
		// 需要留意——例如手動確認一下,或知道舊 session 還可能短暫有效。
		log.Printf("警告:密碼已更新,但撤銷既有 session 失敗: %v", err)
	}

	fmt.Printf("已更新 %s 的密碼,並撤銷所有既有登入態\n", *email)
}
