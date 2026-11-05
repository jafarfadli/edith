import pytest
from fastapi.testclient import TestClient

from edith.main import create_app
from edith.settings import Settings


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path / "data")


@pytest.fixture
def client(settings) -> TestClient:
    with TestClient(create_app(settings)) as c:
        yield c


from edith.storage import Storage


class FakeClock:
    def __init__(self, t: float = 1_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def storage(tmp_path, clock) -> Storage:
    return Storage(tmp_path / "store", ttl=3600, tombstone_ttl=86400, clock=clock)
