import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AddEntryProps {
    onBack: () => void;
    onSave: () => void;
}

export default function AddEntry({ onBack, onSave }: AddEntryProps) {
    const [title, setTitle] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [notes, setNotes] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            await invoke("save_entry", {
                payload: {
                    title,
                    username,
                    password,
                    totp_secret: null, // Optional for now
                    notes
                }
            });
            onSave();
        } catch (err: any) {
            console.error(err);
            setError("Failed to save: " + err.toString());
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={{ height: "100%", background: "#1a1a1a", color: "white", padding: "20px", display: "flex", flexDirection: "column" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", marginBottom: "30px" }}>
                <button
                    onClick={onBack}
                    style={{
                        background: "transparent",
                        border: "none",
                        color: "#007AFF",
                        fontSize: "16px",
                        cursor: "pointer",
                        marginRight: "20px"
                    }}
                >
                    ← Back
                </button>
                <h2 style={{ margin: 0 }}>Add New Credential</h2>
            </div>

            {error && <p style={{ color: "red", marginBottom: "20px" }}>{error}</p>}

            <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "600px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "12px", color: "#aaa" }}>SITE NAME / TITLE</label>
                    <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Netflix, Google"
                        required
                        style={{ padding: "12px", background: "#333", border: "1px solid #444", borderRadius: "6px", color: "white", fontSize: "16px" }}
                    />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "12px", color: "#aaa" }}>USERNAME / EMAIL</label>
                    <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="entry@example.com"
                        style={{ padding: "12px", background: "#333", border: "1px solid #444", borderRadius: "6px", color: "white", fontSize: "16px" }}
                    />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "12px", color: "#aaa" }}>PASSWORD</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Secret123"
                        required
                        style={{ padding: "12px", background: "#333", border: "1px solid #444", borderRadius: "6px", color: "white", fontSize: "16px" }}
                    />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "12px", color: "#aaa" }}>NOTES</label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Additional details..."
                        style={{ padding: "12px", background: "#333", border: "1px solid #444", borderRadius: "6px", color: "white", fontSize: "16px", minHeight: "100px", resize: "vertical" }}
                    />
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    style={{
                        marginTop: "10px",
                        padding: "15px",
                        background: "#007AFF",
                        color: "white",
                        border: "none",
                        borderRadius: "8px",
                        fontSize: "16px",
                        fontWeight: "bold",
                        cursor: loading ? "wait" : "pointer",
                        opacity: loading ? 0.7 : 1
                    }}
                >
                    {loading ? "Saving..." : "Save to Vault"}
                </button>
            </form>
        </div>
    );
}
