#!/usr/bin/env python3
"""起一個本機靜態伺服器,自動開瀏覽器顯示指定的 .mmd 流程圖(viewer.html)。

用法:
    python3 serve.py                    # 預設開 flow.mmd
    python3 serve.py flow_assistant.mmd # 指定要看哪個 .mmd 檔案

viewer.html 本身用 fetch 讀 .mmd 內容——用 file:// 直接雙擊開啟會被瀏覽器
CORS 擋掉,所以才需要這支腳本起一個 http:// 靜態伺服器。Ctrl+C 結束。
"""

import http.server
import socketserver
import sys
import threading
import webbrowser
from pathlib import Path
from urllib.parse import quote

DIR = Path(__file__).resolve().parent


def find_free_port() -> int:
    with socketserver.TCPServer(("127.0.0.1", 0), None) as s:
        return s.server_address[1]


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else "flow.mmd"
    target_path = DIR / target
    if not target_path.exists():
        print(f"找不到檔案: {target_path}", file=sys.stderr)
        sys.exit(1)

    port = find_free_port()

    handler = http.server.SimpleHTTPRequestHandler
    handler.directory = str(DIR)  # type: ignore[attr-defined]

    class Handler(handler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(DIR), **kwargs)

        def log_message(self, fmt: str, *args) -> None:
            pass  # 靜音存取 log,避免洗版終端機

    httpd = socketserver.TCPServer(("127.0.0.1", port), Handler)

    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()

    url = f"http://127.0.0.1:{port}/viewer.html?file={quote(target)}"
    print(f"伺服器已啟動: http://127.0.0.1:{port}/  (目錄: {DIR})")
    print(f"正在開啟瀏覽器: {url}")
    print("按 Ctrl+C 結束伺服器")
    webbrowser.open(url)

    try:
        server_thread.join()
    except KeyboardInterrupt:
        print("\n收到中斷,關閉伺服器...")
        httpd.shutdown()


if __name__ == "__main__":
    main()
