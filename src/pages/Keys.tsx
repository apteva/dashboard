import { useState, useEffect } from "react";
import { auth } from "../api";

interface Key {
  id: number;
  name: string;
  key_prefix: string;
  created_at: string;
}

export function Keys() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const loadKeys = () => auth.listKeys().then(setKeys).catch(() => {});

  useEffect(() => {
    loadKeys();
  }, []);

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    const result = await auth.createKey(newKeyName.trim());
    setNewKey(result.key);
    setNewKeyName("");
    loadKeys();
  };

  const deleteKey = async (id: number) => {
    await auth.deleteKey(id);
    loadKeys();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3">
        <span className="text-text-muted text-xs">// API KEYS</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Create key */}
        <form onSubmit={createKey} className="flex gap-2">
          <input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="flex-1 bg-bg-input border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
            placeholder="key name..."
          />
          <button
            type="submit"
            className="text-xs px-3 py-1.5 bg-accent text-bg rounded hover:bg-accent-hover transition-colors"
          >
            + new key
          </button>
        </form>

        {/* Show new key once */}
        {newKey && (
          <div className="border border-accent rounded p-3 bg-bg-card">
            <div className="text-accent text-xs mb-1">save this key — it won't be shown again:</div>
            <code className="text-text text-xs select-all">{newKey}</code>
            <button
              onClick={() => setNewKey(null)}
              className="block text-text-muted text-xs mt-2 hover:text-text"
            >
              dismiss
            </button>
          </div>
        )}

        {/* Key list */}
        {keys.length === 0 && !newKey && (
          <div className="text-text-muted text-xs">no API keys</div>
        )}
        {keys.map((k) => (
          <div key={k.id} className="border border-border rounded p-3 bg-bg-card flex items-center justify-between">
            <div>
              <span className="text-text text-sm">{k.name}</span>
              <span className="text-text-muted text-xs ml-3">{k.key_prefix}...</span>
            </div>
            <button
              onClick={() => deleteKey(k.id)}
              className="text-xs text-text-muted hover:text-red transition-colors"
            >
              [revoke]
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
