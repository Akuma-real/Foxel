from fastapi import FastAPI

from .routes import adapters, virtual_fs, auth, config, processors, tasks, logs, share, backup, search, vector_db


def include_routers(app: FastAPI):
    app.include_router(adapters.router)
    app.include_router(virtual_fs.router)
    app.include_router(search.router)
    app.include_router(auth.router)
    app.include_router(config.router)
    app.include_router(processors.router)
    app.include_router(tasks.router)
    app.include_router(logs.router)
    app.include_router(share.router)
    app.include_router(share.public_router)
    app.include_router(backup.router)
    app.include_router(vector_db.router)