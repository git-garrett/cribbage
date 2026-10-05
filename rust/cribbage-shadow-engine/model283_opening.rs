//! Optional exact opening assets for 28.3.fast. One shard contains the dealer's
//! legal-information choices after one lead, independent of the live pone hold.
//! The live player's own-discard-aware policy and joint counting run at runtime.
use super::*;
use sha2::{Digest, Sha256};
use std::io::Write;
#[path = "model283_opening_codec.rs"]
mod codec;

pub(super) struct Book {
    pub rows: Vec<(u128, u64, u8)>,
    pub dealer_plays: u8,
}
impl Default for Book {
    fn default() -> Self {
        Self { rows: Vec::new(), dealer_plays: 4 }
    }
}
fn hand_ids() -> &'static Vec<u64> {
    static IDS: std::sync::OnceLock<Vec<u64>> = std::sync::OnceLock::new();
    IDS.get_or_init(|| {
        let mut out = Vec::with_capacity(1820);
        for a in 0..13 {
            for b in a..13 {
                for c in b..13 {
                    for d in c..13 {
                        out.push(
                            (1u64 << (3 * a))
                                + (1u64 << (3 * b))
                                + (1u64 << (3 * c))
                                + (1u64 << (3 * d)),
                        );
                    }
                }
            }
        }
        out.sort_unstable();
        out
    })
}
fn put_varint(mut n: u128, out: &mut Vec<u8>) {
    while n >= 128 {
        out.push((n as u8 & 127) | 128);
        n >>= 7;
    }
    out.push(n as u8);
}
fn get_varint(bytes: &[u8], at: &mut usize) -> Result<u128, String> {
    let mut n = 0;
    for shift in (0..=126).step_by(7) {
        let b = *bytes.get(*at).ok_or("short varint")?;
        *at += 1;
        if shift == 126 && b > 3 {
            return Err("varint overflow".into());
        }
        n |= u128::from(b & 127) << shift;
        if b < 128 {
            return Ok(n);
        }
    }
    Err("varint overflow".into())
}
// The loaded learning snapshot is already hash-verified by PolicyAssets.
// Also bind to all policy/scoring sources, exact board utilities, and decline factors. A changed source or snapshot requires rebuilding shards.
fn fingerprint(s: &Solver) -> String {
    static CODE: std::sync::OnceLock<[u8; 32]> = std::sync::OnceLock::new();
    let code = CODE.get_or_init(|| {
        let mut h = Sha256::new();
        for source in [
            include_str!("model283.rs"),
            include_str!("model283_physical.rs"),
            include_str!("model283_opening.rs"),
            include_str!("model283_opening_codec.rs"),
            include_str!("model283_tables.rs"),
            include_str!("model283_counting.rs"),
            include_str!("model91_compact.rs"),
            include_str!("model203_crib.rs"),
            include_str!("model203_discards.rs"),
            include_str!("model20_discards.rs"),
            include_str!("board.rs"),
            include_str!("board_matrix.rs"),
            include_str!("information_set.rs"),
            include_str!("model1323.rs"),
            include_str!("model132.rs"),
            include_str!("model91.rs"),
            include_str!("cards.rs"),
        ] {
            h.update(source);
        }
        h.finalize().into()
    });
    let mut h = Sha256::new();
    h.update(code);
    h.update(s.opening_snapshot);
    h.update(format!("{:?}", s.factors));
    for v in &s.after_hands {
        h.update(v.to_bits().to_le_bytes());
    }
    format!("{:x}", h.finalize())
}
impl Book {
    pub(super) fn finish(&mut self) {
        self.rows.sort_unstable_by_key(|r| (r.0, r.1));
        assert!(self
            .rows
            .windows(2)
            .all(|w| (w[0].0, w[0].1) < (w[1].0, w[1].1)));
    }
    fn get(&self, p: &Position, h: &Hand) -> Result<u8, String> {
        let key = (p.path, pack(h.initial));
        self.rows
            .binary_search_by_key(&key, |r| (r.0, r.1))
            .map(|i| self.rows[i].2)
            .map_err(|_| "opening asset lacks a needed dealer choice".into())
    }
    fn write(
        &self,
        path: &Path,
        cut: u8,
        scores: Endpoint,
        lead: u8,
        policy: &str,
    ) -> Result<usize, String> {
        let mut body = Vec::new();
        let mut at = 0;
        let mut previous = 0;
        while at < self.rows.len() {
            let path = self.rows[at].0;
            let begin = at;
            while at < self.rows.len() && self.rows[at].0 == path {
                at += 1;
            }
            put_varint(path - previous, &mut body);
            previous = path;
            put_varint((at - begin) as u128, &mut body);
            for &(_, hand, rank) in &self.rows[begin..at] {
                let id = hand_ids()
                    .binary_search(&hand)
                    .map_err(|_| "invalid asset hand")?;
                body.extend(((id as u16) << 4 | u16::from(rank)).to_le_bytes());
            }
        }
        let body = codec::encode(&body)?;
        let header=serde_json::to_vec(&serde_json::json!({"format":4,"dealerPlays":self.dealer_plays,"policy":policy,"cut":cut,"scores":scores,"lead":lead,"rows":self.rows.len(),"sha256":format!("{:x}",Sha256::digest(&body))})).map_err(|e|e.to_string())?;
        let tmp = path.with_extension("tmp");
        let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        out.write_all(&(header.len() as u32).to_le_bytes())
            .and_then(|_| out.write_all(&header))
            .and_then(|_| out.write_all(&body))
            .and_then(|_| out.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(tmp, path).map_err(|e| e.to_string())?;
        Ok(4 + header.len() + body.len())
    }
    fn read(
        path: &Path,
        cut: u8,
        scores: Endpoint,
        lead: u8,
        policy: &str,
    ) -> Result<Self, String> {
        // Shards from this format are small. Bound untrusted allocations.
        if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > 128 * 1024 * 1024 {
            return Err("opening asset too large".into());
        }
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        let n =
            u32::from_le_bytes(bytes.get(..4).ok_or("short asset")?.try_into().unwrap()) as usize;
        if n > 8192 {
            return Err("opening header too large".into());
        }
        let header: serde_json::Value =
            serde_json::from_slice(bytes.get(4..4 + n).ok_or("short header")?)
                .map_err(|e| e.to_string())?;
        if header["format"] != 4
            || header["policy"] != policy
            || header["cut"] != cut
            || header["scores"] != serde_json::json!(scores)
            || header["lead"] != lead
        {
            return Err("opening context mismatch".into());
        }
        let dealer_plays = header["dealerPlays"].as_u64().filter(|v| (1..=4).contains(v)).ok_or("invalid dealer depth")? as u8;
        let body = &bytes[4 + n..];
        let count = header["rows"].as_u64().ok_or("invalid row count")?;
        if count > 4_000_000
            || header["sha256"] != format!("{:x}", Sha256::digest(body))
        {
            return Err("opening integrity mismatch".into());
        }
        let body = codec::decode(body)?;
        if count > body.len() as u64 / 2 { return Err("invalid row count".into()); }
        let body = body.as_slice();
        let mut rows = Vec::with_capacity(count as usize);
        let mut at = 0;
        let mut path = 0u128;
        while at < body.len() {
            let delta = get_varint(body, &mut at)?;
            if delta == 0 {
                return Err("duplicate path".into());
            }
            path = path.checked_add(delta).ok_or("path overflow")?;
            let n =
                usize::try_from(get_varint(body, &mut at)?).map_err(|_| "row count overflow")?;
            if n == 0 || n > 1820 || n > (body.len() - at) / 2 {
                return Err("invalid path group".into());
            }
            for _ in 0..n {
                let code = u16::from_le_bytes(body[at..at + 2].try_into().unwrap());
                at += 2;
                let hand = *hand_ids()
                    .get((code >> 4) as usize)
                    .ok_or("invalid hand ID")?;
                let rank = (code & 15) as u8;
                if rank >= 13 {
                    return Err("invalid action".into());
                }
                rows.push((path, hand, rank));
            }
        }
        if rows.len() != count as usize
            || !rows.windows(2).all(|w| (w[0].0, w[0].1) < (w[1].0, w[1].1))
        {
            return Err("invalid opening ordering".into());
        }
        Ok(Self { rows, dealer_plays })
    }
}
// The same private-row recursion as solve_live, with the broad dealer reasoning
// supplied by the shard. Own alternatives and weights are still evaluated now.
fn private_solve(
    s: &mut Solver,
    book: &Book,
    p: &Position,
    own: Hand,
    other: &[Hand],
    known: &Hand,
    public_own: Option<&[Hand]>,
) -> Result<Vec<u16>, String> {
    s.check_cancelled()?;
    if p.done {
        return Ok(other
            .iter()
            .map(|h| {
                if s.compatible(known, h) {
                    encode(p.scores)
                } else {
                    BAD
                }
            })
            .collect());
    }
    if p.left[0] == 0 || p.left[1] == 0 || p.left.iter().all(|n| *n <= 1) {
        let t = s.suffix(p, &[own], other)?;
        return Ok(other
            .iter()
            .enumerate()
            .map(|(j, h)| {
                if s.compatible(known, h) {
                    t.get(0, j)
                } else {
                    BAD
                }
            })
            .collect());
    }
    if p.actor == 1 {
        if 4 - p.left[1] >= book.dealer_plays
            && other.iter().any(|h| s.compatible(known, h) && p.legal(h).count_ones() > 1)
        {
            // Resume the original full legal-information solver only where
            // the saved policy ends. Never replace A's public domain with
            // its actual hand or filter it using A's private discards.
            let domain = public_own.ok_or("partial opening lacks public domain")?;
            let index = domain.iter().position(|h| h.initial == own.initial)
                .ok_or("partial opening lacks live hand")?;
            s.stats.opening_fallbacks += 1;
            return Ok(s.solve_live(p, domain, other, Some(index))?.live);
        }
        let mut groups: [Vec<usize>; 14] = std::array::from_fn(|_| Vec::new());
        for (j, h) in other.iter().enumerate() {
            if !s.compatible(known, h) {
                continue;
            }
            let legal = p.legal(h);
            let rank = if legal == 0 {
                13
            } else if legal.is_power_of_two() {
                legal.trailing_zeros() as u8
            } else {
                s.stats.opening_lookups += 1;
                book.get(p, h)?
            };
            if rank != 13 && legal & (1 << rank) == 0 {
                return Err("asset returned illegal rank".into());
            }
            groups[rank as usize].push(j);
        }
        let mut result = vec![BAD; other.len()];
        for (rank, members) in groups.iter().enumerate() {
            if members.is_empty() {
                continue;
            }
            // Existing 28.3 conditions beliefs on legal public evidence, not
            // on the policy's predicted choices. Child beliefs must include
            // every hold that COULD play this rank, including holds choosing
            // another branch at this parent. Only outcome propagation selects.
            let legal_members: Vec<_> = other
                .iter()
                .enumerate()
                .filter(|(_, h)| {
                    let m = p.legal(h);
                    if rank == 13 {
                        m == 0
                    } else {
                        m & (1 << rank) != 0
                    }
                })
                .map(|(j, _)| j)
                .collect();
            let child: Vec<_> = legal_members
                .iter()
                .map(|&j| other[j].after(rank as u8))
                .collect();
            let ends = private_solve(s, book, &p.after(rank as u8), own, &child, known, public_own)?;
            for (&j, end) in legal_members.iter().zip(ends) {
                if members.binary_search(&j).is_ok() {
                    result[j] = end;
                }
            }
        }
        return Ok(result);
    }
    let legal = p.legal(&own);
    let ranks: Vec<_> = if legal == 0 {
        vec![13]
    } else {
        (0..13).filter(|r| legal & (1 << r) != 0).collect()
    };
    let weights = if ranks.len() > 1 {
        let w = s.weights(p);
        other
            .iter()
            .map(|h| s.weight_prepared(p, &w, known, h, None))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let mass: f64 = weights.iter().sum();
    let mut best = (f64::NEG_INFINITY, 0, 0);
    let mut selected = vec![BAD; other.len()];
    for rank in ranks.iter().copied() {
        let child = p.after(rank);
        let points = (child.scores[0] - p.scores[0]) as u8;
        let child_public = public_own.map(|domain| domain.iter().filter(|h| {
            let m = p.legal(h);
            if rank == 13 { m == 0 } else { m & (1 << rank) != 0 }
        }).map(|h| h.after(rank)).collect::<Vec<_>>());
        let ends = private_solve(s, book, &child, own.after(rank), other, known, child_public.as_deref())?;
        if ranks.len() == 1 {
            return Ok(ends);
        }
        if mass == 0.0 {
            continue;
        }
        let mut value = 0.0;
        for (j, &weight) in weights.iter().enumerate() {
            if weight == 0.0 {
                continue;
            }
            assert_ne!(ends[j], BAD);
            value += weight * s.value(s.valuation_key(decode(ends[j]), [own.show, other[j].show]));
        }
        let choice = (value / mass, points, rank);
        if choice > best {
            best = choice;
            selected = ends;
        }
    }
    Ok(selected)
}
pub(super) fn asset_forecast(
    s: &mut Solver,
    p: &Position,
    next: &Position,
    own: &Hand,
    other: &[Hand],
    lead: u8,
    public_own: &[Hand],
) -> Result<Option<Solved>, String> {
    let Ok(dir) = std::env::var("CRIBBAGE_283_FAST_ASSET") else {
        return Ok(None);
    };
    if p.actor != 0 || p.path != 1 {
        return Ok(None);
    };
    let path = shard_path(Path::new(&dir), s.cut, p.scores, lead);
    if !path.exists() {
        return Ok(None);
    }; // Exact ordinary fallback, never substitute a different context.
    let Ok(book) = Book::read(&path, s.cut, p.scores, lead, &fingerprint(s)) else {
        return Ok(None);
    };
    s.stats.opening_loaded_rows += book.rows.len() as u64;
    let known = s.live.unwrap().known;
    let public_own = (book.dealer_plays < 3).then_some(public_own);
    let live = match private_solve(s, &book, next, *own, other, &known, public_own) {
        Ok(live) => live,
        Err(_) => { s.check_cancelled()?; return Ok(None); }
    };
    s.stats.opening_successes += 1;
    Ok(Some(Solved {
        table: Table::Constant(BAD),
        live,
    }))
}

fn shard_path(root: &Path, cut: u8, scores: Endpoint, lead: u8) -> std::path::PathBuf {
    root.join(format!("cut{cut}/pone{}/dealer{}-lead{lead}.bin", scores[0], scores[1]))
}

fn project(book: &Book, scores: Endpoint, depth: u8) -> Result<Book, String> {
    if depth == 0 || depth > book.dealer_plays { return Err("invalid projection depth".into()); }
    let mut result = Book { rows: Vec::new(), dealer_plays: depth };
    let mut previous = 0;
    let mut keep = false;
    for &row in &book.rows {
        if row.0 != previous {
            let mut path = row.0;
            let mut moves = Vec::new();
            while path > 1 {
                let code = (path & 15) as u8;
                if code == 0 || code > 14 { return Err("invalid opening path".into()); }
                moves.push(code - 1);
                path >>= 4;
            }
            if path != 1 { return Err("invalid opening path root".into()); }
            let mut p = Position::start(scores, [4, 4]);
            for rank in moves.into_iter().rev() { p = p.after(rank); }
            if p.actor != 1 || p.done { return Err("invalid dealer decision path".into()); }
            keep = 4 - p.left[1] < depth;
            previous = row.0;
        }
        if keep { result.rows.push(row); }
    }
    Ok(result)
}

/// Project a verified full chunk without repeating the strategic calculation.
pub(crate) fn project_file(directory: &Path, input: &Path, output: &Path,
    cut: u8, scores: Endpoint, lead: u8, depth: u8) -> Result<serde_json::Value, String> {
    if cut >= 13 || lead >= 13 || scores.iter().any(|s| !(0..121).contains(s)) { return Err("invalid coordinates".into()); }
    let assets = PolicyAssets::load_model205(directory)?;
    let solver = Solver::new(&assets, cut)?;
    let policy = fingerprint(&solver);
    let full = Book::read(&shard_path(input, cut, scores, lead), cut, scores, lead, &policy)?;
    let projected = project(&full, scores, depth)?;
    let path = shard_path(output, cut, scores, lead);
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let bytes = projected.write(&path, cut, scores, lead, &policy)?;
    if Book::read(&path, cut, scores, lead, &policy)?.rows != projected.rows { return Err("projection roundtrip differs".into()); }
    Ok(serde_json::json!({"status":"passed","path":path,"dealerPlays":depth,"bytes":bytes,"rows":projected.rows.len(),"policy":policy}))
}

/// A single independently buildable lead shard; callers schedule bounded batches.
pub(crate) fn build(
    directory: &Path,
    output: &Path,
    cut: u8,
    scores: [i32; 2],
    lead: u8,
) -> Result<serde_json::Value, String> {
    if cut >= 13 || lead >= 13 || scores.iter().any(|s| !(0..121).contains(s)) {
        return Err("invalid opening coordinates".into());
    }
    let assets = PolicyAssets::load_model205(directory)?;
    let start = Instant::now();
    let mut all: Vec<_> = assets
        .beliefs
        .score_block_hands(Role::Dealer, [0; 13])
        .ok_or("opening beliefs missing")?
        .map(|(h, _)| h)
        .filter(|h| h[cut as usize] < 4)
        .collect();
    all.sort();
    all.dedup();
    let other: Vec<_> = all.into_iter().map(|h| Hand::counted(h, cut)).collect();
    let own: Vec<_> = other
        .iter()
        .filter(|h| h.initial[lead as usize] > 0)
        .map(|h| h.after(lead))
        .collect();
    let mut p = Position::start(scores, [4, 4]).after(lead);
    p.fast_flags = 36;
    let mut solver = Solver::new(&assets, cut)?;
    let dealer_plays = std::env::var("CRIBBAGE_283_BUILD_DEALER_PLAYS")
        .unwrap_or_else(|_| "4".into()).parse::<u8>().map_err(|e| e.to_string())?;
    if !(1..=4).contains(&dealer_plays) { return Err("dealer depth must be 1..4".into()); }
    solver.opening_book = Some(Book { dealer_plays, ..Book::default() });
    let _table = solver.solve_live(&p, &own, &other, None)?;
    let mut book = solver.opening_book.take().unwrap();
    book.finish();
    let policy = fingerprint(&solver);
    let path = shard_path(output, cut, scores, lead);
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let bytes = book.write(&path, cut, scores, lead, &policy)?;
    let saved = start.elapsed().as_secs_f64();
    let restored = Book::read(&path, cut, scores, lead, &policy)?;
    if book.rows != restored.rows {
        return Err("opening roundtrip differs".into());
    }
    Ok(
        serde_json::json!({"status":"passed","path":path,"dealerPlays":dealer_plays,"cut":cut,"scores":scores,"lead":lead,"rows":book.rows.len(),"bytes":bytes,"writeWallSeconds":saved,"wallSeconds":start.elapsed().as_secs_f64(),"policy":policy,"blocks":solver.stats.blocks,"groups":solver.stats.groups}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_replay_matches_shared_private_row() {
        let assets = super::super::tests::assets();
        let cut = 11;
        let a = [
            super::super::tests::counts(&[3, 4, 4, 5]),
            super::super::tests::counts(&[0, 1, 2, 3]),
            super::super::tests::counts(&[5, 6, 6, 10]),
        ]
        .map(|h| Hand::counted(h, cut));
        let b = [
            super::super::tests::counts(&[0, 0, 0, 0]),
            super::super::tests::counts(&[0, 0, 0, 1]),
            super::super::tests::counts(&[6, 6, 9, 9]),
        ]
        .map(|h| Hand::counted(h, cut));
        for (scores, depth) in [[0, 0], [111, 114], [118, 116]].into_iter()
            .flat_map(|scores| [1, 2, 4].map(|depth| (scores, depth))) {
            let mut public = Solver::new(&assets, cut).unwrap();
            public.opening_book = Some(Book { dealer_plays: depth, ..Book::default() });
            let p = Position::start(scores, [4, 4]);
            public.solve(&p, &a, &b);
            let mut book = public.opening_book.take().unwrap();
            book.finish();
            let mut complete = Solver::new(&assets, cut).unwrap();
            complete.opening_book = Some(Book::default());
            complete.solve(&p, &a, &b);
            let mut complete = complete.opening_book.take().unwrap();
            complete.finish();
            assert_eq!(project(&complete, scores, depth).unwrap().rows, book.rows,
                "direct capture and full projection differ at {scores:?}, depth {depth}");
            for (i, own) in a.iter().enumerate() {
                for d in [
                    [0; 13],
                    super::super::tests::counts(&[0, 0]),
                    super::super::tests::counts(&[6, 9]),
                ] {
                    let known = Hand::new(std::array::from_fn(|r| own.initial[r] + d[r]));
                    if known.initial.iter().any(|n| *n > 4) {
                        continue;
                    }
                    let mut baseline = Solver::new(&assets, cut).unwrap();
                    baseline.live = Some(LiveKnowledge {
                        actor: 0,
                        initial: own.initial,
                        known,
                    });
                    let expected = baseline.solve_live(&p, &a, &b, Some(i)).unwrap();
                    let mut fast = Solver::new(&assets, cut).unwrap();
                    fast.live = baseline.live;
                    let actual = private_solve(&mut fast, &book, &p, *own, &b, &known, Some(&a)).unwrap();
                    assert_eq!(
                        actual, expected.live,
                        "scores{scores:?} depth{depth} own{i} discards{d:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn compact_book_roundtrip_and_rejects_bad_context() {
        let directory =
            std::env::temp_dir().join(format!("283-opening-codec-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("book.bin");
        let mut b = Book::default();
        for (i, &h) in hand_ids().iter().enumerate() {
            b.rows.push((17, h, (i % 13) as u8));
            b.rows.push((0x123456789123456789, h, ((i + 1) % 13) as u8));
        }
        b.finish();
        b.write(&path, 4, [15, 11], 0, "test").unwrap();
        assert_eq!(
            Book::read(&path, 4, [15, 11], 0, "test").unwrap().rows,
            b.rows
        );
        for (cut, scores, lead, policy) in [
            (5, [15, 11], 0, "test"),
            (4, [15, 12], 0, "test"),
            (4, [15, 11], 1, "test"),
            (4, [15, 11], 0, "stale"),
        ] {
            assert!(Book::read(&path, cut, scores, lead, policy).is_err());
        }
        let mut bytes = std::fs::read(&path).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        std::fs::write(&path, bytes).unwrap();
        assert!(Book::read(&path, 4, [15, 11], 0, "test").is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
