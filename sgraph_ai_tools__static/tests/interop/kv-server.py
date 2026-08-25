"""Minimal SG/Send-compatible KV store — enough of the vault API for interop tests.

    PUT    /api/vault/write/{vault}/{file_id}
    GET    /api/vault/read/{vault}/{file_id}
    DELETE /api/vault/delete/{vault}/{file_id}
    POST   /api/vault/batch/{vault}          {"operations": [{op, file_id, data, match}]}
    GET    /api/vault/list/{vault}

No auth, no credentials, localhost only. Files land under STORE/{vault}/{file_id}.
"""
import base64
import hashlib
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

STORE = os.environ.get('KV_STORE', './kv-store')
PORT  = int(os.environ.get('KV_PORT', '8899'))


def _path(vault, file_id):
    safe = os.path.normpath(file_id).lstrip('/')
    if safe.startswith('..'):
        raise ValueError('bad file_id')
    return os.path.join(STORE, vault, safe)


def _read(vault, file_id):
    p = _path(vault, file_id)
    if not os.path.isfile(p):
        return None
    with open(p, 'rb') as f:
        return f.read()


def _write(vault, file_id, data):
    p = _path(vault, file_id)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'wb') as f:
        f.write(data)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        print(f'  [kv] {self.command} {self.path.split("?")[0]}', file=sys.stderr)

    # --- helpers ---------------------------------------------------------
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')

    def _send(self, code, body=b'', ctype='application/octet-stream'):
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode(), 'application/json')

    def _parts(self):
        segs = [unquote(s) for s in self.path.split('?')[0].strip('/').split('/')]
        # api / vault / {action} / {vault_id} / {file_id...}
        if len(segs) < 4 or segs[0] != 'api' or segs[1] != 'vault':
            return None, None, None
        return segs[2], segs[3], '/'.join(segs[4:])

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n) if n else b''

    # --- verbs -----------------------------------------------------------
    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        action, vault, file_id = self._parts()
        if action == 'read':
            data = _read(vault, file_id)
            return self._send(404, b'not found') if data is None else self._send(200, data)
        if action == 'list':
            root, out = os.path.join(STORE, vault), []
            for dirpath, _, names in os.walk(root):
                for n in names:
                    out.append(os.path.relpath(os.path.join(dirpath, n), root).replace(os.sep, '/'))
            return self._json(200, {'files': sorted(out)})
        self._send(404, b'unknown route')

    def do_PUT(self):
        action, vault, file_id = self._parts()
        if action != 'write':
            return self._send(404, b'unknown route')
        _write(vault, file_id, self._body())
        self._json(200, {'status': 'ok', 'file_id': file_id})

    def do_DELETE(self):
        action, vault, file_id = self._parts()
        if action != 'delete':
            return self._send(404, b'unknown route')
        p = _path(vault, file_id)
        if os.path.isfile(p):
            os.remove(p)
        self._json(200, {'status': 'ok', 'file_id': file_id})

    def do_POST(self):
        action, vault, _ = self._parts()
        if action != 'batch':
            return self._send(404, b'unknown route')
        ops, results = json.loads(self._body() or b'{}').get('operations', []), []
        for op in ops:
            kind, fid = op.get('op'), op.get('file_id', '')
            if kind == 'read':
                data = _read(vault, fid)
                results.append({'file_id': fid, 'status': 'ok', 'data': base64.b64encode(data).decode()}
                               if data is not None else {'file_id': fid, 'status': 'not_found'})
            elif kind in ('write', 'write-if-match'):
                if kind == 'write-if-match':
                    cur = _read(vault, fid)
                    got = hashlib.sha256(cur).hexdigest() if cur is not None else None
                    if op.get('match') not in (None, '', got):
                        return self._json(409, {'status': 'conflict', 'file_id': fid})
                _write(vault, fid, base64.b64decode(op.get('data', '')))
                results.append({'file_id': fid, 'status': 'ok'})
            elif kind == 'delete':
                p = _path(vault, fid)
                if os.path.isfile(p):
                    os.remove(p)
                results.append({'file_id': fid, 'status': 'ok'})
            else:
                results.append({'file_id': fid, 'status': 'unknown_op'})
        self._json(200, {'status': 'ok', 'results': results})


if __name__ == '__main__':
    os.makedirs(STORE, exist_ok=True)
    print(f'KV store on http://127.0.0.1:{PORT}  →  {os.path.abspath(STORE)}', file=sys.stderr)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
