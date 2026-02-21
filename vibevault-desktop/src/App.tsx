import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import Dashboard from "./components/Dashboard";

function App() {
    const [isRegistered, setIsRegistered] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [sessionToken, setSessionToken] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const activityThrottle = useRef(0);

    useEffect(() => {
        checkRegistration();
    }, []);

    // Inactivity auto-lock: notify the backend on user interaction (throttled)
    const touchActivity = useCallback(() => {
        const now = Date.now();
        if (now - activityThrottle.current < 30_000) return; // throttle to once per 30s
        activityThrottle.current = now;
        invoke("touch_activity").catch(() => {});
    }, []);

    useEffect(() => {
        if (!isAuthenticated) return;
        const events = ["mousemove", "keydown", "mousedown", "scroll", "touchstart"];
        events.forEach((e) => window.addEventListener(e, touchActivity));
        // Periodically check if session is still alive (every 60s)
        const interval = setInterval(async () => {
            try {
                await invoke("get_all_vault_entries", { token: sessionToken });
            } catch {
                // Session expired on backend — lock the UI
                handleLogout();
            }
        }, 60_000);
        return () => {
            events.forEach((e) => window.removeEventListener(e, touchActivity));
            clearInterval(interval);
        };
    }, [isAuthenticated, sessionToken, touchActivity]);

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
            console.error("Registration failed:", e);
            setError("Registration failed. Please try again.");
        }
    }

    async function handleLogin() {
        try {
            const token = await invoke<string>("unlock_vault", { username, pass: password });
            setSessionToken(token);
            setIsAuthenticated(true);
            setError("");
        } catch (e) {
            const msg = typeof e === "string" && e.startsWith("Too many failed attempts")
                ? e
                : "Login failed. Please check your credentials and try again.";
            console.error("Login failed:", e);
            setError(msg);
        }
    }

    async function handleLogout() {
        try {
            await invoke("lock_vault");
        } catch {
            // Best-effort lock; clear frontend state regardless
        }
        setSessionToken("");
        setIsAuthenticated(false);
        setUsername("");
        setPassword("");
    }

    if (isAuthenticated) {
        return <Dashboard onLogout={handleLogout} sessionToken={sessionToken} />;
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
