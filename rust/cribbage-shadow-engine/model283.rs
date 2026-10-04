//! Decision-local, postorder score blocks. No retained path graph, world objects,
//! or calls into another belief solver. Each child returns scores; each parent
//! chooses once per own hold and releases its children. Full public history is
//! used for belief weights but is not retained as a graph.
use super::*;
#[cfg(test)]
use crate::board_matrix::{BoardMatrixSeam, BoardWinMatrix};
use crate::cards;
type Ranks = [u8; 13];
type Endpoint = [i32; 2];
fn pack(h: Ranks) -> u64 {
    h.iter()
        .enumerate()
        .map(|(r, n)| u64::from(*n) << (3 * r))
        .sum()
}
#[cfg(test)]
fn choose(n: u8, k: u8) -> f64 {
    if k > n {
        return 0.0;
    }
    let k = k.min(n - k);
    (0..k).fold(1.0, |v, i| v * f64::from(n - i) / f64::from(i + 1))
}
// Exact small-deck arithmetic, measured independently before activation.
const COMBINATIONS: [[f64; 5]; 5] = [
    [1., 0., 0., 0., 0.],
    [1., 1., 0., 0., 0.],
    [1., 2., 1., 0., 0.],
    [1., 3., 3., 1., 0.],
    [1., 4., 6., 4., 1.],
];
const RATIOS: [[[f64; 5]; 5]; 5] = {
    let mut result = [[[0.; 5]; 5]; 5];
    let mut a = 0;
    while a < 5 {
        let mut b = 0;
        while b < 5 {
            let mut k = 0;
            while k < 5 {
                result[a][b][k] = COMBINATIONS[a][k] / COMBINATIONS[b][k];
                k += 1;
            }
            b += 1;
        }
        a += 1;
    }
    result
};
#[path = "model283_physical.rs"]
mod physical;
use physical::State;
use std::time::{Duration, Instant};
const BAD: u16 = u16::MAX;
#[derive(Clone, Copy)]
struct Hand {
    initial: Ranks,
    left: Ranks,
    mask: u16,
    nibbles: u64,
    show: u8,
    packed_left: u64,
}
impl Hand {
    fn new(h: Ranks) -> Self {
        Self {
            initial: h,
            left: h,
            mask: h
                .iter()
                .enumerate()
                .fold(0, |m, (r, n)| m | if *n > 0 { 1 << r } else { 0 }),
            nibbles: h
                .iter()
                .enumerate()
                .map(|(r, n)| u64::from(*n) << (4 * r))
                .sum(),
            show: 0,
            packed_left: pack(h),
        }
    }
    fn counted(h: Ranks, cut: u8) -> Self {
        Self {
            show: cards::score_four_rank_counts(&h, cut),
            ..Self::new(h)
        }
    }
    fn after(mut self, r: u8) -> Self {
        if r < 13 {
            self.left[r as usize] -= 1;
            self.packed_left -= 1_u64 << (3 * r);
            if self.left[r as usize] == 0 {
                self.mask &= !(1 << r);
            }
        }
        self
    }
}
// Eight cards, at most eight play events, two Goes and one reset per
// series: 32 event slots conservatively cover every legal pegging hand.
#[derive(Clone)]
struct FixedBuffer<T: Copy + Default, const N: usize> {
    data: [T; N],
    len: usize,
}
impl<T: Copy + Default, const N: usize> FixedBuffer<T, N> {
    fn new() -> Self {
        Self {
            data: [T::default(); N],
            len: 0,
        }
    }
    fn push(&mut self, value: T) {
        assert!(self.len < N, "legal pegging storage bound");
        self.data[self.len] = value;
        self.len += 1;
    }
    fn clear(&mut self) {
        self.len = 0;
    }
}
impl<T: Copy + Default, const N: usize> std::ops::Deref for FixedBuffer<T, N> {
    type Target = [T];
    fn deref(&self) -> &[T] {
        &self.data[..self.len]
    }
}
#[cfg(test)]
impl<T: Copy + Default + PartialEq, const N: usize> PartialEq<Vec<T>> for FixedBuffer<T, N> {
    fn eq(&self, other: &Vec<T>) -> bool {
        &**self == other.as_slice()
    }
}
#[derive(Clone)]
struct Position {
    played: [Ranks; 2],
    left: [u8; 2],
    series: FixedBuffer<u8, 8>,
    scores: Endpoint,
    count: u8,
    actor: u8,
    go: u8,
    last: u8,
    done: bool,
    path: u128,
    events: FixedBuffer<(u8, u8), 32>,
}
impl Position {
    fn start(scores: Endpoint, left: [u8; 2]) -> Self {
        Self {
            played: [[0; 13]; 2],
            left,
            series: FixedBuffer::new(),
            scores,
            count: 0,
            actor: 0,
            go: 2,
            last: 2,
            done: false,
            path: 1,
            events: FixedBuffer::new(),
        }
    }
    fn reset(&mut self, actor: u8) {
        self.series.clear();
        self.count = 0;
        self.go = 2;
        self.last = 2;
        self.actor = actor;
        self.events.push((2, 14));
    }
    fn add(&mut self, actor: u8, n: u8) {
        self.scores[actor as usize] = (self.scores[actor as usize] + i32::from(n)).min(121);
        self.done = self.scores[actor as usize] >= 121;
    }
    fn after(&self, r: u8) -> Self {
        let mut p = self.clone();
        p.path = (p.path << 4) | u128::from(r + 1);
        p.events.push((p.actor, r));
        if r < 13 {
            p.played[p.actor as usize][r as usize] += 1;
            p.left[p.actor as usize] -= 1;
            p.count += cards::VALUES[r as usize];
            p.series.push(r);
            p.last = p.actor;
            p.add(p.actor, cards::score_count_ranks(&p.series));
            if p.done {
                return p;
            }
            if p.count == 31 {
                p.reset(1 - p.actor);
            } else if p.go == 2 {
                p.actor = 1 - p.actor;
            }
            if p.left == [0, 0] {
                if p.count != 0 && p.last != 2 {
                    p.add(p.last, 1);
                }
                p.done = true;
            }
        } else if p.go != 2 {
            if p.last != 2 && p.count != 31 {
                p.add(p.last, 1);
            }
            if !p.done {
                p.reset(1 - p.actor);
                if p.left == [0, 0] {
                    p.done = true;
                }
            }
        } else {
            p.go = p.actor;
            p.actor = 1 - p.actor;
        }
        p
    }
    fn legal(&self, h: &Hand) -> u16 {
        h.mask
            & (0..13).fold(0, |m, r| {
                m | if self.count + cards::VALUES[r] <= 31 {
                    1 << r
                } else {
                    0
                }
            })
    }
}
fn encode(e: Endpoint) -> u16 {
    (e[0] as u16) * 128 + e[1] as u16
}
fn decode(e: u16) -> Endpoint {
    assert_ne!(e, BAD);
    [i32::from(e / 128), i32::from(e % 128)]
}
enum Table {
    Constant(u16),
    Cells { cols: usize, data: Vec<u16> },
}
impl Table {
    fn get(&self, a: usize, b: usize) -> u16 {
        match self {
            Self::Constant(e) => *e,
            Self::Cells { cols, data } => data[a * cols + b],
        }
    }
    fn bytes(&self) -> usize {
        match self {
            Self::Constant(_) => 0,
            Self::Cells { data, .. } => data.len() * 2,
        }
    }
    fn packed(cols: usize, data: Vec<u16>) -> Self {
        let mut valid = data.iter().copied().filter(|e| *e != BAD);
        let first = valid.next().unwrap_or(BAD);
        if valid.all(|e| e == first) {
            Self::Constant(first)
        } else {
            Self::Cells { cols, data }
        }
    }
}
enum Priors<'a> {
    Empirical(&'a Model91EmpiricalBeliefs),
    #[cfg(test)]
    Finite(Vec<([Ranks; 2], f64)>),
}
#[derive(Default)]
struct PackedHasher(u64);
impl std::hash::Hasher for PackedHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = self.0.rotate_left(5) ^ u64::from(b);
        }
    }
    fn write_u64(&mut self, key: u64) {
        let p = u128::from(key ^ 0xa0761d6478bd642f) * u128::from(0xe7037ed1a0b428dbu64);
        self.0 = p as u64 ^ (p >> 64) as u64;
    }
}
type TypedPrior = HashMap<u64, f64, std::hash::BuildHasherDefault<PackedHasher>>;
struct Weights {
    raw: Arc<TypedPrior>,
    likelihood: [u32; 13],
    seen: Ranks,
}
#[derive(Clone, Copy)]
struct LiveKnowledge {
    actor: usize,
    initial: Ranks,
    known: Hand,
}
// The ordinary table remains independent of the live player's private cards.
// One extra row follows that player's discard-aware continuations against the
// unchanged opposing policy. It is consumed with its public child, never stored
// as an observation/action book or expanded into hypothetical discard contexts.
struct Solved {
    table: Table,
    live: Vec<u16>,
}
impl Solved {
    fn get(&self, a: usize, b: usize) -> u16 {
        self.table.get(a, b)
    }
    fn bytes(&self) -> usize {
        self.table.bytes() + self.live.len() * 2
    }
}
#[derive(Default)]
struct Stats {
    private_choices: u64,
    private_groups: u64,
    blocks: u64,
    groups: u64,
    choices: u64,
    forced_pairs: u64,
    weight_reads: u64,
    live_bytes: usize,
    peak_bytes: usize,
    root_candidates: u8,
    prior_hits: u64,
    forced_selections: u64,
}
struct Solver<'a> {
    live: Option<LiveKnowledge>,
    #[cfg(test)]
    private_book: HashMap<u128, u8>,
    priors: Priors<'a>,
    #[cfg(test)]
    board: &'a BoardWinMatrix,
    // Pone WP after both hands have counted, before the still-unknown crib.
    // A decision-local scalar table, not extra private contexts or paths.
    after_hands: Vec<f64>,
    #[cfg(test)]
    count_hands: bool,
    factors: Model1322DeclineFactors,
    cut: u8,
    stats: Stats,
    started: Instant,
    last_report: Instant,
    progress: Option<String>,
    prior_rows: HashMap<(u8, u64), Arc<TypedPrior>>,
    reuse: bool,
    #[cfg(test)]
    book: HashMap<(u128, u64, u8), u8>,
    #[cfg(test)]
    record_all: bool,
    #[cfg(test)]
    force_uncompressed: bool,
}
impl<'a> Solver<'a> {
    fn new(assets: &'a PolicyAssets, cut: u8) -> Result<Self, String> {
        let matrix = assets
            .wp_board
            .as_ref()
            .ok_or("28.3 requires its board matrix")?;
        let mut board = crate::board::BoardModel::from_board_matrix(Arc::clone(matrix));
        let mut after_hands = vec![0.0; 128 * 128];
        for pone in 0..=121 {
            for dealer in 0..=121 {
                after_hands[encode([pone, dealer]) as usize] = board
                    .future_win_probability_from_scores(
                        pone,
                        dealer,
                        Role::Pone,
                        crate::board::ScorePhase::Crib,
                    );
            }
        }
        Ok(Self {
            live: None,
            #[cfg(test)]
            private_book: HashMap::new(),
            priors: Priors::Empirical(&assets.beliefs),
            #[cfg(test)]
            board: assets
                .wp_board
                .as_deref()
                .ok_or("28.3 requires its board matrix")?,
            after_hands,
            #[cfg(test)]
            count_hands: std::env::var("CRIBBAGE_283_FUTURE_COUNTING").as_deref() != Ok("0"),
            factors: assets.factors,
            cut,
            stats: Stats::default(),
            started: Instant::now(),
            last_report: Instant::now(),
            progress: std::env::var("CRIBBAGE_283_PROGRESS").ok(),
            prior_rows: HashMap::new(),
            reuse: {
                #[cfg(test)]
                {
                    std::env::var("CRIBBAGE_283_REUSE").as_deref() != Ok("0")
                }
                #[cfg(not(test))]
                {
                    true
                }
            },
            #[cfg(test)]
            book: HashMap::new(),
            #[cfg(test)]
            record_all: false,
            #[cfg(test)]
            force_uncompressed: false,
        })
    }
    #[cfg(test)]
    fn utility(&self, e: Endpoint) -> f64 {
        if e[0] >= 121 {
            return 1.0;
        }
        if e[1] >= 121 {
            return 0.0;
        }
        1.0 - self.board.dealer_win_probability(
            BoardMatrixSeam::AfterPegging,
            e[1] as u8,
            e[0] as u8,
        )
    }
    fn valuation_key(&self, e: Endpoint, shows: [u8; 2]) -> u16 {
        #[cfg(test)]
        if !self.count_hands {
            return encode(e);
        }
        // Pegging wins precede all counting; pone counts before dealer.
        if e[0] >= 121 {
            return encode([121, 0]);
        }
        if e[1] >= 121 {
            return encode([0, 121]);
        }
        let pone = e[0] + i32::from(shows[0]);
        if pone >= 121 {
            return encode([121, 0]);
        }
        encode([pone, (e[1] + i32::from(shows[1])).min(121)])
    }
    fn value(&self, key: u16) -> f64 {
        #[cfg(test)]
        if !self.count_hands {
            return self.utility(decode(key));
        }
        self.after_hands[key as usize]
    }
    fn compatible(&self, a: &Hand, b: &Hand) -> bool {
        let sum = a.nibbles + b.nibbles + (1_u64 << (4 * self.cut));
        (sum + 0x3333333333333) & 0x8888888888888 == 0
    }
    fn weights(&mut self, p: &Position) -> Weights {
        let seen = p.played[1 - p.actor as usize];
        let key = (p.actor, pack(seen));
        let raw = if self.reuse && self.prior_rows.contains_key(&key) {
            self.stats.prior_hits += 1;
            Arc::clone(&self.prior_rows[&key])
        } else {
            let raw = Arc::new(match &self.priors {
                #[cfg(test)]
                Priors::Finite(_) => TypedPrior::default(),
                Priors::Empirical(e) => e
                    .score_block_hands(
                        if p.actor == 0 {
                            Role::Dealer
                        } else {
                            Role::Pone
                        },
                        seen,
                    )
                    .expect("validated complete belief row")
                    .map(|(h, w)| (pack(h), w))
                    .collect(),
            });
            if self.reuse {
                self.prior_rows.insert(key, Arc::clone(&raw));
            }
            raw
        };
        let events: Vec<_> = p
            .events
            .iter()
            .map(|&(a, r)| match (a, r) {
                (_, 14) => PublicPegEvent::Reset,
                (a, 13) if a == p.actor => PublicPegEvent::SelfGo,
                (_, 13) => PublicPegEvent::OpponentGo,
                (a, r) if a == p.actor => PublicPegEvent::SelfPlay(r),
                (_, r) => PublicPegEvent::OpponentPlay(r),
            })
            .collect();
        Weights {
            raw,
            likelihood: crate::model132::rank_likelihoods_for_history(
                self.cut,
                &events,
                self.factors,
                true,
                true,
            ),
            seen,
        }
    }
    #[cfg(test)]
    fn weight(&mut self, p: &Position, w: &Weights, own: &Hand, other: &Hand) -> f64 {
        self.weight_prepared(p, w, own, other, None)
    }
    // Called only with the public, legally filtered hand domains from solve.
    // A Go has already removed every hand containing a hard-zero rank. Positive
    // empirical u64 weights, at most four factors >=1e-6 and depletion ratios
    // >=1/6 cannot underflow. Forced rows need support, not its magnitude.
    fn supported(&self, _p: &Position, w: &Weights, own: &Hand, other: &Hand, raw: f64) -> bool {
        if !self.compatible(own, other) {
            return false;
        }
        match &self.priors {
            #[cfg(test)]
            Priors::Finite(rows) => {
                let pair = if _p.actor == 0 {
                    [own.initial, other.initial]
                } else {
                    [other.initial, own.initial]
                };
                rows.iter().find(|r| r.0 == pair).is_some_and(|r| r.1 > 0.0)
            }
            Priors::Empirical(_) => {
                debug_assert!((0..13).all(|r| other.left[r] == 0 || w.likelihood[r] > 0));
                raw > 0.0
            }
        }
    }
    fn weight_prepared(
        &mut self,
        _p: &Position,
        w: &Weights,
        own: &Hand,
        other: &Hand,
        raw: Option<f64>,
    ) -> f64 {
        self.stats.weight_reads += 1;
        if !self.compatible(own, other) {
            return 0.0;
        }
        match &self.priors {
            #[cfg(test)]
            Priors::Finite(rows) => {
                let pair = if _p.actor == 0 {
                    [own.initial, other.initial]
                } else {
                    [other.initial, own.initial]
                };
                rows.iter().find(|x| x.0 == pair).map_or(0.0, |x| x.1)
            }
            Priors::Empirical(_) => {
                let mut value =
                    raw.unwrap_or_else(|| *w.raw.get(&other.packed_left).unwrap_or(&0.0));
                let mut mask = other.mask;
                while mask != 0 {
                    let r = mask.trailing_zeros() as usize;
                    mask &= mask - 1;
                    let n = other.left[r] as usize;
                    let available =
                        4 - own.initial[r] - w.seen[r] - u8::from(r == self.cut as usize);
                    value *= RATIOS[available as usize][(4 - w.seen[r]) as usize][n];
                    value = value * f64::from(w.likelihood[r]) / 1_000_000.0;
                }
                value
            }
        }
    }
    fn record(&mut self, _p: &Position, _h: &Hand, _r: u8) {
        #[cfg(test)]
        if self.record_all {
            self.book.insert((_p.path, pack(_h.initial), _p.actor), _r);
        }
    }
    fn progress(&mut self, force: bool) {
        if !force
            && (self.stats.blocks % 1024 != 0
                || self.last_report.elapsed() < Duration::from_secs(3))
        {
            return;
        }
        self.last_report = Instant::now();
        if let Some(path) = &self.progress {
            let body=format!("{{\"status\":\"running\",\"selectionGroupsCompleted\":{},\"choiceGroupsCompleted\":{},\"scoreBlocksEntered\":{},\"forcedPairScoresCompleted\":{},\"rootCandidatesCompleted\":{},\"liveScoreBytes\":{},\"peakScoreBytes\":{},\"wallSeconds\":{}}}\n",self.stats.groups,self.stats.choices,self.stats.blocks,self.stats.forced_pairs,self.stats.root_candidates,self.stats.live_bytes,self.stats.peak_bytes,self.started.elapsed().as_secs_f64());
            let tmp = format!("{path}.tmp");
            if std::fs::write(&tmp, body).is_ok() {
                let _ = std::fs::rename(tmp, path);
            }
        }
    }
    fn retain(&mut self, t: &Solved) {
        self.stats.live_bytes += t.bytes();
        self.stats.peak_bytes = self.stats.peak_bytes.max(self.stats.live_bytes);
    }
    fn release(&mut self, t: &Solved) {
        self.stats.live_bytes -= t.bytes();
    }
    fn packed(&self, cols: usize, data: Vec<u16>) -> Table {
        #[cfg(test)]
        if self.force_uncompressed {
            return Table::Cells { cols, data };
        }
        Table::packed(cols, data)
    }
    // Pair-specific arithmetic is safe only after at least one actor has no
    // choice left. Every contested choice remains in its legal-information group.
    fn physical_endpoint(&self, mut state: State, shows: [u8; 2]) -> Endpoint {
        while !state.complete() {
            let mask = state.mask();
            let action = if mask == 0 {
                RankPegAction::Go
            } else if mask.is_power_of_two() {
                RankPegAction::Play(mask.trailing_zeros() as u8)
            } else {
                assert!(state.empty(0) || state.empty(1));
                return self.uncontested_choice(state, shows).1;
            };
            state = state.apply(action);
        }
        state.endpoint()
    }
    fn suffix(&mut self, p: &Position, a: &[Hand], b: &[Hand]) -> Table {
        let template = State::from_parts(p, [[0; 13]; 2]);
        let mut out = vec![BAD; a.len() * b.len()];
        for (i, ah) in a.iter().enumerate() {
            for (j, bh) in b.iter().enumerate() {
                if !self.compatible(ah, bh) {
                    continue;
                }
                #[cfg(test)]
                if self.record_all {
                    let mut state = template.with_hands([ah.packed_left, bh.packed_left]);
                    #[cfg(test)]
                    let mut path = p.path;
                    while !state.complete() {
                        let mut options = action_iter(state);
                        let first = options.next().unwrap();
                        let (_r, next) = if options.next().is_none() {
                            (first.0, first.2)
                        } else {
                            assert!(state.empty(0) || state.empty(1));
                            let r = self.uncontested_choice(state, [ah.show, bh.show]).0;
                            (
                                r,
                                state.apply(if r == 13 {
                                    RankPegAction::Go
                                } else {
                                    RankPegAction::Play(r)
                                }),
                            )
                        };
                        #[cfg(test)]
                        if self.record_all {
                            self.book.insert(
                                (
                                    path,
                                    pack([ah, bh][state.actor()].initial),
                                    state.actor() as u8,
                                ),
                                _r,
                            );
                        }
                        state = next;
                        #[cfg(test)]
                        {
                            path = (path << 4) | u128::from(_r + 1);
                        }
                    }
                    out[i * b.len() + j] = encode(state.endpoint());
                    self.stats.forced_pairs += 1;
                    continue;
                }
                let state = template.with_hands([ah.packed_left, bh.packed_left]);
                out[i * b.len() + j] = encode(self.physical_endpoint(state, [ah.show, bh.show]));
                self.stats.forced_pairs += 1;
            }
        }
        self.packed(b.len(), out)
    }
    #[cfg(test)]
    fn solve(&mut self, p: &Position, a: &[Hand], b: &[Hand]) -> Table {
        self.solve_live(p, a, b, None).table
    }
    fn terminal_live(&self, table: Table, index: Option<usize>, a: &[Hand], b: &[Hand]) -> Solved {
        let live = if let Some(i) = index {
            let k = self.live.unwrap();
            let other = if k.actor == 0 { b } else { a };
            other
                .iter()
                .enumerate()
                .map(|(j, h)| {
                    if !self.compatible(&k.known, h) {
                        BAD
                    } else if k.actor == 0 {
                        table.get(i, j)
                    } else {
                        table.get(j, i)
                    }
                })
                .collect()
        } else {
            Vec::new()
        };
        Solved { table, live }
    }
    fn solve_live(&mut self, p: &Position, a: &[Hand], b: &[Hand], index: Option<usize>) -> Solved {
        // A private-incompatible subtree may still be needed by the opponent's
        // policy. Omit only its extra live row, never its public score table.
        let index = index.filter(|_| {
            let k = self.live.unwrap();
            let other = if k.actor == 0 { b } else { a };
            other.iter().any(|h| self.compatible(&k.known, h))
        });
        self.stats.blocks += 1;
        self.progress(false);
        if p.done {
            return self.terminal_live(Table::Constant(encode(p.scores)), index, a, b);
        }
        if p.left[0] == 0 || p.left[1] == 0 || p.left.iter().all(|n| *n <= 1) {
            let table = self.suffix(p, a, b);
            return self.terminal_live(table, index, a, b);
        }
        let actor = p.actor as usize;
        let own = if actor == 0 { a } else { b };
        let other = if actor == 0 { b } else { a };
        let legal: Vec<_> = own.iter().map(|h| p.legal(h)).collect();
        let mut branches: Vec<(u8, u8, Vec<usize>, Solved)> = vec![];
        for rank in 0..14_u8 {
            let members: Vec<_> = (0..own.len())
                .filter(|&i| {
                    if rank == 13 {
                        legal[i] == 0
                    } else {
                        legal[i] & (1 << rank) != 0
                    }
                })
                .collect();
            if members.is_empty() {
                continue;
            }
            let child_hands: Vec<_> = members.iter().map(|&i| own[i].after(rank)).collect();
            let child = p.after(rank);
            let pts = (child.scores[actor] - p.scores[actor]) as u8;
            let child_index = index.and_then(|i| {
                if self.live.unwrap().actor == actor {
                    members.iter().position(|&j| j == i)
                } else {
                    Some(i)
                }
            });
            let table = if actor == 0 {
                self.solve_live(&child, &child_hands, b, child_index)
            } else {
                self.solve_live(&child, a, &child_hands, child_index)
            };
            self.retain(&table);
            branches.push((rank, pts, members, table));
        }
        let mut by_own = vec![([(0usize, 0usize); 4], 0usize); own.len()];
        for (k, (_, _, members, _)) in branches.iter().enumerate() {
            for (j, &i) in members.iter().enumerate() {
                let (slots, n) = &mut by_own[i];
                slots[*n] = (k, j);
                *n += 1;
            }
        }
        let w = self.weights(p);
        let mut result = vec![BAD; a.len() * b.len()];
        let private_actor = index.map(|_| self.live.unwrap().actor);
        let mut live = if let Some(role) = private_actor {
            vec![
                BAD;
                if role == actor {
                    other.len()
                } else {
                    own.len()
                }
            ]
        } else {
            Vec::new()
        };
        let raw_values: Vec<_> = other
            .iter()
            .map(|h| *w.raw.get(&h.packed_left).unwrap_or(&0.0))
            .collect();
        let mut weights = Vec::new();
        for (i, h) in own.iter().enumerate() {
            let options = &by_own[i].0[..by_own[i].1];
            if options.is_empty() {
                continue;
            }
            let forced = self.reuse && options.len() == 1;
            if forced
                && !other
                    .iter()
                    .enumerate()
                    .any(|(j, o)| self.supported(p, &w, h, o, raw_values[j]))
            {
                continue;
            }
            weights.clear();
            if !forced {
                weights.extend(
                    other
                        .iter()
                        .enumerate()
                        .map(|(j, o)| self.weight_prepared(p, &w, h, o, Some(raw_values[j]))),
                );
            }
            let mass: f64 = if forced { 1.0 } else { weights.iter().sum() };
            if mass == 0.0 {
                continue;
            }
            let mut best = (f64::NEG_INFINITY, 0, 0);
            let mut selected = None;
            // Preserve support checks above. A forced action needs no histogram
            // or WP valuation; its already-solved child is the complete result.
            if self.reuse && options.len() == 1 {
                selected = Some(options[0]);
                self.stats.forced_selections += 1;
            }
            for &(branch, index) in options {
                if self.reuse && options.len() == 1 {
                    break;
                }
                let (rank, pts, _, table) = &branches[branch];
                let mut weighted_value = 0.0;
                #[cfg(test)]
                let mut old_hist: BTreeMap<u16, f64> = BTreeMap::new();
                for (j, &weight) in weights.iter().enumerate() {
                    if weight == 0.0 {
                        continue;
                    }
                    let score = if actor == 0 {
                        table.get(index, j)
                    } else {
                        table.get(j, index)
                    };
                    assert_ne!(score, BAD, "positive-weight child score missing");
                    #[cfg(test)]
                    if !self.count_hands {
                        *old_hist.entry(score).or_default() += weight;
                        continue;
                    }
                    let shows = if actor == 0 {
                        [h.show, other[j].show]
                    } else {
                        [other[j].show, h.show]
                    };
                    // Retain the hold/endpoint association until valuation;
                    // identical counting states share the small WP table.
                    weighted_value += weight * self.value(self.valuation_key(decode(score), shows));
                }
                let value = weighted_value / mass;
                // Pin the historical arithmetic for the matched test ablation.
                #[cfg(test)]
                let value = if !self.count_hands {
                    let old_mass: f64 = old_hist.values().sum();
                    old_hist
                        .iter()
                        .map(|(e, w)| w / old_mass * self.value(*e))
                        .sum()
                } else {
                    value
                };
                let choice = (if actor == 0 { value } else { -value }, *pts, *rank);
                if choice > best {
                    best = choice;
                    selected = Some((branch, index));
                }
            }
            let (branch, index) = selected.unwrap();
            let (rank, _, _, table) = &branches[branch];
            self.record(p, h, *rank);
            if private_actor.is_some_and(|role| role != actor) && !table.live.is_empty() {
                live[i] = table.live[index];
            }
            for (j, o) in other.iter().enumerate() {
                if !self.compatible(h, o) {
                    continue;
                }
                let score = if actor == 0 {
                    table.get(index, j)
                } else {
                    table.get(j, index)
                };
                if actor == 0 {
                    result[i * b.len() + j] = score;
                } else {
                    result[j * b.len() + i] = score;
                }
            }
            self.stats.groups += 1;
            if options.len() > 1 {
                self.stats.choices += 1;
            }
        }
        if private_actor == Some(actor) {
            let i = index.unwrap();
            let k = self.live.unwrap();
            debug_assert_eq!(own[i].initial, k.initial);
            let options = &by_own[i].0[..by_own[i].1];
            weights.clear();
            if options.len() > 1 {
                weights.extend(other.iter().enumerate().map(|(j, h)| {
                    // Finite reference priors identify the keep, not six cards.
                    #[cfg(test)]
                    if matches!(self.priors, Priors::Finite(_)) {
                        return if self.compatible(&k.known, h) {
                            self.weight_prepared(p, &w, &own[i], h, Some(raw_values[j]))
                        } else {
                            0.0
                        };
                    }
                    self.weight_prepared(p, &w, &k.known, h, Some(raw_values[j]))
                }));
            }
            let mass: f64 = weights.iter().sum();
            let mut best = (f64::NEG_INFINITY, 0, 0);
            let mut selected = None;
            for &(branch, _) in options {
                let (rank, pts, _, child) = &branches[branch];
                if child.live.is_empty() {
                    continue;
                }
                if options.len() == 1 {
                    selected = Some(branch);
                    break;
                }
                if mass == 0.0 {
                    break;
                }
                let mut value = 0.0;
                for (j, &weight) in weights.iter().enumerate() {
                    if weight == 0.0 {
                        continue;
                    }
                    assert_ne!(
                        child.live[j], BAD,
                        "positive private weight has no endpoint"
                    );
                    let shows = if actor == 0 {
                        [own[i].show, other[j].show]
                    } else {
                        [other[j].show, own[i].show]
                    };
                    value += weight * self.value(self.valuation_key(decode(child.live[j]), shows));
                }
                let choice = (
                    if actor == 0 {
                        value / mass
                    } else {
                        -value / mass
                    },
                    *pts,
                    *rank,
                );
                if choice > best {
                    best = choice;
                    selected = Some(branch);
                }
            }
            if let Some(branch) = selected {
                live.clone_from(&branches[branch].3.live);
                self.stats.private_groups += 1;
                self.stats.private_choices += u64::from(options.len() > 1);
                #[cfg(test)]
                if self.record_all {
                    self.private_book.insert(p.path, branches[branch].0);
                }
            }
        }
        for (_, _, _, table) in &branches {
            self.release(table);
        }
        Solved {
            table: self.packed(b.len(), result),
            live,
        }
    }
}

#[cfg(test)]
fn actions(s: State) -> Vec<(u8, u8, State)> {
    let mut mask = s.mask();
    let mut out = Vec::with_capacity(4);
    if mask == 0 {
        out.push((13, 0, s.apply(RankPegAction::Go)));
    }
    while mask != 0 {
        let rank = mask.trailing_zeros() as u8;
        mask &= mask - 1;
        let next = s.apply(RankPegAction::Play(rank));
        out.push((
            rank,
            (next.endpoint()[s.actor()] - s.endpoint()[s.actor()]) as u8,
            next,
        ));
    }
    out
}
fn action_iter(s: State) -> impl Iterator<Item = (u8, u8, State)> {
    let mut mask = s.mask();
    let mut go = mask == 0;
    std::iter::from_fn(move || {
        if go {
            go = false;
            return Some((13, 0, s.apply(RankPegAction::Go)));
        }
        if mask == 0 {
            return None;
        }
        let rank = mask.trailing_zeros() as u8;
        mask &= mask - 1;
        let next = s.apply(RankPegAction::Play(rank));
        Some((
            rank,
            (next.endpoint()[s.actor()] - s.endpoint()[s.actor()]) as u8,
            next,
        ))
    })
}
impl Solver<'_> {
    // Hidden cards are harmless only here: there is no remaining choice by
    // the empty player. Never use pair-wise minimax for contested decisions.
    fn uncontested_choice(&self, s: State, shows: [u8; 2]) -> (u8, Endpoint) {
        assert!(s.empty(0) || s.empty(1));
        let sign = if s.actor() == 0 { 1.0 } else { -1.0 };
        let mut best = (f64::NEG_INFINITY, 0, 0);
        let mut result = [0, 0];
        for (r, pts, next) in action_iter(s) {
            let end = if next.complete() {
                next.endpoint()
            } else {
                self.uncontested_choice(next, shows).1
            };
            let v = (sign * self.value(self.valuation_key(end, shows)), pts, r);
            if v > best {
                best = v;
                result = end;
            }
        }
        (best.2, result)
    }
}

fn advance_domains(p: &Position, rank: u8, domains: &mut [Vec<Hand>; 2]) {
    let actor = p.actor as usize;
    domains[actor] = domains[actor]
        .iter()
        .filter(|h| {
            if rank == 13 {
                p.legal(h) == 0
            } else {
                p.legal(h) & (1 << rank) != 0
            }
        })
        .map(|h| h.after(rank))
        .collect();
}

/// Prepare only public domains. Root-private cards, including discards, must
/// not narrow these domains: the other actor needs uncertainty about our hold.
fn prepare(
    assets: &PolicyAssets,
    o: &Model132Observation,
) -> Result<(Position, [Vec<Hand>; 2]), String> {
    o.validate()?;
    let actor = usize::from(o.role == Role::Dealer);
    let mut all: Vec<_> = assets
        .beliefs
        .score_block_hands(Role::Dealer, [0; 13])
        .ok_or("28.3 missing opening prior")?
        .map(|(h, _)| h)
        .filter(|h| h[o.turn_rank as usize] < 4)
        .collect();
    all.sort();
    all.dedup();
    let all: Vec<_> = all
        .into_iter()
        .map(|h| Hand::counted(h, o.turn_rank))
        .collect();
    let mut domains = [all.clone(), all];
    let mut p = Position::start([0, 0], [4, 4]);
    for event in &o.public_history {
        let (a, rank) = match *event {
            PublicPegEvent::SelfPlay(r) => (actor, r),
            PublicPegEvent::OpponentPlay(r) => (1 - actor, r),
            PublicPegEvent::SelfGo => (actor, 13),
            PublicPegEvent::OpponentGo => (1 - actor, 13),
            PublicPegEvent::Reset => continue,
        };
        if rank > 13 || p.done || p.actor as usize != a {
            return Err("28.3 inconsistent public history".into());
        }
        advance_domains(&p, rank, &mut domains);
        p = p.after(rank);
        if domains.iter().any(Vec::is_empty) {
            return Err("28.3 public history has no legal holds".into());
        }
    }
    let relative = |v: Option<InfoActor>| {
        v.map_or(2, |v| {
            if v == InfoActor::SelfPlayer {
                actor as u8
            } else {
                1 - actor as u8
            }
        })
    };
    if p.done
        || p.actor as usize != actor
        || p.played[actor] != o.own_played
        || p.played[1 - actor] != o.opponent_played
        || &*p.series != o.current_series.as_slice()
        || p.count != o.count
        || p.go != relative(o.go_player)
        || p.last != relative(o.last_player)
    {
        return Err("28.3 public history does not reconstruct the live state".into());
    }
    p.scores[actor] = o.my_score;
    p.scores[1 - actor] = o.opponent_score;
    let own: Ranks = std::array::from_fn(|r| o.own_remaining[r] + o.own_played[r]);
    if !(0..13).all(|r| {
        own[r] + o.own_discards[r] + o.opponent_played[r] + u8::from(r == o.turn_rank as usize) <= 4
    }) {
        return Err("28.3 known cards exceed the deck".into());
    }
    if !domains[actor]
        .iter()
        .any(|h| h.initial == own && h.left == o.own_remaining)
    {
        return Err("28.3 live hold contradicts public history".into());
    }
    Ok((p, domains))
}

/// The live actor remembers its discards against the existing opposing policy.
/// Opposing choices still use only their original public/own-keep information. The caller
/// alone applies the live, known-hand/crib valuation, just as in Model 20.7.
/// No actual opponent hand/discards, fallback policy, or six-card worlds enter.
pub(super) fn forecast(
    assets: &PolicyAssets,
    o: &Model132Observation,
    hands: &[(Ranks, f64)],
    requested: &[RankPegAction],
) -> Result<Vec<PegCandidateForecast>, String> {
    Ok(forecast_conditioned(assets, o, hands, requested)?
        .into_iter()
        .map(|x| x.forecast)
        .collect())
}

pub(super) fn forecast_conditioned(
    assets: &PolicyAssets,
    o: &Model132Observation,
    hands: &[(Ranks, f64)],
    requested: &[RankPegAction],
) -> Result<Vec<ScoreBlockForecast>, String> {
    let (p, domains) = prepare(assets, o)?;
    let actor = p.actor as usize;
    let own: Ranks = std::array::from_fn(|r| o.own_remaining[r] + o.own_played[r]);
    let own_domain = &domains[actor];
    let other = &domains[1 - actor];
    let own_index = own_domain.iter().position(|h| h.initial == own).unwrap();
    let legal = o.legal_actions();
    if requested.is_empty() || requested.iter().any(|a| !legal.contains(a)) {
        return Err("28.3 requested an illegal action".into());
    }
    let mut posterior = HashMap::new();
    for &(h, w) in hands {
        if !w.is_finite() || w < 0.0 {
            return Err("28.3 invalid posterior weight".into());
        }
        *posterior.entry(pack(h)).or_insert(0.0) += w;
    }
    let weights: Vec<_> = other
        .iter()
        .map(|h| posterior.remove(&pack(h.left)).unwrap_or(0.0))
        .collect();
    let total: f64 = weights.iter().sum();
    if !total.is_finite() || total <= 0.0 || posterior.values().any(|w| *w > 0.0) {
        return Err("28.3 public domains do not cover the live posterior".into());
    }
    let count = weights.iter().filter(|w| **w > 0.0).count();
    let mut solver = Solver::new(assets, o.turn_rank)?;
    solver.live = Some(LiveKnowledge {
        actor,
        initial: own,
        known: Hand::new(std::array::from_fn(|r| own[r] + o.own_discards[r])),
    });
    let mut out = vec![];
    for &action in requested {
        let rank = match action {
            RankPegAction::Play(r) => r,
            RankPegAction::Go => 13,
        };
        let children: Vec<_> = own_domain
            .iter()
            .filter(|h| {
                if rank == 13 {
                    p.legal(h) == 0
                } else {
                    p.legal(h) & (1 << rank) != 0
                }
            })
            .map(|h| h.after(rank))
            .collect();
        let i = children
            .iter()
            .position(|h| h.initial == own_domain[own_index].initial)
            .ok_or("28.3 live action has no support")?;
        let next = p.after(rank);
        let table = if actor == 0 {
            solver.solve_live(&next, &children, other, Some(i))
        } else {
            solver.solve_live(&next, other, &children, Some(i))
        };
        let mut hist: BTreeMap<u16, f64> = BTreeMap::new();
        let mut conditioned = Vec::with_capacity(count);
        for (j, &w) in weights.iter().enumerate() {
            if w > 0.0 {
                let end = table.live.get(j).copied().unwrap_or(BAD);
                if end == BAD {
                    return Err("28.3 missing positive-weight continuation".into());
                }
                *hist.entry(end).or_default() += w;
                let e = decode(end);
                conditioned.push((
                    other[j].left,
                    (e[actor] - p.scores[actor]) as u8,
                    (e[1 - actor] - p.scores[1 - actor]) as u8,
                    w / total,
                ));
            }
        }
        let mass: f64 = hist.values().sum();
        let outcomes = hist
            .into_iter()
            .map(|(e, w)| {
                let e = decode(e);
                (
                    (e[actor] - p.scores[actor]) as u8,
                    (e[1 - actor] - p.scores[1 - actor]) as u8,
                    w / mass,
                )
            })
            .collect();
        out.push(ScoreBlockForecast {
            conditioned,
            forecast: PegCandidateForecast {
                action,
                outcomes,
                posterior_worlds: count,
                evaluated_worlds: count,
            },
        });
        solver.stats.root_candidates += 1;
        solver.progress(true);
    }
    #[cfg(test)]
    if let Ok(path) = std::env::var("CRIBBAGE_283_STATS") {
        std::fs::write(path, serde_json::to_vec(&serde_json::json!({
            "priorHits":solver.stats.prior_hits,"forcedSelections":solver.stats.forced_selections,
            "priorRows":solver.prior_rows.len(),"privateGroups":solver.stats.private_groups,"privateChoices":solver.stats.private_choices,
            "blocks":solver.stats.blocks,"choices":solver.stats.choices,"groups":solver.stats.groups,
            "peakScoreBytes":solver.stats.peak_bytes
        })).unwrap()).unwrap();
    }
    Ok(out)
}

#[cfg(test)]
#[path = "model283_tests.rs"]
mod tests;

// Diagnostic C-only upper-bound screen. Enumerate physical scoring outcomes
// with depth-first constant-space traversal, never use pairwise choices as policy.
#[cfg(test)]
pub(super) fn root_endpoints(
    assets: &PolicyAssets,
    o: &Model132Observation,
    hands: &[(Ranks, f64)],
    actions: &[RankPegAction],
) -> Result<Vec<(RankPegAction, Vec<(Ranks, f64, Vec<(u8, u8)>)>)>, String> {
    fn visit(s: State, ends: &mut std::collections::BTreeSet<u16>) {
        if s.complete() {
            ends.insert(encode(s.endpoint()));
            return;
        }
        for (_, _, next) in action_iter(s) {
            visit(next, ends);
        }
    }
    let (p, _) = prepare(assets, o)?;
    let actor = p.actor as usize;
    let mut out = vec![];
    for &action in actions {
        let mut rows = vec![];
        for &(h, w) in hands {
            if w == 0.0 {
                continue;
            }
            let pair = if actor == 0 {
                [o.own_remaining, h]
            } else {
                [h, o.own_remaining]
            };
            let start = State::from_parts(&p, pair).apply(action);
            let mut ends = std::collections::BTreeSet::new();
            visit(start, &mut ends);
            let points = ends
                .into_iter()
                .map(|e| {
                    let e = decode(e);
                    (
                        (e[actor] - p.scores[actor]) as u8,
                        (e[1 - actor] - p.scores[1 - actor]) as u8,
                    )
                })
                .collect();
            rows.push((h, w, points));
        }
        out.push((action, rows));
    }
    Ok(out)
}
