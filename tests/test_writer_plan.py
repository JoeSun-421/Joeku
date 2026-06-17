from academic_agent.writer import fallback_plan, rebalance_plan


def test_rebalance_plan_hits_target_words() -> None:
    plan = fallback_plan("test topic", 5000)
    rebalanced = rebalance_plan(plan, 7000)
    assert rebalanced.target_words == 7000
    assert sum(section.target_words for section in rebalanced.sections) == 7000
