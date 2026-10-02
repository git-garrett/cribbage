//! Model 20.6 traversal hints from legally observable contexts.
//! Aggregate rank priors only reorder work; exact evaluation selects the play.
use super::*;
use std::sync::OnceLock;

const EMBEDDED: &[u8] = include_bytes!("assets/model206-root-ordering.json");

#[derive(Deserialize)]
struct Priors {
    ranks: HashMap<String, [[f64; 2]; 13]>,
}

fn priors() -> &'static Priors {
    static PRIORS: OnceLock<Priors> = OnceLock::new();
    PRIORS.get_or_init(|| {
        serde_json::from_slice(EMBEDDED).expect("validated embedded Model 20.6 ordering priors")
    })
}

pub(super) fn rank(action: RankPegAction) -> u8 {
    match action {
        RankPegAction::Play(rank) => rank,
        RankPegAction::Go => 13,
    }
}

pub(super) fn order(o: &Model132Observation, actions: &mut [RankPegAction]) {
    if actions.len() > 1 {
        order_with_priors(priors(), o, actions);
    }
}

fn order_with_priors(table: &Priors, o: &Model132Observation, actions: &mut [RankPegAction]) {
    let role = if o.role == Role::Pone { "p" } else { "d" };
    let phase = if o.own_played.iter().sum::<u8>() == 0 {
        "first"
    } else if o.current_series.is_empty() {
        "reset"
    } else {
        "later"
    };
    let base = format!("{role}:{phase}");
    let one = format!(
        "{base}:c{}:g{}:s{}:one:{}",
        o.count,
        u8::from(o.go_player.is_some()),
        u8::from(o.last_player == Some(InfoActor::SelfPlayer)),
        o.current_series
            .last()
            .map_or(String::new(), |r| r.to_string())
    );
    let mask = actions.iter().fold(0_u16, |m, a| m | (1 << rank(*a)));
    let leaf = format!("{one}:m{mask}");
    let mut predicted = [0.0; 13];
    for &action in actions.iter() {
        let r = rank(action) as usize;
        let mut p = 1.0 / actions.len() as f64;
        // Preserve the tested broad -> last-card -> legal-rank-set smoothing.
        for key in [&base, &one, &leaf] {
            if let Some(row) = table.ranks.get(key) {
                let [wins, n] = row[r];
                p = (wins + 16.0 * p) / (n + 16.0);
            }
        }
        predicted[r] = p;
    }
    actions.sort_by(|a, b| {
        predicted[rank(*b) as usize]
            .total_cmp(&predicted[rank(*a) as usize])
            .then(rank(*a).cmp(&rank(*b)))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        id: String,
        input_text: String,
        order: Vec<u8>,
    }

    fn cases() -> Vec<Case> {
        serde_json::from_str(include_str!("tests/model206-ordering-cases.json")).unwrap()
    }

    #[test]
    fn embedded_priors_are_the_qualified_tested_asset() {
        assert_eq!(
            format!("{:x}", Sha256::digest(EMBEDDED)),
            "5543f601ebdf8a1b03f0a08e67edcae0d823dee2f9f6a6b80a37102a2f12e247"
        );
        assert_eq!(priors().ranks.len(), 19_286);
        for row in priors().ranks.values() {
            for &[wins, n] in row {
                assert!(wins.is_finite() && n.is_finite() && 0.0 <= wins && wins <= n);
            }
        }
    }

    #[test]
    fn all_held_out_traversal_orders_match_the_measured_implementation() {
        let cases = cases();
        assert_eq!(cases.len(), 128);
        for case in cases {
            let input = crate::model::parse_decision_input(&case.input_text).unwrap();
            let o = crate::model::model1323_observation(&input);
            let mut actions = o.legal_actions();
            order(&o, &mut actions);
            assert_eq!(
                actions.into_iter().map(rank).collect::<Vec<_>>(),
                case.order,
                "{}",
                case.id
            );
        }
    }

    #[test]
    fn absent_evidence_uses_ascending_ties_and_single_actions_are_unchanged() {
        let input = crate::model::parse_decision_input(&cases()[0].input_text).unwrap();
        let o = crate::model::model1323_observation(&input);
        let mut actions = o.legal_actions();
        let expected = actions.clone();
        actions.reverse();
        order_with_priors(
            &Priors {
                ranks: HashMap::new(),
            },
            &o,
            &mut actions,
        );
        assert_eq!(actions, expected);
        for action in [RankPegAction::Go, RankPegAction::Play(4)] {
            let mut only = [action];
            order(&o, &mut only);
            assert_eq!(only, [action]);
        }
    }
}
