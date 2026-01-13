use std::sync::Mutex;
use rand::Rng;

// PUSH MODE: Advertise 0001, Scan 0002.
// PULL MODE: Advertise 0002, Scan 0001.

// For logic simple mapping:
const UUID_PUSH_ADV: &str = "00000001-0000-0000-0000-000000000000";
const UUID_PULL_ADV: &str = "00000002-0000-0000-0000-000000000000";

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum SyncState {
    Idle,
    AdvertisingPush, // Source
    AdvertisingPull, // Sink
    HandshakeWait,   // Found Peer, establishing connection
    ConfirmCode { code: String }, // Waiting for user to confirm "123-456"
    Syncing,
    Error(String),
}

pub struct BleSyncManager {
    state: Mutex<SyncState>,
}

impl BleSyncManager {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(SyncState::Idle),
        }
    }

    pub fn get_state(&self) -> SyncState {
        self.state.lock().unwrap().clone()
    }

    pub fn start_push_mode(&self) -> Result<(), String> {
        // Role: Advertise Push UUID
        let mut state = self.state.lock().unwrap();
        *state = SyncState::AdvertisingPush;
        
        // Mock: ble_plugin.advertise(UUID_PUSH_ADV).start();
        // Mock: ble_plugin.scan(UUID_PULL_ADV).start();
        
        // In a real implementation we would spawn a thread or task here 
        // to listen for the "Found Peer" event.
        Ok(())
    }

    pub fn start_pull_mode(&self) -> Result<(), String> {
        // Role: Advertise Pull UUID
        let mut state = self.state.lock().unwrap();
        *state = SyncState::AdvertisingPull;
        
        // Mock: ble_plugin.advertise(UUID_PULL_ADV).start();
        // Mock: ble_plugin.scan(UUID_PUSH_ADV).start();
        Ok(())
    }

    /// Simulates finding a peer (would be called by BLE callback)
    pub fn simulate_peer_found(&self) {
        let mut state = self.state.lock().unwrap();
        // Only if we are advertising/scanning do we transition
        if matches!(*state, SyncState::AdvertisingPush | SyncState::AdvertisingPull) {
             // Generate 6 digit code
             let code = format!("{:06}", rand::thread_rng().gen_range(0..999999));
             *state = SyncState::ConfirmCode { code };
        }
    }

    pub fn confirm_code(&self, user_code: &str) -> Result<String, String> {
        let mut state = self.state.lock().unwrap();
        if let SyncState::ConfirmCode { code } = &*state {
            if user_code == code {
                *state = SyncState::Syncing;
                return Ok("Paired! Starting Sync...".to_string());
            } else {
                return Err("Invalid Code".to_string());
            }
        }
        Err("Not in handshake mode".to_string())
    }
    
    pub fn stop(&self) {
         let mut state = self.state.lock().unwrap();
         *state = SyncState::Idle;
    }
}
