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
