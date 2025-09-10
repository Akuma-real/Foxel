import time
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from services.logging import LogService
from models.database import UserAccount
import jwt
from jwt.exceptions import InvalidTokenError
from services.auth import ALGORITHM
from services.config import ConfigCenter


class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        method = request.method.upper()
        if method == "GET":
            if path == "/api/logs" or path == "/api/plugins" or path.startswith("/api/config"):
                return await call_next(request)

        start_time = time.time()
        user_id = None
        if "authorization" in request.headers:
            token_str = request.headers.get("authorization")
            try:
                if token_str and token_str.startswith("Bearer "):
                    token = token_str.split(" ")[1]
                    payload = jwt.decode(token, await ConfigCenter.get_secret_key("SECRET_KEY"), algorithms=[ALGORITHM])
                    username = payload.get("sub")
                    if username:
                        user_account = await UserAccount.get_or_none(username=username)
                        if user_account:
                            user_id = user_account.id
            except (InvalidTokenError, Exception):
                pass

        response = await call_next(request)

        process_time = (time.time() - start_time) * 1000

        details = {
            "client_ip": request.client.host,
            "method": request.method,
            "path": request.url.path,
            "headers": dict(request.headers),
            "status_code": response.status_code,
            "process_time_ms": round(process_time, 2)
        }

        message = f"{request.method} {request.url.path} - {response.status_code}"

        await LogService.api(message, details, user_id)

        return response
