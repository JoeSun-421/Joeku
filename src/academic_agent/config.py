from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    openai_base_url: str = Field(default="https://api.openai.com/v1", alias="OPENAI_BASE_URL")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4.1", alias="OPENAI_MODEL")
    openai_timeout_seconds: float = Field(default=120.0, alias="OPENAI_TIMEOUT_SECONDS")
    semantic_scholar_api_key: str = Field(default="", alias="SEMANTIC_SCHOLAR_API_KEY")
    default_data_root: str = Field(default="", alias="DEFAULT_DATA_ROOT")


@lru_cache
def get_settings() -> Settings:
    return Settings()
