"""Password hashing, secret encryption, URL validation/redaction (SSRF + injection guards)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import re
import secrets
import socket
from urllib.parse import urlsplit, urlunsplit

from cryptography.fernet import Fernet, InvalidToken

# ---------------------------------------------------------------- passwords (stdlib scrypt)
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt_b64, dk_b64 = stored.split("$")
        if algo != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt_b64), **_SCRYPT)
        return hmac.compare_digest(dk, base64.b64decode(dk_b64))
    except Exception:
        return False


def validate_new_password(password: str) -> None:
    if len(password) < 10:
        raise ValueError("Password must be at least 10 characters")


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---------------------------------------------------------------- secrets at rest
class SecretBox:
    """Fernet encryption keyed from ES_SECRET_KEY. Without a key, secrets cannot be stored."""

    def __init__(self, key: str | None):
        self._f: Fernet | None = None
        if key:
            try:
                self._f = Fernet(key.encode())
            except (ValueError, TypeError):
                derived = base64.urlsafe_b64encode(hashlib.sha256(key.encode()).digest())
                self._f = Fernet(derived)

    @property
    def available(self) -> bool:
        return self._f is not None

    def encrypt(self, plaintext: str) -> str:
        if not self._f:
            raise RuntimeError("ES_SECRET_KEY is not set; refusing to store secrets in plaintext")
        return self._f.encrypt(plaintext.encode()).decode()

    def decrypt(self, token: str | None) -> str | None:
        if not token or not self._f:
            return None
        try:
            return self._f.decrypt(token.encode()).decode()
        except InvalidToken:
            return None


# ---------------------------------------------------------------- URL handling
_CTRL = re.compile(r"[\x00-\x20\x7f\"'`<>\\]")


def redact_url(url: str | None) -> str | None:
    """Strip userinfo and query tokens so credentials never leave the server."""
    if not url:
        return None
    try:
        p = urlsplit(url)
    except ValueError:
        return "<invalid url>"
    host = p.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    netloc = host + (f":{p.port}" if p.port else "")
    if p.username or p.password:
        netloc = "***@" + netloc
    query = "***" if p.query else ""
    return urlunsplit((p.scheme, netloc, p.path, query, ""))


def redact_text(text: str) -> str:
    """Remove anything URL-with-credentials-like from free text (logs, ffmpeg stderr)."""
    return re.sub(r"([a-z]+://)[^/\s@]+@", r"\1***@", text, flags=re.I)


def _resolve(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        return [ipaddress.ip_address(host)]
    except ValueError:
        pass
    infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    return list({ipaddress.ip_address(i[4][0].split("%")[0]) for i in infos})


def _in_networks(addr, networks: list[str]) -> bool:
    for n in networks:
        try:
            if addr in ipaddress.ip_network(n, strict=False):
                return True
        except ValueError:
            continue
    return False


class UrlRejected(ValueError):
    pass


def validate_rtsp_url(url: str, allowed_networks: list[str], resolve: bool = True) -> str:
    """Return a normalised URL or raise UrlRejected.

    * scheme must be rtsp/rtsps (ffmpeg is also locked to a protocol whitelist)
    * no whitespace/control/shell-meaningful characters (we never use a shell, but defence in depth)
    * host must resolve into the configured allowed networks (cameras live on the LAN);
      cloud metadata / link-local is always refused.
    """
    url = url.strip()
    if len(url) > 1024 or _CTRL.search(url):
        raise UrlRejected("URL contains illegal characters")
    try:
        p = urlsplit(url)
        _ = p.port
    except ValueError as e:
        raise UrlRejected(f"Malformed URL: {e}") from None
    if p.scheme not in ("rtsp", "rtsps"):
        raise UrlRejected("Only rtsp:// or rtsps:// URLs are accepted")
    if not p.hostname:
        raise UrlRejected("URL has no host")
    if resolve:
        try:
            addrs = _resolve(p.hostname)
        except OSError:
            raise UrlRejected(f"Host {p.hostname!r} does not resolve") from None
        for a in addrs:
            if a.is_link_local or a.is_multicast or a.is_unspecified:
                raise UrlRejected("Link-local, multicast and unspecified addresses are blocked")
            if not _in_networks(a, allowed_networks):
                raise UrlRejected(f"{a} is outside ES_RTSP_ALLOWED_NETWORKS; add its network to allow it")
    return url


def validate_webhook_url(url: str, allow: list[str]) -> str:
    """Webhooks: https only, public addresses unless host/CIDR explicitly allowlisted."""
    url = url.strip()
    if len(url) > 2048 or _CTRL.search(url):
        raise UrlRejected("URL contains illegal characters")
    p = urlsplit(url)
    if p.scheme != "https":
        raise UrlRejected("Webhooks must use https://")
    if not p.hostname or p.username or p.password:
        raise UrlRejected("Webhook URL must have a host and no embedded credentials")
    if p.hostname in allow:
        return url
    try:
        addrs = _resolve(p.hostname)
    except OSError:
        raise UrlRejected(f"Host {p.hostname!r} does not resolve") from None
    for a in addrs:
        if _in_networks(a, allow):
            continue
        if not a.is_global:
            raise UrlRejected(f"{a} is a private/reserved address; allowlist it via ES_WEBHOOK_ALLOW to use it")
    return url
