//! Learned joint pegging POINT distributions. No WP targets or action tables.
use crate::{board::Role, cards::Card, model::DecisionInput};
use serde::{Deserialize,Serialize};
use std::{cell::RefCell,collections::HashMap,path::Path};
type Bin = (i32,i32,f64);
#[derive(Default,Deserialize)]
struct Region {
    axis: Option<usize>,
    #[serde(default)] cut:i32,
    #[serde(default)] id:usize,
    left:Option<Box<Region>>, right:Option<Box<Region>>,
}
impl Region {
    fn label(&self,scores:[i32;2])->Result<usize,String> {
        if let Some(axis)=self.axis {
            if axis>1 {return Err("invalid region axis".into());}
            let child=if scores[axis]<=self.cut {&self.left} else {&self.right};
            child.as_ref().ok_or("missing region child")?.label(scores)
        } else {Ok(self.id)}
    }
}
#[derive(Deserialize)]
struct Table { schema_version:u8, regions:[Region;2], rows:HashMap<String,Vec<Bin>> }
#[derive(Serialize)]
pub struct Input { context:String, prior:Vec<Bin> }
thread_local! {
    static TABLES: RefCell<HashMap<String,Table>> = RefCell::new(HashMap::new());
    static TRACE: RefCell<Option<HashMap<String,Input>>> = const { RefCell::new(None) };
}
pub fn record(enabled:bool) {TRACE.with(|t|*t.borrow_mut()=enabled.then(HashMap::new));}
pub fn take_records()->serde_json::Value {
    TRACE.with(|t|serde_json::to_value(t.borrow_mut().take().unwrap_or_default()).unwrap())
}
fn valid(bins:&[Bin])->bool {
    !bins.is_empty() && bins.iter().all(|&(a,b,p)|a>=0 && b>=0 && p.is_finite() && p>0.)
        && (bins.iter().map(|v|v.2).sum::<f64>()-1.).abs()<1e-9
}
pub(crate) fn distribution(input:&DecisionInput,discard:&[Card],prior:&[Bin])->Result<Option<Vec<Bin>>,String> {
    if crate::model29_snapshot::model_version()!="29.2" {return Ok(None);}
    let own:Vec<_>=input.ai_hand.iter().map(|c|c.id).collect();
    let thrown:Vec<_>=discard.iter().map(|c|c.id).collect();
    let role=usize::from(input.role!=Role::Dealer);
    let scores=[input.ai_score,input.human_score];
    let context=crate::model29_forecast::key(&own,&thrown,[0,0],role==0);
    TRACE.with(|t|if let Some(rows)=t.borrow_mut().as_mut() {
        rows.insert(crate::model29_forecast::key(&own,&thrown,scores,role==0),Input{context:context.clone(),prior:prior.to_vec()});
    });
    let root=crate::model29_snapshot::active_root();
    TABLES.with(|cell| {
        let mut tables=cell.borrow_mut();
        if !tables.contains_key(&root) {
            let file=std::fs::File::open(Path::new(&root).join("rust/cribbage-shadow-engine/assets/model292-pegging.json.xz")).map_err(|e|e.to_string())?;
            let decoder=xz2::read::XzDecoder::new(file);
            let table:Table=serde_json::from_reader(decoder).map_err(|e|e.to_string())?;
            if table.schema_version!=1 || table.rows.values().any(|r|!valid(r)) {return Err("invalid 29.2 joint scoring forecast".into());}
            for region in &table.regions {for a in 0..121 {for b in 0..121 {region.label([a,b])?;}}}
            tables.insert(root.clone(),table);
        }
        let table=&tables[&root];
        let label=table.regions[role].label(scores)?;
        Ok(table.rows.get(&format!("{context}|{label}")).cloned())
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn regions_cover_both_sides_of_the_boundary() {
        let tree:Region=serde_json::from_str(r#"{"axis":0,"cut":59,"left":{"id":0},"right":{"id":1}}"#).unwrap();
        assert_eq!(tree.label([59,120]).unwrap(),0);
        assert_eq!(tree.label([60,0]).unwrap(),1);
        assert!(!valid(&[(1,2,0.4)]));
        assert!(!valid(&[(1,2,f64::NAN)]));
        assert!(valid(&[(1,2,0.4),(3,4,0.6)]));
    }
    #[test]
    fn learned_points_replace_the_histogram_before_valuation() {
        let root=std::env::temp_dir().join(format!("model292-points-{}",std::process::id()));
        let assets=root.join("rust/cribbage-shadow-engine/assets");std::fs::create_dir_all(&assets).unwrap();
        let input=crate::model::parse_decision_input("kind=discard;model=29.2;role=dealer;aiHand=0,2,4,16,18,30;aiScore=40;humanScore=50;turnCard=0").unwrap();
        let cards=[Card::new(0).unwrap(),Card::new(18).unwrap()];
        let context=crate::model29_forecast::key(&[0,2,4,16,18,30],&[0,18],[0,0],true);
        let bytes=serde_json::to_vec(&serde_json::json!({"schema_version":1,"regions":[{},{}],"rows":{format!("{context}|0"):[[4,2,0.5],[6,2,0.5]]}})).unwrap();
        use std::io::Write;
        let file=std::fs::File::create(assets.join("model292-pegging.json.xz")).unwrap();
        let mut writer=xz2::write::XzEncoder::new(file,1);writer.write_all(&bytes).unwrap();writer.finish().unwrap();
        std::fs::write(assets.join("model29-generation.json"),b"{\"model\":\"29.2\"}").unwrap();
        crate::model29_snapshot::activate(root.to_str().unwrap(),false).unwrap();
        assert_eq!(distribution(&input,&cards,&[(1,1,1.)]).unwrap(),Some(vec![(4,2,0.5),(6,2,0.5)]));
        let mut nearby=input.clone();nearby.ai_score=41;
        assert_eq!(distribution(&nearby,&cards,&[(1,1,1.)]).unwrap(),Some(vec![(4,2,0.5),(6,2,0.5)]));
        let other=[Card::new(0).unwrap(),Card::new(2).unwrap()];
        assert_eq!(distribution(&input,&other,&[(1,1,1.)]).unwrap(),None);
        // Both old post-WP overlays are bypassed in this version.
        let mut wp=0.5;let mut board=crate::board::BoardModel::new();
        crate::model29_forecast::adjust(&input,&cards,&mut board,&mut wp).unwrap();
        crate::model291_forecast::adjust(&input,&cards,&mut board,&mut wp).unwrap();
        assert_eq!(wp,0.5);
        std::fs::remove_dir_all(root).unwrap();
    }
}
