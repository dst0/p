# Python Security Best Practices

Python's dynamic nature and extensive standard library offer powerful features that can become critical vulnerabilities if misused.

## 1. Deserialization & Code Execution (CWE-502, CWE-94)

### Pickle Deserialization Attack
**Bad Pattern**: Deserializing untrusted data with `pickle`. `pickle` can execute arbitrary code upon unpickling.
```python
import pickle
# BAD: RCE vulnerability
def process_data(user_input_bytes):
    data = pickle.loads(user_input_bytes)
```

**Secure Pattern**: Use `json` for untrusted data or `pydantic`/`marshmallow` for structured validation.
```python
import json
# GOOD: JSON is purely data
def process_data(user_input_string):
    data = json.loads(user_input_string)
```

### Eval/Exec Dangers
**Bad Pattern**: Using `eval()` or `exec()` on user input.
```python
# BAD: RCE
result = eval(f"2 * {user_input}") 
```

**Secure Pattern**: Use `ast.literal_eval` for safely evaluating strings containing Python literals, or better, strictly parse the expected type (e.g., `int()`).

## 2. Web Frameworks (FastAPI, Django, Flask)

### SSRF Prevention (CWE-918)
Server-Side Request Forgery happens when a server fetches a URL provided by a user without validation.
**Bad Pattern**:
```python
import requests
@app.get("/proxy")
def proxy(url: str):
    # BAD: Attacker can fetch http://169.254.169.254/latest/meta-data/ (AWS metadata)
    return requests.get(url).content
```

**Secure Pattern**: Validate the URL against an allowlist, or resolve the hostname and ensure it's not a private/internal IP address.

### SQL Injection with ORMs (CWE-89)
ORMs like SQLAlchemy and Django ORM generally protect against SQLi if used correctly, but raw queries remain dangerous.
**Bad Pattern (SQLAlchemy)**:
```python
# BAD
connection.execute(f"SELECT * FROM users WHERE username='{username}'")
```
**Secure Pattern**:
```python
# GOOD: Parameterized
from sqlalchemy import text
connection.execute(text("SELECT * FROM users WHERE username=:username"), {"username": username})
```

### Pydantic Validation as a Security Boundary
In FastAPI and modern Python, strongly type all inputs using Pydantic. It acts as a robust security boundary rejecting malformed data before it reaches business logic.
```python
from pydantic import BaseModel, Field

class UserRegistration(BaseModel):
    # Enforce constraints at the boundary
    username: str = Field(..., pattern=r'^[a-zA-Z0-9_-]{3,20}$')
    age: int = Field(..., ge=18, le=120)
```

## 3. Environment & Isolation

- **Virtual Environments**: Always isolate project dependencies using `venv`, `poetry`, or `conda`.
- **Dependency Pinning**: Use `requirements.txt` with exact hashes (e.g., `pip-compile --generate-hashes`) or `poetry.lock` to prevent supply chain attacks via compromised upstream packages.
- **Secrets**: Use tools like `python-dotenv` or cloud secret managers (AWS Secrets Manager, HashiCorp Vault). Never commit `.env` files.
