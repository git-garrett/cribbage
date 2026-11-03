//! Sparse modern discard forecasts. Store sampled terminal hand outcomes, never
//! actions. Context includes the actual pre-cut board and suit-canonical six.
use crate::{board::{BoardModel, Role, ScorePhase}, cards::Card, model::DecisionInput};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path};

#[derive(Default, Deserialize, Serialize)]
pub struct Forecasts {
    pub prior_mass: f64,
    pub rows: HashMap<String, Vec<[i32; 2]>>,
}
thread_local! {
    static TABLES: std::cell::RefCell<HashMap<String, Forecasts>> = std::cell::RefCell::new(HashMap::new());
}
pub fn key(six: &[u8], discard: &[u8], scores: [i32;2], dealer: bool) -> String {
    let mut best: Option<(Vec<u8>, Vec<u8>)> = None;
    for a in 0..4 { for b in 0..4 { for c in 0..4 { for d in 0..4 {
        let suits = [a,b,c,d];
        if (0..4).any(|i|(i+1..4).any(|j|suits[i]==suits[j])) { continue; }
        let remap = |cards: &[u8]| {
            let mut v: Vec<u8> = cards.iter().map(|x|13*suits[(x/13) as usize]+x%13).collect();
            v.sort_unstable(); v
        };
        let value = (remap(six), remap(discard));
        if best.as_ref().is_none_or(|old| value < *old) { best = Some(value); }
    }}}}
    let (six, discard) = best.unwrap();
    format!("{}:{}:{}:{:?}:{:?}",u8::from(dealer),scores[0],scores[1],six,discard)
}

pub(crate) fn adjust(input: &DecisionInput, discard: &[Card], board: &mut BoardModel,
    probability: &mut f64) -> Result<(), String> {
    let root = crate::model29_snapshot::active_root();
    if root.is_empty() { return Ok(()); }
    TABLES.with(|cell| {
        let mut tables = cell.borrow_mut();
        if !tables.contains_key(&root) {
            let path = Path::new(&root).join("rust/cribbage-shadow-engine/assets/model29-forecasts.json");
            let table = if path.exists() {
                serde_json::from_slice::<Forecasts>(&std::fs::read(path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?
            } else { Forecasts::default() };
            if !table.rows.is_empty() && (!table.prior_mass.is_finite() || table.prior_mass <= 0.) {
                return Err("invalid forecast smoothing mass".into());
            }
            tables.insert(root.clone(), table);
        }
        let table = &tables[&root];
        let own: Vec<_> = input.ai_hand.iter().map(|c|c.id).collect();
        let discard: Vec<_> = discard.iter().map(|c|c.id).collect();
        let identity = key(&own,&discard,[input.ai_score,input.human_score],input.role==Role::Dealer);
        let Some(outcomes) = table.rows.get(&identity) else { return Ok(()); };
        let mut wp = 0.;
        for &[mine, other] in outcomes {
            if mine < input.ai_score || other < input.human_score || mine > 121 || other > 121 || (mine == 121 && other == 121) {
                return Err("invalid modern forecast outcome".into());
            }
            wp += board.future_win_probability(mine as f64,other as f64,
                if input.role==Role::Dealer {Role::Pone} else {Role::Dealer},ScorePhase::PeggingPone);
        }
        let mass = table.prior_mass; let n = outcomes.len() as f64;
        *probability = (*probability*mass+wp)/(mass+n);
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_suits_share_context_but_board_and_discard_do_not() {
        let a=key(&[0,2,4,16,18,30],&[0,18],[20,30],true);
        assert_eq!(a,key(&[13,15,17,3,5,43],&[13,5],[20,30],true));
        assert_ne!(a,key(&[0,2,4,16,18,30],&[0,18],[21,30],true));
        assert_ne!(a,key(&[0,2,4,16,18,30],&[0,2],[20,30],true));
    }
    #[test]
    fn sampled_winner_updates_only_the_matching_board() {
        let root=std::env::temp_dir().join(format!("model29-forecast-{}",std::process::id()));
        let assets=root.join("rust/cribbage-shadow-engine/assets");std::fs::create_dir_all(&assets).unwrap();
        let input=crate::model::parse_decision_input("kind=discard;model=29.0;role=dealer;aiHand=0,2,4,16,18,30;aiScore=119;humanScore=120;turnCard=0").unwrap();
        let discard=[Card::new(0).unwrap(),Card::new(18).unwrap()];
        let identity=key(&[0,2,4,16,18,30],&[0,18],[119,120],true);
        std::fs::write(assets.join("model29-generation.json"),b"{}").unwrap();
        let table=Forecasts{prior_mass:2.,rows:HashMap::from([(identity,vec![[121,120],[121,120]])])};
        std::fs::write(assets.join("model29-forecasts.json"),serde_json::to_vec(&table).unwrap()).unwrap();
        crate::model29_snapshot::activate(root.to_str().unwrap(),false).unwrap();
        let mut board=BoardModel::new();let mut wp=0.5;
        adjust(&input,&discard,&mut board,&mut wp).unwrap();assert_eq!(wp,0.75);
        let mut elsewhere=input.clone();elsewhere.ai_score=118;let mut wp=0.5;
        adjust(&elsewhere,&discard,&mut board,&mut wp).unwrap();assert_eq!(wp,0.5);
        std::fs::remove_dir_all(root).unwrap();
    }
}
