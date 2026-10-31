from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import get_db
from .models import User, UserSession

COOKIE_NAME = "brightloop_session"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, salt_hex, digest_hex = stored.split("$", 2)
        if algorithm != "scrypt":
            return False
        candidate = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=64)
        return hmac.compare_digest(candidate.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def issue_session(response: Response, db: Session, user: User) -> None:
    token = secrets.token_urlsafe(40)
    db.add(UserSession(user_id=user.id, token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at=datetime.utcnow() + timedelta(days=7)))
    db.commit()
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=False, samesite="lax", max_age=7 * 24 * 60 * 60, path="/")


def revoke_session(request: Request, response: Response, db: Session) -> None:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        digest = hashlib.sha256(token.encode()).hexdigest()
        session = db.scalar(select(UserSession).where(UserSession.token_hash == digest))
        if session:
            db.delete(session)
            db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to continue.")
    digest = hashlib.sha256(token.encode()).hexdigest()
    session = db.scalar(select(UserSession).where(UserSession.token_hash == digest, UserSession.expires_at > datetime.utcnow()))
    user = db.get(User, session.user_id) if session else None
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Your session has expired. Sign in again.")
    return user


def require_roles(*roles: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to perform this action.")
        return user
    return dependency
