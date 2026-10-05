// Small complete-hand feasibility harness. One JSON fixture per stdin line;
// scores are pre-cut (the game engine applies Jack-cut points normally).
use cribbage_shadow_engine::{
    cards::{cards_from_ids, Card},
    decision::{recommend_peg_for_side_with_caches, PegDecision},
    game::{CribbageGame, Phase, Side},
    model::Model13HandCache,
    model_id::ModelId,
};
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, Write},
    time::Instant,
};
#[cfg(unix)]
unsafe extern "C" {
    fn clock() -> std::os::raw::c_long;
}
fn cpu() -> Option<f64> {
    #[cfg(unix)]
    {
        Some(unsafe { clock() } as f64 / 1_000_000.0)
    }
    #[cfg(not(unix))]
    {
        None
    }
}
fn progress(value: &Value) -> Result<(), String> {
    if let Ok(path) = std::env::var("CRIBBAGE_283_HAND_PROGRESS") {
        let tmp = format!("{path}.tmp");
        std::fs::write(&tmp, serde_json::to_vec(value).unwrap()).map_err(|e| e.to_string())?;
        std::fs::rename(tmp, path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn run(h: &Value, model: ModelId, root: &str) -> Result<Value, String> {
    let own: Vec<u8> = serde_json::from_value(h["own"].clone()).map_err(|e| e.to_string())?;
    let other: Vec<u8> =
        serde_json::from_value(h["opponent"].clone()).map_err(|e| e.to_string())?;
    let scores: [i32; 2] =
        serde_json::from_value(h["scores"].clone()).map_err(|e| e.to_string())?;
    if own.len() != 6 || other.len() != 6 {
        return Err("fixture requires two six-card deals".into());
    }
    let cut = Card::new(
        h["cut"]
            .as_u64()
            .ok_or("cut missing")?
            .try_into()
            .map_err(|_| "cut out of range")?,
    )?;
    let mut seen = [false; 52];
    for &card in own.iter().chain(&other).chain(std::iter::once(&cut.id)) {
        if card >= 52 || seen[card as usize] {
            return Err("duplicate or invalid fixture card".into());
        }
        seen[card as usize] = true;
    }
    let dealer = match h["dealer"].as_u64() {
        Some(0) => Side::Left,
        Some(1) => Side::Right,
        _ => return Err("invalid dealer".into()),
    };
    let mut game = CribbageGame::new_with_seed(42, dealer);
    game.player_mut(Side::Left).hand = cards_from_ids(&own)?;
    game.player_mut(Side::Right).hand = cards_from_ids(&other)?;
    game.turn_card = cut;
    for side in [Side::Left, Side::Right] {
        game.player_mut(side).score = scores[side.index()];
    }
    game.discard(Side::Left, [own[4], own[5]])?;
    game.discard(Side::Right, [other[4], other[5]])?;
    let start = [
        game.player(Side::Left).score,
        game.player(Side::Right).score,
    ];
    let caches = [Model13HandCache::new(), Model13HandCache::new()];
    let mut rows = vec![];
    let mut first = [true; 2];
    let mut played = 0;
    while game.phase == Phase::Pegging {
        if game.pegging_reset_pending {
            game.acknowledge_pegging_reset();
            continue;
        }
        let side = game.current_player();
        let role = if side == dealer { "dealer" } else { "pone" };
        progress(&json!({"status":"running","decision":rows.len(),"role":role,"rows":rows}))?;
        let t = Instant::now();
        let c = cpu();
        let decision = recommend_peg_for_side_with_caches(
            &game,
            side,
            model,
            None,
            root,
            None,
            Some(&caches[side.index()]),
        )?;
        let wall = t.elapsed().as_secs_f64();
        let cpu = cpu().zip(c).map(|(a, b)| a - b);
        let (rank, ev, wp) = match decision {
            PegDecision::Go => {
                game.say_go(side)?;
                (13, None, None)
            }
            PegDecision::Play {
                card_id,
                ev,
                win_probability,
            } => {
                let rank = Card::new(card_id)?.rank;
                game.play_card(side, card_id)?;
                played += 1;
                (rank, ev, win_probability)
            }
        };
        rows.push(json!({"side":side.index(),"role":role,"first":first[side.index()],"rank":rank,"ev":ev,"wp":wp,"wallSeconds":wall,"cpuSeconds":cpu}));
        first[side.index()] = false;
    }
    if game.phase != Phase::PeggingComplete && game.phase != Phase::GameOver {
        return Err(format!("unexpected phase {:?}", game.phase));
    }
    if played != 8 && game.phase != Phase::GameOver {
        return Err("incomplete pegging hand".into());
    }
    let result = json!({"status":"complete","model":model.as_str(),"rows":rows,"cardsPlayed":played,"postCutStart":start,"scores":[game.player(Side::Left).score,game.player(Side::Right).score],"phase":game.phase,"allMovesLegal":true});
    progress(&result)?;
    Ok(result)
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let root = args.get(1).expect("model root argument");
    let model: ModelId = args
        .get(2)
        .map(String::as_str)
        .unwrap_or("28.3")
        .parse()
        .expect("model ID");
    for line in io::stdin().lock().lines() {
        let result = line
            .map_err(|e| e.to_string())
            .and_then(|line| serde_json::from_str(&line).map_err(|e| e.to_string()))
            .and_then(|h| run(&h, model, root));
        let out = match result {
            Ok(value) => json!({"ok":true,"result":value}),
            Err(error) => json!({"ok":false,"error":error}),
        };
        println!("{out}");
        io::stdout().flush().unwrap();
    }
}
