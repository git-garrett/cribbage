"""A small, unbranded cookie login in front of the private gateway."""
from collections import deque
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path
import secrets
import threading
import time

from flask import Flask, g, redirect, render_template, request, session
from werkzeug.security import check_password_hash


def create_app(credentials=None):
    if credentials is None:
        credentials = json.loads(Path(os.environ.get(
            'ACCESS_CONFIG', '/etc/workbench-access/credentials.json')).read_text())
    username = credentials.get('username', '')
    password_hash = credentials.get('passwordHash', '')
    secret = credentials.get('secretKey', '')
    if not username or not password_hash.startswith('pbkdf2:sha256:') or len(secret) < 32:
        raise ValueError('A username, password hash and strong session key are required.')
    version = hashlib.sha256((username + '\0' + password_hash).encode()).hexdigest()
    app = Flask(__name__, template_folder=str(Path(__file__).with_name('templates')), static_folder=None)
    app.config.update(SECRET_KEY=secret, SESSION_COOKIE_NAME='__Host-access',
                      SESSION_COOKIE_SECURE=True, SESSION_COOKIE_HTTPONLY=True,
                      SESSION_COOKIE_SAMESITE='Strict', SESSION_COOKIE_PATH='/',
                      SESSION_REFRESH_EACH_REQUEST=False,
                      PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
                      MAX_CONTENT_LENGTH=4096, MAX_FORM_MEMORY_SIZE=4096,
                      TRUSTED_HOSTS=['workbench.strongcribbage.com', '127.0.0.1'])
    origin = 'https://workbench.strongcribbage.com'
    attempts = {}
    all_attempts = deque()
    lock = threading.Lock()

    def authenticated():
        value = session.get('v')
        return isinstance(value, str) and secrets.compare_digest(value, version)

    def allowed_attempt():
        # Caddy overwrites this header; the service binds only to loopback.
        address = request.headers.get('X-Access-IP', 'local')
        now = time.monotonic()
        with lock:
            while all_attempts and all_attempts[0] <= now - 60:
                all_attempts.popleft()
            for key in list(attempts):
                queue = attempts[key]
                while queue and queue[0] <= now - 60:
                    queue.popleft()
                if not queue:
                    del attempts[key]
            queue = attempts.get(address, deque())
            if len(queue) >= 10 or len(all_attempts) >= 100:
                return False
            queue.append(now)
            attempts[address] = queue
            all_attempts.append(now)
            return True

    @app.before_request
    def nonce():
        g.style_nonce = secrets.token_urlsafe(18)

    @app.after_request
    def private_response(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Robots-Tag'] = 'noindex, nofollow, noarchive'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = (
            "default-src 'none'; style-src 'nonce-" + getattr(g, 'style_nonce', '') +
            "'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
        return response

    def form(error='', status=200):
        if not session.get('csrf'):
            session['csrf'] = secrets.token_urlsafe(32)
        return render_template('login.html', error=error, csrf=session['csrf']), status

    @app.route('/login', methods=['GET', 'POST'])
    def login():
        if authenticated():
            return redirect('/', 303)
        if request.method == 'GET':
            return form()
        expected = session.get('csrf', '')
        supplied = request.form.get('csrf', '')
        if (request.headers.get('Origin') != origin or not expected
                or not secrets.compare_digest(expected.encode(), supplied.encode())):
            return form('Please try signing in again.', 400)
        if not allowed_attempt():
            body, status = form('Too many attempts. Try again in a minute.', 429)
            return body, status, {'Retry-After': '60'}
        valid_password = check_password_hash(password_hash, request.form.get('password', ''))
        valid_username = request.form.get('username', '').strip().casefold() == username.casefold()
        if not (valid_password and valid_username):
            return form('Check your username and password, then try again.', 400)
        session.clear()
        session.permanent = True
        session['v'] = version
        return redirect('/', 303)

    @app.get('/verify')
    def verify():
        return ('', 204) if authenticated() else redirect('/login', 303)

    return app
