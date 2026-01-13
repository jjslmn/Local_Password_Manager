import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SetupProps {
    onSuccess: () => void;
}

export default function Setup({ onSuccess }: SetupProps) {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState("");

    async function handleRegister(e: React.FormEvent) {
        e.preventDefault();
        if (password !== confirm) {
            setError("Passwords do not match");
            return;
        }
        if (password.length < 8) {
            setError("Password must be at least 8 chars");
            return;
        }

        try {
            await invoke("register_user", { username, password });
            onSuccess();
        } catch (err) {
            console.error(err);
            setError("Registration failed. See console.");
        }
    }

    return (
        <div style={{ padding: 40, color: "#fff", maxWidth: 400, margin: "auto" }}>
            <h2>Welcome to VibeVault</h2>
            <p style={{ color: "#aaa" }}>Create your master profile.</p>

            {error && <p style={{ color: "red" }}>{error}</p>}

            <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column", gap: 15 }}>
                <input
                    placeholder="Choose Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    style={{ padding: 12, borderRadius: 4, border: "1px solid #333", background: "#222", color: "white" }}
                />
                <input
                    type="password"
                    placeholder="Master Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ padding: 12, borderRadius: 4, border: "1px solid #333", background: "#222", color: "white" }}
                />
                <input
                    type="password"
                    placeholder="Confirm Password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    style={{ padding: 12, borderRadius: 4, border: "1px solid #333", background: "#222", color: "white" }}
                />
                <button type="submit" style={{ padding: 12, cursor: "pointer", background: "#fff", color: "#000", border: "none", fontWeight: "bold" }}>
                    Create Vault
                </button>
            </form>
        </div>
    );
}
