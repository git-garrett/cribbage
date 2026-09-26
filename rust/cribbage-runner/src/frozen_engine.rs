//! A separately compiled engine receives only the same legal observation as
//! the native engine. One process per runner worker preserves hand caching.
use cribbage_shadow_engine::board::Role;
use cribbage_shadow_engine::cards::Card;
use cribbage_shadow_engine::information_set::PublicPegEvent;
use cribbage_shadow_engine::model::{Decision, DecisionInput, DecisionKind, PlayerKey};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

pub struct FrozenEngine {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    model: String,
}

impl FrozenEngine {
    pub fn start(binary: &str, root: &str, model: &str) -> Result<Self, String> {
        let mut child = Command::new(binary)
            .env("CRIBBAGE_RUST_MODEL_ROOT", root)
            .env("CRIBBAGE_FROZEN_MODEL", model)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("start frozen engine: {e}"))?;
        Ok(Self {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
            model: model.into(),
        })
    }

    pub fn decide(&mut self, input: &DecisionInput) -> Result<Option<Decision>, String> {
        if input.model != self.model {
            return Ok(None);
        }
        let request = serde_json::json!({"inputText": input_text(input)});
        writeln!(self.input, "{request}")
            .and_then(|_| self.input.flush())
            .map_err(|e| format!("write frozen decision: {e}"))?;
        let mut line = String::new();
        if self
            .output
            .read_line(&mut line)
            .map_err(|e| e.to_string())?
            == 0
        {
            return Err("frozen decision engine exited without a response".into());
        }
        let response: serde_json::Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        if response["ok"] != true || response["model"].as_str() != Some(&self.model) {
            return Err(format!("frozen engine rejected decision: {response}"));
        }
        let value = &response["decision"];
        let optional_card = |name: &str| -> Result<Option<u8>, String> {
            if value[name].is_null() {
                return Ok(None);
            }
            let id = value[name].as_u64().ok_or("invalid frozen card")?;
            if id >= 52 {
                return Err("invalid frozen card ID".into());
            }
            Ok(Some(id as u8))
        };
        let ev = value["ev"].as_f64();
        let win_probability = value["winProbability"].as_f64();
        let decision = match input.kind {
            DecisionKind::Discard => {
                let cards = value["cardIds"]
                    .as_array()
                    .ok_or("missing frozen discards")?;
                let card_ids = cards
                    .iter()
                    .map(|id| {
                        id.as_u64()
                            .filter(|id| *id < 52)
                            .map(|id| id as u8)
                            .ok_or("invalid frozen discard".to_string())
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                Decision::Discard {
                    card_ids,
                    best_lead: optional_card("bestLead")?,
                    ev,
                    win_probability,
                }
            }
            DecisionKind::Peg => Decision::Peg {
                action: value["action"]
                    .as_str()
                    .ok_or("missing frozen action")?
                    .into(),
                card_id: optional_card("cardId")?,
                ev,
                win_probability,
                model16_policy: None,
            },
        };
        Ok(Some(decision))
    }
}

impl Drop for FrozenEngine {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn input_text(input: &DecisionInput) -> String {
    let cards = |cards: &[Card]| {
        cards
            .iter()
            .map(|c| c.id.to_string())
            .collect::<Vec<_>>()
            .join(",")
    };
    let player = |p: PlayerKey| if p == PlayerKey::Ai { "ai" } else { "human" };
    let history = input
        .public_history
        .iter()
        .map(|event| match event {
            PublicPegEvent::SelfPlay(rank) => format!("s{rank}"),
            PublicPegEvent::OpponentPlay(rank) => format!("o{rank}"),
            PublicPegEvent::SelfGo => "sg".into(),
            PublicPegEvent::OpponentGo => "og".into(),
            PublicPegEvent::Reset => "r".into(),
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("kind={};model={};player={};role={};aiScore={};humanScore={};aiHand={};aiTable={};humanTable={};humanHandCount={};ownDiscards={};turnCard={};count={};turn={};go={};last={};plays={};pegHistory={};pegLead={};decisionSeed={}",
        if input.kind == DecisionKind::Discard { "discard" } else { "peg" }, input.model,
        player(input.player), if input.role == Role::Dealer { "dealer" } else { "pone" },
        input.ai_score, input.human_score, cards(&input.ai_hand), cards(&input.ai_table),
        cards(&input.human_table), input.human_hand_count, cards(&input.own_discards), input.turn_card.id,
        input.count, player(input.turn), input.go_player.map_or("-", player),
        input.last_player.map_or("-", player), cards(&input.plays), history,
        input.peg_lead.map_or("-".into(), |lead| lead.to_string()), input.decision_seed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cribbage_shadow_engine::model::parse_decision_input;
    #[test]
    fn frozen_observation_round_trip_preserves_all_legal_fields() {
        let input = parse_decision_input("kind=peg;model=schell_table-peg_table-20.0;role=pone;ownDiscards=1,6;aiHand=4,9;aiTable=0,3;humanTable=2,5;humanHandCount=2;aiScore=119;humanScore=120;turnCard=10;plays=0,2,3,5;count=14;last=human;pegHistory=s0,o2,s3,o5,sg,og,r;decisionSeed=123456789").unwrap();
        let restored = parse_decision_input(&input_text(&input)).unwrap();
        assert_eq!(format!("{restored:?}"), format!("{input:?}"));
    }
}
