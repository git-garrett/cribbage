pub mod artifacts;
pub mod board;
pub mod cards;
pub mod decision;
pub mod game;
pub mod model;
pub mod model_id;
pub mod playout;
pub mod sidecar;

#[cfg(test)]
mod tests {
    #[test]
    fn card_self_test_passes() {
        crate::cards::self_test().expect("card self-test should pass");
    }
}
