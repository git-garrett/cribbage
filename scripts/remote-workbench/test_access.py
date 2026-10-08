"""The sign-in form must never invoke a browser HTTP authentication prompt."""
import importlib.util
from pathlib import Path
import re
import time

import pytest
from werkzeug.security import generate_password_hash

SPEC = importlib.util.spec_from_file_location('workbench_access', Path(__file__).with_name('access.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
ORIGIN = 'https://workbench.strongcribbage.com'


@pytest.fixture
def app():
    return MODULE.create_app({
        'username': 'viewer', 'passwordHash': generate_password_hash('correct-password', method='pbkdf2:sha256:1000'),
        'secretKey': 'test-only-session-key-that-is-at-least-32-characters',
    })


def csrf(client):
    response = client.get('/login', base_url=ORIGIN)
    assert response.status_code == 200
    assert 'WWW-Authenticate' not in response.headers
    return re.search(r'name="csrf" value="([^"]+)"', response.text)[1]


def login(client, password='correct-password', **kwargs):
    return client.post('/login', base_url=ORIGIN,
                       data={'username': 'viewer', 'password': password, 'csrf': csrf(client)},
                       headers={'Origin': ORIGIN}, **kwargs)


def test_wrong_then_correct_login_never_repeats_native_prompt(app):
    client = app.test_client()
    bad = login(client, 'wrong-password')
    assert bad.status_code == 400
    assert 'Check your username and password' in bad.text
    assert 'WWW-Authenticate' not in bad.headers
    good = login(client)
    assert good.status_code == 303 and good.location == '/'
    assert 'WWW-Authenticate' not in good.headers
    cookie = good.headers['Set-Cookie']
    assert all(part in cookie for part in ('__Host-access=', 'Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/'))
    assert 'Domain=' not in cookie
    assert client.get('/verify', base_url=ORIGIN).status_code == 204


def test_anonymous_and_basic_auth_cannot_bypass_cookie(app):
    client = app.test_client()
    for headers in ({}, {'Authorization': 'Basic dmlld2VyOmNvcnJlY3QtcGFzc3dvcmQ='}):
        response = client.get('/verify', base_url=ORIGIN, headers=headers)
        assert response.status_code == 303 and response.location == '/login'
        assert 'WWW-Authenticate' not in response.headers


def test_invalid_or_missing_csrf_and_cross_origin_posts_fail(app):
    client = app.test_client()
    token = csrf(client)
    for supplied, origin in [('', ORIGIN), ('forged', ORIGIN), ('☃', ORIGIN), (token, 'https://other.example'), (token, '')]:
        response = client.post('/login', base_url=ORIGIN,
                               data={'username': 'viewer', 'password': 'correct-password', 'csrf': supplied},
                               headers={'Origin': origin})
        assert response.status_code == 400
        assert client.get('/verify', base_url=ORIGIN).status_code == 303


def test_tampered_and_expired_sessions_fail_closed(app, monkeypatch):
    client = app.test_client()
    login(client)
    cookie = client.get_cookie('__Host-access', domain='workbench.strongcribbage.com').value
    client.set_cookie('__Host-access', cookie + 'tampered', domain='workbench.strongcribbage.com')
    assert client.get('/verify', base_url=ORIGIN).status_code == 303
    client.set_cookie('__Host-access', cookie, domain='workbench.strongcribbage.com')
    now = time.time()
    monkeypatch.setattr(time, 'time', lambda: now + 13 * 3600)
    assert client.get('/verify', base_url=ORIGIN).status_code == 303


def test_password_change_invalidates_sessions(app):
    client = app.test_client()
    login(client)
    cookie = client.get_cookie('__Host-access', domain='workbench.strongcribbage.com').value
    replacement = MODULE.create_app({'username': 'viewer',
        'passwordHash': generate_password_hash('replacement', method='pbkdf2:sha256:1000'),
        'secretKey': app.config['SECRET_KEY']}).test_client()
    replacement.set_cookie('__Host-access', cookie, domain='workbench.strongcribbage.com')
    assert replacement.get('/verify', base_url=ORIGIN).status_code == 303


def test_rate_limit_and_form_limits(app):
    client = app.test_client()
    for _ in range(10):
        assert login(client, 'wrong-password').status_code == 400
    response = login(client)
    assert response.status_code == 429
    assert 'Retry-After' in response.headers
    assert 'WWW-Authenticate' not in response.headers
    assert client.post('/login', base_url=ORIGIN, data='x' * 5000).status_code == 413


def test_login_discloses_no_workbench_and_sets_security_headers(app):
    response = app.test_client().get('/login', base_url=ORIGIN)
    for text in ('cribbage', 'workbench', 'benchmark', 'training', 'gpu'):
        assert text not in response.text.lower()
    assert response.headers['Cache-Control'] == 'no-store'
    assert "frame-ancestors 'none'" in response.headers['Content-Security-Policy']
    assert response.headers['Referrer-Policy'] == 'no-referrer'
    assert 'autocapitalize="none"' in response.text


def test_missing_or_weak_configuration_is_rejected():
    with pytest.raises(ValueError):
        MODULE.create_app({'username': 'viewer', 'passwordHash': 'plain', 'secretKey': 'short'})


def test_untrusted_host_is_rejected_without_server_error(app):
    response = app.test_client().get('/login', base_url='https://untrusted.example')
    assert response.status_code == 400


def test_authenticated_form_posts_do_not_extend_absolute_session(app, monkeypatch):
    client = app.test_client()
    login(client)
    now = time.time()
    monkeypatch.setattr(time, 'time', lambda: now + 10 * 3600)
    response = client.post('/login', base_url=ORIGIN, headers={'Origin': ORIGIN})
    assert 'Set-Cookie' not in response.headers
    monkeypatch.setattr(time, 'time', lambda: now + 13 * 3600)
    assert client.get('/verify', base_url=ORIGIN).status_code == 303
