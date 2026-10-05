//! Reuse complete scoring sequences at explicit starting phases and scores.
//! Range accumulation is exactly equivalent to replaying every start and counting
//! each preterminal phase visit. It never independently relocates later tails.
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{BufRead, BufReader},
    path::Path,
};
const N: usize = 121;
const CELLS: usize = 4 * N * N;
const SEAMS: [&str; 4] = ["discard", "after_discard", "after_pegging", "after_pone"];
#[derive(Clone, Debug)]
struct Series {
    events: Vec<(usize, usize)>,
    markers: Vec<(usize, usize, usize)>,
}
impl Series {
    fn from_json(v: &Value) -> Self {
        Self {
            events: v["events"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| {
                    (
                        x[0].as_u64().unwrap() as usize,
                        x[1].as_u64().unwrap() as usize,
                    )
                })
                .collect(),
            markers: v["markers"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| {
                    (
                        x[0].as_u64().unwrap() as usize,
                        x[1].as_u64().unwrap() as usize,
                        x[2].as_u64().unwrap() as usize,
                    )
                })
                .collect(),
        }
    }
    fn prefix(&self) -> Vec<[usize; 2]> {
        let mut p = vec![[0, 0]];
        for &(actor, points) in &self.events {
            assert!(actor < 2 && points > 0);
            let mut next = *p.last().unwrap();
            next[actor] += points;
            p.push(next);
        }
        p
    }
}
fn cell(seam: usize, d: usize, p: usize) -> usize {
    (seam * N + d) * N + p
}
fn add_range(diff: &mut [i64], phase: usize, d: usize, lo: usize, hi: usize) {
    if lo > hi || lo >= N {
        return;
    }
    let base = (phase * N + d) * (N + 1);
    diff[base + lo] += 1;
    diff[base + hi + 1] -= 1;
}
fn materialize(diff: &[i64]) -> Vec<u64> {
    let mut out = vec![0; CELLS];
    for row in 0..4 * N {
        let mut total = 0;
        for p in 0..N {
            total += diff[row * (N + 1) + p];
            assert!(total >= 0);
            out[row * N + p] = total as u64;
        }
    }
    out
}
fn accumulate(
    s: &Series,
    starts: &[usize],
    obs: &mut [i64],
    wins: &mut [i64],
) -> Result<(), String> {
    let prefix = s.prefix();
    for &start in starts {
        let offset = s.markers[start].0;
        if (0..2)
            .map(|a| prefix.last().unwrap()[a] - prefix[offset][a])
            .max()
            .unwrap()
            < N
        {
            return Err(format!(
                "unresolved zero-score start at phase {}; extend this series before building",
                start
            ));
        }
    }
    for (m, &(offset, phase, dealer)) in s.markers.iter().enumerate() {
        assert!(phase < 4 && dealer < 2 && offset <= s.events.len());
        // First crossing positions for every required gain from this boundary.
        let mut crossing = [[usize::MAX; N + 1]; 2];
        let mut gain = [0usize; 2];
        for (i, &(actor, points)) in s.events[offset..].iter().enumerate() {
            let next = (gain[actor] + points).min(N);
            for need in gain[actor] + 1..=next {
                crossing[actor][need] = i;
            }
            gain[actor] = next;
        }
        let mut cutoff = [-1i32; N];
        for d in 0..N {
            let event = crossing[dealer][N - d];
            if event == usize::MAX {
                continue;
            }
            // Pone wins ties cannot occur: a scoring event has a single actor.
            let slower = (1..=N)
                .find(|&need| crossing[1 - dealer][need] > event)
                .unwrap_or(N + 1);
            cutoff[d] = (N as i32) - slower as i32;
        }
        for &start in starts.iter().filter(|&&a| a <= m) {
            let from = s.markers[start].0;
            let min_d = prefix[offset][dealer] - prefix[from][dealer];
            let min_p = prefix[offset][1 - dealer] - prefix[from][1 - dealer];
            // Scores only increase, so this rectangle is exactly the starts
            // which reach the boundary before either player wins.
            for d in min_d..N {
                add_range(obs, phase, d, min_p, N - 1);
                if cutoff[d] >= min_p as i32 {
                    add_range(wins, phase, d, min_p, cutoff[d] as usize);
                }
            }
        }
    }
    Ok(())
}
#[derive(Default)]
struct Stats {
    games: usize,
    clusters: usize,
    n: Vec<u64>,
    w: Vec<u64>,
    k: Vec<u64>,
    ww: Vec<f64>,
    nw: Vec<f64>,
    nn: Vec<f64>,
}
impl Stats {
    fn new() -> Self {
        Self {
            n: vec![0; CELLS],
            w: vec![0; CELLS],
            k: vec![0; CELLS],
            ww: vec![0.; CELLS],
            nw: vec![0.; CELLS],
            nn: vec![0.; CELLS],
            ..Self::default()
        }
    }
    fn add(&mut self, n: &[u64], w: &[u64], games: usize) {
        self.games += games;
        self.clusters += 1;
        for i in 0..CELLS {
            assert!(w[i] <= n[i]);
            self.n[i] += n[i];
            self.w[i] += w[i];
            self.k[i] += u64::from(n[i] > 0);
            self.ww[i] += (w[i] as f64).powi(2);
            self.nw[i] += (n[i] * w[i]) as f64;
            self.nn[i] += (n[i] as f64).powi(2);
        }
    }
}
fn flush(
    cohort: &str,
    obs: &[i64],
    wins: &[i64],
    games: usize,
    stats: &mut BTreeMap<String, Stats>,
) {
    if games == 0 {
        return;
    }
    let n = materialize(obs);
    let w = materialize(wins);
    for name in [cohort, "pooled"] {
        stats
            .entry(name.into())
            .or_insert_with(Stats::new)
            .add(&n, &w, games);
    }
}
// Sandwich uncertainty is undefined with one contributing seed. The Wilson
// envelope uses Kish's effective cluster count so unanimous sparse evidence
// cannot produce a zero-width interval. These are approximate pointwise bounds.
fn confidence(p: f64, n: f64, k: f64, residual: f64, sum_n2: f64) -> (Option<f64>, f64, f64) {
    if k <= 1. {
        return (None, 0., 1.);
    }
    let se = (k / (k - 1.) * residual / (n * n)).sqrt();
    let effective = n * n / sum_n2;
    let z2 = 1.96f64.powi(2);
    let denominator = 1. + z2 / effective;
    let center = (p + z2 / (2. * effective)) / denominator;
    let radius =
        1.96 * (p * (1. - p) / effective + z2 / (4. * effective * effective)).sqrt() / denominator;
    (
        Some(se),
        (p - 1.96 * se).min(center - radius).max(0.),
        (p + 1.96 * se).max(center + radius).min(1.),
    )
}

fn build(
    input: &Path,
    output: &Path,
    report: &Path,
    starts: &[usize],
) -> Result<(), Box<dyn std::error::Error>> {
    if output.exists() {
        return Err("refusing to overwrite a matrix database".into());
    }
    let mut stats = BTreeMap::new();
    let mut previous = String::new();
    let mut cohort = String::new();
    let mut games = 0;
    let mut obs = vec![0; 4 * N * (N + 1)];
    let mut wins = obs.clone();
    let mut clusters = 0;
    let mut seen = std::collections::HashSet::new();
    for line in BufReader::new(File::open(input)?).lines() {
        let v: Value = serde_json::from_str(&line?)?;
        let cluster = v["cluster"].as_str().ok_or("missing cluster")?;
        if cluster != previous {
            flush(&cohort, &obs, &wins, games, &mut stats);
            if !seen.insert(cluster.to_string()) {
                return Err("noncontiguous duplicate cluster".into());
            }
            previous = cluster.into();
            cohort = v["cohort"].as_str().unwrap().into();
            games = 0;
            obs.fill(0);
            wins.fill(0);
            clusters += 1;
            if clusters % 1000 == 0 {
                println!("processed {} seed clusters", clusters - 1);
            }
        }
        let s = Series::from_json(&v);
        accumulate(&s, starts, &mut obs, &mut wins).map_err(|e| format!("{}: {e}", v["game"]))?;
        games += 1;
    }
    flush(&cohort, &obs, &wins, games, &mut stats);
    let mut db = Connection::open(output)?;
    db.execute_batch("CREATE TABLE matrix_cohorts(cohort TEXT,seam TEXT,source_games INTEGER,seed_clusters INTEGER,PRIMARY KEY(cohort,seam)); CREATE TABLE matrix_cells(cohort TEXT,seam TEXT,dealer_score INTEGER,pone_score INTEGER,wins INTEGER,observations INTEGER,contributing_clusters INTEGER,win_probability REAL,cluster_standard_error REAL,ci95_low REAL,ci95_high REAL,PRIMARY KEY(cohort,seam,dealer_score,pone_score));")?;
    let tx = db.transaction()?;
    let mut summary = json!({"status":"complete","sampling":"equal starts per score and selected first-hand phase; all preterminal visits; fixed recorded decisions","startPhases":starts.iter().map(|&s|SEAMS[s]).collect::<Vec<_>>(),"cohorts":{},"seedClusters":clusters});
    {
        let mut insert = tx.prepare("INSERT INTO matrix_cells VALUES(?,?,?,?,?,?,?,?,?,?,?)")?;
        for (name, s) in &stats {
            for (phase, seam) in SEAMS.iter().enumerate() {
                tx.execute(
                    "INSERT INTO matrix_cohorts VALUES(?,?,?,?)",
                    params![name, seam, s.games, s.clusters],
                )?;
                let mut zero = 0;
                let mut max_se = 0f64;
                for d in 0..N {
                    for p in 0..N {
                        let i = cell(phase, d, p);
                        let n = s.n[i] as f64;
                        let k = s.k[i] as f64;
                        if n == 0. {
                            zero += 1;
                            insert.execute(params![
                                name,
                                seam,
                                d,
                                p,
                                0,
                                0,
                                0,
                                Option::<f64>::None,
                                Option::<f64>::None,
                                Option::<f64>::None,
                                Option::<f64>::None
                            ])?;
                            continue;
                        }
                        let prob = s.w[i] as f64 / n;
                        let residual =
                            (s.ww[i] - 2. * prob * s.nw[i] + prob * prob * s.nn[i]).max(0.);
                        let (se, low, high) = confidence(prob, n, k, residual, s.nn[i]);
                        max_se = max_se.max((high - low) / 2.);
                        insert.execute(params![
                            name, seam, d, p, s.w[i], s.n[i], s.k[i], prob, se, low, high
                        ])?;
                    }
                }
                let slice = &s.n[phase * N * N..(phase + 1) * N * N];
                summary["cohorts"][name][*seam] = json!({"sourceGames":s.games,"seedClusters":s.clusters,"zeroCells":zero,"minimumObservations":slice.iter().min(),"maximumObservations":slice.iter().max(),"totalVisits":slice.iter().sum::<u64>(),"maximumCi95HalfWidth":max_se});
            }
        }
    }
    tx.commit()?;
    std::fs::write(report, serde_json::to_string_pretty(&summary)? + "\n")?;
    println!("Built {} cohorts from {} clusters", stats.len(), clusters);
    Ok(())
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: build_anchored_board INPUT.jsonl OUTPUT.sqlite REPORT.json");
        std::process::exit(2);
    }
    let starts = [0];
    if let Err(e) = build(
        Path::new(&args[1]),
        Path::new(&args[2]),
        Path::new(&args[3]),
        &starts,
    ) {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn oracle(s: &Series, starts: &[usize]) -> (Vec<u64>, Vec<u64>) {
        let mut n = vec![0; CELLS];
        let mut w = n.clone();
        for &start in starts {
            for left in 0..N {
                for right in 0..N {
                    let mut score = [left, right];
                    let mut visited = Vec::new();
                    let mut marker = start;
                    let mut winner = None;
                    for i in s.markers[start].0..s.events.len() {
                        while marker < s.markers.len() && s.markers[marker].0 == i {
                            let (_, phase, dealer) = s.markers[marker];
                            visited.push((cell(phase, score[dealer], score[1 - dealer]), dealer));
                            marker += 1;
                        }
                        let (actor, points) = s.events[i];
                        score[actor] += points;
                        if score[actor] >= N {
                            winner = Some(actor);
                            break;
                        }
                    }
                    let winner = winner.expect("fixture must resolve");
                    for (i, dealer) in visited {
                        n[i] += 1;
                        w[i] += u64::from(winner == dealer);
                    }
                }
            }
        }
        (n, w)
    }
    #[test]
    fn sparse_or_unanimous_clusters_do_not_claim_exact_certainty() {
        assert_eq!(confidence(0., 2., 1., 0., 4.), (None, 0., 1.));
        let (_, low, high) = confidence(0., 10., 10., 0., 10.);
        assert_eq!(low, 0.);
        assert!(high > 0. && high < 1.);
        let (_, low, high) = confidence(1., 10., 10., 0., 10.);
        assert!(low > 0. && low < 1.);
        assert_eq!(high, 1.);
    }

    #[test]
    fn optimized_visits_match_every_direct_replay_in_both_dealer_orientations() {
        for dealer in 0..2 {
            let s = Series {
                events: vec![(0, 2), (1, 7), (0, 1), (1, 12), (0, 4), (0, 121), (1, 121)],
                markers: vec![
                    (0, 0, dealer),
                    (1, 1, dealer),
                    (3, 2, dealer),
                    (4, 3, dealer),
                    (5, 0, 1 - dealer),
                    (5, 1, 1 - dealer),
                    (6, 2, 1 - dealer),
                    (7, 3, 1 - dealer),
                ],
            };
            for starts in [vec![0], vec![0, 1, 2, 3]] {
                let mut n = vec![0; 4 * N * (N + 1)];
                let mut w = n.clone();
                accumulate(&s, &starts, &mut n, &mut w).unwrap();
                let expected = oracle(&s, &starts);
                assert_eq!(materialize(&n), expected.0);
                assert_eq!(materialize(&w), expected.1);
            }
        }
    }
    #[test]
    fn known_winner_counts_when_loser_never_reaches_target() {
        let s = Series {
            events: vec![(0, 121)],
            markers: vec![(0, 0, 0), (0, 1, 0), (0, 2, 0), (0, 3, 0)],
        };
        let mut n = vec![0; 4 * N * (N + 1)];
        let mut w = n.clone();
        accumulate(&s, &[0, 1, 2, 3], &mut n, &mut w).unwrap();
        assert_eq!(materialize(&n), materialize(&w));
        assert_eq!(materialize(&n)[cell(3, 0, 0)], 4);
    }
    #[test]
    fn incomplete_start_fails_instead_of_silently_selecting_resolved_cells() {
        let s = Series {
            events: vec![(0, 1), (1, 1)],
            markers: vec![(0, 0, 0)],
        };
        let mut n = vec![0; 4 * N * (N + 1)];
        let mut w = n.clone();
        assert!(accumulate(&s, &[0], &mut n, &mut w).is_err());
    }
}
