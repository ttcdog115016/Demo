"""★ TTC 2026-10-28：密碼長度下限（預設 12，OPEN_PETS_PASSWORD_MIN_LENGTH 可調）。"""
import pytest

from app.core.errors import PetsError
from app.governance.auth import AuthManager, get_password_min_length


@pytest.fixture
def strict_auth(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_PETS_PASSWORD_MIN_LENGTH", "12")
    manager = AuthManager(db_path=str(tmp_path / "users.db"))
    return manager


def test_default_is_12(monkeypatch):
    monkeypatch.delenv("OPEN_PETS_PASSWORD_MIN_LENGTH", raising=False)
    assert get_password_min_length() == 12
    monkeypatch.setenv("OPEN_PETS_PASSWORD_MIN_LENGTH", "abc")
    assert get_password_min_length() == 12


def test_create_user_rejects_short_password(strict_auth):
    with pytest.raises(PetsError) as exc_info:
        strict_auth.create_user("bob", "short-pass", "user")
    assert exc_info.value.error_code == "ERR_INVALID_PARAM"
    strict_auth.create_user("bob", "long-enough-pass", "user")
    assert strict_auth.get_user("bob") is not None


def test_change_and_reset_password_reject_short_password(strict_auth):
    strict_auth.create_user("carol", "carol-password-1", "user")
    with pytest.raises(PetsError):
        strict_auth.change_password("carol", "carol-password-1", "short")
    assert strict_auth.change_password("carol", "carol-password-1", "carol-password-2") is True
    with pytest.raises(PetsError):
        strict_auth.reset_password("carol", "tiny")
    strict_auth.reset_password("carol", "carol-password-3")
    assert strict_auth.authenticate("carol", "carol-password-3").ok
