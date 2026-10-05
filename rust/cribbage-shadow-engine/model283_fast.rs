//! Isolated 28.3.fast feasibility laboratory. No ordinary model enables it.
//! A shard stores only dealer choices. The caller's exact private policy is
//! recomputed against these legally grouped choices; no pairwise policy leaks.
use super::*;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::PathBuf;
#[derive(Default)]
pub(super) struct Book {
    pub rows: Vec<(u128, u64, u8)>,
}
impl Book {
    fn finish(&mut self) {
        self.rows.sort_unstable_by_key(|r| (r.0, r.1));
        assert!(self
            .rows
            .windows(2)
            .all(|w| (w[0].0, w[0].1) != (w[1].0, w[1].1)));
    }
    fn get(&self, p: &Position, h: &Hand) -> Result<u8, String> {
        let key = (p.path, pack(h.initial));
        self.rows
            .binary_search_by_key(&key, |r| (r.0, r.1))
            .map(|i| self.rows[i].2)
            .map_err(|_| format!("missing dealer choice at {} / {}", key.0, key.1))
    }
    fn write(&self, path: &Path, cut: u8, scores: Endpoint, lead: u8) -> Result<usize, String> {
        let mut body = Vec::with_capacity(self.rows.len() * 25);
        for &(p, h, r) in &self.rows {
            body.extend(p.to_le_bytes());
            body.extend(h.to_le_bytes());
            body.push(r);
        }
        let header=serde_json::to_vec(&serde_json::json!({"format":1,"policy":"28.3-4cba96d","cut":cut,"scores":scores,"lead":lead,"rows":self.rows.len(),"sha256":format!("{:x}",Sha256::digest(&body))})).unwrap();
        let tmp = path.with_extension("tmp");
        let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        out.write_all(&(header.len() as u32).to_le_bytes())
            .and_then(|_| out.write_all(&header))
            .and_then(|_| out.write_all(&body))
            .map_err(|e| e.to_string())?;
        out.sync_all().map_err(|e| e.to_string())?;
        std::fs::rename(tmp, path).map_err(|e| e.to_string())?;
        Ok(4 + header.len() + body.len())
    }
    fn read(path: &Path, cut: u8, scores: Endpoint, lead: u8) -> Result<Self, String> {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        let length =
            u32::from_le_bytes(bytes.get(..4).ok_or("short asset")?.try_into().unwrap()) as usize;
        let header: serde_json::Value =
            serde_json::from_slice(bytes.get(4..4 + length).ok_or("short header")?)
                .map_err(|e| e.to_string())?;
        if header["format"] != 1
            || header["policy"] != "28.3-4cba96d"
            || header["cut"] != cut
            || header["scores"] != serde_json::json!(scores)
            || header["lead"] != lead
        {
            return Err("asset context mismatch".into());
        }
        let body = &bytes[4 + length..];
        if body.len() % 25 != 0
            || header["rows"] != body.len() / 25
            || header["sha256"] != format!("{:x}", Sha256::digest(body))
        {
            return Err("asset integrity mismatch".into());
        }
        let rows = body
            .chunks_exact(25)
            .map(|r| {
                (
                    u128::from_le_bytes(r[..16].try_into().unwrap()),
                    u64::from_le_bytes(r[16..24].try_into().unwrap()),
                    r[24],
                )
            })
            .collect::<Vec<_>>();
        if !rows.iter().all(|r| r.2 < 13)
            || !rows.windows(2).all(|w| (w[0].0, w[0].1) < (w[1].0, w[1].1))
        {
            return Err("invalid asset ordering/action".into());
        }
        Ok(Self { rows })
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
) -> Result<Vec<u16>, String> {
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
        let t = s.suffix(p, &[own], other);
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
            let ends = private_solve(s, book, &p.after(rank as u8), own, &child, known)?;
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
        let ends = private_solve(s, book, &child, own.after(rank), other, known)?;
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
) -> Result<Option<Solved>, String> {
    if std::env::var("FAST_V2").as_deref() == Ok("1") {
        return Ok(None);
    }
    let Ok(dir) = std::env::var("CRIBBAGE_283_FAST_ASSET") else {
        return Ok(None);
    };
    if p.actor != 0 || p.path != 1 {
        return Ok(None);
    };
    let path = Path::new(&dir).join(format!(
        "cut{}-{}-{}-lead{}.bin",
        s.cut, p.scores[0], p.scores[1], lead
    ));
    if !path.exists() {
        return Ok(None);
    }; // Exact ordinary fallback, never substitute a different context.
    let book = Book::read(&path, s.cut, p.scores, lead)?;
    let known = s.live.unwrap().known;
    let live = private_solve(s, &book, next, *own, other, &known)?;
    Ok(Some(Solved {
        table: Table::Constant(BAD),
        live,
    }))
}
unsafe extern "C" {
    fn clock() -> std::os::raw::c_long;
}
fn cpu() -> f64 {
    unsafe { clock() as f64 / 1_000_000.0 }
}
#[test]
#[ignore = "full-deck offline slice, supervisor only"]
fn build_lead_slice() {
    let cut: u8 = std::env::var("FAST_CUT").unwrap().parse().unwrap();
    let scores: Endpoint = serde_json::from_str(&std::env::var("FAST_SCORES").unwrap()).unwrap();
    let lead: u8 = std::env::var("FAST_LEAD").unwrap().parse().unwrap();
    let assets =
        PolicyAssets::load_model205(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap();
    let start = Instant::now();
    let before = cpu();
    let mut all: Vec<_> = assets
        .beliefs
        .score_block_hands(Role::Dealer, [0; 13])
        .unwrap()
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
    let p = Position::start(scores, [4, 4]).after(lead);
    let mut solver = Solver::new(&assets, cut).unwrap();
    solver.fast_book = Some(Book::default());
    let _table = solver.solve(&p, &own, &other);
    let mut book = solver.fast_book.take().unwrap();
    book.finish();
    let solve_cpu = cpu() - before;
    let dir = PathBuf::from(std::env::var("FAST_OUTPUT").unwrap());
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(format!(
        "cut{}-{}-{}-lead{}.bin",
        cut, scores[0], scores[1], lead
    ));
    let n = book.write(&path, cut, scores, lead).unwrap();
    let saved = cpu();
    let read_start = cpu();
    let restored = Book::read(&path, cut, scores, lead).unwrap();
    let load_cpu = cpu() - read_start;
    assert_eq!(book.rows, restored.rows);
    std::fs::write(path.with_extension("json"),serde_json::to_vec_pretty(&serde_json::json!({"status":"passed","cut":cut,"scores":scores,"lead":lead,"rows":book.rows.len(),"bytes":n,"solveCpuSeconds":solve_cpu,"buildCpuSeconds":saved-before,"wallSeconds":start.elapsed().as_secs_f64(),"loadCpuSeconds":load_cpu,"blocks":solver.stats.blocks,"groups":solver.stats.groups,"peakScoreBytes":solver.stats.peak_bytes})).unwrap()).unwrap();
}
#[test]
fn private_replay_matches_shared_private_row() {
    let assets = super::tests::assets();
    let cut = 11;
    let a = [
        super::tests::counts(&[3, 4, 4, 5]),
        super::tests::counts(&[0, 1, 2, 3]),
        super::tests::counts(&[5, 6, 6, 10]),
    ]
    .map(|h| Hand::counted(h, cut));
    let b = [
        super::tests::counts(&[0, 0, 0, 0]),
        super::tests::counts(&[0, 0, 0, 1]),
        super::tests::counts(&[6, 6, 9, 9]),
    ]
    .map(|h| Hand::counted(h, cut));
    for scores in [[0, 0], [111, 114], [118, 116]] {
        let mut public = Solver::new(&assets, cut).unwrap();
        public.fast_book = Some(Book::default());
        let p = Position::start(scores, [4, 4]);
        public.solve(&p, &a, &b);
        let mut book = public.fast_book.take().unwrap();
        book.finish();
        for (i, own) in a.iter().enumerate() {
            for d in [
                [0; 13],
                super::tests::counts(&[0, 0]),
                super::tests::counts(&[6, 9]),
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
                let expected = baseline.solve_live(&p, &a, &b, Some(i));
                let mut fast = Solver::new(&assets, cut).unwrap();
                let actual = private_solve(&mut fast, &book, &p, *own, &b, &known).unwrap();
                assert_eq!(
                    actual, expected.live,
                    "scores{scores:?} own{i} discards{d:?}"
                );
            }
        }
    }
}

// Separate switches for paired screening; no production model reads these.
// 1 prior rows, 2 short scorer, 4 legal masks, 8 utility, 16 holds,
// 32 short scorer with maintained key (an alternative to 2).
pub(super) fn options() -> u32 {
    std::env::var("FAST_OPTIONS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}
struct Prepared {
    priors: HashMap<(u8, u64), Arc<TypedPrior>>,
    utility: Vec<f64>,
    cut: u8,
    holds: Vec<Hand>,
}
thread_local! {static PREPARED:std::cell::RefCell<Option<Prepared>>=const{std::cell::RefCell::new(None)};}
fn ranks_of_size(n: u8) -> Vec<Ranks> {
    fn rec(r: usize, n: u8, h: &mut Ranks, out: &mut Vec<Ranks>) {
        if r == 13 {
            if n == 0 {
                out.push(*h);
            }
            return;
        }
        for k in 0..=n.min(4) {
            h[r] = k;
            rec(r + 1, n - k, h, out);
        }
        h[r] = 0;
    }
    let mut out = Vec::new();
    rec(0, n, &mut [0; 13], &mut out);
    out
}
pub(crate) fn prepare_shared(assets: &PolicyAssets, cut: u8) {
    let mut priors = HashMap::new();
    for actor in 0..2 {
        for n in 0..4 {
            for seen in ranks_of_size(n) {
                let row = assets
                    .beliefs
                    .score_block_hands(if actor == 0 { Role::Dealer } else { Role::Pone }, seen)
                    .unwrap()
                    .map(|(h, w)| (pack(h), w))
                    .collect();
                priors.insert((actor, pack(seen)), Arc::new(row));
            }
        }
    }
    // Generate exactly the current table, with the same loop/arithmetic.
    let mut board =
        crate::board::BoardModel::from_board_matrix(Arc::clone(assets.wp_board.as_ref().unwrap()));
    let mut utility = vec![0.; 128 * 128];
    for pone in 0..=121 {
        for dealer in 0..=121 {
            utility[encode([pone, dealer]) as usize] = board.future_win_probability_from_scores(
                pone,
                dealer,
                Role::Pone,
                crate::board::ScorePhase::Crib,
            );
        }
    }
    let mut holds: Vec<_> = assets
        .beliefs
        .score_block_hands(Role::Dealer, [0; 13])
        .unwrap()
        .map(|(h, _)| h)
        .filter(|h| h[cut as usize] < 4)
        .collect();
    holds.sort();
    holds.dedup();
    let holds = holds.into_iter().map(|h| Hand::counted(h, cut)).collect();
    PREPARED.with(|p| {
        *p.borrow_mut() = Some(Prepared {
            priors,
            utility,
            cut,
            holds,
        })
    });
    short_scores();
}
pub(super) fn prior(actor: u8, seen: u64) -> Arc<TypedPrior> {
    PREPARED.with(|p| {
        Arc::clone(
            &p.borrow()
                .as_ref()
                .expect("prepare test assets first")
                .priors[&(actor, seen)],
        )
    })
}
pub(super) fn utility() -> Option<Vec<f64>> {
    if options() & 8 == 0 {
        return None;
    }
    PREPARED.with(|p| Some(p.borrow().as_ref().unwrap().utility.clone()))
}
pub(super) fn holds(cut: u8) -> Option<Vec<Hand>> {
    if options() & 16 == 0 {
        return None;
    }
    PREPARED.with(|p| {
        let p = p.borrow();
        let p = p.as_ref().unwrap();
        assert_eq!(p.cut, cut);
        Some(p.holds.clone())
    })
}
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
#[test]
fn precomputed_small_tables_are_exact() {
    for count in 0..=31 {
        for r in 0..13 {
            assert_eq!(
                LEGAL[count] & (1 << r) != 0,
                count + cards::VALUES[r] as usize <= 31
            );
        }
    }
    for len in 1..=4 {
        for code in 0..13_usize.pow(len as u32) {
            let mut h = [0; 4];
            let mut n = code;
            for r in h[..len].iter_mut().rev() {
                *r = (n % 13) as u8;
                n /= 13;
            }
            let count = h[..len].iter().map(|&r| cards::VALUES[r as usize]).sum();
            assert_eq!(
                score(&h[..len], count, Some(code)),
                physical::score_known_count(&h[..len], count)
            );
        }
    }
    let assets = super::tests::assets();
    prepare_shared(&assets, 4);
    for actor in 0..2 {
        for n in 0..4 {
            for seen in ranks_of_size(n) {
                let actual = prior(actor, pack(seen));
                for (h, w) in assets
                    .beliefs
                    .score_block_hands(if actor == 0 { Role::Dealer } else { Role::Pone }, seen)
                    .unwrap()
                {
                    assert_eq!(actual[&pack(h)].to_bits(), w.to_bits());
                }
            }
        }
    }
}

#[test]
#[ignore = "supervised opening asset slice"]
fn build_compact_slice() {
    let cut = std::env::var("FAST_CUT").unwrap().parse().unwrap();
    let lead = std::env::var("FAST_LEAD").unwrap().parse().unwrap();
    let scores = serde_json::from_str(&std::env::var("FAST_SCORES").unwrap()).unwrap();
    let out = PathBuf::from(std::env::var("FAST_OUTPUT").unwrap());
    let before = cpu();
    let mut result = opening::build(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("assets"),
        &out,
        cut,
        scores,
        lead,
    )
    .unwrap();
    result["buildCpuSeconds"] = serde_json::json!(cpu() - before);
    std::fs::write(
        out.join(format!(
            "cut{cut}-{}-{}-lead{lead}.json",
            scores[0], scores[1]
        )),
        serde_json::to_vec_pretty(&result).unwrap(),
    )
    .unwrap();
}
