"""Serve the static timetable locally and open it in the default browser."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import socket
from urllib.request import urlopen
import webbrowser


class LocalPreviewServer(ThreadingHTTPServer):
    # On Windows, SO_REUSEADDR can otherwise let two preview processes bind
    # the same port, making the served page depend on which process answers.
    allow_reuse_address = False

    def server_bind(self) -> None:
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('端口需要在1到65535之间')
    root = Path(__file__).resolve().parent
    handler = partial(SimpleHTTPRequestHandler, directory=str(root))
    url = f"http://127.0.0.1:{args.port}/"
    try:
        server = LocalPreviewServer(('127.0.0.1', args.port), handler)
    except OSError as error:
        # Reuse an already-running copy only when it serves this exact homepage.
        try:
            with urlopen(url, timeout=2) as response:
                same_site = response.read(1024 * 1024) == (root / 'index.html').read_bytes()
        except Exception:
            same_site = False
        if same_site:
            print(f'课程表已在运行：{url}', flush=True)
            if not args.no_browser:
                webbrowser.open(url, new=2)
            return
        raise SystemExit(f'预览地址无法启动：{error}。请关闭占用{args.port}端口的程序后重试。')
    with server:
        print(f"课程表已启动：{url}", flush=True)
        print('请始终用这个地址访问，以便读取本机保存的事项。', flush=True)
        print("关闭此窗口即可停止本地预览。", flush=True)
        if not args.no_browser:
            webbrowser.open(url, new=2)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
