"""Servidor de desarrollo sin caché para koi-flow.
Uso: python serve.py [puerto]   (puerto por defecto: 8765)
"""
import http.server, socketserver, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
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
        # Cross-origin isolation (SharedArrayBuffer / WASM threads, Fase 1 del solver 2D
        # grande). 'credentialless' en vez de 'require-corp': los tiles de mapa/DEM
        # (ArcGIS, OpenTopoMap, S3 terrarium) son de otro origen y no traen cabecera
        # Cross-Origin-Resource-Policy propia; 'require-corp' los bloquearía,
        # 'credentialless' los deja pasar (sin credenciales) y de todos modos aísla
        # el origen. Ver js/lib/portico/wasm_solve_mt.js (feature-detect antes de usar).
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
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
    print(f'koi-flow -> http://localhost:{PORT}')
    httpd.serve_forever()
