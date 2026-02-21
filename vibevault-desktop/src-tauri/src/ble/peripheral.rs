// Linux-only GATT Peripheral using bluer (BlueZ D-Bus bindings)
//
// Implements a BLE GATT server that advertises the VibeVault sync service
// and handles connections from the iOS app (GATT Central).

use bluer::{
    adv::Advertisement,
    gatt::local::{
        characteristic_control, Application, Characteristic, CharacteristicControlEvent,
        CharacteristicNotify, CharacteristicNotifyMethod, CharacteristicRead,
        CharacteristicWrite, Service,
    },
};
use futures::StreamExt;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex as TokioMutex};

// Custom 128-bit UUIDs for the VibeVault sync service
pub fn service_uuid() -> uuid::Uuid {
    uuid::Uuid::from_u128(0xa1b2c3d4_e5f6_7890_abcd_ef0123456789)
}
pub fn mode_char_uuid() -> uuid::Uuid {
    uuid::Uuid::from_u128(0xa1b2c3d4_e5f6_7890_abcd_ef012345678a)
}
pub fn pairing_char_uuid() -> uuid::Uuid {
    uuid::Uuid::from_u128(0xa1b2c3d4_e5f6_7890_abcd_ef012345678b)
}
pub fn sync_control_char_uuid() -> uuid::Uuid {
    uuid::Uuid::from_u128(0xa1b2c3d4_e5f6_7890_abcd_ef012345678c)
}
pub fn data_transfer_char_uuid() -> uuid::Uuid {
    uuid::Uuid::from_u128(0xa1b2c3d4_e5f6_7890_abcd_ef012345678d)
}

/// Events emitted by the peripheral to the sync orchestrator
#[derive(Debug, Clone)]
pub enum PeripheralEvent {
    PairingDataReceived { data: Vec<u8> },
    SyncControlReceived { control: u8 },
    DataChunkReceived { data: Vec<u8> },
}

/// Start advertising and serving the GATT application.
/// Returns a handle to control the peripheral and a receiver for events.
pub async fn start_peripheral(
    mode: super::protocol::SyncMode,
    pairing_public_key: Vec<u8>,
) -> Result<(PeripheralHandle, mpsc::Receiver<PeripheralEvent>), String> {
    let session = bluer::Session::new()
        .await
        .map_err(|e| format!("BlueZ session: {}", e))?;
    let adapter = session
        .default_adapter()
        .await
        .map_err(|e| format!("No BLE adapter: {}", e))?;
    adapter
        .set_powered(true)
        .await
        .map_err(|e| format!("Power on failed: {}", e))?;
    adapter
        .set_discoverable(true)
        .await
        .map_err(|e| format!("Discoverable failed: {}", e))?;

    let (event_tx, event_rx) = mpsc::channel::<PeripheralEvent>(32);

    // Mode characteristic: read-only, returns current sync mode byte
    let mode_value = Arc::new(TokioMutex::new(vec![mode as u8]));
    let mode_value_read = mode_value.clone();
    let (_mode_control, mode_handle) = characteristic_control();

    // Pairing characteristic: readable (our public key) + writable (peer sends theirs)
    let pairing_value = Arc::new(TokioMutex::new(pairing_public_key));
    let pairing_value_read = pairing_value.clone();
    let (pairing_control, pairing_handle) = characteristic_control();

    // Sync Control characteristic: writable + notifiable
    let (sync_control, sync_control_handle) = characteristic_control();

    // Data Transfer characteristic: writable + notifiable
    let (data_control, data_handle) = characteristic_control();

    let app = Application {
        services: vec![Service {
            uuid: service_uuid(),
            primary: true,
            characteristics: vec![
                // Mode (Read)
                Characteristic {
                    uuid: mode_char_uuid(),
                    read: Some(CharacteristicRead {
                        read: true,
                        fun: Box::new(move |_req| {
                            let val = mode_value_read.clone();
                            Box::pin(async move {
                                let v = val.lock().await;
                                Ok(v.clone())
                            })
                        }),
                        ..Default::default()
                    }),
                    control_handle: mode_handle,
                    ..Default::default()
                },
                // Pairing (Read + Write)
                Characteristic {
                    uuid: pairing_char_uuid(),
                    read: Some(CharacteristicRead {
                        read: true,
                        fun: Box::new(move |_req| {
                            let val = pairing_value_read.clone();
                            Box::pin(async move {
                                let v = val.lock().await;
                                Ok(v.clone())
                            })
                        }),
                        ..Default::default()
                    }),
                    write: Some(CharacteristicWrite {
                        write: true,
                        ..Default::default()
                    }),
                    control_handle: pairing_handle,
                    ..Default::default()
                },
                // Sync Control (Write + Notify)
                Characteristic {
                    uuid: sync_control_char_uuid(),
                    write: Some(CharacteristicWrite {
                        write: true,
                        ..Default::default()
                    }),
                    notify: Some(CharacteristicNotify {
                        notify: true,
                        method: CharacteristicNotifyMethod::Io,
                        ..Default::default()
                    }),
                    control_handle: sync_control_handle,
                    ..Default::default()
                },
                // Data Transfer (Write + Notify)
                Characteristic {
                    uuid: data_transfer_char_uuid(),
                    write: Some(CharacteristicWrite {
                        write: true,
                        ..Default::default()
                    }),
                    notify: Some(CharacteristicNotify {
                        notify: true,
                        method: CharacteristicNotifyMethod::Io,
                        ..Default::default()
                    }),
                    control_handle: data_handle,
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    // Register GATT application
    let app_reg = adapter
        .serve_gatt_application(app)
        .await
        .map_err(|e| format!("GATT register failed: {}", e))?;

    // Start advertising
    let adv = Advertisement {
        advertisement_type: bluer::adv::Type::Peripheral,
        service_uuids: vec![service_uuid()].into_iter().collect(),
        local_name: Some("VibeVault".to_string()),
        discoverable: Some(true),
        ..Default::default()
    };

    let adv_handle = adapter
        .advertise(adv)
        .await
        .map_err(|e| format!("Advertising failed: {}", e))?;

    // Spawn tasks to forward characteristic write events to the event channel.
    // bluer uses accept() -> CharacteristicReader -> recv() pattern for writes.
    let event_tx_pairing = event_tx.clone();
    let event_tx_control = event_tx.clone();
    let event_tx_data = event_tx.clone();

    tokio::spawn(async move {
        let mut stream = pairing_control;
        while let Some(event) = stream.next().await {
            if let CharacteristicControlEvent::Write(req) = event {
                match req.accept() {
                    Ok(reader) => {
                        if let Ok(data) = reader.recv().await {
                            let _ = event_tx_pairing
                                .send(PeripheralEvent::PairingDataReceived { data })
                                .await;
                        }
                    }
                    Err(e) => {
                        #[cfg(debug_assertions)]
                        eprintln!("Pairing write accept error: {}", e);
                        let _ = e;
                    }
                }
            }
        }
    });

    tokio::spawn(async move {
        let mut stream = sync_control;
        while let Some(event) = stream.next().await {
            if let CharacteristicControlEvent::Write(req) = event {
                match req.accept() {
                    Ok(reader) => {
                        if let Ok(data) = reader.recv().await {
                            if let Some(&ctrl) = data.first() {
                                let _ = event_tx_control
                                    .send(PeripheralEvent::SyncControlReceived { control: ctrl })
                                    .await;
                            }
                        }
                    }
                    Err(e) => {
                        #[cfg(debug_assertions)]
                        eprintln!("Control write accept error: {}", e);
                        let _ = e;
                    }
                }
            }
        }
    });

    tokio::spawn(async move {
        let mut stream = data_control;
        while let Some(event) = stream.next().await {
            if let CharacteristicControlEvent::Write(req) = event {
                match req.accept() {
                    Ok(reader) => {
                        if let Ok(data) = reader.recv().await {
                            let _ = event_tx_data
                                .send(PeripheralEvent::DataChunkReceived { data })
                                .await;
                        }
                    }
                    Err(e) => {
                        #[cfg(debug_assertions)]
                        eprintln!("Data write accept error: {}", e);
                        let _ = e;
                    }
                }
            }
        }
    });

    let handle = PeripheralHandle {
        _app_handle: app_reg,
        _adv_handle: adv_handle,
    };

    Ok((handle, event_rx))
}

/// Handle to the running BLE peripheral. Dropping stops advertising.
pub struct PeripheralHandle {
    _app_handle: bluer::gatt::local::ApplicationHandle,
    _adv_handle: bluer::adv::AdvertisementHandle,
}
