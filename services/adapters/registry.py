from typing import Dict, Callable
import pkgutil
import inspect
from importlib import import_module

from .base import BaseAdapter
from models import StorageAdapter

AdapterFactory = Callable[[StorageAdapter], object]

TYPE_MAP: Dict[str, AdapterFactory] = {}
CONFIG_SCHEMAS: Dict[str, list] = {}


def discover_adapters():
    """扫描 services.adapters 包, 自动注册适配器类型、工厂与配置 schema。"""
    from .. import adapters as adapters_pkg
    TYPE_MAP.clear()
    CONFIG_SCHEMAS.clear()
    for modinfo in pkgutil.iter_modules(adapters_pkg.__path__):
        if modinfo.name.startswith("_"):
            continue
        full_name = f"{adapters_pkg.__name__}.{modinfo.name}"
        try:
            module = import_module(full_name)
        except Exception:
            continue
        adapter_type = getattr(module, "ADAPTER_TYPE", None)
        schema = getattr(module, "CONFIG_SCHEMA", None)
        factory = getattr(module, "ADAPTER_FACTORY", None)

        if not adapter_type:
            continue

        if factory is None:
            for attr in module.__dict__.values():
                if inspect.isclass(attr) and attr.__name__.endswith("Adapter"):
                    def _mk(cls=attr):
                        return lambda rec: cls(rec)
                    factory = _mk()
                    break
        if not callable(factory):
            continue

        TYPE_MAP[adapter_type] = factory
        if isinstance(schema, list):
            CONFIG_SCHEMAS[adapter_type] = schema


def get_config_schemas() -> Dict[str, list]:
    return CONFIG_SCHEMAS


def get_config_schema(adapter_type: str):
    return CONFIG_SCHEMAS.get(adapter_type)


class RuntimeRegistry:
    def __init__(self):
        self._instances: Dict[int, object] = {}

    async def refresh(self):
        discover_adapters()
        self._instances.clear()
        adapters = await StorageAdapter.filter(enabled=True)
        for rec in adapters:
            factory = TYPE_MAP.get(rec.type)
            if not factory:
                continue
            try:
                self._instances[rec.id] = factory(rec)
            except Exception:
                continue  

    def get(self, adapter_id: int):
        return self._instances.get(adapter_id)

    def snapshot(self) -> Dict[int, BaseAdapter]:
        return dict(self._instances)

    def remove(self, adapter_id: int):
        """从缓存中移除一个适配器实例"""
        if adapter_id in self._instances:
            del self._instances[adapter_id]

    async def upsert(self, rec: StorageAdapter):
        """新增或更新一个适配器实例"""
        if not rec.enabled:
            self.remove(rec.id)
            return
        
        factory = TYPE_MAP.get(rec.type)
        if not factory:
            discover_adapters()
            factory = TYPE_MAP.get(rec.type)
            if not factory:
                return

        try:
            instance = factory(rec)
            self._instances[rec.id] = instance
        except Exception:
            self.remove(rec.id)
            pass


runtime_registry = RuntimeRegistry()
discover_adapters()
