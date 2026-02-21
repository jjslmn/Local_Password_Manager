export interface VaultEntry {
    id?: number;
    uuid: string;
    entryUuid?: string;
    username?: string;
    password?: string;
    totpSecret?: string;
    notes?: string;
}

export interface Profile {
    id: number;
    name: string;
    createdAt: string;
    entryCount: number;
}

export interface DashboardProps {
    onLogout: () => void;
    sessionToken: string;
}

/** Raw vault entry as returned by the Rust backend (before JSON parsing) */
export interface RawVaultEntry {
    id: number;
    uuid: string;
    data_blob: number[];
    entry_uuid?: string;
}

export interface PairedDevice {
    id: number;
    device_name: string;
    device_id: string;
    paired_at: string;
    last_sync_at: string | null;
}

export interface SyncHistoryEntry {
    id: number;
    device_id: string;
    direction: string;
    entries_sent: number;
    entries_received: number;
    status: string;
    started_at: string;
    completed_at: string | null;
    error_message: string | null;
}

export interface SyncProgress {
    state: "idle" | "advertising" | "pairing" | "transferring" | "complete" | "error";
    chunks_transferred: number;
    total_chunks: number;
    message: string;
}
