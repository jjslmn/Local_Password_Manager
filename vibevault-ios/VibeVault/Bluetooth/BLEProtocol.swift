import Foundation
import CryptoKit

/// BLE chunking protocol — must match the Rust implementation exactly
enum BLEProtocol {

    /// Maximum data per chunk after 8-byte header
    static let maxChunkData = 493  // 501 - 8 header bytes

    // MARK: - Chunk Structure

    /// Header: chunk_index(u16 LE) + total_chunks(u16 LE) + crc32(u32 LE)
    struct Chunk {
        let index: UInt16
        let total: UInt16
        let crc32: UInt32
        let data: Data

        func toBytes() -> Data {
            var buf = Data(capacity: 8 + data.count)
            buf.append(contentsOf: withUnsafeBytes(of: index.littleEndian) { Array($0) })
            buf.append(contentsOf: withUnsafeBytes(of: total.littleEndian) { Array($0) })
            buf.append(contentsOf: withUnsafeBytes(of: crc32.littleEndian) { Array($0) })
            buf.append(data)
            return buf
        }

        static func fromBytes(_ bytes: Data) -> Result<Chunk, String> {
            guard bytes.count >= 8 else {
                return .failure("Chunk too small")
            }

            let index = bytes.subdata(in: 0..<2).withUnsafeBytes { $0.load(as: UInt16.self).littleEndian }
            let total = bytes.subdata(in: 2..<4).withUnsafeBytes { $0.load(as: UInt16.self).littleEndian }
            let crc32Stored = bytes.subdata(in: 4..<8).withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }
            let data = bytes.subdata(in: 8..<bytes.count)

            // Verify CRC32
            let computed = CRC32.compute(data)
            guard computed == crc32Stored else {
                return .failure("CRC32 mismatch on chunk \(index)")
            }

            return .success(Chunk(index: index, total: total, crc32: crc32Stored, data: data))
        }
    }

    // MARK: - Chunking

    static func chunkData(_ data: Data) -> [Chunk] {
        let chunkCount = max(1, (data.count + maxChunkData - 1) / maxChunkData)
        let total = UInt16(chunkCount)

        return (0..<chunkCount).map { i in
            let start = i * maxChunkData
            let end = min(start + maxChunkData, data.count)
            let chunkData = data.subdata(in: start..<end)
            let crc = CRC32.compute(chunkData)
            return Chunk(index: UInt16(i), total: total, crc32: crc, data: chunkData)
        }
    }

    // MARK: - Reassembly

    class ChunkReassembler {
        private let total: Int
        private var chunks: [Data?]
        private var receivedCount = 0

        init(total: Int) {
            self.total = total
            self.chunks = Array(repeating: nil, count: total)
        }

        /// Add a chunk. Returns true when all chunks received.
        func addChunk(_ chunk: Chunk) -> Result<Bool, String> {
            guard chunk.total == UInt16(total) else {
                return .failure("Total mismatch")
            }
            guard chunk.index < total else {
                return .failure("Index out of range")
            }

            let idx = Int(chunk.index)
            if chunks[idx] == nil {
                receivedCount += 1
            }
            chunks[idx] = chunk.data
            return .success(receivedCount == total)
        }

        var progress: (Int, Int) { (receivedCount, total) }

        func reassemble() -> Result<Data, String> {
            guard receivedCount == total else {
                return .failure("Incomplete: \(receivedCount)/\(total)")
            }
            var result = Data()
            for (i, chunk) in chunks.enumerated() {
                guard let data = chunk else {
                    return .failure("Missing chunk \(i)")
                }
                result.append(data)
            }
            return .success(result)
        }
    }
}

// MARK: - CRC32 (matches crc32fast in Rust)

enum CRC32 {
    private static let table: [UInt32] = {
        (0..<256).map { i -> UInt32 in
            var crc = UInt32(i)
            for _ in 0..<8 {
                crc = (crc & 1 != 0) ? (0xEDB88320 ^ (crc >> 1)) : (crc >> 1)
            }
            return crc
        }
    }()

    static func compute(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFFFFFF
        for byte in data {
            let index = Int((crc ^ UInt32(byte)) & 0xFF)
            crc = table[index] ^ (crc >> 8)
        }
        return crc ^ 0xFFFFFFFF
    }
}
