package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// usageExempt 是不要求出現在 usage 的旗標。目前沒有豁免:-api 雖然是各指令
// 共用,usage 每一行都有寫 [-api ...],所以照常逐行檢查,漏寫也會被抓到。
var usageExempt = map[string]bool{}

// flagNameArgIndex 是 FlagSet 註冊方法中「旗標名」所在的參數位置
// (String/Bool 等是第一個,Var 是第二個)。
var flagNameArgIndex = map[string]int{
	"String": 0, "Bool": 0, "Int": 0, "Int64": 0, "Duration": 0, "Float64": 0, "Uint": 0,
	"Var": 1, "Func": 0,
}

// collectCommandFlags 用 AST 掃描各指令函式內 flag.NewFlagSet("名稱", ...) 與其後
// fs.String/Bool/Var(...) 註冊的旗標,回傳 指令名 -> 旗標名集合。registerDetailFlags
// 以 "detail" 為鍵(方案內容旗標,usage 另有專段)。直接掃原始碼,日後新增旗標不用
// 改測試也會被涵蓋。
func collectCommandFlags(t *testing.T) map[string]map[string]bool {
	t.Helper()
	out := map[string]map[string]bool{}
	fset := token.NewFileSet()
	for _, file := range []string{"main.go", "login.go", "detail.go"} {
		f, err := parser.ParseFile(fset, file, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, decl := range f.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			cmd := ""
			if fn.Name.Name == "registerDetailFlags" {
				cmd = "detail"
			}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				if pkg, ok := sel.X.(*ast.Ident); ok && pkg.Name == "flag" && sel.Sel.Name == "NewFlagSet" {
					cmd = unquoteArg(call.Args, 0)
					return true
				}
				idx, isReg := flagNameArgIndex[sel.Sel.Name]
				recv, ok := sel.X.(*ast.Ident)
				if !isReg || !ok || recv.Name != "fs" || cmd == "" {
					return true
				}
				if name := unquoteArg(call.Args, idx); name != "" {
					if out[cmd] == nil {
						out[cmd] = map[string]bool{}
					}
					out[cmd][name] = true
				}
				return true
			})
		}
	}
	return out
}

func unquoteArg(args []ast.Expr, i int) string {
	if i >= len(args) {
		return ""
	}
	lit, ok := args[i].(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return ""
	}
	s, _ := strconv.Unquote(lit.Value)
	return s
}

// flagMentioned 判斷 -name 是否以完整旗標名出現在文字中
// (避免 -detail 被 -detail-file 誤判為已列出)。
func flagMentioned(text, name string) bool {
	return regexp.MustCompile(`(^|[\s\[|(,、])-` + regexp.QuoteMeta(name) + `($|[\s\]|),、(])`).MatchString(text)
}

func TestUsageListsEveryRegisteredFlag(t *testing.T) {
	flags := collectCommandFlags(t)
	for _, want := range []string{"login", "campaign create", "plan create", "plan update", "detail"} {
		if len(flags[want]) == 0 {
			t.Fatalf("沒掃到 %q 的旗標,掃描邏輯壞了: %v", want, flags)
		}
	}

	lines := strings.Split(usageText, "\n")
	detailStart := -1
	for i, l := range lines {
		if strings.HasPrefix(l, "方案內容旗標") {
			detailStart = i
		}
	}
	if detailStart < 0 {
		t.Fatal("usage 找不到「方案內容旗標」段落")
	}
	// 方案內容旗標段落:從標題行到下一個子指令行(plan status)之前。
	detailText := strings.Join(lines[detailStart:], "\n")
	if i := strings.Index(detailText, "\n  plan status"); i >= 0 {
		detailText = detailText[:i]
	}

	for cmd, names := range flags {
		if cmd == "detail" {
			for name := range names {
				if !flagMentioned(detailText, name) {
					t.Errorf("方案內容旗標 -%s 已註冊但 usage 的「方案內容旗標」段落沒列", name)
				}
			}
			continue
		}
		var line string
		for _, l := range lines {
			if strings.HasPrefix(l, "  ") && strings.HasPrefix(strings.TrimSpace(l), cmd+" ") {
				line = l
				break
			}
		}
		if line == "" {
			t.Errorf("usage 沒有 %q 這個子指令的說明行", cmd)
			continue
		}
		for name := range names {
			if usageExempt[name] {
				continue
			}
			if !flagMentioned(line, name) {
				t.Errorf("%s: 旗標 -%s 已註冊但 usage 沒列: %s", cmd, name, strings.TrimSpace(line))
			}
		}
	}
}
