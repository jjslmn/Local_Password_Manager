import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

type SyncState =
    | "Idle"
    | "AdvertisingPush"
    | "AdvertisingPull"
    | "HandshakeWait"
    | { ConfirmCode: { code: string } }
    | "Syncing"
    | { Error: string };

export default function SyncDashboard() {
    const [status, setStatus] = useState<SyncState>("Idle");
    const [confirmInput, setConfirmInput] = useState("");
    const [feedback, setFeedback] = useState("");

    // Poll for state updates (rudimentary event loop without events trait)
    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                const s = await invoke("get_sync_state");
                setStatus(s as SyncState);
            } catch (e) {
                console.error(e);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    async function startPush() {
        await invoke("start_sync_push");
        setFeedback("Started Push Mode (Source)...");
    }

    async function startPull() {
        await invoke("start_sync_pull");
        setFeedback("Started Pull Mode (Receiver)...");
    }

    async function simulatePeer() {
        await invoke("debug_simulate_peer");
        setFeedback("Simulated Peer Discovery...");
    }

    async function submitCode() {
        try {
            const msg = await invoke("confirm_code", { code: confirmInput });
            setFeedback(msg as string);
        } catch (e: any) {
            setFeedback("Error: " + e);
        }
    }

    // Render Helpers
    const isConfirming = typeof status === "object" && "ConfirmCode" in status;
    const codeDisplay = isConfirming ? (status as any).ConfirmCode.code : "";

    return (
        <div className="sync-dashboard" style={{ marginTop: '2rem', borderTop: '1px solid #ccc', paddingTop: '1rem' }}>
            <h2>P2P Sync</h2>

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '1rem' }}>
                <button onClick={startPush}>Start Push (Source)</button>
                <button onClick={startPull}>Start Pull (Receiver)</button>
            </div>

            <div style={{ margin: '1rem 0', fontWeight: 'bold' }}>
                Status: {JSON.stringify(status)}
            </div>

            <div style={{ fontStyle: 'italic', color: '#666' }}>
                {feedback}
            </div>

            {/* Debug Tool */}
            {(status === "AdvertisingPush" || status === "AdvertisingPull") && (
                <button onClick={simulatePeer} style={{ marginTop: '1rem', backgroundColor: '#eee' }}>
                    [DEBUG] Simulate Peer Found
                </button>
            )}

            {/* Confirmation UI */}
            {isConfirming && (
                <div style={{ backgroundColor: '#e6fffa', padding: '1rem', borderRadius: '8px', border: '1px solid #b2f5ea', marginTop: '1rem' }}>
                    <h3>Pairing Request!</h3>
                    <p>Code: <strong style={{ fontSize: '1.5rem', letterSpacing: '2px' }}>{codeDisplay}</strong></p>
                    <p>Enter this code on the other device if required, or verify match.</p>

                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                        <input
                            type="text"
                            maxLength={6}
                            value={confirmInput}
                            onChange={e => setConfirmInput(e.target.value)}
                            placeholder="123456"
                        />
                        <button onClick={submitCode} style={{ backgroundColor: '#319795', color: 'white' }}>Confirm Pair</button>
                    </div>
                </div>
            )}
        </div>
    );
}
