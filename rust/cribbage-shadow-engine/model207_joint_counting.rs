//! Experimental joint terminal counting with the unchanged 20.7 rollout policy.
use super::*;
use crate::model203_crib::{pair_index, Model203CribTable};
use crate::model20_discards::SuitedDiscardRates;
type Ranks = [u8; 13];
type Joint = Vec<(u8, u8, f64)>;

pub(super) fn forecast(
    input: &DecisionInput,
    tables: &RuntimeTables,
    actions: &[RankPegAction],
    cache: Option<&Model13HandCache>,
    prune: bool,
) -> Result<Vec<crate::model1323::joint_rollout::JointForecast>, String> {
    let o = model1323_observation(input);
    let assets = tables.pegging_policy_assets(input)?;
    let prepared = assets.prepare_decision(&o)?;
    prepared.collapse_forced_wp_continuations();
    prepared.use_short_legal_rank_check();
    let table = tables
        .crib_for_model(input)?
        .indexed
        .as_ref()
        .ok_or("joint indexed crib missing")?;
    let rates = assets.suited_discard_rates(other_role(input.role))?;
    let known = known_cards_for_pegging(input);
    let mut masks = [15; 13];
    for c in &known {
        masks[c.rank as usize] &= !(1 << c.suit);
    }
    let mut own = input.ai_table.clone();
    own.extend(&input.ai_hand);
    let own_show = score_hand(&own, input.turn_card, false) as i32;
    let mut board = BoardModel::from_board_matrix(Arc::clone(tables.board_for_model1323(input)?));
    let mut joints: HashMap<(Ranks, Ranks), Joint> = HashMap::new();
    let mut memo = HashMap::new();
    prepared.forecast_joint(
        actions,
        cache.map(|c| &c.model1323),
        prune,
        &mut |h, d, a, b| {
            let scores = (
                input.ai_score + i32::from(a),
                input.human_score + i32::from(b),
            );
            if scores.0 >= 121 {
                return Ok(1.0);
            }
            if scores.1 >= 121 {
                return Ok(0.0);
            }
            if let Some(&v) = memo.get(&(*h, *d, scores)) {
                return Ok(v);
            }
            if !joints.contains_key(&(*h, *d)) {
                // Existing world generation collapses discards at forced opponent tails.
                // Restore the full conditional mixture for counting, without extra rollouts.
                let discard = if h.iter().sum::<u8>() <= 1 {
                    assets.opponent_discard_weights(&o, &[(*h, 1.0)])?
                } else {
                    let mut row = [0.0; 91];
                    let ranks: Vec<_> = d
                        .iter()
                        .enumerate()
                        .flat_map(|(r, n)| std::iter::repeat(r as u8).take(*n as usize))
                        .collect();
                    if ranks.len() != 2 {
                        return Err("joint world discard must have two cards".into());
                    }
                    row[pair_index(ranks[0], ranks[1])] = 1.0;
                    row
                };
                joints.insert((*h, *d), joint(input, &masks, *h, &discard, rates, table)?);
            }
            let v = weighted_probability(joints[&(*h, *d)].iter().map(|&(show, crib, p)| {
                (
                    p,
                    counted_wp(
                        &mut board,
                        input.role,
                        scores,
                        own_show,
                        i32::from(show),
                        i32::from(crib),
                    ),
                )
            }));
            memo.insert((*h, *d, scores), v);
            Ok(v)
        },
    )
}
pub(super) fn select(
    input: &DecisionInput,
    legal: &[Card],
    fs: &[crate::model1323::joint_rollout::JointForecast],
) -> Result<Decision, String> {
    let mut best: Option<(Card, f64, f64, f64)> = None;
    for f in fs {
        let RankPegAction::Play(rank) = f.forecast.action else {
            continue;
        };
        let Some(&card) = legal.iter().find(|c| c.rank == rank) else {
            continue;
        };
        let ev = f
            .forecast
            .outcomes
            .iter()
            .map(|(a, b, w)| w * (f64::from(*a) - f64::from(*b)))
            .sum();
        let mut plays = input.plays.clone();
        plays.push(card);
        let immediate = f64::from(score_count(&plays));
        if best.as_ref().is_none_or(|(c, wp, _, pts)| {
            compare_tuple(
                &[f.wp, immediate, f64::from(rank)],
                &[*wp, *pts, f64::from(c.rank)],
            ) > 0
        }) {
            best = Some((card, f.wp, ev, immediate));
        }
    }
    let (card, wp, ev, _) = best.ok_or("no joint action")?;
    Ok(Decision::Peg {
        action: "play".into(),
        card_id: Some(card.id),
        ev: Some(ev),
        win_probability: Some(wp),
        model16_policy: None,
    })
}

fn weighted_probability(values: impl Iterator<Item = (f64, f64)>) -> f64 {
    let (value, mass) = values.fold((0.0, 0.0), |(v, m), (w, p)| (v + w * p, m + w));
    value / mass
}

fn counted_wp(
    board: &mut BoardModel,
    role: Role,
    (mut own, mut other): (i32, i32),
    own_show: i32,
    other_show: i32,
    crib: i32,
) -> f64 {
    // Evaluate in real counting order, including score-outs before the crib.
    for (ours, points) in if role == Role::Pone {
        [(true, own_show), (false, other_show), (false, crib)]
    } else {
        [(false, other_show), (true, own_show), (true, crib)]
    } {
        if own >= 121 {
            return 1.0;
        }
        if other >= 121 {
            return 0.0;
        }
        if ours {
            own += points;
        } else {
            other += points;
        }
    }
    if own >= 121 {
        1.0
    } else if other >= 121 {
        0.0
    } else {
        board.future_win_probability_from_scores(
            own,
            other,
            next_perspective_role(role, ScorePhase::Crib),
            next_score_phase(ScorePhase::Crib),
        )
    }
}

fn subsets(mask: u8, n: u8) -> impl Iterator<Item = u8> {
    (0..16u8).filter(move |s| s & !mask == 0 && s.count_ones() == u32::from(n))
}

// Enumerate suits only at the discard's two ranks. All other keep suits are
// integrated as integer flush/nobs class counts. Preserve P(keep ranks), the
// uniform legal keep-suit distribution, and P(discard ranks | keep ranks).
fn joint(
    input: &DecisionInput,
    masks: &[u8; 13],
    hand: Ranks,
    discard: &[f64; 91],
    rates: &SuitedDiscardRates,
    table: &Model203CribTable,
) -> Result<Joint, String> {
    let cut = input.turn_card;
    let mut full = hand;
    for c in &input.human_table {
        full[c.rank as usize] += 1;
    }
    let base = crate::cards::score_four_rank_counts(&full, cut.rank) as usize;
    let total: u16 = show_suit_class_counts(masks, &hand, &input.human_table, cut)
        .iter()
        .sum();
    if total == 0 {
        return Err("20.7 joint has no suited keep support".into());
    }
    let own_pair = pair_index(input.own_discards[0].rank, input.own_discards[1].rank);
    let mut bins = [[0.0; 30]; 30];
    for a in 0..13usize {
        for b in a..13usize {
            let index = pair_index(a as u8, b as u8);
            if discard[index] == 0.0 {
                continue;
            }
            let rank_score = table.rank_score(own_pair, cut.rank, index);
            if rank_score == 255 {
                return Err("20.7 joint impossible crib rank support".into());
            }
            let mut remaining = hand;
            remaining[a] = 0;
            remaining[b] = 0;
            for sa in subsets(masks[a], hand[a]) {
                for sb in subsets(
                    if a == b { 0 } else { masks[b] },
                    if a == b { 0 } else { hand[b] },
                ) {
                    let mut known = input.human_table.clone();
                    for (rank, mask) in [(a, sa), (b, sb)] {
                        for suit in 0..4u8 {
                            if mask & (1 << suit) != 0 {
                                known.push(Card::new(suit * 13 + rank as u8)?);
                            }
                        }
                    }
                    let classes = show_suit_class_counts(masks, &remaining, &known, cut);
                    let dsa = masks[a] & !sa;
                    let dsb = masks[b] & !(if a == b { sa } else { sb });
                    let crib = crib_suits(
                        input,
                        a as u8,
                        b as u8,
                        dsa,
                        dsb,
                        rank_score,
                        rates.rate_at(index),
                    );
                    if crib.iter().sum::<f64>() == 0.0 {
                        return Err("20.7 joint conditional crib has no suits".into());
                    }
                    for (bonus, count) in classes.into_iter().enumerate() {
                        if count == 0 {
                            continue;
                        }
                        let p = discard[index] * f64::from(count) / f64::from(total);
                        for (score, &weight) in crib.iter().enumerate() {
                            bins[base + bonus][score] += p * weight;
                        }
                    }
                }
            }
        }
    }
    let mass: f64 = bins.iter().flatten().sum();
    if !mass.is_finite() || (mass - 1.0).abs() > 1e-10 {
        return Err(format!("20.7 joint invalid joint counting mass {mass}"));
    }
    Ok(bins
        .iter()
        .enumerate()
        .flat_map(|(show, row)| {
            row.iter().enumerate().filter_map(move |(crib, &w)| {
                (w > 0.0).then_some((show as u8, crib as u8, w / mass))
            })
        })
        .collect())
}

fn crib_suits(
    input: &DecisionInput,
    a: u8,
    b: u8,
    sa: u8,
    sb: u8,
    rank_score: u8,
    suited_rate: f64,
) -> [f64; 30] {
    let mut out = [0.0; 30];
    let (na, nb) = (sa.count_ones(), sb.count_ones());
    let total = if a == b {
        na * na.saturating_sub(1) / 2
    } else {
        na * nb
    };
    if total == 0 {
        return out;
    }
    let suited = if a == b { 0 } else { (sa & sb).count_ones() };
    let unsuited = total - suited;
    let same = if suited == 0 {
        0.0
    } else if unsuited == 0 {
        1.0 / f64::from(suited)
    } else {
        suited_rate / f64::from(suited)
    };
    let different = if unsuited == 0 {
        0.0
    } else if suited == 0 {
        1.0 / f64::from(unsuited)
    } else {
        (1.0 - suited_rate) / f64::from(unsuited)
    };
    let cut = input.turn_card;
    let own_jack = input
        .own_discards
        .iter()
        .filter(|c| c.rank == 10 && c.suit == cut.suit)
        .count();
    let flush = input.own_discards.iter().all(|c| c.suit == cut.suit);
    for s in 0..4 {
        for t in 0..4 {
            if sa & (1 << s) == 0 || sb & (1 << t) == 0 || (a == b && t <= s) {
                continue;
            }
            let bonus = own_jack
                + usize::from(a == 10 && s == cut.suit)
                + usize::from(b == 10 && t == cut.suit)
                + if flush && s == cut.suit && t == cut.suit {
                    5
                } else {
                    0
                };
            out[rank_score as usize + bonus] += if s == t { same } else { different };
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    fn root() -> String {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .to_str()
            .unwrap()
            .into()
    }
    fn fixture(fields: &str) -> DecisionInput {
        parse_decision_input(&format!("model={MODEL_20_7};kind=peg;{fields}")).unwrap()
    }
    #[test]
    fn compact_joint_matches_physical_cards_and_preserves_show_marginal() {
        let tables = runtime_tables(&root()).unwrap();
        let mut checked = 0;
        for fields in [
            "role=pone;aiHand=49,25,51,12;ownDiscards=3,45;turnCard=43;humanHandCount=4;aiScore=15;humanScore=11",
            "role=dealer;aiHand=1,3,7,8;ownDiscards=10,12;turnCard=4;humanHandCount=4;aiScore=116;humanScore=112",
            "role=pone;aiHand=4,9;aiTable=0,3;ownDiscards=1,6;turnCard=10;humanTable=2,5;humanHandCount=2;aiScore=95;humanScore=96;plays=0,2,3,5;count=14;last=human;pegHistory=s0,o2,s3,o5",
        ] {
            let input=fixture(fields); let o=model1323_observation(&input);
            let assets=tables.pegging_policy_assets(&input).unwrap();
            let hands=assets.opponent_keep_weights(&o).unwrap();
            let known=known_cards_for_pegging(&input);
            let available:Vec<_>=full_deck().into_iter().filter(|c|!known.contains(c)).collect();
            let mut masks=[0u8;13];for c in &available {masks[c.rank as usize]|=1<<c.suit;}
            let table=tables.crib_for_model(&input).unwrap().indexed.as_ref().unwrap();
            let rates=assets.suited_discard_rates(other_role(input.role)).unwrap();
            for &(hand,_) in hands.iter().step_by((hands.len()/7).max(1)) {
                let dw=assets.opponent_discard_weights(&o,&[(hand,1.0)]).unwrap();
                let actual=joint(&input,&masks,hand,&dw,rates,table).unwrap();
                let physical=cards_for_rank_counts(&available,&hand);
                let mut expected=[[0.0;30];30];
                for kept in &physical {
                    let mut h=input.human_table.clone();h.extend(kept);
                    let show=score_hand(&h,input.turn_card,false) as usize;
                    let deck:Vec<_>=available.iter().filter(|c|!kept.contains(c)).copied().collect();
                    let mut pairs:Vec<Vec<(Card,Card)>>=vec![vec![];91];
                    for (i,&a) in deck.iter().enumerate() {for &b in &deck[i+1..] {pairs[pair_index(a.rank,b.rank)].push((a,b));}}
                    for (i,row) in pairs.iter().enumerate() {
                        if dw[i]==0.0 {continue;}
                        assert!(!row.is_empty());
                        let same=row.iter().filter(|(a,b)|a.suit==b.suit).count();
                        let different=row.len()-same;
                        for &(a,b) in row {
                            let probability=if same==0||different==0 {1.0/row.len() as f64}
                                else if a.suit==b.suit {rates.rate_at(i)/same as f64}
                                else {(1.0-rates.rate_at(i))/different as f64};
                            let mut crib=input.own_discards.clone();crib.extend([a,b]);
                            let score=score_hand(&crib,input.turn_card,true) as usize;
                            expected[show][score]+=dw[i]*probability/physical.len() as f64;
                        }
                    }
                }
                let mut actual_bins=[[0.0;30];30];for (show,crib,p) in &actual {actual_bins[*show as usize][*crib as usize]=*p;}
                for show in 0..30 {for crib in 0..30 {assert!((actual_bins[show][crib]-expected[show][crib]).abs()<2e-12,"joint mismatch show={show} crib={crib}");}}
                let marginal=opponent_show_score_outcomes_classes(&input,&available,[WeightedRankHand {ranks:hand,weight:1.0}]);
                for (show,p) in marginal { assert!((actual_bins[show as usize].iter().sum::<f64>()-p).abs()<2e-12); }
                checked+=1;
            }
        }
        assert!(checked >= 21);
    }
    #[test]
    fn suit_counts_need_jack_identity_and_counting_respects_scoreout_order() {
        let cards = |ids: &[u8]| {
            ids.iter()
                .map(|&id| Card::new(id).unwrap())
                .collect::<Vec<_>>()
        };
        let a = cards(&[10, 16, 30, 44]);
        let b = cards(&[23, 3, 30, 44]);
        let cut = Card::new(8).unwrap();
        let counts = |h: &[Card]| {
            let mut n = [0; 4];
            for c in h {
                n[c.suit as usize] += 1;
            }
            n
        };
        assert_eq!(counts(&a), counts(&b));
        assert_eq!(score_hand(&a, cut, false), score_hand(&b, cut, false) + 1);
        let tables = runtime_tables(&root()).unwrap();
        let input=fixture("role=pone;aiHand=1,3,7,8;ownDiscards=10,12;turnCard=4;humanHandCount=4;aiScore=115;humanScore=115");
        let mut board =
            BoardModel::from_board_matrix(Arc::clone(tables.board_for_model1323(&input).unwrap()));
        assert_eq!(
            counted_wp(&mut board, Role::Pone, (115, 115), 6, 6, 10),
            1.0
        );
        assert_eq!(
            counted_wp(&mut board, Role::Dealer, (115, 115), 6, 6, 10),
            0.0
        );
    }

    #[test]
    fn joint_correlation_and_certain_outcomes_are_preserved() {
        let tables = runtime_tables(&root()).unwrap();
        let input = fixture("role=dealer;aiHand=1,3,7,8;ownDiscards=10,12;turnCard=4;humanHandCount=4;aiScore=117;humanScore=118");
        let mut board =
            BoardModel::from_board_matrix(Arc::clone(tables.board_for_model1323(&input).unwrap()));
        let coherent =
            weighted_probability([(118, 2), (114, 6)].into_iter().map(|(score, show)| {
                (
                    0.5,
                    counted_wp(&mut board, Role::Dealer, (117, score), 4, show, 0),
                )
            }));
        let independent =
            weighted_probability([(118, 2), (118, 6), (114, 2), (114, 6)].into_iter().map(
                |(score, show)| {
                    (
                        0.25,
                        counted_wp(&mut board, Role::Dealer, (117, score), 4, show, 0),
                    )
                },
            ));
        assert_eq!(coherent, 1.0);
        assert_eq!(independent, 0.75);
        for p in [0.0, 1.0] {
            assert_eq!(
                weighted_probability((1..1820).map(|n| (1.0 / f64::from(n), p))),
                p
            );
        }
    }

    #[test]
    fn forced_opponent_tail_restores_the_discard_mixture() {
        let tables = runtime_tables(&root()).unwrap();
        let input=fixture("role=pone;aiHand=11,12;aiTable=9,10;ownDiscards=4,5;turnCard=6;humanTable=0,1,2;humanHandCount=1;aiScore=50;humanScore=50;count=0;pegHistory=s9,o0,s10,o1,sg,o2,og,r");
        let o = model1323_observation(&input);
        let assets = tables.pegging_policy_assets(&input).unwrap();
        let mut hand = [0; 13];
        hand[8] = 1;
        let weights = assets.opponent_discard_weights(&o, &[(hand, 1.0)]).unwrap();
        let mut masks = [15; 13];
        for c in known_cards_for_pegging(&input) {
            masks[c.rank as usize] &= !(1 << c.suit);
        }
        let table = tables
            .crib_for_model(&input)
            .unwrap()
            .indexed
            .as_ref()
            .unwrap();
        let rates = assets.suited_discard_rates(other_role(input.role)).unwrap();
        let mixed = joint(&input, &masks, hand, &weights, rates, table).unwrap();
        let mut expected = [[0.0; 30]; 30];
        for (d, &w) in weights.iter().enumerate() {
            if w == 0.0 {
                continue;
            }
            let mut one = [0.0; 91];
            one[d] = 1.0;
            for (show, crib, p) in joint(&input, &masks, hand, &one, rates, table).unwrap() {
                expected[show as usize][crib as usize] += w * p;
            }
        }
        let mut actual = [[0.0; 30]; 30];
        for (show, crib, p) in mixed {
            actual[show as usize][crib as usize] = p;
        }
        for a in 0..30 {
            for b in 0..30 {
                assert!((actual[a][b] - expected[a][b]).abs() < 2e-12);
            }
        }
    }
}
