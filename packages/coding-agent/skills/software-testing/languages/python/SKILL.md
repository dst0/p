---
name: software-testing-python
description: "Python test engineering guide: Pytest fixtures, scoping, parametrization, and Hypothesis property-based testing."
---

# Python Test Engineering Guide

This sub-skill provides conventions, fixture architectures, and generative testing methodologies for Python applications.

---

## 1. Core Principles

- Use `pytest` as the universal testing standard for all Python projects.
- Prefer explicit fixtures (`tmp_path`, `monkeypatch`) over global mutable state.
- Use `hypothesis` for discovering edge-case inputs, unicode anomalies, and numeric overflow.

---

## 2. Navigation

- [Pytest Fixtures & Scopes](file:///packages/coding-agent/skills/software-testing/languages/python/pytest-fixtures.md): Fixture lifecycles (`function`, `module`, `session`), autouse, parametrization, and teardown.
- [Hypothesis Property Testing](file:///packages/coding-agent/skills/software-testing/languages/python/hypothesis-property.md): Generative property tests, custom strategies, and stateful testing.
