"""Write the OpenAPI spec to ``services/edgar/openapi.json``.

``uv run python -m edgar_service.export_openapi`` (no network; a placeholder identity is
used if SEC_USER_AGENT is unset, since the spec does not depend on it).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from edgar_service.config import SERVICE_ROOT

OUTPUT = SERVICE_ROOT / "openapi.json"


def export(path: Path = OUTPUT) -> Path:
    os.environ.setdefault("SEC_USER_AGENT", "DealPilot openapi-export noreply@example.com")
    from edgar_service.main import create_app

    spec = create_app().openapi()
    path.write_text(json.dumps(spec, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    return path


if __name__ == "__main__":
    out = export(Path(sys.argv[1]) if len(sys.argv) > 1 else OUTPUT)
    print(f"wrote {out}")
