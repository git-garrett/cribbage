//! Compact physical scoring for forced or publicly uncontested suffixes only.

use super::*;
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(super) struct State {
    hands: [u64; 2],
    plays: [u8; 8],
    scores: [u8; 2],
    len: u8,
    count: u8,
    current: u8,
    go: u8,
    last: u8,
    done: bool,
    fast_flags:u32,
    short_key:u16,
}
impl State {
    pub(super) fn from_parts(s: &Position, hands: [Ranks; 2]) -> Self {
        assert!(s.series.len() <= 8);
        let mut plays = [0; 8];
        plays[..s.series.len()].copy_from_slice(&s.series);
        Self {
            hands: std::array::from_fn(|p| {
                hands[p]
                    .iter()
                    .enumerate()
                    .map(|(r, &n)| u64::from(n) << (r * 3))
                    .sum()
            }),
            plays,
            scores: s.scores.map(|v| u8::try_from(v).unwrap()),
            len: s.series.len() as u8,
            count: s.count,
            current: s.actor,
            go: s.go,
            last: s.last,
            done: s.done,
            fast_flags:s.fast_flags,
            short_key:s.series.iter().take(4).fold(0,|k,&r|k*13+u16::from(r)),
        }
    }
    pub(super) fn with_hands(mut self, hands: [u64; 2]) -> Self {
        self.hands = hands;
        self
    }
    #[cfg(test)]
    pub(super) fn copies(self, p: usize, r: usize) -> u8 {
        ((self.hands[p] >> (r * 3)) & 7) as u8
    }
    pub(super) fn mask(self) -> u16 {
        if self.done {
            return 0;
        }
        let hand = self.hands[self.current as usize];
        let mut bits = (hand | (hand >> 1) | (hand >> 2)) & 0x1249249249u64;
        let mut legal = 0;
        while bits != 0 {
            let r = bits.trailing_zeros() as usize / 3;
            bits &= bits - 1;
            if self.fast_flags&4!=0{legal|=1<<r;continue;}
            if self.count + cards::VALUES[r] <= 31 {
                legal |= 1 << r;
            }
        }
        if self.fast_flags&4!=0{return legal&tables::LEGAL[self.count as usize];}
        legal
    }
    pub(super) fn add(&mut self, p: u8, n: u8) {
        self.scores[p as usize] = (self.scores[p as usize] + n).min(121);
        if self.scores[p as usize] >= 121 {
            self.done = true;
        }
    }
    pub(super) fn reset(&mut self, next: u8) {
        self.plays = [0; 8];
        self.len = 0;
        self.count = 0;
        self.go = 2;
        self.last = 2;
        self.current = next;
        self.short_key=0;
    }
    pub(super) fn apply(mut self, action: RankPegAction) -> Self {
        match action {
            RankPegAction::Play(r) => {
                debug_assert!(!self.done && self.mask() & (1 << r) != 0);
                self.hands[self.current as usize] -= 1_u64 << (r * 3);
                self.plays[self.len as usize] = r;
                self.len += 1;
                self.count += crate::cards::VALUES[r as usize];
                if self.fast_flags&32!=0 && self.len<=4{self.short_key=self.short_key*13+u16::from(r);}
                self.last = self.current;
                self.add(
                    self.current,
                    {
                        if self.fast_flags&(2|32)!=0{tables::score(&self.plays[..self.len as usize],self.count,if self.fast_flags&32!=0{Some(self.short_key as usize)}else{None})}else{score_known_count(&self.plays[..self.len as usize],self.count)}
                    },
                );
                if self.done {
                    return self;
                }
                if self.count == 31 {
                    self.reset(1 - self.current);
                } else if self.go == 2 {
                    self.current = 1 - self.current;
                }
                if self.hands == [0, 0] {
                    if self.count != 0 && self.last != 2 {
                        self.add(self.last, 1);
                    }
                    self.done = true;
                }
            }
            RankPegAction::Go => {
                debug_assert!(!self.done && self.mask() == 0);
                if self.go != 2 {
                    if self.last != 2 && self.count != 31 {
                        self.add(self.last, 1);
                    }
                    if !self.done {
                        self.reset(1 - self.current);
                        if self.hands == [0, 0] {
                            self.done = true;
                        }
                    }
                } else {
                    self.go = self.current;
                    self.current = 1 - self.current;
                }
            }
        }
        self
    }
}
impl State {
    pub(super) fn endpoint(self) -> Endpoint {
        self.scores.map(i32::from)
    }
    pub(super) fn complete(self) -> bool {
        self.done
    }
    pub(super) fn actor(self) -> usize {
        self.current as usize
    }
    pub(super) fn empty(self, p: usize) -> bool {
        self.hands[p] == 0
    }
}

pub(super) fn score_known_count(ranks: &[u8], count: u8) -> u8 {
    if ranks.len() < 2 {
        return 0;
    }
    let mut points = if matches!(count, 15 | 31) { 2 } else { 0 };
    let same = ranks
        .iter()
        .rev()
        .take_while(|rank| **rank == ranks[ranks.len() - 1])
        .count();
    points += match same {
        2 => 2,
        3 => 6,
        4 => 12,
        _ => 0,
    };
    let mut seen = 0u16;
    let mut run = 0;
    for (i, rank) in ranks.iter().rev().enumerate() {
        let bit = 1u16 << rank;
        if seen & bit != 0 {
            break;
        }
        seen |= bit;
        let length = i + 1;
        if length >= 3 && (16 - seen.leading_zeros() - seen.trailing_zeros()) as usize == length {
            run = length as u8;
        }
    }
    points + run
}

#[cfg(test)]
impl State {
    pub(super) fn test_count(self) -> u8 {
        self.count
    }
    pub(super) fn test_series(&self) -> &[u8] {
        &self.plays[..self.len as usize]
    }
}
