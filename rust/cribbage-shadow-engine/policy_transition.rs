//! Versioned, fixed-width records for the offline Model 16.1 pegging
//! transition compiler.  This is deliberately separate from the historical
//! P12/P14 pairwise formats: a transition record preserves the scoring-event
//! order needed to resolve count-outs correctly.

use std::io::{Read, Write};

pub const TRANSITION_MAGIC: &[u8; 8] = b"C16TRN01";
pub const TRANSITION_VERSION: u32 = 1;
pub const TRANSITION_EVENT_CAPACITY: usize = 16;
pub const TRANSITION_RECORD_BYTES: usize = 26;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TransitionScoreContext {
    pub own_score: u8,
    pub opponent_score: u8,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransitionArtifactHeader {
    pub policy_checksum: u64,
    pub contexts: Vec<TransitionScoreContext>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TransitionRecord {
    pub own_keep_id: u16,
    pub opponent_keep_id: u16,
    pub context_id: u16,
    /// `0` means the modeled player is pone; `1` means dealer.
    pub role: u8,
    pub event_len: u8,
    /// Each populated byte is `seat << 7 | points`: seat 0 is the modeled
    /// player and seat 1 the opponent. Only nonzero scoring events appear.
    pub events: [u8; TRANSITION_EVENT_CAPACITY],
    pub learned_actions: u8,
    pub fallback_actions: u8,
}

impl TransitionArtifactHeader {
    pub fn write_to(&self, writer: &mut impl Write) -> Result<(), String> {
        if self.contexts.is_empty() {
            return Err("transition artifact requires at least one score context".to_string());
        }
        let context_count = u32::try_from(self.contexts.len())
            .map_err(|_| "transition artifact has too many score contexts".to_string())?;
        writer
            .write_all(TRANSITION_MAGIC)
            .and_then(|_| writer.write_all(&TRANSITION_VERSION.to_le_bytes()))
            .and_then(|_| writer.write_all(&(TRANSITION_RECORD_BYTES as u32).to_le_bytes()))
            .and_then(|_| writer.write_all(&self.policy_checksum.to_le_bytes()))
            .and_then(|_| writer.write_all(&context_count.to_le_bytes()))
            .map_err(|error| format!("write transition header failed: {}", error))?;
        for context in &self.contexts {
            validate_context(*context)?;
            writer
                .write_all(&[context.own_score, context.opponent_score])
                .map_err(|error| format!("write transition context failed: {}", error))?;
        }
        Ok(())
    }

    pub fn read_from(reader: &mut impl Read) -> Result<TransitionArtifactHeader, String> {
        let mut magic = [0_u8; 8];
        read_exact(reader, &mut magic, "transition magic")?;
        if &magic != TRANSITION_MAGIC {
            return Err("invalid transition artifact magic".to_string());
        }
        let version = read_u32(reader, "transition version")?;
        if version != TRANSITION_VERSION {
            return Err(format!(
                "unsupported transition artifact version {}",
                version
            ));
        }
        let record_bytes = read_u32(reader, "transition record width")?;
        if record_bytes != TRANSITION_RECORD_BYTES as u32 {
            return Err(format!(
                "unsupported transition record width {}",
                record_bytes
            ));
        }
        let policy_checksum = read_u64(reader, "transition policy checksum")?;
        let context_count = read_u32(reader, "transition context count")? as usize;
        if context_count == 0 || context_count > 16_384 {
            return Err(format!(
                "invalid transition context count {}",
                context_count
            ));
        }
        let mut contexts = Vec::with_capacity(context_count);
        for _ in 0..context_count {
            let mut bytes = [0_u8; 2];
            read_exact(reader, &mut bytes, "transition score context")?;
            let context = TransitionScoreContext {
                own_score: bytes[0],
                opponent_score: bytes[1],
            };
            validate_context(context)?;
            contexts.push(context);
        }
        Ok(TransitionArtifactHeader {
            policy_checksum,
            contexts,
        })
    }

    pub fn encoded_len(&self) -> usize {
        8 + 4 + 4 + 8 + 4 + self.contexts.len() * 2
    }
}

impl TransitionRecord {
    pub fn encode(self) -> Result<[u8; TRANSITION_RECORD_BYTES], String> {
        validate_record(self)?;
        let mut bytes = [0_u8; TRANSITION_RECORD_BYTES];
        bytes[0..2].copy_from_slice(&self.own_keep_id.to_le_bytes());
        bytes[2..4].copy_from_slice(&self.opponent_keep_id.to_le_bytes());
        bytes[4..6].copy_from_slice(&self.context_id.to_le_bytes());
        bytes[6] = self.role;
        bytes[7] = self.event_len;
        bytes[8..8 + TRANSITION_EVENT_CAPACITY].copy_from_slice(&self.events);
        bytes[24] = self.learned_actions;
        bytes[25] = self.fallback_actions;
        Ok(bytes)
    }

    pub fn decode(bytes: [u8; TRANSITION_RECORD_BYTES]) -> Result<TransitionRecord, String> {
        let mut events = [0_u8; TRANSITION_EVENT_CAPACITY];
        events.copy_from_slice(&bytes[8..8 + TRANSITION_EVENT_CAPACITY]);
        let record = TransitionRecord {
            own_keep_id: u16::from_le_bytes(bytes[0..2].try_into().unwrap()),
            opponent_keep_id: u16::from_le_bytes(bytes[2..4].try_into().unwrap()),
            context_id: u16::from_le_bytes(bytes[4..6].try_into().unwrap()),
            role: bytes[6],
            event_len: bytes[7],
            events,
            learned_actions: bytes[24],
            fallback_actions: bytes[25],
        };
        validate_record(record)?;
        Ok(record)
    }
}

fn validate_context(context: TransitionScoreContext) -> Result<(), String> {
    if context.own_score > 120 || context.opponent_score > 120 {
        return Err(format!(
            "transition score context must be below 121, got {}:{}",
            context.own_score, context.opponent_score
        ));
    }
    Ok(())
}

fn validate_record(record: TransitionRecord) -> Result<(), String> {
    if record.role > 1 {
        return Err(format!("invalid transition record role {}", record.role));
    }
    if usize::from(record.event_len) > TRANSITION_EVENT_CAPACITY {
        return Err(format!(
            "transition event length {} exceeds capacity {}",
            record.event_len, TRANSITION_EVENT_CAPACITY
        ));
    }
    for event in record.events.iter().take(record.event_len as usize) {
        let points = event & 0x7f;
        if points == 0 || points > 31 {
            return Err(format!("invalid transition scoring event {}", event));
        }
    }
    if record
        .events
        .iter()
        .skip(record.event_len as usize)
        .any(|event| *event != 0)
    {
        return Err("transition record has events beyond its length".to_string());
    }
    Ok(())
}

fn read_exact(reader: &mut impl Read, bytes: &mut [u8], label: &str) -> Result<(), String> {
    reader
        .read_exact(bytes)
        .map_err(|error| format!("read {} failed: {}", label, error))
}

fn read_u32(reader: &mut impl Read, label: &str) -> Result<u32, String> {
    let mut bytes = [0_u8; 4];
    read_exact(reader, &mut bytes, label)?;
    Ok(u32::from_le_bytes(bytes))
}

fn read_u64(reader: &mut impl Read, label: &str) -> Result<u64, String> {
    let mut bytes = [0_u8; 8];
    read_exact(reader, &mut bytes, label)?;
    Ok(u64::from_le_bytes(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header() -> TransitionArtifactHeader {
        TransitionArtifactHeader {
            policy_checksum: 0x4d313631,
            contexts: vec![
                TransitionScoreContext {
                    own_score: 90,
                    opponent_score: 102,
                },
                TransitionScoreContext {
                    own_score: 120,
                    opponent_score: 119,
                },
            ],
        }
    }

    fn record() -> TransitionRecord {
        let mut events = [0_u8; TRANSITION_EVENT_CAPACITY];
        events[0] = 2;
        events[1] = 0x80 | 1;
        TransitionRecord {
            own_keep_id: 17,
            opponent_keep_id: 34,
            context_id: 1,
            role: 0,
            event_len: 2,
            events,
            learned_actions: 6,
            fallback_actions: 2,
        }
    }

    #[test]
    fn header_and_record_round_trip_deterministically() {
        let header = header();
        let mut bytes = Vec::new();
        header.write_to(&mut bytes).unwrap();
        bytes.extend_from_slice(&record().encode().unwrap());
        let mut cursor = bytes.as_slice();
        assert_eq!(
            TransitionArtifactHeader::read_from(&mut cursor).unwrap(),
            header
        );
        let encoded: [u8; TRANSITION_RECORD_BYTES] = cursor.try_into().unwrap();
        assert_eq!(TransitionRecord::decode(encoded).unwrap(), record());
    }

    #[test]
    fn malformed_header_and_record_are_rejected() {
        let mut bytes = Vec::new();
        header().write_to(&mut bytes).unwrap();
        bytes[0] ^= 1;
        assert!(TransitionArtifactHeader::read_from(&mut bytes.as_slice()).is_err());

        let mut malformed = record();
        malformed.events[3] = 4;
        assert!(malformed.encode().is_err());
    }
}
