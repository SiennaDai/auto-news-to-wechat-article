"""Pydantic request models with validation."""

from typing import Optional

from pydantic import BaseModel, Field, EmailStr


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)


class TemplateSaveRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    config: dict


class TemplateUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    config: Optional[dict] = None


class KnowledgeBaseCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    content: Optional[str] = None
