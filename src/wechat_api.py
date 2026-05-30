"""微信公众平台 API 客户端 — access_token、素材上传、草稿、发布。"""
import json
import os
import time
import requests


# ---- access_token 缓存 ----

_token_cache = {}  # keyed by appid


def get_access_token(appid: str, secret: str) -> str:
    """获取 access_token，按 appid 缓存，过期前 5 分钟刷新。"""
    entry = _token_cache.get(appid)
    if entry and entry["token"] and time.time() < entry["expires_at"] - 300:
        return entry["token"]

    resp = requests.get(
        "https://api.weixin.qq.com/cgi-bin/token",
        params={
            "grant_type": "client_credential",
            "appid": appid,
            "secret": secret,
        },
        timeout=15,
    )
    data = resp.json()
    if "errcode" in data and data["errcode"] != 0:
        raise RuntimeError(f"获取 access_token 失败: {data}")

    _token_cache[appid] = {
        "token": data["access_token"],
        "expires_at": time.time() + data.get("expires_in", 7200),
    }
    return _token_cache[appid]["token"]


# ---- 素材上传 ----

def upload_body_image(filepath: str, access_token: str) -> str:
    """上传图文正文内图片（不占用素材库配额），返回微信 url。"""
    filename = os.path.basename(filepath)
    with open(filepath, "rb") as f:
        resp = requests.post(
            "https://api.weixin.qq.com/cgi-bin/media/uploadimg",
            params={"access_token": access_token},
            files={"media": (filename, f, "image/jpeg")},
            timeout=60,
        )
    data = resp.json()
    if "url" not in data:
        raise RuntimeError(f"上传正文图片失败: {data}")
    return data["url"]


def upload_thumb(filepath: str, access_token: str) -> str:
    """上传封面缩略图，返回 media_id。"""
    filename = os.path.basename(filepath)
    with open(filepath, "rb") as f:
        resp = requests.post(
            "https://api.weixin.qq.com/cgi-bin/material/add_material",
            params={"access_token": access_token, "type": "thumb"},
            files={"media": (filename, f, "image/jpeg")},
            timeout=60,
        )
    data = resp.json()
    if "media_id" not in data:
        raise RuntimeError(f"上传封面图失败: {data}")
    return data["media_id"]


# ---- 草稿与发布 ----

def _encode_to_entities(text: str) -> str:
    """将非 ASCII 字符转为 HTML 数字实体，绕过微信侧 JSON 转义。"""
    result = []
    for ch in text:
        code = ord(ch)
        if code > 127:
            result.append(f"&#x{code:X};")
        else:
            result.append(ch)
    return "".join(result)


def create_draft(access_token: str, *, title: str, author: str,
                 content: str, thumb_media_id: str) -> str:
    """创建草稿，返回 draft media_id。"""
    article = {
        "title": title,
        "author": author,
        "content": _encode_to_entities(content),
        "thumb_media_id": thumb_media_id,
        "show_cover_pic": 1,
        "need_open_comment": 0,
        "only_fans_can_comment": 0,
    }
    body = json.dumps({"articles": [article]}, ensure_ascii=False).encode("utf-8")

    resp = requests.post(
        f"https://api.weixin.qq.com/cgi-bin/draft/add?access_token={access_token}",
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        timeout=30,
    )
    data = resp.json()
    if "media_id" not in data:
        raise RuntimeError(f"创建草稿失败: {data}")
    return data["media_id"]


def list_drafts(access_token: str, count: int = 20) -> list:
    """获取草稿列表，返回 items 列表（按更新时间降序）。"""
    resp = requests.post(
        f"https://api.weixin.qq.com/cgi-bin/draft/batchget?access_token={access_token}",
        json={"offset": 0, "count": count},
        timeout=15,
    )
    data = resp.json()
    return data.get("item", [])


def delete_draft(access_token: str, media_id: str) -> None:
    """删除一篇草稿。"""
    resp = requests.post(
        f"https://api.weixin.qq.com/cgi-bin/draft/delete?access_token={access_token}",
        json={"media_id": media_id},
        timeout=15,
    )
    data = resp.json()
    if data.get("errcode") != 0:
        raise RuntimeError(f"删除草稿失败: {data}")


def publish_draft(access_token: str, media_id: str) -> str:
    """发布草稿，返回 publish_id。"""
    resp = requests.post(
        f"https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token={access_token}",
        data=json.dumps({"media_id": media_id}, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        timeout=30,
    )
    data = resp.json()
    if "errcode" in data and data["errcode"] != 0:
        raise RuntimeError(f"发布失败: {data}")
    return data.get("publish_id", "")


def get_draft_url(access_token: str, media_id: str) -> str:
    """获取草稿的预览链接。"""
    resp = requests.post(
        f"https://api.weixin.qq.com/cgi-bin/draft/get?access_token={access_token}",
        json={"media_id": media_id},
        timeout=15,
    )
    data = resp.json()
    if "news_item" not in data:
        raise RuntimeError(f"获取草稿详情失败: {data}")
    return data["news_item"][0]["url"]
