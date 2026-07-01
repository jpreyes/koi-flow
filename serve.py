"""Servidor de desarrollo sin caché para ReWind (SHM de torres eólicas).
Uso: python serve.py [puerto]   (puerto por defecto: 8765)
"""
import http.server, socketserver, os, sys, json, subprocess

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.dirname(os.path.abspath(__file__))

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        # Endpoint para descargar datos DGA desde el UI: POST /api/fetch_dga
        # body JSON: { lon, lat, radio, var: "pr"|"qflx" }
        if self.path.rstrip('/') == '/api/fetch_dga':
            try:
                n = int(self.headers.get('Content-Length', 0))
                req = json.loads(self.rfile.read(n) or b'{}')
                args = [sys.executable, os.path.join(ROOT, 'tools', 'fetch_dga.py'),
                        '--lon', str(float(req['lon'])), '--lat', str(float(req['lat'])),
                        '--radio', str(float(req.get('radio', 60))),
                        '--var', 'qflx' if req.get('var') == 'qflx' else 'pr']
                p = subprocess.run(args, capture_output=True, text=True, timeout=600, cwd=ROOT)
                ok = p.returncode == 0
                self._json({'ok': ok, 'stdout': p.stdout[-4000:], 'stderr': p.stderr[-2000:]},
                           200 if ok else 500)
            except Exception as e:  # noqa
                self._json({'ok': False, 'error': str(e)}, 500)
            return
        self.send_error(404)

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=UTF-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def guess_type(self, path):
        # Manifest PWA: tipo correcto para que el navegador lo acepte
        if str(path).endswith('.webmanifest'):
            return 'application/manifest+json; charset=UTF-8'
        ctype = super().guess_type(path)
        if isinstance(ctype, str):
            if ctype in ('text/javascript', 'application/javascript', 'text/css', 'text/html'):
                ctype = ctype + '; charset=UTF-8'
        return ctype

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # silenciar logs de acceso

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Multihilo: el servidor monohilo (TCPServer) se ahogaba con las cargas paralelas
# de módulos ES (Three.js + varios .js a la vez) → ConnectionAbortedError y
# conexiones rechazadas. ThreadingTCPServer atiende peticiones concurrentes.
class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

with Server(('', PORT), NoCacheHandler) as httpd:
    print(f'ReWind -> http://localhost:{PORT}')
    httpd.serve_forever()
