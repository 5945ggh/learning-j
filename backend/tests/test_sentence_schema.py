import pytest
from pydantic import ValidationError

from learningj.api.export_openapi import build_openapi
from learningj.api.schemas import SentenceOut


def test_sentence_requires_anchor_payload_in_validation_and_openapi():
    sentence = dict(
        id="sentence", material_id="material", index=0,
        text="source", anchor_type="plain_text",
    )
    with pytest.raises(ValidationError) as error:
        SentenceOut.model_validate(sentence)
    assert any(
        item["loc"] == ("anchor_payload",) and item["type"] == "missing"
        for item in error.value.errors()
    )
    schema = build_openapi()["components"]["schemas"]["SentenceOut"]
    assert "anchor_payload" in schema["required"]
    payload = {"char_start": 0, "char_end": 6}
    assert SentenceOut.model_validate(
        {**sentence, "anchor_payload": payload}
    ).anchor_payload == payload
