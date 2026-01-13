import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface UnlockScreenProps {
    onUnlock: () => void;
}

export default function UnlockScreen({ onUnlock }: UnlockScreenProps) {
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    async function handleUnlock(e: React.FormEvent) {
        e.preventDefault();
        try {
            await invoke("unlock_vault", { password });
            onUnlock();
        } catch (err: any) {
            setError(err.toString());
        }
    }

    return (
        <div style={{ padding: 40, color: "#fff", maxWidth: 400, margin: "auto" }}>
            <h2>Unlock VibeVault</h2>

            {error && <p style={{ color: "red" }}>{error}</p>}

            <form onSubmit={handleUnlock} style={{ display: "flex", flexDirection: "column", gap: 15 }}>
                <input
                    type="password"
                    placeholder="Master Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ padding: 12, borderRadius: 4, border: "1px solid #333", background: "#222", color: "white" }}
                />
                <button type="submit" style={{ padding: 12, cursor: "pointer", background: "#fff", color: "#000", border: "none", fontWeight: "bold" }}>
                    Unlock
                </button>
            </form>
        </div>
    );
}
