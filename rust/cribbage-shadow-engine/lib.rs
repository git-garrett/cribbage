pub mod artifacts;
pub mod board;
pub mod board_matrix;
pub mod cards;
pub mod decision;
pub mod dynamic;
pub mod game;
pub mod information_set;
pub mod model;
pub mod model132;
pub mod model162;
pub mod model90;
pub mod model91;
pub mod model91_discard;
pub mod model_id;
pub mod myrmidon;
pub mod playout;
pub mod policy;
pub mod policy_transition;
pub mod sidecar;

#[cfg(test)]
mod tests {
    #[test]
    fn card_self_test_passes() {
        crate::cards::self_test().expect("card self-test should pass");
    }
}
