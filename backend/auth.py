"""
Authentication: email + password (Argon2) and Emergent-managed Google sign-in.

Both providers end up in the same `users` document (matched by normalised email) and
both mint an opaque 7-day `session_token` stored in `user_sessions`. Every data route
resolves the current user from `Authorization: Bearer <session_token>`.
"""
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pwdlib import PasswordHash
from pydantic import BaseModel, EmailStr, Field
from pymongo.errors import DuplicateKeyError

from models import DEMO_USER_ID

EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
SESSION_DAYS = 7

_hasher = PasswordHash.recommended()
_DUMMY_HASH = _hasher.hash("not-a-real-password")

router = APIRouter(prefix="/auth")
_db = None  # injected by server.py
_seed_demo_for = None  # async callable(user_id) injected by server.py


def configure(db, seed_demo_for):
    global _db, _seed_demo_for
    _db, _seed_demo_for = db, seed_demo_for


async def ensure_indexes():
    await _db.users.create_index("email_normalized", unique=True)
    await _db.users.create_index("user_id", unique=True)
    await _db.user_sessions.create_index("session_token", unique=True)
    await _db.user_sessions.create_index("user_id")
    await _db.user_sessions.create_index("expires_at", expireAfterSeconds=0)


# ---------------------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(default="", max_length=80)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class SessionIn(BaseModel):
    session_id: str = Field(min_length=1)


class ProfilePatch(BaseModel):
    name: Optional[str] = Field(default=None, max_length=80)
    onboarded: Optional[bool] = None
    app_lock: Optional[bool] = None


def _norm(email: str) -> str:
    return email.strip().casefold()


def _public(u: dict) -> dict:
    return {
        "user_id": u["user_id"],
        "email": u["email"],
        "name": u.get("name") or "",
        "picture": u.get("picture"),
        "auth_providers": u.get("auth_providers", []),
        "onboarded": bool(u.get("onboarded")),
        "app_lock": bool(u.get("app_lock")),
        "is_demo": u["user_id"] == DEMO_USER_ID,
    }


async def _mint_session(user_id: str, token: Optional[str] = None) -> str:
    token = token or secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    await _db.user_sessions.insert_one({"session_token": token, "user_id": user_id, "created_at": now, "expires_at": now + timedelta(days=SESSION_DAYS)})
    return token


def _unauthorized() -> HTTPException:
    return HTTPException(401, "Invalid or expired credentials", headers={"WWW-Authenticate": "Bearer"})


async def current_user(request: Request) -> dict:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise _unauthorized()
    token = header[7:].strip()
    sess = await _db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        raise _unauthorized()
    exp = sess["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        raise _unauthorized()
    user = await _db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user:
        raise _unauthorized()
    return user


def user_id_of(user: dict = Depends(current_user)) -> str:
    return user["user_id"]


# ---------------------------------------------------------------------------
@router.post("/register", status_code=201)
async def register(body: RegisterIn):
    email = _norm(str(body.email))
    doc = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}",
        "email": email,
        "email_normalized": email,
        "name": body.name.strip(),
        "password_hash": _hasher.hash(body.password),
        "auth_providers": ["password"],
        "onboarded": False,
        "app_lock": False,
        "created_at": datetime.now(timezone.utc),
    }
    try:
        await _db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "An account already exists for this email")
    return {"session_token": await _mint_session(doc["user_id"]), "user": _public(doc)}


@router.post("/login")
async def login(body: LoginIn):
    user = await _db.users.find_one({"email_normalized": _norm(str(body.email))}, {"_id": 0})
    if user and user.get("password_hash"):
        valid = _hasher.verify(body.password, user["password_hash"])
    else:
        _hasher.verify(body.password, _DUMMY_HASH)  # constant-time-ish path
        valid = False
    if not valid:
        raise _unauthorized()
    return {"session_token": await _mint_session(user["user_id"]), "user": _public(user)}


@router.post("/session")
async def google_session(body: SessionIn):
    """Exchange the one-time Emergent session_id (from the redirect URL) for our session token."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": body.session_id})
    except httpx.HTTPError:
        raise HTTPException(401, "Could not verify Google sign-in")
    if r.status_code != 200:
        raise HTTPException(401, "Invalid or expired sign-in session")
    data = r.json()
    email = _norm(data.get("email", ""))
    if not email:
        raise HTTPException(401, "Google account has no email")
    user = await _db.users.find_one({"email_normalized": email}, {"_id": 0})
    if user:
        await _db.users.update_one({"user_id": user["user_id"]}, {"$set": {"picture": data.get("picture"), "name": user.get("name") or data.get("name", "")}, "$addToSet": {"auth_providers": "google"}})
        user = await _db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    else:
        user = {
            "user_id": f"user_{uuid.uuid4().hex[:12]}", "email": email, "email_normalized": email,
            "name": data.get("name", ""), "picture": data.get("picture"), "auth_providers": ["google"],
            "onboarded": False, "app_lock": False, "created_at": datetime.now(timezone.utc),
        }
        await _db.users.insert_one(user)
    token = await _mint_session(user["user_id"], data.get("session_token"))
    return {"session_token": token, "user": _public(user)}


@router.post("/demo")
async def demo_login():
    """Explore with demo data: shared demo account with the synthetic ₹5,000 story."""
    user = await _db.users.find_one({"user_id": DEMO_USER_ID}, {"_id": 0})
    if not user:
        user = {
            "user_id": DEMO_USER_ID, "email": "demo@artha.app", "email_normalized": "demo@artha.app",
            "name": "Demo", "auth_providers": ["demo"], "onboarded": True, "app_lock": False,
            "created_at": datetime.now(timezone.utc),
        }
        await _db.users.insert_one(user)
    if await _db.accounts.count_documents({"user_id": DEMO_USER_ID}) == 0:
        await _seed_demo_for(DEMO_USER_ID)
    return {"session_token": await _mint_session(DEMO_USER_ID), "user": _public(user)}


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    return _public(user)


@router.patch("/me")
async def patch_me(body: ProfilePatch, user: dict = Depends(current_user)):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if patch:
        await _db.users.update_one({"user_id": user["user_id"]}, {"$set": patch})
    return _public(await _db.users.find_one({"user_id": user["user_id"]}, {"_id": 0}))


@router.post("/logout")
async def logout(request: Request):
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        await _db.user_sessions.delete_one({"session_token": header[7:].strip()})
    return {"ok": True}
