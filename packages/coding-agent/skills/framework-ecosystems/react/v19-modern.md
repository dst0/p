# React 19 Modern Architecture (Default)

React 19 simplifies component authoring by deprecating `forwardRef`, introducing first-class async actions, and providing the `use()` API.

---

## 1. Direct `ref` as a Prop

In React 19, function components accept `ref` directly as a standard prop without `forwardRef`:

```tsx
interface TextInputProps {
  label: string;
  ref?: React.Ref<HTMLInputElement>;
}

export function TextInput({ label, ref }: TextInputProps) {
  return (
    <label>
      {label}
      <input ref={ref} className="text-input" />
    </label>
  );
}
```

---

## 2. Async Actions & `useActionState`

```tsx
import { useActionState } from "react";

async function updateUsernameAction(previousState: string | null, formData: FormData) {
  const newName = formData.get("username") as string;
  await api.updateProfile({ name: newName });
  return newName;
}

export function ProfileEditor() {
  const [name, formAction, isPending] = useActionState(updateUsernameAction, null);

  return (
    <form action={formAction}>
      <input name="username" defaultValue={name ?? ""} />
      <button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
```

---

## 3. Reading Promises with `use()`

```tsx
import { use, Suspense } from "react";

function UserProfile({ userPromise }: { userPromise: Promise<{ name: string }> }) {
  const user = use(userPromise);
  return <h1>Hello, {user.name}</h1>;
}
```
