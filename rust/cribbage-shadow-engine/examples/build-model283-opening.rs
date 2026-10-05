use std::path::Path;
fn main() -> Result<(), String> {
    let a: Vec<_> = std::env::args().collect();
    if a.len() != 7 && a.len() != 8 {
        return Err("usage: build-model283-opening ASSETS OUTPUT CUT_RANK PONE_SCORE DEALER_SCORE LEAD_RANK [PRODUCTION_OUTPUT]".into());
    }
    let number = |i: usize| a[i].parse::<i32>().map_err(|e| e.to_string());
    let cut = u8::try_from(number(3)?).map_err(|e| e.to_string())?;
    let lead = u8::try_from(number(6)?).map_err(|e| e.to_string())?;
    let r = cribbage_shadow_engine::model1323::build_model283_opening(
        Path::new(&a[1]),
        Path::new(&a[2]),
        cut,
        [number(4)?, number(5)?],
        lead,
    )?;
    let result = if let Some(production) = a.get(7) {
        let shallow = cribbage_shadow_engine::model1323::project_model283_opening(
            Path::new(&a[1]), Path::new(&a[2]), Path::new(production), cut, [number(4)?, number(5)?], lead, 2)?;
        serde_json::json!({"status":"passed","full":r,"production":shallow})
    } else { r };
    println!("{result}");
    Ok(())
}
