//! Lossless hand-list dictionary and bounded XZ envelope for opening records.
use super::{get_varint, put_varint};
use std::collections::BTreeMap;
use std::io::{Read, Write};

const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_LISTS: usize = 65_536;
const MAX_HAND_IDS: usize = 2_000_000;

pub(super) fn encode(body: &[u8]) -> Result<Vec<u8>, String> {
    let mut lists = Vec::<Vec<u16>>::new();
    let mut ids = BTreeMap::<Vec<u16>, usize>::new();
    let mut records = Vec::new();
    let mut at = 0;
    while at < body.len() {
        let delta = get_varint(body, &mut at)?;
        let count = usize::try_from(get_varint(body, &mut at)?).map_err(|e| e.to_string())?;
        if count == 0 || count > 1820 || count > (body.len() - at) / 2 {
            return Err("invalid source group".into());
        }
        let codes: Vec<u16> = body[at..at + count * 2]
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect();
        at += count * 2;
        let hands: Vec<_> = codes.iter().map(|c| c >> 4).collect();
        let next = lists.len();
        let id = *ids.entry(hands.clone()).or_insert_with(|| {
            lists.push(hands);
            next
        });
        put_varint(delta, &mut records);
        put_varint(id as u128, &mut records);
        for pair in codes.chunks(2) {
            records.push((pair[0] & 15) as u8 | pair.get(1).map_or(0, |c| ((c & 15) << 4) as u8));
        }
    }
    let mut packed = Vec::new();
    put_varint(lists.len() as u128, &mut packed);
    for hands in lists {
        put_varint(hands.len() as u128, &mut packed);
        let mut previous = 0;
        for hand in hands {
            put_varint(u128::from(hand - previous), &mut packed);
            previous = hand;
        }
    }
    packed.extend(records);
    if packed.len() > MAX_BYTES {
        return Err("opening dictionary too large".into());
    }
    let mut out = xz2::write::XzEncoder::new(Vec::new(), 6);
    out.write_all(&packed).map_err(|e| e.to_string())?;
    out.finish().map_err(|e| e.to_string())
}

pub(super) fn decode(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let stream = xz2::stream::Stream::new_stream_decoder(16 * 1024 * 1024, 0)
        .map_err(|e| e.to_string())?;
    let mut decoder = xz2::bufread::XzDecoder::new_stream(bytes, stream);
    let mut packed = Vec::new();
    decoder.by_ref().take(MAX_BYTES as u64 + 1).read_to_end(&mut packed)
        .map_err(|e| e.to_string())?;
    if packed.len() > MAX_BYTES || decoder.total_in() != bytes.len() as u64 {
        return Err("opening compression limit or trailing bytes".into());
    }
    unpack(&packed)
}

fn unpack(packed: &[u8]) -> Result<Vec<u8>, String> {
    let mut at = 0;
    let count = usize::try_from(get_varint(packed, &mut at)?).map_err(|e| e.to_string())?;
    if count > MAX_LISTS || count > packed.len() {
        return Err("invalid opening dictionary size".into());
    }
    let mut lists = Vec::with_capacity(count);
    let mut total_ids = 0;
    for _ in 0..count {
        let n = usize::try_from(get_varint(packed, &mut at)?).map_err(|e| e.to_string())?;
        total_ids += n.min(MAX_HAND_IDS + 1);
        if n == 0 || n > 1820 || total_ids > MAX_HAND_IDS {
            return Err("invalid opening hand list size".into());
        }
        let mut hands = Vec::with_capacity(n);
        let mut previous = 0u128;
        for i in 0..n {
            let delta = get_varint(packed, &mut at)?;
            let hand = previous.checked_add(delta).ok_or("hand ID overflow")?;
            if hand >= 1820 || (i > 0 && delta == 0) {
                return Err("invalid opening hand ID".into());
            }
            hands.push(hand as u16);
            previous = hand;
        }
        lists.push(hands);
    }
    let mut body = Vec::new();
    while at < packed.len() {
        let delta = get_varint(packed, &mut at)?;
        let id = usize::try_from(get_varint(packed, &mut at)?).map_err(|e| e.to_string())?;
        let hands = lists.get(id).ok_or("missing opening hand list")?;
        let bytes = (hands.len() + 1) / 2;
        let ranks = packed.get(at..at + bytes).ok_or("short opening actions")?;
        at += bytes;
        if hands.len() % 2 == 1 && ranks[bytes - 1] >> 4 != 0 {
            return Err("invalid opening action padding".into());
        }
        if body.len() + hands.len() * 2 + 40 > MAX_BYTES {
            return Err("expanded opening too large".into());
        }
        put_varint(delta, &mut body);
        put_varint(hands.len() as u128, &mut body);
        for (i, hand) in hands.iter().enumerate() {
            let rank = (ranks[i / 2] >> (4 * (i % 2))) & 15;
            if rank >= 13 {
                return Err("invalid opening action".into());
            }
            body.extend((hand << 4 | u16::from(rank)).to_le_bytes());
        }
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_and_reject_corrupt_truncated_or_trailing_data() {
        let mut body = Vec::new();
        for delta in [17, 73, 1234567] {
            put_varint(delta, &mut body);
            put_varint(3, &mut body);
            for code in [0u16, 16 | 12, 1819 << 4 | 7] { body.extend(code.to_le_bytes()); }
        }
        let bytes = encode(&body).unwrap();
        assert_eq!(decode(&bytes).unwrap(), body);
        assert!(decode(&bytes[..bytes.len()-1]).is_err());
        let mut extra = bytes.clone(); extra.push(0);
        assert!(decode(&extra).is_err());
        let mut corrupt = bytes; corrupt[20] ^= 1;
        assert!(decode(&corrupt).is_err());
        assert!(unpack(&[255, 255, 255, 255, 15]).is_err());
        assert_eq!(decode(&encode(&[]).unwrap()).unwrap(), Vec::<u8>::new());
    }
}
