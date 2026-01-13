export interface VaultEntry {
    id: number;
    uuid: string;
    title: string;
    username: string;
    has_totp: boolean;
    password?: string;
    notes?: string;
}

export interface VaultEntryPayload {
    title: string;
    username: string;
    password: string;
    totp_secret?: string;
    notes: string;
}

export interface VaultEntryResponse {
    id: number;
    uuid: string;
    payload: VaultEntryPayload;
    created_at: number;
}
