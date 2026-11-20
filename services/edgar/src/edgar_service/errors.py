"""Service errors and the handlers that render them as ``{error: {code, message}}``."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from edgar_service.models import ErrorBody, ErrorResponse


class ServiceError(Exception):
    status_code = 500
    code = "internal_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFound(ServiceError):
    status_code = 404
    code = "not_found"


class UpstreamError(ServiceError):
    """SEC (or edgartools talking to SEC) failed: transport, HTTP error, unparsable data."""

    status_code = 502
    code = "upstream_error"


class ProvenanceError(ServiceError):
    """We could not attach accession/form/filed to a value, so we refuse to return it."""

    status_code = 502
    code = "provenance_missing"


class Unauthorized(ServiceError):
    status_code = 401
    code = "unauthorized"


class InvalidRequest(ServiceError):
    status_code = 422
    code = "validation_error"


class UnsupportedForm(ServiceError):
    status_code = 422
    code = "unsupported_form"


def error_json(status_code: int, code: str, message: str) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=code, message=message))
    return JSONResponse(status_code=status_code, content=body.model_dump())


ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "Missing or wrong X-Service-Key"},
    404: {"model": ErrorResponse, "description": "Unknown ticker, concept or accession"},
    422: {"model": ErrorResponse, "description": "Invalid request"},
    502: {"model": ErrorResponse, "description": "SEC/edgartools failure or missing provenance"},
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ServiceError)
    async def _service_error(_: Request, exc: ServiceError) -> JSONResponse:
        return error_json(exc.status_code, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        parts = [
            f"{'.'.join(str(p) for p in err.get('loc', ()))}: {err.get('msg', '')}"
            for err in exc.errors()
        ]
        return error_json(422, "validation_error", "; ".join(parts) or "invalid request")

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "not_found" if exc.status_code == 404 else f"http_{exc.status_code}"
        return error_json(exc.status_code, code, str(exc.detail))
