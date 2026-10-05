//! Exact, small scoring and legality tables for 28.3.fast.
use super::*;
pub(super) const LEGAL: [u16; 32] = {
    let mut out = [0; 32];
    let mut c = 0;
    while c < 32 {
        let mut r = 0;
        while r < 13 {
            if c + cards::VALUES[r] as usize <= 31 {
                out[c] |= 1 << r;
            }
            r += 1;
        }
        c += 1;
    }
    out
};
const OFFSETS: [usize; 5] = [0, 1, 14, 183, 2380];
fn short_scores() -> &'static Vec<u8> {
    static TABLE: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut out = vec![0; 30941];
        for len in 1..=4 {
            for code in 0..13_usize.pow(len as u32) {
                let mut h = [0; 4];
                let mut n = code;
                for r in h[..len].iter_mut().rev() {
                    *r = (n % 13) as u8;
                    n /= 13;
                }
                let count = h[..len].iter().map(|&r| cards::VALUES[r as usize]).sum();
                out[OFFSETS[len] + code] = physical::score_known_count(&h[..len], count);
            }
        }
        out
    })
}
pub(super) fn score(ranks: &[u8], count: u8, key: Option<usize>) -> u8 {
    if ranks.len() > 4 {
        return physical::score_known_count(ranks, count);
    }
    let key = key.unwrap_or_else(|| ranks.iter().fold(0, |n, &r| n * 13 + r as usize));
    short_scores()[OFFSETS[ranks.len()] + key]
}
