//! Root-only joint counting, conditioned on the same legal hand posterior as
//! pegging. Suit classes are integrated here, never added to the policy tree.
use super::*;
use crate::model203_crib::{pair_index, Model203CribTable};
use crate::model20_discards::SuitedDiscardRates;
type Ranks = [u8; 13];
type Joint = Vec<(u8, u8, f64)>; // opposing show, crib, probability

pub(super) struct Values {
    forecasts: Vec<crate::model1323::PegCandidateForecast>,
    probabilities: Vec<f64>,
}
impl Values {
    pub(super) fn select(&self, input: &DecisionInput, legal: &[Card]) -> Result<Decision, String> {
        select_peg_with_values(input, legal, &self.forecasts, &mut |f| {
            self.probabilities[self
                .forecasts
                .iter()
                .position(|x| x.action == f.action)
                .unwrap()]
        })
    }
    pub(super) fn select_action(
        &self,
        input: &DecisionInput,
        card: Card,
    ) -> Result<Decision, String> {
        let i = self
            .forecasts
            .iter()
            .position(|f| f.action == RankPegAction::Play(card.rank))
            .ok_or("28.3 selected action has no forecast")?;
        select_peg_with_values(
            input,
            &[card],
            std::slice::from_ref(&self.forecasts[i]),
            &mut |_| self.probabilities[i],
        )
    }
}

pub(super) fn forecast(
    input: &DecisionInput,
    tables: &RuntimeTables,
    actions: &[RankPegAction],
) -> Result<Values, String> {
    let observation = model1323_observation(input);
    let assets = tables.pegging_policy_assets(input)?;
    let prepared = assets.prepare_decision(&observation)?;
    let forecasts = if input.model==MODEL_28_3_FAST {prepared.forecast_score_blocks_fast(actions)?}else{prepared.forecast_score_blocks_conditioned(actions)?};
    value(input, tables, &observation, forecasts)
}

fn value(
    input: &DecisionInput,
    tables: &RuntimeTables,
    observation: &crate::model132::Model132Observation,
    forecasts: Vec<crate::model1323::ScoreBlockForecast>,
) -> Result<Values, String> {
    let assets = tables.pegging_policy_assets(input)?;
    let table = tables
        .crib_for_model(input)?
        .indexed
        .as_ref()
        .ok_or("28.3 requires indexed crib scores")?;
    let rates = assets.suited_discard_rates(other_role(input.role))?;
    let mut board = BoardModel::from_board_matrix(Arc::clone(tables.board_for_model1323(input)?));
    let known = known_cards_for_pegging(input);
    let mut masks = [15; 13];
    for c in &known {
        masks[c.rank as usize] &= !(1 << c.suit);
    }
    let mut own = input.ai_table.clone();
    own.extend(&input.ai_hand);
    let own_show = score_hand(&own, input.turn_card, false) as i32;
    let mut joints: HashMap<Ranks, Joint> = HashMap::new();
    let mut memo = HashMap::new();
    let mut probabilities = Vec::with_capacity(forecasts.len());
    for f in &forecasts {
        let mut wp = 0.0;
        for &(hand, my, their, weight) in &f.conditioned {
            let scores = (
                input.ai_score + i32::from(my),
                input.human_score + i32::from(their),
            );
            let probability = if scores.0 >= 121 {
                1.0
            } else if scores.1 >= 121 {
                0.0
            } else if let Some(&v) = memo.get(&(hand, scores)) {
                v
            } else {
                if !joints.contains_key(&hand) {
                    let discard = assets.opponent_discard_weights(observation, &[(hand, 1.0)])?;
                    let joint = joint(input, &masks, hand, &discard, rates, table)?;
                    joints.insert(hand, joint);
                }
                let v = weighted_probability(joints[&hand].iter().map(|&(show, crib, p)| {
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
                memo.insert((hand, scores), v);
                v
            };
            wp += weight * probability;
        }
        // Normalize in the same order as the weighted sum. Certain wins/losses
        // remain exactly one/zero instead of tiny roundoff-dependent tie breaks.
        let mass: f64 = f.conditioned.iter().map(|x| x.3).sum();
        probabilities.push(wp / mass);
    }
    Ok(Values {
        probabilities,
        forecasts: forecasts.into_iter().map(|f| f.forecast).collect(),
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
        return Err("28.3 has no suited keep support".into());
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
                return Err("28.3 impossible crib rank support".into());
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
                        return Err("28.3 conditional crib has no suits".into());
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
        return Err(format!("28.3 invalid joint counting mass {mass}"));
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
        parse_decision_input(&format!("model={MODEL_28_3};kind=peg;{fields}")).unwrap()
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

    // One serial worker. Export full distributions for exact search comparison;
    // independently time the old marginal and new joint root valuations.
    #[test]
    #[ignore = "full-deck release measurement"]
    fn compact_counting_measurement() {
        unsafe extern "C" {
            fn clock() -> std::os::raw::c_long;
        }
        let cpu = || unsafe { clock() as f64 / 1_000_000.0 };
        let index: usize = std::env::var("CRIBBAGE_283_FIXTURE")
            .unwrap()
            .parse()
            .unwrap();
        let fixtures: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(std::env::var("CRIBBAGE_283_FIXTURES").unwrap_or_else(|_| {
                "/private/tmp/cribbage-model283-validation-20261003-v1/fixtures.json".into()
            }))
            .unwrap(),
        )
        .unwrap();
        let h = &fixtures[index]["hand"];
        let own = h["own"].as_array().unwrap();
        let ids = |range: std::ops::Range<usize>| {
            range
                .map(|i| own[i].as_u64().unwrap().to_string())
                .collect::<Vec<_>>()
                .join(",")
        };
        let input=fixture(&format!("role=pone;aiHand={};ownDiscards={};turnCard={};humanHandCount=4;aiScore={};humanScore={}",ids(0..4),ids(4..6),h["cut"],h["scores"][0],h["scores"][1].as_i64().unwrap()+if h["cut"].as_u64().unwrap()%13==10 {2}else{0}));
        let tables = runtime_tables(&root()).unwrap();
        let o = model1323_observation(&input);
        let assets = tables.pegging_policy_assets(&input).unwrap();
        crate::model1323::score_blocks::fast::prepare_shared(assets, o.turn_rank);
        let prepared = assets.prepare_decision(&o).unwrap();
        let start = std::time::Instant::now();
        let before = cpu();
        let legal = o.legal_actions();
        let action_index = std::env::var("CRIBBAGE_283_ACTION_INDEX")
            .ok()
            .map(|v| v.parse::<usize>().unwrap());
        let requested = if let Some(i) = action_index {
            &legal[i..i + 1]
        } else {
            &legal[..]
        };
        let f = if std::env::var("FAST_V2").as_deref()==Ok("1") {prepared.forecast_score_blocks_fast(requested)}else{prepared.forecast_score_blocks_conditioned(requested)}.unwrap();
        let search_cpu = cpu() - before;
        let search_wall = start.elapsed().as_secs_f64();
        let search:Vec<_>=f.iter().map(|x|serde_json::json!({"action":format!("{:?}",x.forecast.action),"histogram":x.forecast.outcomes,"conditioned":x.conditioned})).collect();
        let start = std::time::Instant::now();
        let before = cpu();
        let mut old =
            model1323_pegging_win_evaluator(&input, tables, Some(prepared.opponent_hands()))
                .unwrap();
        let old_wp: Vec<f64> = f
            .iter()
            .map(|f| {
                f.forecast
                    .outcomes
                    .iter()
                    .map(|&(my, other, p)| {
                        p * old.win_probability(
                            input.ai_score + i32::from(my),
                            input.human_score + i32::from(other),
                        )
                    })
                    .sum()
            })
            .collect();
        let old_cpu = cpu() - before;
        let old_wall = start.elapsed().as_secs_f64();
        let start = std::time::Instant::now();
        let before = cpu();
        let values = value(&input, tables, &o, f).unwrap();
        let new_cpu = cpu() - before;
        let new_wall = start.elapsed().as_secs_f64();
        let old_decision =
            select_peg_with_values(&input, &input.ai_hand, &values.forecasts, &mut |f| {
                old_wp[values
                    .forecasts
                    .iter()
                    .position(|x| x.action == f.action)
                    .unwrap()]
            })
            .unwrap();
        let new_decision = values.select(&input, &input.ai_hand).unwrap();
        if let Ok(path)=std::env::var("CRIBBAGE_283_ROOT_BOUNDS") {
            let start=std::time::Instant::now();let before=cpu();
            let possibilities=prepared.score_block_root_endpoints(requested).unwrap();
            let physical_cpu=cpu()-before;
            let table=tables.crib_for_model(&input).unwrap().indexed.as_ref().unwrap();
            let rates=assets.suited_discard_rates(other_role(input.role)).unwrap();
            let mut board=BoardModel::from_board_matrix(Arc::clone(tables.board_for_model1323(&input).unwrap()));
            let mut masks=[15;13];for c in known_cards_for_pegging(&input){masks[c.rank as usize]&=!(1<<c.suit);}
            let mut own=input.ai_table.clone();own.extend(&input.ai_hand);let own_show=score_hand(&own,input.turn_card,false) as i32;
            let mut joints=HashMap::new();let mut memo=HashMap::new();let mut bounds=vec![];let mut endpoints=0;
            for (action,rows) in &possibilities {let mut lo=0.0;let mut hi=0.0;let mut mass=0.0;
                for (h,w,ends) in rows {let mut lower=1.0_f64;let mut upper=0.0_f64;endpoints+=ends.len();
                    for &(my,their) in ends {let scores=(input.ai_score+i32::from(my),input.human_score+i32::from(their));
                        let v=if scores.0>=121 {1.0} else if scores.1>=121 {0.0} else if let Some(&v)=memo.get(&(*h,scores)) {v} else {
                            if !joints.contains_key(h){let discard=assets.opponent_discard_weights(&o,&[(*h,1.0)]).unwrap();joints.insert(*h,joint(&input,&masks,*h,&discard,rates,table).unwrap());}
                            let v=weighted_probability(joints[h].iter().map(|&(show,crib,p)|(p,counted_wp(&mut board,input.role,scores,own_show,i32::from(show),i32::from(crib)))));
                            memo.insert((*h,scores),v);v
                        };lower=lower.min(v);upper=upper.max(v);
                    }lo+=w*lower;hi+=w*upper;mass+=w;
                }
                let actual_index=values.forecasts.iter().position(|f|f.action==*action).unwrap();let actual=values.probabilities[actual_index];
                let margin=64.0*f64::EPSILON*(rows.len()+1) as f64;
                assert!(lo/mass-margin<=actual && actual<=hi/mass+margin);
                // Every actually selected policy endpoint must be physically reachable.
                for row in search[actual_index]["conditioned"].as_array().unwrap() {
                    let h:[u8;13]=serde_json::from_value(row[0].clone()).unwrap();let my=row[1].as_u64().unwrap() as u8;let their=row[2].as_u64().unwrap() as u8;
                    assert!(rows.iter().find(|r|r.0==h).unwrap().2.contains(&(my,their)));
                }
                bounds.push(serde_json::json!({"action":format!("{action:?}"),"lower":lo/mass-margin,"upper":hi/mass+margin,"actual":actual}));
            }
            let incumbent=values.probabilities.iter().copied().fold(f64::NEG_INFINITY,f64::max);
            let prunable=bounds.iter().filter(|b|b["upper"].as_f64().unwrap()<incumbent).count();
            fs::write(path,serde_json::to_vec_pretty(&serde_json::json!({"status":"passed","scope":"root-bound feasibility ceiling, oracle-best ordering only","physicalCpu":physical_cpu,"totalCpu":cpu()-before,"totalWall":start.elapsed().as_secs_f64(),"endpointCount":endpoints,"bounds":bounds,"maximumPrunableActions":prunable})).unwrap()).unwrap();
        }
        let report = serde_json::json!({"partialRootActionIndex":action_index,"fixture":index,"reuse":std::env::var("CRIBBAGE_283_REUSE").unwrap(),"searchCpu":search_cpu,"searchWall":search_wall,"marginalCpu":old_cpu,"marginalWall":old_wall,"jointCpu":new_cpu,"jointWall":new_wall,"oldWP":old_wp,"jointWP":values.probabilities,"oldDecision":format!("{old_decision:?}"),"newDecision":format!("{new_decision:?}"),"search":search});
        fs::write(
            std::env::var("CRIBBAGE_283_RESULT").unwrap(),
            serde_json::to_vec(&report).unwrap(),
        )
        .unwrap();
        // Optional post-measurement rendezvous lets the controller capture final
        // native counters before this test process exits. Not a solve timeout.
        if let Ok(ready) = std::env::var("CRIBBAGE_283_MEASURE_READY") {
            fs::write(&ready, b"complete").unwrap();
            let release = format!("{ready}.release");
            let wait = std::time::Instant::now();
            while !std::path::Path::new(&release).exists() && wait.elapsed().as_secs() < 30 {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    }
}
