export interface VaultEntry {
    id?: number;
    uuid: string;
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
}

/** Raw vault entry as returned by the Rust backend (before JSON parsing) */
export interface RawVaultEntry {
    id: number;
    uuid: string;
    data_blob: number[];
}
