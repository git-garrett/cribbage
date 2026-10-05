use super::*;
pub(super) fn counts(r: &[u8]) -> Ranks {
    let mut h = [0; 13];
    for &v in r {
        h[v as usize] += 1;
    }
    h
}
pub(super) fn assets() -> PolicyAssets {
    PolicyAssets::load_model205(&Path::new(env!("CARGO_MANIFEST_DIR")).join("assets")).unwrap()
}
fn at_depth(s: State, path: u128, depth: u8, target: u8, visit: &mut impl FnMut(State, u128)) {
    if s.complete() {
        return;
    }
    if depth == target {
        visit(s, path);
        return;
    }
    for (r, _, n) in actions(s) {
        at_depth(n, (path << 4) | u128::from(r + 1), depth + 1, target, visit);
    }
}
type Information = (u128, u64, u8);
fn replay(s: State, path: u128, own: [u64; 2], policy: &HashMap<Information, u8>) -> Endpoint {
    if s.complete() {
        return s.endpoint();
    }
    let rank = policy[&(path, own[s.actor()], s.actor() as u8)];
    let next = actions(s).into_iter().find(|x| x.0 == rank).unwrap().2;
    replay(next, (path << 4) | u128::from(rank + 1), own, policy)
}
// Bounded test-only reference: enumerate legal physical lines at each depth,
// group by legal information, then select backward. No compact reductions.
fn reference(
    rows: &[([Ranks; 2], f64)],
    solver: &Solver,
) -> (Vec<Endpoint>, HashMap<Information, u8>) {
    type Options = BTreeMap<u8, (u8, BTreeMap<(Endpoint, [u8; 2]), f64>)>;
    let mut board = crate::board::BoardModel::from_board_matrix(Arc::clone(
        assets().wp_board.as_ref().unwrap(),
    ));
    let states: Vec<_> = rows
        .iter()
        .map(|(h, _)| State::from_parts(&Position::start([0, 0], [4, 4]), *h))
        .collect();
    let mut policy = HashMap::new();
    for depth in (0..20).rev() {
        let mut groups: HashMap<Information, Options> = HashMap::new();
        for (i, start) in states.iter().enumerate() {
            let own = rows[i].0.map(pack);
            at_depth(*start, 1, 0, depth, &mut |s, path| {
                let options = groups
                    .entry((path, own[s.actor()], s.actor() as u8))
                    .or_default();
                for (r, pts, next) in actions(s) {
                    let end = replay(next, (path << 4) | u128::from(r + 1), own, &policy);
                    *options
                        .entry(r)
                        .or_insert_with(|| (pts, BTreeMap::new()))
                        .1
                        .entry((
                            end,
                            rows[i].0.map(|h| {
                                cards::score_hand_rank_only(
                                    &cards::cards_for_rank_counts_for_scoring(&h),
                                    cards::peg_card_for_rank(solver.cut),
                                )
                            }),
                        ))
                        .or_default() += rows[i].1;
                }
            });
        }
        for (key, options) in groups {
            let sign = if key.2 == 0 { 1.0 } else { -1.0 };
            let mut best = (f64::NEG_INFINITY, 0, 0);
            for (r, (pts, hist)) in options {
                let mass: f64 = hist.values().sum();
                let v: f64 = hist
                    .iter()
                    .map(|((e, show), w)| {
                        // Independent sequential counting, without the compact
                        // solver's key transformation or precomputed WP table.
                        let v = if !solver.count_hands {
                            solver.utility(*e)
                        } else if e[0] >= 121 {
                            1.0
                        } else if e[1] >= 121 {
                            0.0
                        } else if e[0] + i32::from(show[0]) >= 121 {
                            1.0
                        } else if e[1] + i32::from(show[1]) >= 121 {
                            0.0
                        } else {
                            board.future_win_probability_from_scores(
                                e[0] + i32::from(show[0]),
                                e[1] + i32::from(show[1]),
                                Role::Pone,
                                crate::board::ScorePhase::Crib,
                            )
                        };
                        if solver.count_hands {
                            w * v
                        } else {
                            w / mass * v
                        }
                    })
                    .sum();
                let v = if solver.count_hands { v / mass } else { v };
                let c = (sign * v, pts, r);
                if c > best {
                    best = c;
                }
            }
            policy.insert(key, best.2);
        }
    }
    (
        states
            .iter()
            .enumerate()
            .map(|(i, s)| replay(*s, 1, rows[i].0.map(pack), &policy))
            .collect(),
        policy,
    )
}
#[test]
fn backward_groups_match_independent_reference_and_uncompressed_blocks() {
    let assets = assets();
    let aa = [
        counts(&[3, 4, 4, 5]),
        counts(&[0, 1, 2, 3]),
        counts(&[5, 6, 6, 10]),
    ];
    let bb = [
        counts(&[0, 0, 0, 0]),
        counts(&[0, 0, 0, 1]),
        counts(&[6, 6, 9, 9]),
    ];
    let mut rows = vec![];
    for (i, a) in aa.iter().enumerate() {
        for (j, b) in bb.iter().enumerate() {
            if (0..13).all(|r| a[r] + b[r] + u8::from(r == 11) <= 4) {
                rows.push(([*a, *b], ((i + 2) * (j + 1)) as f64));
            }
        }
    }
    let a = aa.map(|h| Hand::counted(h, 11));
    let b = bb.map(|h| Hand::counted(h, 11));
    for (plain, reuse, count_hands) in [
        (false, false, true),
        (false, true, true),
        (true, true, true),
        (false, true, false),
    ] {
        let mut solver = Solver::new(&assets, 11).unwrap();
        solver.record_all = true;
        solver.priors = Priors::Finite(rows.clone());
        solver.force_uncompressed = plain;
        solver.reuse = reuse;
        solver.count_hands = count_hands;
        let out = solver.solve(&Position::start([0, 0], [4, 4]), &a, &b);
        let (expected, policy) = reference(&rows, &solver);
        for (i, (h, _)) in rows.iter().enumerate() {
            let ai = a.iter().position(|x| x.initial == h[0]).unwrap();
            let bi = b.iter().position(|x| x.initial == h[1]).unwrap();
            assert_eq!(decode(out.get(ai, bi)), expected[i]);
        }
        assert!(solver.book.len() > 2000);
        for (key, rank) in solver.book {
            assert_eq!(policy.get(&key), Some(&rank));
        }
        assert_eq!(solver.stats.live_bytes, 0);
    }
}
#[test]
fn indistinguishable_hidden_cards_cannot_choose_two_different_moves() {
    let assets = assets();
    let a = counts(&[3, 6]);
    let b = [counts(&[3]), counts(&[6])];
    let mut solver = Solver::new(&assets, 11).unwrap();
    solver.record_all = true;
    solver.priors = Priors::Finite(vec![([a, b[0]], 0.25), ([a, b[1]], 0.75)]);
    let out = solver.solve(
        &Position::start([118, 119], [2, 1]),
        &[Hand::new(a)],
        &b.map(Hand::new),
    );
    assert_eq!(solver.book[&(1, pack(a), 0)], 3);
    assert_eq!(
        0.25 * solver.utility(decode(out.get(0, 0))) + 0.75 * solver.utility(decode(out.get(0, 1))),
        0.75
    );
}
fn observation(p: &Position, own: Ranks, discards: Ranks, cut: u8) -> Model132Observation {
    let actor = p.actor as usize;
    let relative = |a| {
        if a == actor as u8 {
            InfoActor::SelfPlayer
        } else {
            InfoActor::Opponent
        }
    };
    Model132Observation {
        role: if actor == 0 { Role::Pone } else { Role::Dealer },
        my_score: p.scores[actor],
        opponent_score: p.scores[1 - actor],
        own_remaining: std::array::from_fn(|r| own[r] - p.played[actor][r]),
        own_played: p.played[actor],
        opponent_played: p.played[1 - actor],
        own_discards: discards,
        turn_rank: cut,
        current_series: p.series.to_vec(),
        count: p.count,
        go_player: (p.go < 2).then(|| relative(p.go)),
        last_player: (p.last < 2).then(|| relative(p.last)),
        public_history: p
            .events
            .iter()
            .map(|&(a, r)| match (a, r) {
                (_, 14) => PublicPegEvent::Reset,
                (a, 13) if a == p.actor => PublicPegEvent::SelfGo,
                (_, 13) => PublicPegEvent::OpponentGo,
                (a, r) if a == p.actor => PublicPegEvent::SelfPlay(r),
                (_, r) => PublicPegEvent::OpponentPlay(r),
            })
            .collect(),
    }
}
#[test]
fn public_domains_and_weights_match_native_priors_through_both_players_and_go() {
    let assets = assets();
    let pair = [counts(&[10, 12, 12, 12]), counts(&[2, 1, 2, 0])];
    let discards = [counts(&[3, 6]), counts(&[11, 5])];
    let mut p = Position::start([15, 11], [4, 4]);
    for r in [12, 2, 12, 0, 13, 2, 1, 13, 12, 13, 10] {
        let actor = p.actor as usize;
        let o = observation(&p, pair[actor], discards[actor], 4);
        let (rebuilt, domains) = prepare(&assets, &o).unwrap();
        assert_eq!(rebuilt.scores, p.scores);
        if p.left[1 - actor] > 0 {
            let mut solver = Solver::new(&assets, 4).unwrap();
            let w = solver.weights(&p);
            let known = Hand::new(std::array::from_fn(|rank| {
                pair[actor][rank] + discards[actor][rank]
            }));
            let mut expected: BTreeMap<_, _> = assets
                .opponent_keep_weights(&o)
                .unwrap()
                .into_iter()
                .map(|(h, w)| (pack(h), w))
                .collect();
            let actual: Vec<_> = domains[1 - actor]
                .iter()
                .filter_map(|h| {
                    let w = solver.weight(&p, &w, &known, h);
                    (w > 0.0).then_some((pack(h.left), w))
                })
                .collect();
            let et: f64 = expected.values().sum();
            let at: f64 = actual.iter().map(|x| x.1).sum();
            assert_eq!(actual.len(), expected.len());
            for (key, w) in actual {
                let ew = expected.remove(&key).unwrap();
                assert!((w / at - ew / et).abs() < 1e-12);
            }
        }
        // Own discards must never alter the opponent's public hypothetical domain.
        let mut without = o.clone();
        without.own_discards = [0; 13];
        let (_, blind) = prepare(&assets, &without).unwrap();
        for a in 0..2 {
            assert_eq!(
                domains[a].iter().map(|h| h.initial).collect::<Vec<_>>(),
                blind[a].iter().map(|h| h.initial).collect::<Vec<_>>()
            );
        }
        p = p.after(r);
    }
    assert!(p.done);
}
#[test]
fn invalid_history_is_rejected_and_live_discard_rows_remain_conditioned() {
    let assets = assets();
    let p = Position::start([15, 11], [4, 4]);
    let o = observation(&p, counts(&[10, 12, 12, 12]), counts(&[3, 6]), 4);
    let h = assets.opponent_keep_weights(&o).unwrap();
    let mut bad = o.clone();
    bad.public_history.push(PublicPegEvent::OpponentGo);
    assert!(forecast(&assets, &bad, &h, &[RankPegAction::Play(12)]).is_err());
    assert!(forecast(&assets, &o, &h, &[RankPegAction::Go]).is_err());
    let mut blind = o.clone();
    blind.own_discards = [0; 13];
    assert_ne!(h, assets.opponent_keep_weights(&blind).unwrap());
}
// This is an explicit release measurement, never part of the normal test suite.
#[test]
#[ignore = "release full-deck regression: about two minutes on one efficiency core"]
fn frozen_research_opening_distribution_and_choice() {
    // This pins the historical board-only policy, not the new counting policy.
    assert_eq!(
        std::env::var("CRIBBAGE_283_FUTURE_COUNTING").as_deref(),
        Ok("0")
    );
    let assets = assets();
    let o = observation(
        &Position::start([15, 11], [4, 4]),
        counts(&[10, 12, 12, 12]),
        counts(&[3, 6]),
        4,
    );
    let h = assets.opponent_keep_weights(&o).unwrap();
    let f = forecast(&assets, &o, &h, &o.legal_actions()).unwrap();
    let solver = Solver::new(&assets, 4).unwrap();
    let best = f
        .iter()
        .map(|f| {
            let rank = match f.action {
                RankPegAction::Play(r) => r,
                _ => unreachable!(),
            };
            let v: f64 = f
                .outcomes
                .iter()
                .map(|(a, b, w)| w * solver.utility([15 + i32::from(*a), 11 + i32::from(*b)]))
                .sum();
            (v, rank)
        })
        .max_by(|a, b| a.partial_cmp(b).unwrap())
        .unwrap();
    assert_eq!(best.1, 12);
    assert!((best.0 - 0.5135945553983083).abs() < 1e-12);
}

#[test]
fn counting_keys_preserve_order_correlation_and_initial_keep() {
    let assets = assets();
    let solver = Solver::new(&assets, 11).unwrap();
    assert!(solver.count_hands);
    // Pegging ends before counting, even if the loser holds a winning show.
    assert_eq!(solver.value(solver.valuation_key([118, 121], [12, 0])), 0.0);
    assert_eq!(solver.value(solver.valuation_key([121, 118], [0, 12])), 1.0);
    // Both could count out: pone must win first.
    assert_eq!(solver.value(solver.valuation_key([118, 118], [3, 3])), 1.0);
    assert_eq!(solver.value(solver.valuation_key([118, 118], [2, 3])), 0.0);
    // Opposing show and pegging endpoint must remain correlated: both
    // paired cases score out; crossing the shows creates an artificial loss.
    assert_eq!(solver.value(solver.valuation_key([116, 117], [5, 4])), 1.0);
    assert_eq!(solver.value(solver.valuation_key([112, 117], [9, 4])), 1.0);
    assert_eq!(solver.value(solver.valuation_key([112, 117], [5, 4])), 0.0);
    let h = Hand::counted(counts(&[3, 4, 4, 5]), 11);
    assert_eq!(h.after(4).after(3).show, h.show);
    let mut board =
        crate::board::BoardModel::from_board_matrix(Arc::clone(assets.wp_board.as_ref().unwrap()));
    for p in [0, 40, 90, 110, 120] {
        for d in [0, 40, 90, 110, 120] {
            for show in [[0, 0], [2, 12], [12, 2], [20, 20]] {
                let expected = if p + i32::from(show[0]) >= 121 {
                    1.0
                } else {
                    board.future_win_probability_from_scores(
                        p + i32::from(show[0]),
                        d + i32::from(show[1]),
                        Role::Pone,
                        crate::board::ScorePhase::Crib,
                    )
                };
                assert_eq!(solver.value(solver.valuation_key([p, d], show)), expected);
            }
        }
    }
}

#[test]
fn compact_scoring_matches_native_transitions_including_go_31_and_scoreouts() {
    let pairs = [
        ([3, 4, 4, 5], [0, 0, 0, 0]),
        ([0, 5, 7, 7], [3, 5, 6, 8]),
        ([1, 2, 6, 11], [1, 5, 7, 12]),
    ];
    fn visit(s: State, native: RankPegState, visited: &mut usize) {
        *visited += 1;
        assert_eq!(s.endpoint(), native.scores);
        assert_eq!(s.complete(), native.complete || native.winner.is_some());
        if s.complete() {
            return;
        }
        assert_eq!(s.actor(), native.current.index());
        for (r, _, next) in actions(s) {
            let action = if r == 13 {
                RankPegAction::Go
            } else {
                RankPegAction::Play(r)
            };
            assert!(native.legal_actions().contains(&action));
            let mut n = native.clone();
            n.apply(action).unwrap();
            visit(next, n, visited);
        }
    }
    let mut visited = 0;
    for (a, b) in pairs {
        for scores in [[0, 0], [118, 116]] {
            let h = [counts(&a), counts(&b)];
            let compact = State::from_parts(&Position::start(scores, [4, 4]), h);
            let native = RankPegState {
                hands: h,
                own_discards: [[0; 13]; 2],
                turn_rank: 10,
                scores,
                dealer: PegSeat::One,
                current: PegSeat::Zero,
                plays: vec![],
                count: 0,
                go_player: None,
                last_player: None,
                history: vec![],
                winner: None,
                complete: false,
            };
            visit(compact, native, &mut visited);
        }
    }
    assert!(visited > 1000);
}

#[test]
fn optimized_posterior_preserves_dense_arithmetic_bits() {
    let assets = assets();
    let mut solver = Solver::new(&assets, 4).unwrap();
    let pair = [counts(&[10, 12, 12, 12]), counts(&[2, 1, 2, 0])];
    let mut p = Position::start([15, 11], [4, 4]);
    let mut checked = 0;
    for rank in [12, 2, 12, 0, 13, 2, 1, 13, 12, 13, 10] {
        let actor = p.actor as usize;
        let o = observation(&p, pair[actor], [0; 13], 4);
        let (_, domains) = prepare(&assets, &o).unwrap();
        if p.left[1 - actor] == 0 {
            p = p.after(rank);
            continue;
        }
        let mut w = solver.weights(&p);
        for likelihood in [1_000_000, 999_983, 1, 0] {
            w.likelihood[rank.min(12) as usize] = likelihood;
            for own in domains[actor].iter().step_by(17) {
                for other in &domains[1 - actor] {
                    assert_eq!(other.packed_left, pack(other.left));
                    let mut expected = 0.0;
                    if solver.compatible(own, other) {
                        expected = *w.raw.get(&pack(other.left)).unwrap_or(&0.0);
                        for r in 0..13 {
                            let n = other.left[r];
                            let available =
                                4 - own.initial[r] - w.seen[r] - u8::from(r == solver.cut as usize);
                            expected *= choose(available, n) / choose(4 - w.seen[r], n);
                            if n > 0 {
                                expected = expected * f64::from(w.likelihood[r]) / 1_000_000.0;
                            }
                        }
                    }
                    assert_eq!(
                        solver.weight(&p, &w, own, other).to_bits(),
                        expected.to_bits()
                    );
                    checked += 1;
                }
            }
        }
        p = p.after(rank);
    }
    assert!(checked > 100_000);
}
#[test]
fn physical_iterator_matches_reference_actions_through_complete_hands() {
    fn visit(s: State, n: &mut usize) {
        if s.complete() {
            return;
        }
        let expected = actions(s);
        let actual: Vec<_> = action_iter(s).collect();
        assert_eq!(actual, expected);
        *n += 1;
        for (_, _, next) in actual {
            visit(next, n);
        }
    }
    let mut n = 0;
    for (a, b) in [([3, 4, 4, 5], [0, 0, 0, 1]), ([6, 7, 8, 9], [5, 6, 10, 12])] {
        let p = Position::start([0, 0], [4, 4]);
        visit(State::from_parts(&p, [counts(&a), counts(&b)]), &mut n);
    }
    assert!(n > 1000);
}

#[test]
fn corrected_physical_scoring_matches_reference_through_complete_hands() {
    fn visit(s: State, n: &mut usize) {
        let expected_mask = if s.complete() {
            0
        } else {
            (0..13).fold(0, |m, r| {
                m | if s.copies(s.actor(), r) > 0 && s.test_count() + cards::VALUES[r] <= 31 {
                    1 << r
                } else {
                    0
                }
            })
        };
        assert_eq!(s.mask(), expected_mask);
        if s.complete() {
            return;
        }
        for (_, _, next) in action_iter(s) {
            // Every nonempty current series, including zero-point prefixes.
            if !next.test_series().is_empty() {
                assert_eq!(
                    physical::score_known_count(next.test_series(), next.test_count()),
                    cards::score_count_ranks(next.test_series())
                );
            }
            *n += 1;
            visit(next, n);
        }
    }
    let mut n = 0;
    for h in [
        [counts(&[3, 4, 4, 5]), counts(&[0, 0, 0, 1])],
        [counts(&[0, 0, 1, 1]), counts(&[0, 0, 1, 1])],
        [counts(&[5, 6, 6, 10]), counts(&[6, 6, 9, 9])],
    ] {
        for board in [[0, 0], [111, 114], [118, 119]] {
            visit(
                State::from_parts(&Position::start(board, [4, 4]), h),
                &mut n,
            );
        }
    }
    assert!(n > 1000);
}

#[test]
fn corrected_physical_loop_matches_recorded_policy_endpoints() {
    let assets = assets();
    let a = [
        counts(&[3, 4, 4, 5]),
        counts(&[0, 1, 2, 3]),
        counts(&[5, 6, 6, 10]),
    ]
    .map(|h| Hand::counted(h, 11));
    let b = [
        counts(&[0, 0, 0, 0]),
        counts(&[0, 0, 0, 1]),
        counts(&[6, 6, 9, 9]),
    ]
    .map(|h| Hand::counted(h, 11));
    let mut rows = vec![];
    for (i, x) in a.iter().enumerate() {
        for (j, y) in b.iter().enumerate() {
            if (0..13).all(|r| x.initial[r] + y.initial[r] + u8::from(r == 11) <= 4) {
                rows.push(([x.initial, y.initial], ((i + 2) * (j + 1)) as f64));
            }
        }
    }
    for scores in [[0, 0], [111, 114], [118, 116]] {
        let p = Position::start(scores, [4, 4]);
        let mut base = Solver::new(&assets, 11).unwrap();
        base.priors = Priors::Finite(rows.clone());
        base.record_all = true;
        let expected = base.solve(&p, &a, &b);
        {
            let mut c = Solver::new(&assets, 11).unwrap();
            c.priors = Priors::Finite(rows.clone());
            c.record_all = false;
            let actual = c.solve(&p, &a, &b);
            for i in 0..a.len() {
                for j in 0..b.len() {
                    assert_eq!(
                        actual.get(i, j),
                        expected.get(i, j),
                        "board{scores:?},pair{i},{j}"
                    );
                }
            }
            assert_eq!(c.stats.live_bytes, 0);
        }
    }
}

#[test]
fn forced_support_matches_full_weights_on_legal_public_domains() {
    let assets = assets();
    let mut solver = Solver::new(&assets, 4).unwrap();
    let pair = [counts(&[10, 12, 12, 12]), counts(&[2, 1, 2, 0])];
    let mut p = Position::start([15, 11], [4, 4]);
    let mut checked = 0;
    for rank in [12, 2, 12, 0, 13, 2, 1, 13, 12, 13, 10] {
        let actor = p.actor as usize;
        let (_, domains) = prepare(&assets, &observation(&p, pair[actor], [0; 13], 4)).unwrap();
        if p.left[1 - actor] > 0 {
            let mut w = solver.weights(&p);
            for floor in [false, true] {
                if floor {
                    for x in &mut w.likelihood {
                        if *x > 0 {
                            *x = 1;
                        }
                    }
                }
                for own in domains[actor].iter().step_by(17) {
                    for other in &domains[1 - actor] {
                        let raw = *w.raw.get(&other.packed_left).unwrap_or(&0.0);
                        assert!((0..13).all(|r| other.left[r] == 0 || w.likelihood[r] > 0));
                        assert_eq!(
                            solver.supported(&p, &w, own, other, raw),
                            solver.weight_prepared(&p, &w, own, other, Some(raw)) > 0.0
                        );
                        checked += 1;
                    }
                }
            }
        }
        p = p.after(rank);
    }
    assert!(checked > 50_000);
}
// Independent finite-support continuation reference. B always uses the saved
// public policy; A chooses once per public path across its compatible B holds.
fn private_reference(
    p: &Position,
    initial: [Vec<Hand>; 2],
    actor: usize,
    actual: Ranks,
    known: &Hand,
    weights: &[([Ranks; 2], f64)],
    base: &Solver,
) -> (Vec<Endpoint>, HashMap<u128, u8>) {
    let own = initial[actor].iter().find(|h| h.initial == actual).unwrap();
    let opponents = &initial[1 - actor];
    let mut private = HashMap::new();
    fn follow(
        mut s: State,
        mut path: u128,
        actor: usize,
        hands: [u64; 2],
        private: &HashMap<u128, u8>,
        base: &Solver,
        shows: [u8; 2],
    ) -> Endpoint {
        while !s.complete() {
            let legal = actions(s);
            let rank = if legal.len() == 1 {
                legal[0].0
            } else if s.actor() == actor {
                private[&path]
            } else if s.empty(0) || s.empty(1) {
                base.uncontested_choice(s, shows).0
            } else {
                base.book[&(path, hands[s.actor()], s.actor() as u8)]
            };
            s = actions(s).into_iter().find(|x| x.0 == rank).unwrap().2;
            path = (path << 4) | u128::from(rank + 1);
        }
        s.endpoint()
    }
    for depth in (0..24).rev() {
        let mut groups: BTreeMap<u128, BTreeMap<u8, (u8, f64, f64)>> = BTreeMap::new();
        for other in opponents {
            if !base.compatible(known, other) {
                continue;
            }
            let pair = if actor == 0 {
                [own.initial, other.initial]
            } else {
                [other.initial, own.initial]
            };
            let w = weights.iter().find(|x| x.0 == pair).map_or(0.0, |x| x.1);
            if w == 0.0 {
                continue;
            }
            let h = if actor == 0 {
                [own.left, other.left]
            } else {
                [other.left, own.left]
            };
            at_depth(State::from_parts(p, h), p.path, 0, depth, &mut |s, path| {
                if s.actor() != actor {
                    return;
                }
                for (rank, pts, next) in actions(s) {
                    let end = follow(
                        next,
                        (path << 4) | u128::from(rank + 1),
                        actor,
                        pair.map(pack),
                        &private,
                        base,
                        if actor == 0 {
                            [own.show, other.show]
                        } else {
                            [other.show, own.show]
                        },
                    );
                    let shows = if actor == 0 {
                        [own.show, other.show]
                    } else {
                        [other.show, own.show]
                    };
                    let value = base.value(base.valuation_key(end, shows));
                    let v = groups
                        .entry(path)
                        .or_default()
                        .entry(rank)
                        .or_insert((pts, 0.0, 0.0));
                    v.1 += w * value;
                    v.2 += w;
                }
            });
        }
        for (path, opts) in groups {
            let mut best = (f64::NEG_INFINITY, 0, 0);
            for (r, (pts, v, mass)) in opts {
                let c = (if actor == 0 { v / mass } else { -v / mass }, pts, r);
                if c > best {
                    best = c;
                }
            }
            private.insert(path, best.2);
        }
    }
    let ends = opponents
        .iter()
        .map(|other| {
            if !base.compatible(known, other) {
                return [-1, -1];
            }
            let pair = if actor == 0 {
                [own.initial, other.initial]
            } else {
                [other.initial, own.initial]
            };
            let h = if actor == 0 {
                [own.left, other.left]
            } else {
                [other.left, own.left]
            };
            follow(
                State::from_parts(p, h),
                p.path,
                actor,
                pair.map(pack),
                &private,
                base,
                if actor == 0 {
                    [own.show, other.show]
                } else {
                    [other.show, own.show]
                },
            )
        })
        .collect();
    (ends, private)
}
#[test]
fn discard_continuations_match_independent_reference_and_preserve_opponent_policy() {
    let assets = assets();
    let cut = 11;
    let aa = [
        counts(&[3, 4, 4, 5]),
        counts(&[0, 1, 2, 3]),
        counts(&[5, 6, 6, 10]),
    ]
    .map(|h| Hand::counted(h, cut));
    let bb = [
        counts(&[0, 0, 0, 0]),
        counts(&[0, 0, 0, 1]),
        counts(&[6, 6, 9, 9]),
    ]
    .map(|h| Hand::counted(h, cut));
    let mut rows = vec![];
    for (i, a) in aa.iter().enumerate() {
        for (j, b) in bb.iter().enumerate() {
            if (0..13).all(|r| a.initial[r] + b.initial[r] + u8::from(r == cut as usize) <= 4) {
                rows.push(([a.initial, b.initial], ((i + 2) * (j + 1)) as f64));
            }
        }
    }
    let mut checked = 0;
    let mut changed = 0;
    for scores in [[0, 0], [111, 114], [118, 116]] {
        let p = Position::start(scores, [4, 4]);
        let mut baseline = Solver::new(&assets, cut).unwrap();
        baseline.record_all = true;
        baseline.priors = Priors::Finite(rows.clone());
        let public = baseline.solve(&p, &aa, &bb);
        for actor in 0..2 {
            let domains = [aa.to_vec(), bb.to_vec()];
            for (index, own) in domains[actor].iter().enumerate() {
                for discards in [[0; 13], counts(&[0, 0]), counts(&[6, 9]), counts(&[8, 12])] {
                    let known = Hand::new(std::array::from_fn(|r| own.initial[r] + discards[r]));
                    if known.initial.iter().any(|n| *n > 4) || known.initial[cut as usize] >= 4 {
                        continue;
                    }
                    if !domains[1 - actor]
                        .iter()
                        .any(|h| baseline.compatible(&known, h))
                    {
                        continue;
                    }
                    let mut solver = Solver::new(&assets, cut).unwrap();
                    solver.record_all = true;
                    solver.priors = Priors::Finite(rows.clone());
                    solver.live = Some(LiveKnowledge {
                        actor,
                        initial: own.initial,
                        known,
                    });
                    let result = solver.solve_live(&p, &aa, &bb, Some(index)).unwrap();
                    assert_eq!(
                        solver.book, baseline.book,
                        "live private information changed public policy"
                    );
                    for i in 0..aa.len() {
                        for j in 0..bb.len() {
                            assert_eq!(result.get(i, j), public.get(i, j));
                        }
                    }
                    let (expected, policy) = private_reference(
                        &p,
                        domains.clone(),
                        actor,
                        own.initial,
                        &known,
                        &rows,
                        &baseline,
                    );
                    for (j, e) in expected.iter().enumerate() {
                        if *e == [-1, -1] {
                            assert_eq!(result.live[j], BAD);
                            continue;
                        }
                        assert_eq!(
                            decode(result.live[j]),
                            *e,
                            "actor{actor} own{index} discards{discards:?} other{j}"
                        );
                        if discards == [0; 13] {
                            let original = if actor == 0 {
                                public.get(index, j)
                            } else {
                                public.get(j, index)
                            };
                            assert_eq!(
                                result.live[j], original,
                                "zero-discard ablation changed endpoints"
                            );
                        }
                    }
                    for (path, rank) in &solver.private_book {
                        assert_eq!(Some(rank), policy.get(path));
                        if baseline.book.get(&(*path, pack(own.initial), actor as u8)) != Some(rank)
                        {
                            changed += 1;
                        }
                    }
                    assert_eq!(solver.stats.live_bytes, 0);
                    checked += 1;
                }
            }
        }
    }
    assert!(checked > 40);
    assert!(changed > 0, "test must exercise corrected future choices");
}

#[test]
fn cancellation_interrupts_public_and_forced_solves_without_a_partial_result() {
    let assets = assets();
    let progress = Arc::new(crate::progress::DecisionProgress::default());
    crate::progress::with_progress(Arc::clone(&progress), || {
        let mut solver = Solver::new(&assets, 4).unwrap();
        let hands = [Hand::new(counts(&[0, 1, 2, 3]))];
        let p = Position::start([15, 11], [4, 4]);
        progress.cancel();
        assert_eq!(solver.solve_live(&p, &hands, &hands, None).err().as_deref(),
            Some(crate::progress::CANCELLED_ERROR));
        assert_eq!(solver.suffix(&p, &hands, &hands).err().as_deref(),
            Some(crate::progress::CANCELLED_ERROR));
    });
}
