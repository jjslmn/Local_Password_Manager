import Foundation
import CoreBluetooth
import Combine

/// CoreBluetooth Central Manager for discovering and connecting to the desktop VibeVault peripheral
class BLECentralManager: NSObject, ObservableObject {

    // Must match desktop peripheral UUIDs exactly
    static let serviceUUID = CBUUID(string: "A1B2C3D4-E5F6-7890-ABCD-EF0123456789")
    static let modeCharUUID = CBUUID(string: "A1B2C3D4-E5F6-7890-ABCD-EF012345678A")
    static let pairingCharUUID = CBUUID(string: "A1B2C3D4-E5F6-7890-ABCD-EF012345678B")
    static let syncControlCharUUID = CBUUID(string: "A1B2C3D4-E5F6-7890-ABCD-EF012345678C")
    static let dataTransferCharUUID = CBUUID(string: "A1B2C3D4-E5F6-7890-ABCD-EF012345678D")

    @Published var state: BLEState = .idle
    @Published var discoveredDevices: [DiscoveredDevice] = []
    @Published var syncProgress: SyncProgress = SyncProgress()

    private var centralManager: CBCentralManager!
    private var connectedPeripheral: CBPeripheral?
    private var characteristics: [CBUUID: CBCharacteristic] = [:]
    private var receivedChunks: [Data] = []

    override init() {
        super.init()
        centralManager = CBCentralManager(delegate: self, queue: .main)
    }

    // MARK: - Public API

    func startScanning() {
        guard centralManager.state == .poweredOn else {
            state = .error("Bluetooth is not available")
            return
        }
        discoveredDevices = []
        state = .scanning
        centralManager.scanForPeripherals(
            withServices: [Self.serviceUUID],
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )
    }

    func stopScanning() {
        centralManager.stopScan()
        if state == .scanning { state = .idle }
    }

    func connect(to device: DiscoveredDevice) {
        stopScanning()
        state = .connecting
        centralManager.connect(device.peripheral, options: nil)
    }

    func disconnect() {
        if let peripheral = connectedPeripheral {
            centralManager.cancelPeripheralConnection(peripheral)
        }
        connectedPeripheral = nil
        characteristics = [:]
        state = .idle
    }

    /// Write pairing data (ECDH public key + HMAC) to the pairing characteristic
    func writePairingData(_ data: Data) {
        guard let char = characteristics[Self.pairingCharUUID] else { return }
        connectedPeripheral?.writeValue(data, for: char, type: .withResponse)
    }

    /// Read the current sync mode from the desktop
    func readMode() {
        guard let char = characteristics[Self.modeCharUUID] else { return }
        connectedPeripheral?.readValue(for: char)
    }

    /// Read the desktop's pairing public key
    func readPairingData() {
        guard let char = characteristics[Self.pairingCharUUID] else { return }
        connectedPeripheral?.readValue(for: char)
    }

    /// Write a sync control command
    func writeSyncControl(_ command: UInt8) {
        guard let char = characteristics[Self.syncControlCharUUID] else { return }
        connectedPeripheral?.writeValue(Data([command]), for: char, type: .withResponse)
    }

    /// Write a data chunk (for pull mode — iPhone sending to desktop)
    func writeDataChunk(_ data: Data) {
        guard let char = characteristics[Self.dataTransferCharUUID] else { return }
        connectedPeripheral?.writeValue(data, for: char, type: .withResponse)
    }

    /// Subscribe to notifications on data transfer characteristic (for push mode)
    func subscribeToDataTransfer() {
        guard let char = characteristics[Self.dataTransferCharUUID] else { return }
        connectedPeripheral?.setNotifyValue(true, for: char)
    }

    /// Subscribe to notifications on sync control characteristic
    func subscribeToSyncControl() {
        guard let char = characteristics[Self.syncControlCharUUID] else { return }
        connectedPeripheral?.setNotifyValue(true, for: char)
    }
}

// MARK: - CBCentralManagerDelegate

extension BLECentralManager: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state != .poweredOn && state == .scanning {
            state = .error("Bluetooth turned off")
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = peripheral.name ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? "Unknown"
        let device = DiscoveredDevice(
            peripheral: peripheral,
            name: name,
            rssi: RSSI.intValue
        )

        if !discoveredDevices.contains(where: { $0.peripheral.identifier == peripheral.identifier }) {
            discoveredDevices.append(device)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        connectedPeripheral = peripheral
        peripheral.delegate = self
        state = .connected
        // Discover our sync service
        peripheral.discoverServices([Self.serviceUUID])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        state = .error("Connection failed: \(error?.localizedDescription ?? "unknown")")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        connectedPeripheral = nil
        characteristics = [:]
        if state != .idle {
            state = .error("Disconnected unexpectedly")
        }
    }
}

// MARK: - CBPeripheralDelegate

extension BLECentralManager: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let service = peripheral.services?.first(where: { $0.uuid == Self.serviceUUID }) else { return }
        peripheral.discoverCharacteristics([
            Self.modeCharUUID,
            Self.pairingCharUUID,
            Self.syncControlCharUUID,
            Self.dataTransferCharUUID,
        ], for: service)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        for char in service.characteristics ?? [] {
            characteristics[char.uuid] = char
        }
        state = .ready
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value else { return }

        switch characteristic.uuid {
        case Self.modeCharUUID:
            if let mode = data.first {
                syncProgress.mode = mode == 0x01 ? .push : .pull
            }
        case Self.pairingCharUUID:
            syncProgress.peerPublicKey = data
        case Self.syncControlCharUUID:
            if let ctrl = data.first {
                handleSyncControl(ctrl)
            }
        case Self.dataTransferCharUUID:
            receivedChunks.append(data)
            syncProgress.chunksReceived = receivedChunks.count
        default:
            break
        }
    }

    private func handleSyncControl(_ control: UInt8) {
        switch control {
        case 0x04: // Complete
            state = .complete
        case 0x03: // Abort
            state = .error("Sync aborted by desktop")
        default:
            break
        }
    }
}

// MARK: - Types

enum BLEState: Equatable {
    case idle
    case scanning
    case connecting
    case connected
    case ready       // characteristics discovered, ready to pair/sync
    case pairing
    case transferring
    case complete
    case error(String)

    static func == (lhs: BLEState, rhs: BLEState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle), (.scanning, .scanning), (.connecting, .connecting),
             (.connected, .connected), (.ready, .ready), (.pairing, .pairing),
             (.transferring, .transferring), (.complete, .complete):
            return true
        case (.error(let a), .error(let b)):
            return a == b
        default:
            return false
        }
    }
}

struct DiscoveredDevice: Identifiable {
    let peripheral: CBPeripheral
    let name: String
    let rssi: Int
    var id: UUID { peripheral.identifier }
}

enum SyncMode {
    case push  // Desktop sends, iPhone receives
    case pull  // iPhone sends, Desktop receives
}

struct SyncProgress {
    var mode: SyncMode = .push
    var peerPublicKey: Data?
    var chunksReceived: Int = 0
    var totalChunks: Int = 0
    var entriesSynced: Int = 0
}
