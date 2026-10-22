//! Per-exact-hand forecast corrections. Only positions share evidence; cards do
//! not. Each role/style fits a regularized residual to the inherited WP value.
use crate::{board::{BoardModel,Role,ScorePhase}, cards::Card, model::DecisionInput};
use serde::{Deserialize,Serialize};
use std::{collections::HashMap,path::Path,cell::RefCell};

#[derive(Default,Deserialize)]
struct Row { coefficients: [[f64;4];3] }
#[derive(Default,Deserialize)]
struct Table { schema_version: u8, rows: HashMap<String,Row> }
#[derive(Clone,Serialize)]
pub struct Input {
    pub context: String,
    pub baseline: f64,
    pub features: [f64;4],
    pub styles: [f64;3], // standard, on, off: opponent behaviour hypotheses
}
thread_local! {
    static TABLES: RefCell<HashMap<String,Table>> = RefCell::new(HashMap::new());
    static TRACE: RefCell<Option<HashMap<String,Input>>> = const { RefCell::new(None) };
}

pub fn context(six: &[u8], discard: &[u8], dealer: bool) -> String {
    // Exact suit isomorphism only. No rank abstraction or similar-hand pooling.
    crate::model29_forecast::key(six,discard,[0,0],dealer)
}
pub fn record(enabled: bool) { TRACE.with(|t| *t.borrow_mut()=enabled.then(HashMap::new)); }
pub fn take_records() -> serde_json::Value {
    TRACE.with(|t|serde_json::to_value(t.borrow_mut().take().unwrap_or_default()).unwrap())
}
fn features(scores: [i32;2], baseline: f64) -> [f64;4] {
    [1.,(scores[0] as f64-60.)/60.,(scores[1] as f64-60.)/60.,2.*baseline-1.]
}
fn styles(input: &DecisionInput, board: &mut BoardModel) -> [f64;3] {
    let a=input.ai_score; let b=input.human_score;
    let value=|board: &mut BoardModel,x:i32,y:i32| board.future_win_probability(
        x as f64,y as f64,input.role,ScorePhase::PeggingPone);
    let now=value(board,a,b);
    // Probe scoring pace without crossing a terminal boundary. At 120 use the
    // backward slope. This is an explicit initial opponent-tempo heuristic,
    // not a Colvert rule or a restriction on either actor's executable moves.
    let step=2.min(120-a.max(b));
    let opponent_gain=if step>0 { (now-value(board,a+step,b+step))*2./step as f64 }
        else { let step=2.min(a.min(b)); if step>0 {
            (value(board,a-step,b-step)-now)*2./step as f64
        } else {0.} };
    let tilt=(opponent_gain/0.02).clamp(-1.,1.);
    [1.-tilt.abs(),tilt.max(0.),(-tilt).max(0.)]
}
fn correction(row: &Row, x: &[f64;4], weights: &[f64;3]) -> f64 {
    (0..3).map(|s|weights[s]*(0..4).map(|i|row.coefficients[s][i]*x[i]).sum::<f64>()).sum()
}
pub(crate) fn adjust(input: &DecisionInput, discard: &[Card], board: &mut BoardModel,
    probability: &mut f64) -> Result<(),String> {
    if crate::model29_snapshot::model_version() != "29.1" { return Ok(()); }
    let root=crate::model29_snapshot::active_root();
    let own: Vec<_>=input.ai_hand.iter().map(|c|c.id).collect();
    let thrown: Vec<_>=discard.iter().map(|c|c.id).collect();
    let scores=[input.ai_score,input.human_score];
    let dealer=input.role==Role::Dealer;
    let data=Input {context:context(&own,&thrown,dealer),baseline:*probability,
        features:features(scores,*probability),styles:styles(input,board)};
    TABLES.with(|cell| -> Result<(),String> {
        let mut tables=cell.borrow_mut();
        if !tables.contains_key(&root) {
            let bytes=std::fs::read(Path::new(&root).join("rust/cribbage-shadow-engine/assets/model291-forecast.json")).map_err(|e|e.to_string())?;
            let table:Table=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;
            if table.schema_version!=1 || table.rows.values().any(|r|r.coefficients.iter().flatten().any(|x|!x.is_finite())) {
                return Err("invalid 29.1 forecast correction".into());
            }
            tables.insert(root.clone(),table);
        }
        if let Some(row)=tables[&root].rows.get(&data.context) {
            *probability=(*probability+correction(row,&data.features,&data.styles)).clamp(0.,1.);
        }
        Ok(())
    })?;
    TRACE.with(|t|if let Some(rows)=t.borrow_mut().as_mut() {
        rows.insert(crate::model29_forecast::key(&own,&thrown,scores,dealer),data);
    });
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_exact_suit_isomorphisms_share_a_hand() {
        let a=context(&[0,2,4,16,18,30],&[0,18],true);
        assert_eq!(a,context(&[13,15,17,3,5,43],&[13,5],true));
        assert_ne!(a,context(&[0,2,5,16,18,30],&[0,18],true));
        assert_ne!(a,context(&[0,2,4,16,18,30],&[0,2],true));
        assert_ne!(a,context(&[0,2,4,16,18,30],&[0,18],false));
    }
    #[test]
    fn board_and_opponent_style_condition_the_correction() {
        let row=Row {coefficients:[[0.1,0.,0.,0.],[0.,0.2,0.,0.],[-0.1,0.,0.,0.]]};
        assert_eq!(correction(&row,&features([60,60],0.5),&[1.,0.,0.]),0.1);
        assert_eq!(correction(&row,&features([60,60],0.5),&[0.,1.,0.]),0.);
        assert_eq!(correction(&row,&features([120,60],0.5),&[0.,1.,0.]),0.2);
        assert_eq!(correction(&row,&features([60,60],0.5),&[0.,0.,1.]),-0.1);
    }
}
