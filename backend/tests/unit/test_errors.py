"""錯誤分類本身的測試：錯誤碼、HTTP 狀態碼、CLI 離開代碼三者的對應關係。

這一份守的是「同一個問題在 API 與 CLI 得到同一種答案」——對照表只有一份，
任何人新增錯誤碼卻忘了登記，或改了狀態碼卻沒改離開代碼，都會在此被擋下。
"""
import pytest

from app.core.errors import (
    DEFAULT_CODE_BY_STATUS,
    ERROR_HTTP_STATUS,
    EXIT_UNEXPECTED,
    HTTP_STATUS_EXIT_CODE,
    PetsError,
    default_code_for_status,
)


def test_error_code_carries_status_and_exit_code():
    """錯誤碼決定狀態碼，狀態碼決定離開代碼——兩個介面共用同一條推導鏈。"""
    err = PetsError("ERR_CONFIG_DATA_MISMATCH", "欄位對不上。")
    assert err.http_status == 422
    assert err.exit_code == HTTP_STATUS_EXIT_CODE[422]


def test_unregistered_code_is_rejected():
    """沒登記的錯誤碼一律拒收：打錯字要在開發期就炸，不能悄悄變成別的狀態碼。"""
    with pytest.raises(KeyError):
        PetsError("ERR_NOT_A_REAL_CODE", "應該建不起來。")


def test_message_keeps_code_prefix_for_str():
    """str(e) 為「ERR_XXX: 說明」格式。"""
    err = PetsError("ERR_INVALID_PARAM", "seed 須為非負整數。")
    assert str(err) == "ERR_INVALID_PARAM: seed 須為非負整數。"
    assert err.message == "seed 須為非負整數。"


def test_is_a_value_error():
    """繼承 ValueError：except ValueError 的呼叫端一併接得到。"""
    assert isinstance(PetsError("ERR_BAD_REQUEST", "x"), ValueError)


def test_to_dict_omits_empty_recommendations():
    """沒有建議就不放這個欄位，回應主體不出現空陣列讓整合方誤判。"""
    assert "recommendations" not in PetsError("ERR_BAD_REQUEST", "x").to_dict()
    body = PetsError("ERR_BAD_REQUEST", "x", recommendations=["改這裡"]).to_dict()
    assert body["recommendations"] == ["改這裡"]


def test_every_registered_status_has_an_exit_code():
    """每個會出現的用戶端錯誤狀態碼都要有對應的離開代碼，CLI 才不會全部回同一個值。"""
    for code, status in ERROR_HTTP_STATUS.items():
        if status >= 500:
            assert PetsError(code, "x").exit_code == EXIT_UNEXPECTED
        else:
            assert status in HTTP_STATUS_EXIT_CODE, f"{code} 的狀態碼 {status} 未對應離開代碼"


def test_exit_codes_are_distinct_per_category():
    """不同類別的失敗要能被腳本分辨，離開代碼不可重複、也不可佔用 0（成功）與 1（未預期）。"""
    values = list(HTTP_STATUS_EXIT_CODE.values())
    assert len(values) == len(set(values))
    assert all(v > EXIT_UNEXPECTED for v in values)


def test_default_code_for_framework_statuses():
    """框架自己產生的狀態碼也要有錯誤碼，回應主體才不會少掉 error_code 欄位。"""
    assert default_code_for_status(401) == "ERR_UNAUTHORIZED"
    assert default_code_for_status(499) == "ERR_BAD_REQUEST"
    for status, code in DEFAULT_CODE_BY_STATUS.items():
        assert ERROR_HTTP_STATUS[code] == status
