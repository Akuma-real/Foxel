from pydantic import BaseModel
from typing import List, Optional


class VfsEntry(BaseModel):
    name: str
    is_dir: bool
    size: int
    mtime: int
    type: Optional[str] = None
    is_image: Optional[bool] = None


class DirListing(BaseModel):
    path: str
    entries: List[VfsEntry]
    pagination: Optional[dict] = None


class SearchResultItem(BaseModel):
    id: int | str
    path: str
    score: float


class MkdirRequest(BaseModel):
    path: str


class MoveRequest(BaseModel):
    src: str
    dst: str
