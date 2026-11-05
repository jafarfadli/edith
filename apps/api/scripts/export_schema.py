import json

from pydantic import BaseModel

from edith.ops import ExportRequest, RenderPageRequest
from edith.settings import REPO_ROOT

OUT = REPO_ROOT / "packages" / "ops" / "schema.json"


class EdithSchema(BaseModel):
    export: ExportRequest
    renderPage: RenderPageRequest


def build_schema() -> dict:
    schema = EdithSchema.model_json_schema()
    schema["title"] = "EdithSchema"
    return schema


if __name__ == "__main__":
    OUT.write_text(json.dumps(build_schema(), indent=2) + "\n")
    print("wrote", OUT)
