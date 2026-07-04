from __future__ import annotations

"""Multi-agent registry — scaffolding for future orchestration."""

from typing import Any

AGENT_REGISTRY: list[dict[str, Any]] = [
    {
        "id": "orchestrator",
        "name": "Joeku 主 Agent",
        "role": "对话、意图识别、协调各子 Agent",
        "status": "active",
    },
    {
        "id": "planner",
        "name": "结构规划",
        "role": "论文大纲、章节分工、字数规划",
        "status": "planned",
    },
    {
        "id": "researcher",
        "name": "资料检索",
        "role": "Scholar 检索、资料库匹配、引用筛选",
        "status": "partial",
    },
    {
        "id": "writer",
        "name": "正文撰写",
        "role": "分节并行写作、引用嵌入",
        "status": "active",
    },
    {
        "id": "translator",
        "name": "翻译",
        "role": "跨语言文稿与摘要翻译",
        "status": "planned",
    },
    {
        "id": "polish",
        "name": "润色",
        "role": "去 AI 化、语气统一、段落打磨",
        "status": "partial",
    },
    {
        "id": "custom",
        "name": "自定义 Agent",
        "role": "用户可配置人设与任务模板",
        "status": "planned",
    },
]


def list_agents() -> list[dict[str, Any]]:
    return list(AGENT_REGISTRY)