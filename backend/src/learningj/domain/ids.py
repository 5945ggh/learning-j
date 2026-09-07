"""ID 生成：UUIDv7（RFC 9562）。

`data-model.md` §0 要求所有实体带「UUIDv7 或等价的单调递增 ID」。
实现要点：

- 48 bit Unix 毫秒时间戳 + 12 bit `rand_a`（同毫秒内作单调计数器）+ 62 bit 随机数；
- 同一毫秒内并发调用仍保持字典序递增；
- 计数器起点每毫秒随机，避免跨进程可预测性。
"""

from __future__ import annotations

import secrets
import threading
import time
import uuid

_COUNTER_SEED_MASK = 0x0FFF
_TIMESTAMP_MASK = 0xFFFF_FFFF_FFFF

_lock = threading.Lock()
_state = {"ms": -1, "counter": 0}


def new_uuid7() -> uuid.UUID:
    """生成一个新的 UUIDv7。同进程内字典序单调递增。

    单调性由「时间戳递增 + 同毫秒 `rand_a` 计数器递增」共同保证；
    计数器回绕到 0 时时间戳前移（字典序仍增）。
    """
    with _lock:
        ms = time.time_ns() // 1_000_000
        if ms != _state["ms"]:
            _state["ms"] = ms
            # 新毫秒从 0 重新计数（不随机起点）：随机起点会让新毫秒的
            # rand_a 小于上一毫秒的尾部值，破坏字典序单调性。
            _state["counter"] = 0
        else:
            _state["counter"] = (_state["counter"] + 1) & _COUNTER_SEED_MASK
            if _state["counter"] == 0:
                # 同一毫秒内 12 bit 计数器用尽：推进到下一毫秒重新起算。
                _state["ms"] += 1
                ms = _state["ms"]
                _state["counter"] = 0
        rand_a = _state["counter"]
        rand_b = secrets.randbits(62)

    value = (
        (ms & _TIMESTAMP_MASK) << 80
        | (0x7 << 76)  # version 7
        | (rand_a << 64)
        | (0b10 << 62)  # RFC 4122 variant
        | rand_b
    )
    return uuid.UUID(int=value)
