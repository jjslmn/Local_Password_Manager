use crc32fast::Hasher as Crc32Hasher;
use serde::{Deserialize, Serialize};

/// Maximum BLE MTU payload after ATT overhead
const MAX_CHUNK_PAYLOAD: usize = 501;

/// Chunk header size: chunk_index(u16) + total_chunks(u16) + crc32(u32)
const CHUNK_HEADER_SIZE: usize = 8;

/// Maximum data per chunk after header
const MAX_CHUNK_DATA: usize = MAX_CHUNK_PAYLOAD - CHUNK_HEADER_SIZE;

/// Message types for the Sync Control characteristic
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum SyncControl {
    StartSync = 0x01,
    AckChunk = 0x02,
    Abort = 0x03,
    Complete = 0x04,
}

impl SyncControl {
    pub fn from_byte(b: u8) -> Option<Self> {
        match b {
            0x01 => Some(SyncControl::StartSync),
            0x02 => Some(SyncControl::AckChunk),
            0x03 => Some(SyncControl::Abort),
            0x04 => Some(SyncControl::Complete),
            _ => None,
        }
    }
}

/// BLE sync mode (read from Mode characteristic)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum SyncMode {
    Push = 0x01, // Desktop sends data to iPhone
    Pull = 0x02, // iPhone sends data to Desktop
}

impl SyncMode {
    pub fn from_byte(b: u8) -> Option<Self> {
        match b {
            0x01 => Some(SyncMode::Push),
            0x02 => Some(SyncMode::Pull),
            _ => None,
        }
    }
}

/// A single chunk of data for BLE transfer
#[derive(Debug, Clone)]
pub struct Chunk {
    pub index: u16,
    pub total: u16,
    pub crc32: u32,
    pub data: Vec<u8>,
}

impl Chunk {
    /// Serialize chunk to bytes: [index_le(2)] [total_le(2)] [crc32_le(4)] [data...]
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(CHUNK_HEADER_SIZE + self.data.len());
        buf.extend_from_slice(&self.index.to_le_bytes());
        buf.extend_from_slice(&self.total.to_le_bytes());
        buf.extend_from_slice(&self.crc32.to_le_bytes());
        buf.extend_from_slice(&self.data);
        buf
    }

    /// Parse chunk from raw bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() < CHUNK_HEADER_SIZE {
            return Err("Chunk too small".to_string());
        }

        let index = u16::from_le_bytes([bytes[0], bytes[1]]);
        let total = u16::from_le_bytes([bytes[2], bytes[3]]);
        let crc32 = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
        let data = bytes[CHUNK_HEADER_SIZE..].to_vec();

        // Verify CRC32
        let mut hasher = Crc32Hasher::new();
        hasher.update(&data);
        let computed_crc = hasher.finalize();
        if computed_crc != crc32 {
            return Err(format!(
                "CRC32 mismatch on chunk {}: expected {:08x}, got {:08x}",
                index, crc32, computed_crc
            ));
        }

        Ok(Chunk {
            index,
            total,
            crc32,
            data,
        })
    }
}

/// Split data into BLE-sized chunks
pub fn chunk_data(data: &[u8]) -> Vec<Chunk> {
    let chunks: Vec<&[u8]> = data.chunks(MAX_CHUNK_DATA).collect();
    let total = chunks.len() as u16;

    chunks
        .into_iter()
        .enumerate()
        .map(|(i, chunk_data)| {
            let mut hasher = Crc32Hasher::new();
            hasher.update(chunk_data);
            let crc32 = hasher.finalize();

            Chunk {
                index: i as u16,
                total,
                crc32,
                data: chunk_data.to_vec(),
            }
        })
        .collect()
}

/// Reassembly buffer for receiving chunks out of order
pub struct ChunkReassembler {
    total: u16,
    received: Vec<Option<Vec<u8>>>,
    received_count: u16,
}

impl ChunkReassembler {
    /// Create a new reassembler expecting `total` chunks
    pub fn new(total: u16) -> Self {
        ChunkReassembler {
            total,
            received: vec![None; total as usize],
            received_count: 0,
        }
    }

    /// Add a chunk. Returns true if all chunks are now received.
    pub fn add_chunk(&mut self, chunk: Chunk) -> Result<bool, String> {
        if chunk.total != self.total {
            return Err(format!(
                "Chunk total mismatch: expected {}, got {}",
                self.total, chunk.total
            ));
        }
        if chunk.index >= self.total {
            return Err(format!(
                "Chunk index {} out of range (total {})",
                chunk.index, self.total
            ));
        }

        let idx = chunk.index as usize;
        if self.received[idx].is_none() {
            self.received_count += 1;
        }
        self.received[idx] = Some(chunk.data);

        Ok(self.received_count == self.total)
    }

    /// Check if all chunks have been received
    pub fn is_complete(&self) -> bool {
        self.received_count == self.total
    }

    /// Get progress as (received, total)
    pub fn progress(&self) -> (u16, u16) {
        (self.received_count, self.total)
    }

    /// Reassemble all chunks into the original data. Fails if incomplete.
    pub fn reassemble(self) -> Result<Vec<u8>, String> {
        if !self.is_complete() {
            return Err(format!(
                "Cannot reassemble: only {}/{} chunks received",
                self.received_count, self.total
            ));
        }

        let mut data = Vec::new();
        for (i, chunk_data) in self.received.into_iter().enumerate() {
            match chunk_data {
                Some(d) => data.extend_from_slice(&d),
                None => return Err(format!("Missing chunk {}", i)),
            }
        }
        Ok(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_roundtrip() {
        let data = b"Hello, this is a test payload for BLE chunking!";
        let chunks = chunk_data(data);

        assert_eq!(chunks.len(), 1); // Small data fits in one chunk
        assert_eq!(chunks[0].index, 0);
        assert_eq!(chunks[0].total, 1);

        // Serialize and deserialize
        let bytes = chunks[0].to_bytes();
        let parsed = Chunk::from_bytes(&bytes).unwrap();
        assert_eq!(parsed.data, data.to_vec());
    }

    #[test]
    fn test_large_data_chunking() {
        // Create data larger than one chunk
        let data: Vec<u8> = (0..2000).map(|i| (i % 256) as u8).collect();
        let chunks = chunk_data(&data);

        assert!(chunks.len() > 1);

        // Reassemble
        let mut reassembler = ChunkReassembler::new(chunks[0].total);
        for chunk in chunks {
            let serialized = chunk.to_bytes();
            let parsed = Chunk::from_bytes(&serialized).unwrap();
            reassembler.add_chunk(parsed).unwrap();
        }

        let result = reassembler.reassemble().unwrap();
        assert_eq!(result, data);
    }

    #[test]
    fn test_out_of_order_chunks() {
        let data: Vec<u8> = (0..2000).map(|i| (i % 256) as u8).collect();
        let chunks = chunk_data(&data);
        let total = chunks[0].total;

        let mut reassembler = ChunkReassembler::new(total);

        // Add in reverse order
        for chunk in chunks.into_iter().rev() {
            let serialized = chunk.to_bytes();
            let parsed = Chunk::from_bytes(&serialized).unwrap();
            reassembler.add_chunk(parsed).unwrap();
        }

        let result = reassembler.reassemble().unwrap();
        assert_eq!(result, data);
    }

    #[test]
    fn test_crc_corruption_detected() {
        let data = b"test data";
        let chunks = chunk_data(data);
        let mut bytes = chunks[0].to_bytes();

        // Corrupt one data byte
        let last = bytes.len() - 1;
        bytes[last] ^= 0xFF;

        let result = Chunk::from_bytes(&bytes);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("CRC32 mismatch"));
    }
}
