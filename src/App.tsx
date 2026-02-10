import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Dashboard from "./components/Dashboard";

function App() {
    const [isRegistered, setIsRegistered] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        checkRegistration();
    }, []);

    async function checkRegistration() {
        try {
            const status = await invoke("check_registration_status");
            setIsRegistered(status as boolean);
        } catch {
            // Registration check failed, assume not registered
        }
    }

    async function handleRegister() {
        if (!username || !password) {
            setError("Please fill in all fields");
            return;
        }
        try {
            await invoke("register_user", { username, pass: password });
            setIsRegistered(true);
            setError("");
            alert("Registration Successful! Please Log In.");
        } catch (e) {
            setError("Registration failed: " + e);
        }
    }

    async function handleLogin() {
        try {
            await invoke("unlock_vault", { username, pass: password });
            setIsAuthenticated(true);
            setError("");
        } catch (e) {
            setError("Login failed: " + e);
        }
    }

    function handleLogout() {
        setIsAuthenticated(false);
        setUsername("");
        setPassword("");
    }

    if (isAuthenticated) {
        return <Dashboard onLogout={handleLogout} />;
    }

    return (
        <div style={{
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#1a1a1a",
            color: "white",
            fontFamily: "sans-serif"
        }}>
            <form
                style={{ width: "300px", textAlign: "center" }}
                onSubmit={(e) => {
                    e.preventDefault();
                    isRegistered ? handleLogin() : handleRegister();
                }}
            >
                <h1 style={{ marginBottom: "10px" }}>VibeVault</h1>
                <p style={{ color: "#888", marginBottom: "30px" }}>
                    {isRegistered ? "Unlock your vault" : "Create your Master Account"}
                </p>

                <input
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    style={inputStyle}
                    autoFocus
                />
                <input
                    type="password"
                    placeholder="Master Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={inputStyle}
                />

                {error && <p style={{ color: "#ff4444", fontSize: "14px" }}>{error}</p>}

                <button
                    type="submit"
                    style={{
                        width: "100%",
                        padding: "12px",
                        background: "#8A2BE2",
                        color: "white",
                        border: "none",
                        borderRadius: "6px",
                        fontSize: "16px",
                        cursor: "pointer",
                        fontWeight: "bold",
                        marginTop: "10px"
                    }}
                >
                    {isRegistered ? "Unlock Vault" : "Create Account"}
                </button>
            </form>
        </div>
    );
}

const inputStyle = {
    width: "100%",
    padding: "12px",
    marginBottom: "15px",
    borderRadius: "6px",
    border: "1px solid #333",
    background: "#252525",
    color: "white",
    boxSizing: "border-box" as const
};

export default App;
